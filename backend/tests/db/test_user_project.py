"""Tests for the ``User``/``Project`` common structure migration
(DBF-AC09, DBF-AC10, DBF-AC11).

Migrates the database behind ``conftest.py``'s ``db_url`` fixture
(a temporary SQLite file by default, PostgreSQL under
``--db-backend=postgresql``) with the real Alembic migration
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
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import CHAR, Engine, Uuid, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Project, User
from tests.db.conftest import build_root_user, create_root_user_with_company

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
def migrated_url(db_url) -> str:
    """Migrate the test database from ``conftest.py``'s ``db_url``
    fixture to head and return its connection URL.
    """
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


def test_migration_registers_both_tables(migrated_url):
    """Guards ``app/models/__init__.py`` actually importing both
    model modules -- a missing import would leave the table off
    ``Base.metadata`` and this migration would never have matched
    it, but a regression that removes the import later should
    still be caught here.
    """
    engine = create_engine_from_settings(migrated_url)
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
        user = create_root_user_with_company(session, "E100")
        session.add(user)
        session.commit()
        project = Project(
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
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


class TestDbfAc10BusinessNumbers:
    """DBF-AC10: employee numbers are unique; project codes repeat."""

    def test_duplicate_employee_no_is_rejected_and_row_count_unchanged(
        self, session
    ):
        first = create_root_user_with_company(session, "E001")
        session.commit()

        # A second call to ``create_root_user_with_company`` would
        # raise on its own eager flush instead of at this test's own
        # ``session.commit()`` (see that helper's docstring), so the
        # duplicate row is built with ``build_root_user`` instead,
        # reusing the first row's already-committed ``company_id``.
        session.add(build_root_user("E001", first.company_id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(User).filter_by(employee_no="E001").count() == 1

    def test_duplicate_project_code_is_accepted_with_distinct_ids(
        self, session
    ):
        owner = create_root_user_with_company(session, "E002")
        session.add(owner)
        session.commit()
        first = Project(
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P001",
            created_by=owner.id,
            updated_by=owner.id,
        )
        session.add(first)
        session.commit()

        second = Project(
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P001",
            created_by=owner.id,
            updated_by=owner.id,
        )
        session.add(second)
        session.commit()

        count = session.query(Project).filter_by(project_code="P001").count()
        assert count == 2
        assert first.id != second.id

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

        user = create_root_user_with_company(session, "E200")
        session.add(user)
        session.commit()

        assert user.created_by == user.id
        assert user.updated_by == user.id
        assert user.created_at == t0
        assert user.updated_at == t0

        project = Project(
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P200",
            created_by=user.id,
            updated_by=user.id,
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
        user = create_root_user_with_company(session, "E201")
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
        user = create_root_user_with_company(session, "E300")
        session.add(user)
        session.commit()

        bad_user = User(
            id=uuid7(),
            username="ue301",
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
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P300",
            created_by=None,
            updated_by=user.id,
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0

    def test_null_updated_by_is_rejected_on_both_tables(self, session):
        user = create_root_user_with_company(session, "E400")
        session.add(user)
        session.commit()

        bad_user = User(
            id=uuid7(),
            username="ue401",
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
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P400",
            created_by=user.id,
            updated_by=None,
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0

    def test_created_by_pointing_to_a_nonexistent_user_is_rejected(
        self, session
    ):
        user = create_root_user_with_company(session, "E500")
        session.add(user)
        session.commit()
        dangling = uuid7()

        bad_user = User(
            id=uuid7(),
            username="ue501",
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
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            project_code="P500",
            created_by=dangling,
            updated_by=user.id,
        )
        session.add(bad_project)
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(Project).count() == 0


class TestProjectBusinessFields:
    """DOM-AC28, AC29, AC31 and AC32."""

    @staticmethod
    def _values(owner_id):
        return {
            "project_code": "DEMO",
            "name": "示範廠機電工程",
            "client_name": "示範業主",
            "site_location": "示範工地",
            "created_by": owner_id,
            "updated_by": owner_id,
        }

    def test_required_and_optional_columns(self, engine, session):
        owner = create_root_user_with_company(session, "E601")
        session.commit()
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("projects")
        }
        assert set(columns) == {
            "id",
            "project_code",
            "name",
            "client_name",
            "site_location",
            "planned_start_date",
            "planned_completion_date",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        }
        for field in ("project_code", "name", "client_name", "site_location"):
            assert columns[field]["nullable"] is False
        for field in ("planned_start_date", "planned_completion_date"):
            assert columns[field]["nullable"] is True

        first = Project(**self._values(owner.id))
        session.add(first)
        session.commit()
        assert session.get(Project, first.id) is not None
        assert first.planned_start_date is None
        assert first.planned_completion_date is None

        dated = Project(
            **self._values(owner.id),
            planned_start_date=date(2026, 10, 1),
            planned_completion_date=date(2027, 1, 1),
        )
        session.add(dated)
        session.commit()
        assert dated.planned_start_date == date(2026, 10, 1)
        assert dated.planned_completion_date == date(2027, 1, 1)

        for field in ("project_code", "name", "client_name", "site_location"):
            values = self._values(owner.id)
            del values[field]
            session.add(Project(**values))
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()
            assert session.query(Project).count() == 2

    def test_length_limits_on_insert_and_update(self, engine, session):
        owner = create_root_user_with_company(session, "E602")
        session.commit()
        limits = {
            "project_code": 32,
            "name": 128,
            "client_name": 128,
            "site_location": 256,
        }
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("projects")
        }
        for field, limit in limits.items():
            assert columns[field]["type"].length == limit

        values = self._values(owner.id)
        values.update({field: "X" * limit for field, limit in limits.items()})
        boundary = Project(**values)
        session.add(boundary)
        session.commit()

        for field, limit in limits.items():
            invalid = self._values(owner.id)
            invalid[field] = "X" * (limit + 1)
            with pytest.raises(ValueError):
                Project(**invalid)
            assert session.query(Project).count() == 1

        with pytest.raises(ValueError):
            boundary.name = "X" * 129
        session.refresh(boundary)
        assert boundary.name == "X" * 128


def test_project_migration_round_trip_backfills_existing_row(db_url):
    """One old row survives upgrade, explicit downgrade and upgrade."""
    cfg = _alembic_config()
    command.upgrade(cfg, "4c38ff477939")
    engine = create_engine_from_settings(db_url)
    try:
        owner_id = uuid7()
        company_id = uuid7()
        project_id = uuid7()
        params = {
            "owner": owner_id.hex,
            "company": company_id.hex,
            "now": datetime.now(UTC).isoformat(),
        }
        with engine.begin() as conn:
            # Raw SQL: the ORM models describe the current schema, and
            # this database is deliberately older. ``users.company_id``
            # is deferred, so the owner goes in before its company.
            conn.execute(
                text(
                    "INSERT INTO users (id, employee_no, company_id, "
                    "department, location, name_en, name_zh, email, "
                    "created_at, updated_at, created_by, updated_by) "
                    "VALUES (:owner, 'E603', :company, 'D', 'L', 'N', "
                    "'名', 'e603@example.com', :now, :now, :owner, "
                    ":owner)"
                ),
                params,
            )
            conn.execute(
                text(
                    "INSERT INTO companies (id, code, name, kind, "
                    "created_at, updated_at, created_by, updated_by) "
                    "VALUES (:company, 'C603', 'Demo Co', 'internal', "
                    ":now, :now, :owner, :owner)"
                ),
                params,
            )
            conn.execute(
                text(
                    "INSERT INTO projects (id, project_code, "
                    "created_at, updated_at, created_by, updated_by) "
                    "VALUES (:id, :code, :now, :now, :owner, :owner)"
                ),
                {
                    "id": project_id.hex,
                    "code": "DEMO",
                    "now": datetime.now(UTC).isoformat(),
                    "owner": owner_id.hex,
                },
            )
    finally:
        engine.dispose()

    command.upgrade(cfg, "9d2b7c6e4a10")
    engine = create_engine_from_settings(db_url)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT name, client_name, site_location "
                    "FROM projects WHERE project_code = :code"
                ),
                {"code": "DEMO"},
            ).one()
            assert tuple(row) == ("DEMO", "未提供", "未提供")
    finally:
        engine.dispose()

    command.downgrade(cfg, "4c38ff477939")
    command.upgrade(cfg, "9d2b7c6e4a10")
    engine = create_engine_from_settings(db_url)
    try:
        with engine.connect() as conn:
            assert (
                conn.execute(
                    text(
                        "SELECT count(*) FROM projects "
                        "WHERE project_code = :code"
                    ),
                    {"code": "DEMO"},
                ).scalar_one()
                == 1
            )
    finally:
        engine.dispose()
