"""Tests for the ``employee_no``/``project_code`` length-narrowing
migration ``22bfdd8a72a4`` (issue #140, DOM-Q1 ruled in #121).

``employee_no`` is narrowed to ``VARCHAR(16)`` and ``project_code``
to ``VARCHAR(32)`` (the latter a provisional value carried over
from ``employee_no`` pending ``Project``'s own business columns,
OQ-01 -- see the PR description).

Like ``test_user_project.py``, this migrates the database behind
``conftest.py``'s ``db_url`` fixture with the real Alembic migration
chain and reads/writes it exclusively through SQLAlchemy (DBF-R01).

No ``postgresql_only`` marker exists in this suite (only
``sqlite_only``, see ``tests/db/conftest.py``): PostgreSQL enforces
``VARCHAR(n)`` at the database level while SQLite does not (a
``VARCHAR(n)`` column there is a storage hint only, never checked on
write), so the over-limit rejection tests below skip themselves at
runtime by checking ``engine.dialect.name`` instead of adding a new
marker to shared test infrastructure.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import String, inspect
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Project, User

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


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(_alembic_config(), "head")
    return db_url


@pytest.fixture
def engine(migrated_url):
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
    self_id = uuid7()
    return User(
        id=self_id,
        employee_no=employee_no,
        created_by=self_id,
        updated_by=self_id,
    )


class TestMigratedSchemaReflectsNarrowedLengths:
    def test_employee_no_is_varchar_16(self, engine):
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("users")
        }
        assert columns["employee_no"]["type"].length == 16

    def test_project_code_is_varchar_32(self, engine):
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("projects")
        }
        assert columns["project_code"]["type"].length == 32


class TestBoundaryLengthValuesAreAccepted:
    def test_employee_no_at_16_chars_is_accepted(self, session):
        user = _new_root_user("E" * 16)
        session.add(user)
        session.commit()
        assert len(user.employee_no) == 16

    def test_project_code_at_32_chars_is_accepted(self, session):
        owner = _new_root_user("E600")
        session.add(owner)
        session.commit()

        project = Project(
            project_code="P" * 32,
            created_by=owner.id,
            updated_by=owner.id,
        )
        session.add(project)
        session.commit()
        assert len(project.project_code) == 32


class TestOverLimitValuesAreRejectedByPostgresql:
    """PostgreSQL enforces ``VARCHAR(n)`` server-side; SQLite does
    not, so these skip themselves outside a PostgreSQL run
    (``--db-backend=postgresql``) rather than asserting a rejection
    SQLite never actually performs.
    """

    def test_employee_no_over_16_chars_is_rejected(self, session, engine):
        if engine.dialect.name != "postgresql":
            pytest.skip(
                "VARCHAR length is not enforced by SQLite; run with "
                "--db-backend=postgresql to exercise this"
            )
        session.add(_new_root_user("E" * 17))
        with pytest.raises(DataError):
            session.commit()
        session.rollback()

    def test_project_code_over_32_chars_is_rejected(self, session, engine):
        if engine.dialect.name != "postgresql":
            pytest.skip(
                "VARCHAR length is not enforced by SQLite; run with "
                "--db-backend=postgresql to exercise this"
            )
        owner = _new_root_user("E601")
        session.add(owner)
        session.commit()

        session.add(
            Project(
                project_code="P" * 33,
                created_by=owner.id,
                updated_by=owner.id,
            )
        )
        with pytest.raises(DataError):
            session.commit()
        session.rollback()


def test_narrowing_migration_round_trip_preserves_rows_and_constraints(
    db_url,
):
    """Upgrading to head, downgrading past the narrowing migration,
    and upgrading back to head again preserves existing rows and
    keeps the unique constraint on ``employee_no`` enforced --
    proving the ``op.batch_alter_table`` rebuild on both sides of
    the migration does not silently drop data or constraints
    (DBF-AC08, DBF-AC10).
    """
    cfg = _alembic_config()
    command.upgrade(cfg, "head")

    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as sess:
            user = _new_root_user("E700")
            sess.add(user)
            sess.commit()
            project = Project(
                project_code="P700",
                created_by=user.id,
                updated_by=user.id,
            )
            sess.add(project)
            sess.commit()
            user_id, project_id = user.id, project.id
    finally:
        engine.dispose()

    command.downgrade(cfg, "-1")
    command.upgrade(cfg, "head")

    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("users")
        }
        employee_no_type = columns["employee_no"]["type"]
        assert isinstance(employee_no_type, String)
        assert employee_no_type.length == 16

        with Session(engine) as sess:
            user = sess.get(User, user_id)
            project = sess.get(Project, project_id)
            assert user is not None
            assert user.employee_no == "E700"
            assert project is not None
            assert project.project_code == "P700"

            sess.add(_new_root_user("E700"))
            with pytest.raises(IntegrityError):
                sess.commit()
            sess.rollback()
    finally:
        engine.dispose()
