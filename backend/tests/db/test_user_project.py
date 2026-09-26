"""Tests for the ``User``/``Project`` common structure migration
(DBF-AC09, DBF-AC10, DBF-AC11).

Builds a temporary SQLite database with the real Alembic migration
chain (through the public ``alembic.config``/``alembic.command``
API, as ``test_migrations.py`` does), then reads and writes it
exclusively through SQLAlchemy -- never ``sqlite3`` directly, per
DBF-R01. The engine under test is always built with
``app.db.engine.create_engine_from_settings`` (not a bare
``sqlalchemy.create_engine``), because only that constructor wires
up the ``PRAGMA foreign_keys=ON`` connection setup DBF-AC11's
foreign-key rejection checks depend on.
"""

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import CHAR, Engine, Uuid, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock, settings
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Project, User

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    """Same guard ``test_migrations.py`` uses: a stale cached shared
    engine must never leak between tests or into the real default
    database under ``backend/data``.
    """
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
def db_url(tmp_path, monkeypatch) -> str:
    """Migrate a fresh temporary SQLite database to head and return
    its connection URL.
    """
    db_path = tmp_path / "user_project.db"
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv(settings.DATABASE_URL_ENV_VAR, url)
    command.upgrade(_alembic_config(), "head")
    return url


@pytest.fixture
def engine(db_url) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(db_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


def _new_root_user(employee_no: str) -> User:
    """Build a ``User`` whose ``created_by``/``updated_by`` point at
    its own id (produced by the application, not the database), the
    way the first ``User`` row must be created per DBF-R14/DBF-Q2
    (plan.md's "第一筆 User 自我參照" risk): the primary key has to
    exist client-side before the row is written, since it is also
    this row's own foreign key value, and both must go in the same
    INSERT.
    """
    self_id = uuid7()
    return User(
        id=self_id,
        employee_no=employee_no,
        created_by=self_id,
        updated_by=self_id,
    )


def test_migration_registers_both_tables(db_url):
    """Guards ``app/models/__init__.py`` actually importing both
    model modules -- a missing import would leave the table off
    ``Base.metadata`` and this migration would never have matched
    it, but a regression that removes the import later should
    still be caught here.
    """
    engine = create_engine_from_settings(db_url)
    try:
        table_names = inspect(engine).get_table_names()
    finally:
        engine.dispose()

    assert "users" in table_names
    assert "projects" in table_names


class TestDbfAc09PrimaryKeysAreSingleColumnUuids:
    """DBF-AC09: primary keys are a single UUID column, not an
    auto-incrementing integer, on both tables.
    """

    @pytest.mark.parametrize("table_name", ["users", "projects"])
    def test_primary_key_is_a_single_non_integer_column(
        self, engine, table_name
    ):
        inspector = inspect(engine)

        pk = inspector.get_pk_constraint(table_name)
        assert pk["constrained_columns"] == ["id"]

        columns = {
            col["name"]: col for col in inspector.get_columns(table_name)
        }
        id_type = columns["id"]["type"]
        # sa.Uuid reflects back as CHAR(32) on SQLite (no native
        # UUID storage type) and as a native UUID elsewhere; an
        # autoincrement primary key would instead reflect as an
        # integer type with a Python int value -- DBF-R07 rules
        # that out as a cross-system identity.
        assert id_type.python_type is not int
        if engine.dialect.name == "sqlite":
            assert isinstance(id_type, CHAR)
            assert id_type.length == 32
        else:
            assert isinstance(id_type, Uuid)

        model = {"users": User, "projects": Project}[table_name]
        assert isinstance(model.__table__.c.id.type, Uuid)

    def test_inserted_rows_get_a_uuid_parseable_primary_key(self, session):
        user = _new_root_user("E100")
        session.add(user)
        session.commit()
        project = Project(
            project_code="P100",
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(project)
        session.commit()

        # Raises ValueError if not a valid UUID; str() first so
        # this holds whether the driver already returns a
        # uuid.UUID (as SQLAlchemy's Uuid type does) or a raw
        # string.
        assert uuid.UUID(str(user.id)) == user.id
        assert uuid.UUID(str(project.id)) == project.id


class TestDbfAc10BusinessNumbersAreUnique:
    """DBF-AC10: ``employee_no``/``project_code`` are unique, and
    are columns distinct from the UUID primary key.
    """

    def test_duplicate_employee_no_is_rejected_and_row_count_unchanged(
        self, session
    ):
        session.add(_new_root_user("E001"))
        session.commit()

        session.add(_new_root_user("E001"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).filter_by(employee_no="E001").count() == 1

    def test_duplicate_project_code_is_rejected_and_row_count_unchanged(
        self, session
    ):
        owner = _new_root_user("E002")
        session.add(owner)
        session.commit()
        session.add(
            Project(
                project_code="P001", created_by=owner.id, updated_by=owner.id
            )
        )
        session.commit()

        session.add(
            Project(
                project_code="P001", created_by=owner.id, updated_by=owner.id
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = session.query(Project).filter_by(project_code="P001").count()
        assert count == 1

    def test_business_number_column_is_not_the_primary_key_column(
        self, engine
    ):
        inspector = inspect(engine)
        assert inspector.get_pk_constraint("users")["constrained_columns"] != [
            "employee_no"
        ]
        assert inspector.get_pk_constraint("projects")[
            "constrained_columns"
        ] != ["project_code"]


class TestDbfAc11AuditColumns:
    """DBF-AC11: ``created_at``/``updated_at``/``created_by``/
    ``updated_by`` exist on both tables, are not nullable, the
    ``created_by``/``updated_by`` foreign keys point at ``users.id``
    (self-reference allowed for ``User``'s own first row), and the
    database rejects null or dangling values for them.
    """

    _AUDIT_COLUMNS = {"created_at", "updated_at", "created_by", "updated_by"}

    @pytest.mark.parametrize("table_name", ["users", "projects"])
    def test_audit_columns_exist_and_are_not_nullable(
        self, engine, table_name
    ):
        inspector = inspect(engine)
        columns = {
            col["name"]: col for col in inspector.get_columns(table_name)
        }

        assert self._AUDIT_COLUMNS <= columns.keys()
        assert columns["created_by"]["nullable"] is False
        assert columns["updated_by"]["nullable"] is False

    @pytest.mark.parametrize("table_name", ["users", "projects"])
    def test_created_by_and_updated_by_reference_users(
        self, engine, table_name
    ):
        inspector = inspect(engine)
        foreign_keys = inspector.get_foreign_keys(table_name)

        references = {
            fk["constrained_columns"][0]: (
                fk["referred_table"],
                fk["referred_columns"],
            )
            for fk in foreign_keys
        }
        assert references["created_by"] == ("users", ["id"])
        assert references["updated_by"] == ("users", ["id"])

    def test_first_user_self_references_and_project_references_it(
        self, session
    ):
        t0 = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: t0)

        user = _new_root_user("E200")
        session.add(user)
        session.commit()

        assert user.created_by == user.id
        assert user.updated_by == user.id
        assert user.created_at == t0
        assert user.updated_at == t0

        project = Project(
            project_code="P200", created_by=user.id, updated_by=user.id
        )
        session.add(project)
        session.commit()

        assert project.created_by == user.id
        assert project.updated_by == user.id
        assert project.created_at == t0
        assert project.updated_at == t0

    def test_updated_at_advances_strictly_and_created_at_is_stable(
        self, session
    ):
        t0 = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: t0)
        user = _new_root_user("E201")
        session.add(user)
        session.commit()
        original_created_at = user.created_at
        original_updated_at = user.updated_at

        t1 = t0 + timedelta(seconds=2)
        clock.set_clock(lambda: t1)
        user.employee_no = "E201-renamed"
        session.commit()

        assert user.created_at == original_created_at
        assert user.updated_at == t1
        assert user.updated_at > original_updated_at

    def test_null_created_by_is_rejected_on_both_tables(self, session):
        user = _new_root_user("E300")
        session.add(user)
        session.commit()

        bad_user = User(
            id=uuid7(),
            employee_no="E301",
            created_by=None,
            updated_by=user.id,
        )
        session.add(bad_user)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == 1

        bad_project = Project(
            project_code="P300", created_by=None, updated_by=user.id
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0

    def test_null_updated_by_is_rejected_on_both_tables(self, session):
        user = _new_root_user("E400")
        session.add(user)
        session.commit()

        bad_user = User(
            id=uuid7(),
            employee_no="E401",
            created_by=user.id,
            updated_by=None,
        )
        session.add(bad_user)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == 1

        bad_project = Project(
            project_code="P400", created_by=user.id, updated_by=None
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0

    def test_created_by_pointing_to_a_nonexistent_user_is_rejected(
        self, session
    ):
        user = _new_root_user("E500")
        session.add(user)
        session.commit()
        dangling = uuid7()

        bad_user = User(
            id=uuid7(),
            employee_no="E501",
            created_by=dangling,
            updated_by=user.id,
        )
        session.add(bad_user)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(User).count() == 1

        bad_project = Project(
            project_code="P500", created_by=dangling, updated_by=user.id
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0
