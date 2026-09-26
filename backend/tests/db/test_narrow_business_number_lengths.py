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
from sqlalchemy import String, inspect, text
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Project
from tests.db.conftest import build_root_user, create_root_user_with_company

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
        user = create_root_user_with_company(session, "E" * 16)
        session.commit()
        assert len(user.employee_no) == 16

    def test_project_code_at_32_chars_is_accepted(self, session):
        owner = create_root_user_with_company(session, "E600")
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
        # DOM-R31 (added after this test was written, by #130's
        # domain-model T2) now checks ``employee_no``'s length in
        # Python before it ever reaches the database on either
        # backend, so the over-limit value is rejected by ``User``'s
        # own ``@validates`` (a ``ValueError``, raised while
        # ``build_root_user`` constructs the row) instead of by
        # PostgreSQL's ``VARCHAR(16)`` column (a ``DataError``) --
        # both still reject the same value, only the layer that
        # catches it changed.
        anchor = create_root_user_with_company(session, "E601-anchor")
        session.commit()
        with pytest.raises((DataError, ValueError)):
            session.add(build_root_user("E" * 17, anchor.company_id))
            session.commit()
        session.rollback()

    def test_project_code_over_32_chars_is_rejected(self, session, engine):
        if engine.dialect.name != "postgresql":
            pytest.skip(
                "VARCHAR length is not enforced by SQLite; run with "
                "--db-backend=postgresql to exercise this"
            )
        owner = create_root_user_with_company(session, "E601")
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
    """Upgrading to the narrowing migration itself, downgrading past
    it, and upgrading back again preserves existing rows and keeps
    the unique constraint on ``employee_no`` enforced -- proving the
    ``op.batch_alter_table`` rebuild on both sides of the migration
    does not silently drop data or constraints (DBF-AC08, DBF-AC10).

    Stops at ``22bfdd8a72a4`` (this migration's own head) rather than
    ``head``: once ``domain-model`` T2 (#130) added ``User``'s
    mandatory ``company_id`` a few migrations later, a row that
    exists all the way up at ``head`` cannot survive a downgrade past
    ``companies``/``company_id`` and back -- ``company_id`` has no
    default, so re-adding it on the way back up over a leftover row
    fails (verified empirically). That is a real, unrelated
    consequence of a later migration adding a mandatory foreign key,
    not something this test needs to exercise: its own concern is
    ``22bfdd8a72a4``'s narrowing round trip, which this still proves
    in full. Because ``User``/``Project`` (the ORM classes) always
    reflect the *current* full schema, not whatever revision the
    database happens to be at, rows are written and read back with
    plain SQL here instead -- matching the columns that actually
    exist at this revision.
    """
    cfg = _alembic_config()
    command.upgrade(cfg, "22bfdd8a72a4")

    # A plain ISO string, not a ``datetime`` object: this goes
    # through raw ``text()`` SQL, not a mapped ``UTCDateTime``
    # column, so nothing adapts a Python ``datetime`` for the
    # driver (see ``test_company.py``'s
    # ``test_raw_sql_insert_without_is_active_defaults_to_true`` for
    # the same pattern).
    now = clock.utc_now().isoformat()
    engine = create_engine_from_settings(db_url)
    try:
        with engine.begin() as conn:
            self_id = uuid7()
            conn.execute(
                text(
                    "INSERT INTO users "
                    "(id, employee_no, created_at, updated_at, "
                    "created_by, updated_by) "
                    "VALUES (:id, :employee_no, :now, :now, :id, :id)"
                ),
                {"id": self_id.hex, "employee_no": "E700", "now": now},
            )
            project_id = uuid7()
            conn.execute(
                text(
                    "INSERT INTO projects "
                    "(id, project_code, created_at, updated_at, "
                    "created_by, updated_by) "
                    "VALUES (:id, :project_code, :now, :now, "
                    ":creator, :creator)"
                ),
                {
                    "id": project_id.hex,
                    "project_code": "P700",
                    "now": now,
                    "creator": self_id.hex,
                },
            )
    finally:
        engine.dispose()

    # Target the narrowing migration's parent explicitly: "-1"
    # would only undo whichever migration is head at the time.
    command.downgrade(cfg, "78a4ba191ab5")
    command.upgrade(cfg, "22bfdd8a72a4")

    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            col["name"]: col for col in inspect(engine).get_columns("users")
        }
        employee_no_type = columns["employee_no"]["type"]
        assert isinstance(employee_no_type, String)
        assert employee_no_type.length == 16

        with engine.begin() as conn:
            user_row = conn.execute(
                text("SELECT employee_no FROM users WHERE id = :id"),
                {"id": self_id.hex},
            ).one()
            project_row = conn.execute(
                text("SELECT project_code FROM projects WHERE id = :id"),
                {"id": project_id.hex},
            ).one()
            assert user_row.employee_no == "E700"
            assert project_row.project_code == "P700"

            with pytest.raises(IntegrityError):
                conn.execute(
                    text(
                        "INSERT INTO users "
                        "(id, employee_no, created_at, updated_at, "
                        "created_by, updated_by) "
                        "VALUES (:id, :employee_no, :now, :now, "
                        ":creator, :creator)"
                    ),
                    {
                        "id": uuid7().hex,
                        "employee_no": "E700",
                        "now": now,
                        "creator": self_id.hex,
                    },
                )
    finally:
        engine.dispose()
