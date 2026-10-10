"""Tests for the account-redesign fields of ``User`` (DOM-AC33,
DOM-AC34, DOM-AC39, DOM-AC40).

Same fixture pattern as ``test_user_fields.py``: migrates the
database behind ``conftest.py``'s ``db_url`` fixture with the real
Alembic migration chain, then reads and writes it exclusively
through SQLAlchemy. The precondition every test here shares is the
one DOM-AC33 spells out: an empty database plus the built-in
``admin`` (``is_system``, no company, no email, no names) and one
``Company``.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, inspect, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Company, User

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def engine(db_url) -> Generator[Engine, None, None]:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    eng = create_engine_from_settings(db_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def admin(session) -> User:
    """The built-in ``admin``, created as its own operator in one
    transaction (``created_by``/``updated_by`` point at its own
    pre-generated id).
    """
    admin_id = uuid7()
    user = User(
        id=admin_id,
        username="admin",
        is_system=True,
        is_admin=True,
        is_external_collaborator=False,
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(user)
    session.flush()
    session.commit()
    return user


@pytest.fixture
def company(session, admin) -> Company:
    company = Company(name="Demo Co", created_by=admin.id, updated_by=admin.id)
    session.add(company)
    session.commit()
    return company


def _kwargs(admin: User, username: str, **overrides) -> dict:
    kwargs = {
        "username": username,
        "is_external_collaborator": False,
        "email": f"{username}@example.com",
        "name_zh": "示範人員",
        "created_by": admin.id,
        "updated_by": admin.id,
    }
    kwargs.update(overrides)
    return kwargs


def _rejected(session: Session, **kwargs) -> None:
    session.add(User(**kwargs))
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


class TestDomAc33UserFields:
    """DOM-AC33: DOM-R46's columns and their nullability, the
    built-in account with no email or names, and the ordinary
    account's required fields.
    """

    _NOT_NULL = {
        "username",
        "is_active",
        "is_admin",
        "is_system",
        "auth_source",
    }
    _NULLABLE = {
        "email",
        "name_zh",
        "name_en",
        "company_id",
        "department",
        "location",
        "employee_no",
    }

    def test_columns_nullability_and_company_foreign_key(self, engine, admin):
        inspector = inspect(engine)
        columns = {c["name"]: c for c in inspector.get_columns("users")}

        for name in self._NOT_NULL:
            assert columns[name]["nullable"] is False, name
        for name in self._NULLABLE:
            assert columns[name]["nullable"] is True, name
        references = {
            fk["constrained_columns"][0]: fk["referred_table"]
            for fk in inspector.get_foreign_keys("users")
        }
        assert references["company_id"] == "companies"

    def test_builtin_admin_without_email_or_names_is_stored(
        self, session, admin
    ):
        session.expire(admin)
        stored = session.get(User, admin.id)
        assert stored.username == "admin"
        assert stored.email is None
        assert stored.name_zh is None
        assert stored.name_en is None
        assert stored.company_id is None
        assert stored.is_admin is True

    def test_required_fields_only_succeeds_with_defaults(self, session, admin):
        user = User(**_kwargs(admin, "anna.deng"))
        session.add(user)
        session.commit()
        session.expire(user)

        stored = session.get(User, user.id)
        assert stored.is_active is True
        assert stored.is_admin is False
        assert stored.is_system is False
        assert stored.auth_source == "local"
        for field in (
            "company_id",
            "department",
            "location",
            "employee_no",
            "name_en",
        ):
            assert getattr(stored, field) is None, field

    @pytest.mark.parametrize("missing", ["username", "email", "name_zh"])
    def test_ordinary_account_missing_a_required_field_is_rejected(
        self, session, admin, missing
    ):
        before = session.query(User).count()
        kwargs = _kwargs(admin, "bob")
        del kwargs[missing]
        _rejected(session, **kwargs)

        assert session.query(User).count() == before

    def test_account_with_company_fields_round_trips(
        self, session, admin, company
    ):
        user = User(
            **_kwargs(
                admin,
                "carol",
                name_en="Carol Lin",
                company_id=company.id,
                department="Engineering",
                location="Taipei",
                employee_no="E001",
            )
        )
        session.add(user)
        session.commit()
        session.expire(user)

        stored = session.get(User, user.id)
        assert stored.name_en == "Carol Lin"
        assert stored.company_id == company.id
        assert stored.department == "Engineering"
        assert stored.location == "Taipei"
        assert stored.employee_no == "E001"

    @pytest.mark.parametrize(
        "field, value",
        [
            ("employee_no", "E001"),
            ("department", "Engineering"),
            ("location", "Taipei"),
        ],
    )
    def test_company_bound_field_without_company_is_rejected(
        self, session, admin, field, value
    ):
        """DOM-R47: no company means no employee number, department
        or location.
        """
        before = session.query(User).count()
        _rejected(session, **_kwargs(admin, "dave", **{field: value}))

        assert session.query(User).count() == before


class TestDomAc34UsernameRules:
    """DOM-AC34: ``username`` is 3-32 characters, starts with a
    letter, holds only ``[A-Za-z0-9._-]``, is stored lowercase and is
    unique regardless of case (deactivated accounts included);
    ``admin``/``system``/``root`` are reserved.
    """

    @pytest.fixture
    def disabled_anna(self, session, admin) -> User:
        user = User(**_kwargs(admin, "anna.deng", is_active=False))
        session.add(user)
        session.commit()
        return user

    def test_three_and_thirty_two_characters_are_accepted(
        self, session, admin, disabled_anna
    ):
        session.add(User(**_kwargs(admin, "abc")))
        session.add(User(**_kwargs(admin, "a" * 32)))
        session.commit()

        assert session.query(User).filter(User.username == "abc").count() == 1
        assert (
            session.query(User).filter(User.username == "a" * 32).count() == 1
        )

    @pytest.mark.parametrize(
        "bad",
        [
            "ab",
            "a" * 33,
            "1abc",
            "_abc",
            "使用者abc",
            "ab@cd",
            "ab cd",
            "ab+cd",
            "",
        ],
    )
    def test_invalid_format_is_rejected_on_construction(
        self, session, admin, disabled_anna, bad
    ):
        before = session.query(User).count()
        with pytest.raises(ValueError):
            User(**_kwargs(admin, bad, email="x@example.com"))

        assert session.query(User).count() == before

    @pytest.mark.parametrize("reserved", ["Admin", "SYSTEM", "root"])
    def test_reserved_word_is_rejected_for_an_ordinary_account(
        self, session, admin, disabled_anna, reserved
    ):
        before = session.query(User).count()
        _rejected(session, **_kwargs(admin, reserved, email="r@example.com"))

        assert session.query(User).count() == before

    def test_case_only_difference_from_a_disabled_account_is_rejected(
        self, session, admin, disabled_anna
    ):
        before = session.query(User).count()
        _rejected(
            session, **_kwargs(admin, "ANNA.DENG", email="a2@example.com")
        )

        assert session.query(User).count() == before

    def test_mixed_case_is_stored_lowercase_and_a_short_rename_is_rejected(
        self, session, admin, disabled_anna
    ):
        user = User(**_kwargs(admin, "Bob.Lee_2-x"))
        session.add(user)
        session.commit()
        session.expire(user)
        assert session.get(User, user.id).username == "bob.lee_2-x"

        with pytest.raises(ValueError):
            user.username = "a"
        session.rollback()
        assert session.get(User, user.id).username == "bob.lee_2-x"

    def test_core_update_to_uppercase_is_rejected_by_the_database(
        self, session, admin, disabled_anna
    ):
        # ``@validates`` never sees a Core statement; the
        # ``username = lower(username)`` CHECK is the backstop.
        with pytest.raises(IntegrityError):
            session.execute(
                update(User)
                .where(User.id == disabled_anna.id)
                .values(username="Anna.Deng")
            )
            session.commit()
        session.rollback()

        session.expire_all()
        assert session.get(User, disabled_anna.id).username == "anna.deng"


class TestDomAc39EmployeeNoUniquePerCompany:
    """DOM-AC39 (with DBF-R13): ``employee_no`` is unique within one
    company only; accounts without a company or without an employee
    number never collide.
    """

    @pytest.fixture
    def company_b(self, session, admin) -> Company:
        company = Company(
            name="Other Co", created_by=admin.id, updated_by=admin.id
        )
        session.add(company)
        session.commit()
        return company

    @pytest.fixture
    def existing(self, session, admin, company, company_b) -> User:
        user = User(
            **_kwargs(
                admin,
                "first",
                company_id=company.id,
                employee_no="E001",
            )
        )
        session.add(user)
        session.commit()
        return user

    def test_same_employee_no_in_the_same_company_is_rejected(
        self, session, admin, company, existing
    ):
        before = session.query(User).count()
        _rejected(
            session,
            **_kwargs(
                admin, "second", company_id=company.id, employee_no="E001"
            ),
        )

        assert session.query(User).count() == before

    def test_same_employee_no_in_another_company_succeeds(
        self, session, admin, company_b, existing
    ):
        session.add(
            User(
                **_kwargs(
                    admin,
                    "third",
                    company_id=company_b.id,
                    employee_no="E001",
                )
            )
        )
        session.commit()

    def test_accounts_without_company_or_employee_no_never_collide(
        self, session, admin, company, existing
    ):
        for name in ("nocompany1", "nocompany2", "nocompany3"):
            session.add(User(**_kwargs(admin, name)))
        # Same company but no employee number: NULLs do not collide.
        session.add(User(**_kwargs(admin, "noemp1", company_id=company.id)))
        session.add(User(**_kwargs(admin, "noemp2", company_id=company.id)))
        session.commit()

    def test_moving_to_a_company_with_a_colliding_employee_no_is_rejected(
        self, session, admin, company, company_b, existing
    ):
        mover = User(
            **_kwargs(
                admin, "mover", company_id=company_b.id, employee_no="E001"
            )
        )
        session.add(mover)
        session.commit()

        mover.company_id = company.id
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.expire_all()
        assert session.get(User, mover.id).company_id == company_b.id

    def test_the_old_global_unique_constraint_is_gone(self, engine, admin):
        inspector = inspect(engine)
        uniques = [
            tuple(u["column_names"])
            for u in inspector.get_unique_constraints("users")
        ]
        assert ("employee_no",) not in uniques
        assert ("company_id", "employee_no") in uniques


class TestDomAc40BuiltInAdminConstraints:
    """DOM-AC40 (DOM-R50): the built-in ``admin`` has no company or
    names and is always ``admin`` and an Admin; an ordinary account
    cannot be ``admin`` or omit its email.
    """

    def _update_admin(self, session, admin, **values) -> None:
        with pytest.raises(IntegrityError):
            session.execute(
                update(User).where(User.id == admin.id).values(**values)
            )
            session.commit()
        session.rollback()
        session.expire_all()

    def test_admin_cannot_join_a_company(self, session, admin, company):
        self._update_admin(session, admin, company_id=company.id)

        assert session.get(User, admin.id).company_id is None

    @pytest.mark.parametrize("field", ["name_zh", "name_en"])
    def test_admin_cannot_have_a_name(self, session, admin, field):
        self._update_admin(session, admin, **{field: "示範"})

        assert getattr(session.get(User, admin.id), field) is None

    def test_admin_cannot_be_renamed_to_a_reserved_word(self, session, admin):
        self._update_admin(session, admin, username="root")

        assert session.get(User, admin.id).username == "admin"

    def test_admin_cannot_lose_admin_rights(self, session, admin):
        self._update_admin(session, admin, is_admin=False)

        assert session.get(User, admin.id).is_admin is True

    def test_ordinary_account_cannot_be_named_admin(self, session, admin):
        before = session.query(User).count()
        _rejected(session, **_kwargs(admin, "Admin", email="a@example.com"))

        assert session.query(User).count() == before

    def test_ordinary_account_without_email_is_rejected(self, session, admin):
        before = session.query(User).count()
        _rejected(session, **_kwargs(admin, "noemail", email=None))

        assert session.query(User).count() == before

    def test_a_second_builtin_account_is_rejected(self, session, admin):
        """``username`` is unique and the built-in account must be
        ``admin``, so a second ``is_system`` row cannot exist.
        """
        new_id = uuid7()
        _rejected(
            session,
            id=new_id,
            username="admin",
            is_system=True,
            is_admin=True,
        is_external_collaborator=False,
            created_by=new_id,
            updated_by=new_id,
        )
