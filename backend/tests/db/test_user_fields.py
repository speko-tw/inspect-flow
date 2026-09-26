"""Tests for ``User``'s business fields (DOM-AC01, DOM-AC02,
DOM-AC03, DOM-AC07, DOM-AC19).

Same fixture pattern as ``test_company.py``: migrates the database
behind ``conftest.py``'s ``db_url`` fixture with the real Alembic
migration chain, then reads and writes it exclusively through
SQLAlchemy (DBF-R01).
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, insert, inspect, update
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Company, User
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

# DOM-R28's length limits, mirroring ``app/models/user.py``'s
# ``_MAX_LENGTHS`` -- duplicated here (not imported) so these tests
# would notice a change to the model's limits rather than silently
# tracking it.
_MAX_LENGTHS = {
    "employee_no": 16,
    "department": 64,
    "location": 64,
    "name_en": 128,
    "name_zh": 64,
    "email": 254,
    "extension_1": 64,
    "extension_2": 64,
    "mobile": 64,
    "line_id": 64,
    "wechat_id": 64,
    "responsibilities": 2000,
}


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(_alembic_config(), "head")
    return db_url


@pytest.fixture
def engine(migrated_url) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def operator(session) -> User:
    """DOM-AC01/AC02/AC03's shared precondition: a self-referential
    operator ``User`` and the ``Company`` it belongs to, built in
    the same transaction (see ``create_root_user_with_company`` in
    ``tests/db/conftest.py`` for why the write order matters).
    """
    user = create_root_user_with_company(session, "OP0001")
    session.commit()
    return user


def _full_user_kwargs(company_id, *, employee_no: str) -> dict:
    """Every DOM-R01/DOM-R03 field at a valid, non-boundary value,
    for building a "normal" ``User`` distinct from ``operator``.
    """
    return {
        "employee_no": employee_no,
        "company_id": company_id,
        "department": "Engineering",
        "location": "Taipei",
        "name_en": "Anna Deng",
        "name_zh": "鄧安娜",
        "email": f"{employee_no.lower()}@example.com",
    }


def _user_kwargs(operator: User, employee_no: str, **overrides) -> dict:
    """``_full_user_kwargs`` plus ``created_by``/``updated_by`` set to
    ``operator``, with any field (including ``email``) replaced by
    ``overrides`` -- the one place callers override a field, instead
    of each call site risking a duplicate keyword argument by both
    spreading ``_full_user_kwargs`` and passing the same key again.
    """
    kwargs = _full_user_kwargs(operator.company_id, employee_no=employee_no)
    kwargs["created_by"] = operator.id
    kwargs["updated_by"] = operator.id
    kwargs.update(overrides)
    return kwargs


class TestDomAc01BasicFieldsAndDefaults:
    """DOM-AC01: DOM-R01/DOM-R03/DOM-R05/DOM-R08's columns all
    exist with the right nullability; ``company_id`` is a foreign
    key into ``companies``; a ``User`` with only the required basic
    fields succeeds and gets the documented defaults; each required
    basic field missing is rejected by the database, row count
    unchanged.
    """

    _NULLABLE_COLUMNS = {
        "extension_1",
        "extension_2",
        "mobile",
        "line_id",
        "wechat_id",
        "responsibilities",
        "external_source",
        "external_id",
        "external_synced_at",
    }
    _NOT_NULL_COLUMNS = {
        "company_id",
        "department",
        "location",
        "employee_no",
        "name_en",
        "name_zh",
        "email",
        "is_active",
        "is_admin",
        "is_system",
        "auth_source",
    }

    def test_table_has_dom_r01_r03_r05_r08_columns(self, engine, operator):
        inspector = inspect(engine)
        columns = {col["name"]: col for col in inspector.get_columns("users")}

        assert self._NOT_NULL_COLUMNS <= columns.keys()
        assert self._NULLABLE_COLUMNS <= columns.keys()
        for name in self._NOT_NULL_COLUMNS:
            assert columns[name]["nullable"] is False, name
        for name in self._NULLABLE_COLUMNS:
            assert columns[name]["nullable"] is True, name

        references = {
            fk["constrained_columns"][0]: fk["referred_table"]
            for fk in inspector.get_foreign_keys("users")
        }
        assert references["company_id"] == "companies"

    def test_user_with_only_required_fields_gets_documented_defaults(
        self, session, operator
    ):
        user = User(**_user_kwargs(operator, "U0001"))
        session.add(user)
        session.commit()
        session.expire(user)

        stored = session.get(User, user.id)
        assert stored.is_active is True
        assert stored.is_admin is False
        assert stored.is_system is False
        assert stored.auth_source == "local"
        assert stored.extension_1 is None
        assert stored.extension_2 is None
        assert stored.mobile is None
        assert stored.line_id is None
        assert stored.wechat_id is None
        assert stored.responsibilities is None
        assert stored.external_source is None
        assert stored.external_id is None
        assert stored.external_synced_at is None

    @pytest.mark.parametrize(
        "missing_field",
        [
            "company_id",
            "department",
            "location",
            "employee_no",
            "name_en",
            "name_zh",
            "email",
        ],
    )
    def test_missing_required_basic_field_is_rejected(
        self, session, operator, missing_field
    ):
        before = session.query(User).count()
        kwargs = _user_kwargs(operator, "U0002")
        del kwargs[missing_field]
        session.add(User(**kwargs))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).count() == before

    @pytest.mark.parametrize(
        "column", ["is_active", "is_admin", "is_system", "auth_source"]
    )
    def test_explicit_null_on_defaulted_column_is_rejected_by_the_database(
        self, session, operator, column
    ):
        """These columns have a Python-side default, so building a
        ``User`` with ``<column>=None`` would just have the ORM
        apply that default instead of sending ``NULL`` -- only a
        Core ``insert()`` bypasses it, proving ``nullable=False`` is
        enforced by the database itself and not only by the
        default (mirrors ``test_company.py``'s
        ``test_null_is_active_is_rejected``).
        """
        before = session.query(User).count()
        kwargs = _user_kwargs(operator, "U0003", **{column: None})
        with pytest.raises(IntegrityError):
            session.execute(insert(User).values(id=uuid7(), **kwargs))
            session.commit()
        session.rollback()

        assert session.query(User).count() == before


class TestDomAc02EmailCaseInsensitiveUniqueness:
    """DOM-AC02: ``email`` uniqueness ignores case and applies to
    disabled accounts too; the stored value keeps its original
    casing.
    """

    @pytest.fixture
    def disabled_user(self, session, operator) -> User:
        user = User(
            **_user_kwargs(
                operator, "U0100", email="a@example.com", is_active=False
            )
        )
        session.add(user)
        session.commit()
        return user

    def test_exact_duplicate_email_is_rejected(
        self, session, operator, disabled_user
    ):
        before = session.query(User).count()
        session.add(
            User(**_user_kwargs(operator, "U0101", email="a@example.com"))
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).count() == before
        matches = [
            u
            for u in session.query(User).all()
            if u.email.lower() == "a@example.com"
        ]
        assert len(matches) == 1

    def test_case_only_difference_is_rejected(
        self, session, operator, disabled_user
    ):
        before = session.query(User).count()
        session.add(
            User(**_user_kwargs(operator, "U0102", email="A@Example.COM"))
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).count() == before
        matches = [
            u
            for u in session.query(User).all()
            if u.email.lower() == "a@example.com"
        ]
        assert len(matches) == 1

    def test_different_email_succeeds_and_round_trips_original_casing(
        self, session, operator, disabled_user
    ):
        user = User(
            **_user_kwargs(operator, "U0103", email="Anna.Deng@Example.com")
        )
        session.add(user)
        session.commit()
        session.expire(user)

        stored = session.get(User, user.id)
        assert stored.email == "Anna.Deng@Example.com"


class TestDomAc03AuthSourceAndExternalIdentity:
    """DOM-AC03: a second ``local`` account (external fields all
    null) and one ``external`` account (both external fields set)
    succeed; an out-of-range ``auth_source``, ``external`` with
    either external field missing, and a duplicate
    (``external_source``, ``external_id``) pair are all rejected,
    row count unchanged.
    """

    def _user(self, operator, employee_no, **overrides):
        return User(**_user_kwargs(operator, employee_no, **overrides))

    def test_second_local_account_with_null_external_fields_succeeds(
        self, session, operator
    ):
        session.add(self._user(operator, "U0200"))
        session.commit()

    def test_external_account_with_both_fields_set_succeeds(
        self, session, operator
    ):
        session.add(
            self._user(
                operator,
                "U0201",
                auth_source="external",
                external_source="ldap",
                external_id="cn=anna",
            )
        )
        session.commit()

    def test_auth_source_outside_allowed_values_is_rejected(
        self, session, operator
    ):
        before = session.query(User).count()
        session.add(self._user(operator, "U0202", auth_source="oauth"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == before

    def test_external_without_external_id_is_rejected(self, session, operator):
        before = session.query(User).count()
        session.add(
            self._user(
                operator,
                "U0203",
                auth_source="external",
                external_source="ldap",
                external_id=None,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == before

    def test_external_without_external_source_is_rejected(
        self, session, operator
    ):
        before = session.query(User).count()
        session.add(
            self._user(
                operator,
                "U0204",
                auth_source="external",
                external_source=None,
                external_id="cn=anna",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == before

    def test_duplicate_external_source_and_id_pair_is_rejected(
        self, session, operator
    ):
        session.add(
            self._user(
                operator,
                "U0205",
                auth_source="external",
                external_source="ldap",
                external_id="cn=dup",
            )
        )
        session.commit()

        before = session.query(User).count()
        session.add(
            self._user(
                operator,
                "U0206",
                auth_source="external",
                external_source="ldap",
                external_id="cn=dup",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == before


class TestDomAc07CreatedByPreventsDeletion:
    """DOM-AC07: a ``User`` referenced by another row's
    ``created_by`` cannot be deleted.
    """

    def test_deleting_a_referenced_user_is_rejected(self, session, operator):
        other = User(**_user_kwargs(operator, "U0300"))
        session.add(other)
        session.commit()

        session.delete(operator)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.get(User, operator.id) is not None


class TestCircularForeignKeyWriteOrder:
    """The risk plan.md's "風險" section documents: ``User.company_id``
    (``DEFERRABLE INITIALLY DEFERRED``) and ``Company.created_by``/
    ``updated_by`` (checked immediately) reference each other, so the
    ``User`` row must be flushed before the ``Company`` row that
    names it as ``created_by`` -- and the reference is still checked
    at commit, so a company that never shows up still fails.
    """

    def test_user_then_company_in_same_transaction_succeeds(self, session):
        user = create_root_user_with_company(session, "CYC001")
        session.commit()
        assert session.get(Company, user.company_id) is not None

    def test_committing_without_the_referenced_company_is_rejected(
        self, session
    ):
        self_id = uuid7()
        missing_company_id = uuid7()
        session.add(
            User(
                id=self_id,
                employee_no="CYC002",
                company_id=missing_company_id,
                department="Engineering",
                location="Taipei",
                name_en="Ghost",
                name_zh="幽靈",
                email="ghost@example.com",
                created_by=self_id,
                updated_by=self_id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).count() == 0


class TestDomAc19StringLengthsAndEmailFormat:
    """DOM-AC19: DOM-R28's length limits are reflected in the
    schema; a ``User`` at every field's exact limit succeeds; one
    character over any limit, or an ``email`` missing ``@`` or
    containing whitespace, is rejected on both insert and update,
    row count/data unchanged.
    """

    _BOUNDARY_VALUES = {
        "employee_no": "E" * _MAX_LENGTHS["employee_no"],
        "department": "D" * _MAX_LENGTHS["department"],
        "location": "L" * _MAX_LENGTHS["location"],
        "name_en": "N" * _MAX_LENGTHS["name_en"],
        "name_zh": "中" * _MAX_LENGTHS["name_zh"],
        "email": ("a" * 242) + "@example.com",
        "extension_1": "1" * _MAX_LENGTHS["extension_1"],
        "extension_2": "2" * _MAX_LENGTHS["extension_2"],
        "mobile": "9" * _MAX_LENGTHS["mobile"],
        "line_id": "L" * _MAX_LENGTHS["line_id"],
        "wechat_id": "W" * _MAX_LENGTHS["wechat_id"],
        "responsibilities": "R" * _MAX_LENGTHS["responsibilities"],
    }

    @pytest.fixture
    def boundary_user(self, session, operator) -> User:
        assert len(self._BOUNDARY_VALUES["email"]) == 254
        user = User(
            company_id=operator.company_id,
            created_by=operator.id,
            updated_by=operator.id,
            **self._BOUNDARY_VALUES,
        )
        session.add(user)
        session.commit()
        return user

    def test_string_column_lengths(self, engine, operator):
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("users")
        }
        for field, limit in _MAX_LENGTHS.items():
            assert columns[field]["type"].length == limit, field

    def test_boundary_values_are_accepted(self, session, boundary_user):
        session.expire(boundary_user)
        stored = session.get(User, boundary_user.id)
        for field, value in self._BOUNDARY_VALUES.items():
            assert getattr(stored, field) == value, field

    @pytest.mark.parametrize("field", list(_MAX_LENGTHS))
    def test_one_character_over_limit_is_rejected_on_construction(
        self, session, operator, field
    ):
        before = session.query(User).count()
        # Not passed as an override kwarg: when ``field`` is
        # ``"employee_no"`` that would collide with the positional
        # ``employee_no`` argument below.
        kwargs = _user_kwargs(operator, "OVR001")
        kwargs[field] = self._BOUNDARY_VALUES[field] + "x"

        with pytest.raises(ValueError):
            User(**kwargs)

        assert session.query(User).count() == before

    @pytest.mark.parametrize(
        "bad_email",
        [
            "no-at-sign.example.com",
            "with space@example.com",
            "tab\t@example.com",
        ],
    )
    def test_invalid_email_format_is_rejected_on_construction(
        self, session, operator, bad_email
    ):
        before = session.query(User).count()
        kwargs = _user_kwargs(operator, "OVR002", email=bad_email)

        with pytest.raises(ValueError):
            User(**kwargs)

        assert session.query(User).count() == before

    def test_updating_name_en_to_129_characters_is_rejected_and_unchanged(
        self, session, boundary_user
    ):
        with pytest.raises(ValueError):
            boundary_user.name_en = "N" * 129

        session.expire(boundary_user)
        stored = session.get(User, boundary_user.id)
        assert stored.name_en == self._BOUNDARY_VALUES["name_en"]

    def test_updating_email_to_miss_at_sign_is_rejected_and_unchanged(
        self, session, boundary_user
    ):
        with pytest.raises(ValueError):
            boundary_user.email = "no-at-sign.example.com"

        session.expire(boundary_user)
        stored = session.get(User, boundary_user.id)
        assert stored.email == self._BOUNDARY_VALUES["email"]

    def test_core_insert_with_over_length_department_is_rejected(
        self, session, operator
    ):
        """``session.execute(insert(User).values(department=...))``
        never calls ``@validates`` -- only ``_BoundedStringType.
        process_bind_param`` (bind-time) sees this value.
        """
        before = session.query(User).count()
        kwargs = _user_kwargs(operator, "OVR003", department="D" * 65)
        with pytest.raises(StatementError):
            session.execute(insert(User).values(id=uuid7(), **kwargs))
            session.commit()
        session.rollback()

        assert session.query(User).count() == before

    def test_core_update_of_email_to_invalid_format_is_rejected(
        self, session, boundary_user
    ):
        with pytest.raises(StatementError):
            session.execute(
                update(User)
                .where(User.id == boundary_user.id)
                .values(email="still-no-at-sign")
            )
            session.commit()
        session.rollback()

        session.expire_all()
        stored = session.get(User, boundary_user.id)
        assert stored.email == self._BOUNDARY_VALUES["email"]


class TestMigrationRoundTrip:
    """Migration round trip (issue #130 comment): upgrading to
    head, downgrading to this migration's explicit parent
    (``88da78b69aa7``, not the relative ``"-1"``), and upgrading
    back to head again still leaves ``users``' self-referential
    ``created_by``/``updated_by`` foreign keys enforced against a
    dangling value -- proving the round trip does not silently drop
    that constraint. Uses an otherwise-empty database throughout
    (no pre-existing rows survive the trip): unlike
    ``test_narrow_business_number_lengths.py``'s round trip (which
    predates this migration and stops at its own, earlier layer),
    surviving *rows* across the boundary that adds ``company_id``
    (``NOT NULL``, no default) is not attempted here.
    """

    def test_self_referential_fk_still_enforced_after_round_trip(self, db_url):
        cfg = _alembic_config()
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "88da78b69aa7")
        command.upgrade(cfg, "head")

        engine = create_engine_from_settings(db_url)
        try:
            with Session(engine) as sess:
                dangling = uuid7()
                sess.add(
                    User(
                        id=uuid7(),
                        employee_no="RT0001",
                        company_id=uuid7(),
                        department="Engineering",
                        location="Taipei",
                        name_en="Ghost",
                        name_zh="幽靈",
                        email="ghost2@example.com",
                        created_by=dangling,
                        updated_by=dangling,
                    )
                )
                with pytest.raises(IntegrityError):
                    sess.commit()
                sess.rollback()
                assert sess.query(User).count() == 0
        finally:
            engine.dispose()
