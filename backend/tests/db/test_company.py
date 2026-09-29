"""Tests for the ``Company`` table (DOM-AC36, DOM-AC37, and the
issue #127/DOM-Q7 ``is_active`` default).

Same fixture pattern as ``test_user_project.py``: migrates the
database behind ``conftest.py``'s ``db_url`` fixture with the real
Alembic migration chain, then reads and writes it exclusively
through SQLAlchemy.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, insert, inspect, text
from sqlalchemy.exc import IntegrityError, StatementError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Company, User
from tests.db.conftest import create_root_user_with_company

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


@pytest.fixture
def creator(session) -> User:
    """A ``User`` to use as ``created_by``/``updated_by`` for
    ``Company`` rows in these tests -- not itself under test.

    Built with ``create_root_user_with_company`` (its own throwaway
    ``Company``, distinct from ``existing_company`` below).
    """
    user = create_root_user_with_company(session, "E900")
    session.commit()
    return user


def _new_company(creator: User, **kwargs) -> Company:
    kwargs.setdefault("created_by", creator.id)
    kwargs.setdefault("updated_by", creator.id)
    return Company(**kwargs)


@pytest.fixture
def existing_companies(session, creator) -> None:
    """DOM-AC36's precondition: an active ``Demo Co`` and an
    inactive ``Old Co``.
    """
    session.add(_new_company(creator, name="Demo Co"))
    session.add(_new_company(creator, name="Old Co", is_active=False))
    session.commit()


def _reject_on_commit(session: Session, company: Company) -> None:
    session.add(company)
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()


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


class TestDomAc36CompanyFieldsAndConstraints:
    """DOM-AC36: a UUID primary key, ``name``, ``is_active`` and the
    audit columns, and none of the removed ``code``, ``tax_id``,
    ``kind`` or ``parent_id``; every invalid write is rejected with
    the row count unchanged, and a valid one is stored trimmed.
    """

    _EXPECTED_COLUMNS = {
        "id",
        "name",
        "is_active",
        "created_at",
        "updated_at",
        "created_by",
        "updated_by",
    }

    def test_table_columns_and_keys(self, engine):
        inspector = inspect(engine)

        assert inspector.get_pk_constraint("companies")[
            "constrained_columns"
        ] == ["id"]

        columns = {
            col["name"]: col for col in inspector.get_columns("companies")
        }
        assert set(columns) == self._EXPECTED_COLUMNS
        for removed in ("code", "tax_id", "kind", "parent_id"):
            assert removed not in columns
        assert columns["name"]["nullable"] is False
        assert columns["is_active"]["nullable"] is False
        assert columns["created_by"]["nullable"] is False
        assert columns["updated_by"]["nullable"] is False

        references = {
            fk["constrained_columns"][0]: (
                fk["referred_table"],
                fk["referred_columns"],
            )
            for fk in inspector.get_foreign_keys("companies")
        }
        assert references == {
            "created_by": ("users", ["id"]),
            "updated_by": ("users", ["id"]),
        }

    def test_removed_constraints_and_indexes_are_gone(self, engine):
        inspector = inspect(engine)
        index_names = {i["name"] for i in inspector.get_indexes("companies")}
        unique_names = {
            u["name"] for u in inspector.get_unique_constraints("companies")
        }
        for name in index_names | unique_names:
            assert "code" not in name
            assert "tax_id" not in name
            assert "kind" not in name
            assert "parent" not in name

    @pytest.mark.parametrize(
        "name", ["Demo Co", "DEMO CO", " Demo Co ", "old co"]
    )
    def test_duplicate_name_is_rejected_and_row_count_unchanged(
        self, session, creator, existing_companies, name
    ):
        before = session.query(Company).count()
        _reject_on_commit(session, _new_company(creator, name=name))

        assert session.query(Company).count() == before

    @pytest.mark.parametrize("name", [None, "", "   "])
    def test_null_empty_or_blank_name_is_rejected(
        self, session, creator, existing_companies, name
    ):
        before = session.query(Company).count()
        with pytest.raises(ValueError):
            _new_company(creator, name=name)

        assert session.query(Company).count() == before

    def test_null_name_is_rejected_by_the_database(
        self, session, creator, existing_companies
    ):
        before = session.query(Company).count()
        with pytest.raises(IntegrityError):
            session.execute(
                insert(Company).values(
                    id=uuid7(),
                    name=None,
                    created_by=creator.id,
                    updated_by=creator.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_null_created_by_is_rejected(
        self, session, creator, existing_companies
    ):
        before = session.query(Company).count()
        _reject_on_commit(
            session,
            Company(name="No Creator", created_by=None, updated_by=creator.id),
        )

        assert session.query(Company).count() == before

    def test_null_is_active_is_rejected(
        self, session, creator, existing_companies
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
                    name="Null Active",
                    is_active=None,
                    created_by=creator.id,
                    updated_by=creator.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Company).count() == before

    def test_unspecified_is_active_and_padded_name_are_stored_trimmed(
        self, session, creator, existing_companies
    ):
        company = _new_company(creator, name="  New Co  ")
        session.add(company)
        session.commit()
        session.expire_all()

        stored = session.get(Company, company.id)
        assert stored.name == "New Co"
        assert stored.is_active is True


class TestDomAc37NameRules:
    """DOM-AC37: ``name`` is trimmed on every assignment, at most 128
    characters, case-insensitively unique across active and inactive
    companies, and the original casing is what is stored.
    """

    def test_name_column_length(self, engine):
        columns = {
            col["name"]: col
            for col in inspect(engine).get_columns("companies")
        }
        assert columns["name"]["type"].length == 128

    def test_128_characters_is_accepted_and_129_rejected(
        self, session, creator
    ):
        session.add(_new_company(creator, name="a" * 128))
        session.commit()

        with pytest.raises(ValueError):
            _new_company(creator, name="b" * 129)

    def test_129_characters_after_trimming_boundary(self, creator):
        # Padding does not count: 128 characters plus spaces is valid.
        company = _new_company(creator, name=" " + "c" * 128 + " ")
        assert company.name == "c" * 128

    def test_updating_name_to_129_characters_is_rejected_and_unchanged(
        self, session, creator, existing_companies
    ):
        company = session.query(Company).filter_by(name="Demo Co").one()
        with pytest.raises(ValueError):
            company.name = "d" * 129
        session.rollback()

        assert session.get(Company, company.id).name == "Demo Co"

    def test_updating_name_trims_whitespace(
        self, session, creator, existing_companies
    ):
        company = session.query(Company).filter_by(name="Demo Co").one()
        company.name = "  Renamed Co "
        session.commit()
        session.expire_all()

        assert session.get(Company, company.id).name == "Renamed Co"

    def test_updating_name_to_case_variant_of_another_is_rejected(
        self, session, creator, existing_companies
    ):
        company = session.query(Company).filter_by(name="Demo Co").one()
        company.name = "OLD CO"
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.get(Company, company.id).name == "Demo Co"

    def test_renaming_only_the_casing_of_itself_is_allowed(
        self, session, creator, existing_companies
    ):
        company = session.query(Company).filter_by(name="Demo Co").one()
        company.name = "DEMO CO"
        session.commit()
        session.expire_all()

        assert session.get(Company, company.id).name == "DEMO CO"

    def test_core_insert_of_untrimmed_or_blank_name_is_rejected(
        self, session, creator
    ):
        # ``@validates`` never sees a Core statement; ``BoundedString``
        # is the second layer that still rejects it.
        for bad in (" padded ", "", "   "):
            with pytest.raises(StatementError):
                session.execute(
                    insert(Company).values(
                        id=uuid7(),
                        name=bad,
                        created_by=creator.id,
                        updated_by=creator.id,
                    )
                )
            session.rollback()

        assert session.query(Company).filter_by(name="padded").count() == 0


class TestIsActiveDefault:
    """Issue #127/DOM-Q7: ``is_active`` defaults to enabled (true)
    when not specified, both through the ORM and at the database
    level (``server_default``), and is never nullable.
    """

    def test_orm_insert_without_is_active_defaults_to_true(
        self, session, creator
    ):
        company = _new_company(creator, name="Company D")
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
        # ``sqlalchemy.types.Uuid`` stores a UUID on SQLite;
        # PostgreSQL's native ``uuid`` column accepts the same
        # undashed form on input. Raw text SQL bypasses SQLAlchemy's
        # column type binding.
        new_id = uuid7()
        session.execute(
            text(
                "INSERT INTO companies "
                "(id, name, created_at, updated_at, "
                "created_by, updated_by) "
                "VALUES "
                "(:id, :name, :now, :now, :creator, :creator)"
            ),
            {
                "id": new_id.hex,
                "name": "Company D2",
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
