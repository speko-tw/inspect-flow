"""Tests for ``Project.project_code``'s Python-side length check
(issue #168): SQLite does not enforce ``VARCHAR(n)`` at all, so
without a Python-side check an over-limit value written through
SQLite would silently persist. ``app/models/project.py``'s
``_ProjectCodeType``/``_validate_project_code`` close that gap on
both write paths (ORM attribute assignment/construction and Core
``insert()``/``update()``), the same two-layer pattern
``app/models/user.py``/``app/models/company.py`` use for their own
DOM-R28/DOM-R29 columns.

Runs on SQLite (this suite's default backend, see
``tests/db/conftest.py``): unlike
``test_narrow_business_number_lengths.py``'s
``TestOverLimitValuesAreRejectedByPostgresql`` (which skips outside
``--db-backend=postgresql`` because it exercises PostgreSQL's own
``VARCHAR(n)`` enforcement), the rejections here come from Python
before a value ever reaches either backend, so they hold on SQLite
too.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import insert, update
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import Project
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_MAX_LENGTH = 32


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


@pytest.fixture
def owner(session):
    user = create_root_user_with_company(session, "E900")
    session.commit()
    return user


@pytest.fixture
def existing_project(session, owner):
    project = Project(
        project_code="P900", created_by=owner.id, updated_by=owner.id
    )
    session.add(project)
    session.commit()
    return project


class TestOrmConstructionAndAssignment:
    def test_construction_with_33_chars_is_rejected(self, owner):
        with pytest.raises(ValueError):
            Project(
                project_code="P" * (_MAX_LENGTH + 1),
                created_by=owner.id,
                updated_by=owner.id,
            )

    def test_assignment_of_33_chars_is_rejected_and_unchanged(
        self, session, existing_project
    ):
        with pytest.raises(ValueError):
            existing_project.project_code = "P" * (_MAX_LENGTH + 1)

        session.expire(existing_project)
        stored = session.get(Project, existing_project.id)
        assert stored.project_code == "P900"

    def test_construction_with_32_chars_is_accepted(self, session, owner):
        project = Project(
            project_code="P" * _MAX_LENGTH,
            created_by=owner.id,
            updated_by=owner.id,
        )
        session.add(project)
        session.commit()
        assert project.project_code == "P" * _MAX_LENGTH


class TestCoreInsertAndUpdate:
    """``session.execute(insert(Project)...)``/
    ``session.execute(update(Project)...)`` never call
    ``@validates`` -- only ``_ProjectCodeType.process_bind_param``
    sees these values.
    """

    def test_core_insert_with_33_chars_is_rejected(self, session, owner):
        before = session.query(Project).count()
        with pytest.raises((StatementError, ValueError)):
            session.execute(
                insert(Project).values(
                    project_code="P" * (_MAX_LENGTH + 1),
                    created_by=owner.id,
                    updated_by=owner.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(Project).count() == before

    def test_core_update_with_33_chars_is_rejected_and_unchanged(
        self, session, existing_project
    ):
        with pytest.raises((StatementError, ValueError)):
            session.execute(
                update(Project)
                .where(Project.id == existing_project.id)
                .values(project_code="P" * (_MAX_LENGTH + 1))
            )
            session.commit()
        session.rollback()

        session.expire_all()
        stored = session.get(Project, existing_project.id)
        assert stored.project_code == "P900"

    def test_core_insert_with_32_chars_is_accepted(self, session, owner):
        before = session.query(Project).count()
        session.execute(
            insert(Project).values(
                project_code="P" * _MAX_LENGTH,
                created_by=owner.id,
                updated_by=owner.id,
            )
        )
        session.commit()

        count = (
            session.query(Project)
            .filter_by(project_code="P" * _MAX_LENGTH)
            .count()
        )
        assert count == 1
        assert session.query(Project).count() == before + 1
