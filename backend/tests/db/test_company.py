"""Tests for the ``Company`` table migration (DOM-AC11, DOM-AC12,
DOM-AC20, and the issue #127/DOM-Q7 ``is_active`` default).

Same fixture pattern as ``test_user_project.py``: migrates the
database behind ``conftest.py``'s ``db_url`` fixture with the real
Alembic migration chain, then reads and writes it exclusively
through SQLAlchemy.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, insert, inspect, text, update
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Company, User

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture(autouse=True)
def _reset_clock_after_test() -> Generator[None, None, None]:
    yield
    clock.reset_clock()


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


def _new_root_user(employee_no: str) -> User:
    """Same self-referential construction as
    ``test_user_project.py``'s helper of the same name: this row's
    ``created_by``/``updated_by`` point at its own id.
    """
    self_id = uuid7()
    return User(
        id=self_id,
        employee_no=employee_no,
        created_by=self_id,
        updated_by=self_id,
    )


@pytest.fixture
def creator(session) -> User:
    """A ``User`` to use as ``created_by``/``updated_by`` for
    ``Company`` rows in these tests -- not itself under test.
    """
    user = _new_root_user("E900")
    session.add(user)
    session.commit()
    return user


def _new_company(creator: User, **kwargs) -> Company:
    kwargs.setdefault("created_by", creator.id)
    kwargs.setdefault("updated_by", creator.id)
    return Company(**kwargs)


@pytest.fixture
def existing_company(session, creator) -> Company:
    """DOM-AC11's (and DOM-AC20's) precondition: one company with
    ``code = "C001"`` and ``tax_id = "12345678"``.
    """
    company = _new_company(
        creator,
        code="C001",
        name="Company One",
        tax_id="12345678",
        kind="internal",
    )
    session.add(company)
    session.commit()
    return company


def test_migration_registers_companies_table(migrated_url):
    """Guards ``app/models/__init__.py`` actually importing
    ``company`` -- a missing import would leave the table off
    ``Base.metadata`` and this migration would never have matched
    it.
    """
    engine = create_engine_from_settings(migrated_url)
    try:
        table_names = inspect(engine).get_table_names()
    finally:
        engine.dispose()

    assert "companies" in table_names


class TestDomAc11CompanyFieldsAndConstraints:
    """DOM-AC11: primary key, DOM-R16's fields, and the
    created/updated audit columns; duplicate ``code``/``tax_id``,
    an out-of-range ``kind``, a dangling ``parent_id``, a null
    ``created_by`` and a null ``is_active`` are all rejected by the
    database, with row count unchanged. Two companies with a null
    ``tax_id`` and no ``is_active`` given both succeed, and both
    come out active (DOM-R16's default).
    """

    _EXPECTED_COLUMNS = {
        "id",
        "code",
        "name",
        "tax_id",
        "kind",
        "parent_id",
        "is_active",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
    }

    def test_table_has_primary_key_and_dom_r16_columns(self, engine):
        inspector = inspect(engine)

        pk = inspector.get_pk_constraint("companies")
        assert pk["constrained_columns"] == ["id"]

        columns = {
            col["name"]: col for col in inspector.get_columns("companies")
        }
        assert self._EXPECTED_COLUMNS <= columns.keys()
        assert columns["code"]["nullable"] is False
        assert columns["name"]["nullable"] is False
        assert columns["tax_id"]["nullable"] is True
        assert columns["kind"]["nullable"] is False
        assert columns["parent_id"]["nullable"] is True
        assert columns["is_active"]["nullable"] is False
        assert columns["created_by"]["nullable"] is False
        assert columns["updated_by"]["nullable"] is False

        foreign_keys = inspector.get_foreign_keys("companies")
        references = {
            fk["constrained_columns"][0]: (
                fk["referred_table"],
                fk["referred_columns"],
            )
            for fk in foreign_keys
        }
        assert references["parent_id"] == ("companies", ["id"])
        assert references["created_by"] == ("users", ["id"])
        assert references["updated_by"] == ("users", ["id"])

    def test_duplicate_code_is_rejected_and_row_count_unchanged(
        self, session, creator, existing_company
    ):
        session.add(
            _new_company(
                creator,
                code="C001",
                name="Company Two",
                kind="internal",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(Company).filter_by(code="C001").count() == 1

    def test_duplicate_tax_id_is_rejected_and_row_count_unchanged(
        self, session, creator, existing_company
    ):
        session.add(
            _new_company(
                creator,
                code="C002",
                name="Company Two",
                tax_id="12345678",
                kind="internal",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = session.query(Company).filter_by(tax_id="12345678").count()
        assert count == 1

    def test_two_null_tax_ids_both_succeed(
        self, session, creator, existing_company
    ):
        session.add(
            _new_company(
                creator, code="C003", name="Company Three", kind="internal"
            )
        )
        session.add(
            _new_company(
                creator, code="C004", name="Company Four", kind="customer"
            )
        )
        session.commit()

        rows = session.query(Company).filter_by(tax_id=None).all()
        assert len(rows) == 2
        assert all(row.is_active is True for row in rows)

    def test_kind_outside_allowed_values_is_rejected(
        self, session, creator, existing_company
    ):
        before = session.query(Company).count()
        session.add(
            _new_company(
                creator, code="C005", name="Company Five", kind="partner"
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_parent_id_pointing_to_a_nonexistent_company_is_rejected(
        self, session, creator, existing_company
    ):
        before = session.query(Company).count()
        session.add(
            _new_company(
                creator,
                code="C006",
                name="Company Six",
                kind="internal",
                parent_id=uuid7(),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_null_created_by_is_rejected(
        self, session, creator, existing_company
    ):
        before = session.query(Company).count()
        session.add(
            Company(
                code="C007",
                name="Company Seven",
                kind="internal",
                created_by=None,
                updated_by=creator.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_null_is_active_is_rejected(
        self, session, creator, existing_company
    ):
        # Core ``insert`` sends an explicit ``None`` as NULL. The ORM
        # would not: it treats ``is_active=None`` on a new object as
        # "not specified" and applies the column default instead, so
        # it cannot show that the database itself rejects NULL.
        before = session.query(Company).count()
        with pytest.raises(IntegrityError):
            session.execute(
                insert(Company).values(
                    id=uuid7(),
                    code="C008",
                    name="Company Eight",
                    kind="internal",
                    is_active=None,
                    created_by=creator.id,
                    updated_by=creator.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before


class TestDomAc12ParentIdSelfReferenceRejected:
    """DOM-AC12: setting ``parent_id`` to a company's own id is
    rejected by the database with data unchanged; setting it to
    another company succeeds.
    """

    def test_self_reference_rejected_then_valid_parent_succeeds(
        self, session, creator
    ):
        company_a = _new_company(
            creator, code="A001", name="Company A", kind="internal"
        )
        company_b = _new_company(
            creator, code="B001", name="Company B", kind="internal"
        )
        session.add_all([company_a, company_b])
        session.commit()

        company_b.parent_id = company_b.id
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        refreshed_b = session.get(Company, company_b.id)
        assert refreshed_b.parent_id is None

        refreshed_b.parent_id = company_a.id
        session.commit()

        assert session.get(Company, company_b.id).parent_id == company_a.id


class TestDomAc20LengthAndFormatValidation:
    """DOM-AC20: ``code``/``name``/``tax_id`` length limits (32,
    128, 8 characters) and ``code``/``tax_id`` format are enforced
    before a value reaches the database -- on both insert and
    attribute assignment -- so SQLite (which does not enforce
    ``String`` length or format) still rejects the same values
    PostgreSQL's column types and this project's format rules
    reject.

    The "batch" tests below cover the write paths that never touch
    a mapped attribute -- ``session.execute(insert(Company)...)``
    and ``session.execute(update(Company)...)`` -- which
    ``@validates`` cannot see; only the bind-time column types
    (``_CodeType``/``_NameType``/``_TaxIdType`` in
    ``app/models/company.py``) catch these.
    """

    # 32 characters mixing letters, digits, ``-`` and ``_``.
    _MAX_CODE = "Ab1-_" + "x" * 27
    _MAX_NAME = "N" * 128
    _VALID_TAX_ID = "87654321"

    @pytest.fixture
    def boundary_company(self, session, creator, existing_company):
        company = _new_company(
            creator,
            code=self._MAX_CODE,
            name=self._MAX_NAME,
            tax_id=self._VALID_TAX_ID,
            kind="internal",
        )
        session.add(company)
        session.commit()
        return company

    def test_string_column_lengths(self, engine):
        columns = {
            col["name"]: col
            for col in inspect(engine).get_columns("companies")
        }

        assert columns["code"]["type"].length == 32
        assert columns["name"]["type"].length == 128
        assert columns["tax_id"]["type"].length == 8

    def test_boundary_valid_values_are_accepted(
        self, session, boundary_company
    ):
        assert len(self._MAX_CODE) == 32
        assert session.query(Company).count() == 2
        session.expire(boundary_company)
        stored = session.get(Company, boundary_company.id)
        assert stored.code == self._MAX_CODE
        assert stored.name == self._MAX_NAME
        assert stored.tax_id == self._VALID_TAX_ID

    @pytest.mark.parametrize(
        "field,value",
        [
            ("code", "A" * 33),
            ("code", "AB CD"),
            ("code", "AB中文"),
            ("name", "N" * 129),
            ("tax_id", "1234567"),
            ("tax_id", "123456789"),
            ("tax_id", "1234567A"),
        ],
    )
    def test_invalid_value_is_rejected_on_construction(
        self, session, creator, existing_company, field, value
    ):
        before = session.query(Company).count()
        kwargs = {
            "code": "GOOD1",
            "name": "Good Name",
            "kind": "internal",
        }
        kwargs[field] = value

        with pytest.raises(ValueError):
            _new_company(creator, **kwargs)

        assert session.query(Company).count() == before

    def test_updating_code_to_33_characters_is_rejected_and_unchanged(
        self, session, boundary_company
    ):
        with pytest.raises(ValueError):
            boundary_company.code = "B" * 33

        session.expire(boundary_company)
        stored = session.get(Company, boundary_company.id)
        assert stored.code == self._MAX_CODE

    def test_updating_tax_id_to_7_digits_is_rejected_and_unchanged(
        self, session, boundary_company
    ):
        with pytest.raises(ValueError):
            boundary_company.tax_id = "1234567"

        session.expire(boundary_company)
        stored = session.get(Company, boundary_company.id)
        assert stored.tax_id == self._VALID_TAX_ID

    def test_dom_ac20_batch_insert_with_invalid_code_is_rejected(
        self, session, creator, existing_company
    ):
        """``session.execute(insert(Company).values(code=...))``
        never calls ``@validates`` -- only ``_CodeType.
        process_bind_param`` sees this value.
        """
        before = session.query(Company).count()
        with pytest.raises(StatementError):
            session.execute(
                insert(Company).values(
                    id=uuid7(),
                    code="bad code",
                    name="Company Nine",
                    kind="internal",
                    created_by=creator.id,
                    updated_by=creator.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_dom_ac20_batch_update_of_code_to_invalid_value_is_rejected(
        self, session, existing_company
    ):
        """``session.execute(update(Company).values(code=...))``
        against a mapped ``Company`` never calls ``@validates``
        either -- same bind-time coverage as the insert case above.
        """
        with pytest.raises(StatementError):
            session.execute(
                update(Company)
                .where(Company.id == existing_company.id)
                .values(code="中文")
            )
            session.commit()
        session.rollback()

        session.expire_all()
        stored = session.get(Company, existing_company.id)
        assert stored.code == "C001"

    def test_dom_ac20_batch_insert_with_invalid_tax_id_is_rejected(
        self, session, creator, existing_company
    ):
        before = session.query(Company).count()
        with pytest.raises(StatementError):
            session.execute(
                insert(Company).values(
                    id=uuid7(),
                    code="C010",
                    name="Company Ten",
                    tax_id="1234567",
                    kind="internal",
                    created_by=creator.id,
                    updated_by=creator.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_dom_ac20_batch_update_of_name_to_129_characters_is_rejected(
        self, session, existing_company
    ):
        with pytest.raises(StatementError):
            session.execute(
                update(Company)
                .where(Company.id == existing_company.id)
                .values(name="N" * 129)
            )
            session.commit()
        session.rollback()

        session.expire_all()
        stored = session.get(Company, existing_company.id)
        assert stored.name == "Company One"


class TestIsActiveDefault:
    """Issue #127/DOM-Q7: ``is_active`` defaults to enabled (true)
    when not specified, both through the ORM and at the database
    level (``server_default``), and is never nullable.
    """

    def test_orm_insert_without_is_active_defaults_to_true(
        self, session, creator
    ):
        company = _new_company(
            creator, code="D001", name="Company D", kind="internal"
        )
        session.add(company)
        session.commit()
        session.expire(company)

        assert session.get(Company, company.id).is_active is True

    def test_raw_sql_insert_without_is_active_defaults_to_true(
        self, session, creator
    ):
        """Bypasses the ORM's Python-side ``default=True`` entirely,
        so this only passes if the migration's ``server_default``
        also makes the column default to true at the database
        level.
        """
        # ``.hex`` (32 lowercase hex digits, no dashes) matches how
        # ``sqlalchemy.types.Uuid`` stores a UUID on SQLite (see
        # ``TestDomAc09PrimaryKeysAreSingleColumnUuids`` in
        # ``test_user_project.py``, which asserts the reflected
        # column is ``CHAR(32)``); PostgreSQL's native ``uuid``
        # column accepts the same undashed form on input. Raw text
        # SQL bypasses SQLAlchemy's column type binding, so a
        # dashed ``str(uuid)`` would not match either backend's
        # stored representation and would look like a dangling
        # foreign key.
        new_id = uuid7()
        session.execute(
            text(
                "INSERT INTO companies "
                "(id, code, name, kind, created_at, updated_at, "
                "created_by, updated_by) "
                "VALUES "
                "(:id, :code, :name, :kind, :now, :now, :creator, "
                ":creator)"
            ),
            {
                "id": new_id.hex,
                "code": "D002",
                "name": "Company D2",
                "kind": "internal",
                "now": "2026-01-01T00:00:00+00:00",
                "creator": creator.id.hex,
            },
        )
        session.commit()

        row = session.execute(
            text("SELECT is_active FROM companies WHERE id = :id"),
            {"id": new_id.hex},
        ).one()
        assert bool(row.is_active) is True

    def test_is_active_column_is_not_nullable(self, engine):
        columns = {
            col["name"]: col
            for col in inspect(engine).get_columns("companies")
        }
        assert columns["is_active"]["nullable"] is False
