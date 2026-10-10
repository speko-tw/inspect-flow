"""Database constraints and migration backfill for module permissions."""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, insert, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    CreatorRoleSetting,
    Role,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
_PARENT_REVISION = "f6c142a90b7d"


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


def _cfg() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(_cfg(), "head")
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
def creator(session: Session) -> User:
    user = create_root_user_with_company(session, "E574M")
    session.commit()
    return user


def _permission_values(user_id, code="project.create", source="manual"):
    return {
        "id": uuid7(),
        "user_id": user_id,
        "permission_code": code,
        "source": source,
    }


class TestModulePermissionConstraints:
    def test_duplicate_user_permission_is_rejected(self, session, creator):
        statement = insert(UserModulePermission)
        values = _permission_values(creator.id)
        session.execute(statement.values(**values))
        session.commit()

        with pytest.raises(IntegrityError):
            session.execute(statement.values(**_permission_values(creator.id)))
        session.rollback()

    def test_missing_user_foreign_key_is_rejected(self, session):
        with pytest.raises(IntegrityError):
            session.execute(
                insert(UserModulePermission).values(
                    **_permission_values(uuid7())
                )
            )
        session.rollback()

    def test_invalid_source_check_is_rejected(self, session, creator):
        with pytest.raises(IntegrityError):
            session.execute(
                insert(UserModulePermission).values(
                    **_permission_values(creator.id, source="unknown")
                )
            )
        session.rollback()

    def test_invalid_module_check_is_rejected(self, session, creator):
        with pytest.raises(IntegrityError):
            session.execute(
                insert(UserModuleDelegation).values(
                    user_id=creator.id, module="unknown"
                )
            )
        session.rollback()

    def test_creator_role_setting_allows_only_one_row(self, session, creator):
        role = Role(
            name="Creator role",
            created_by=creator.id,
            updated_by=creator.id,
        )
        session.add(role)
        session.flush()
        session.add(CreatorRoleSetting(role_id=role.id))
        session.commit()

        session.add(CreatorRoleSetting(role_id=role.id))
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_existing_user_is_backfilled_without_server_default(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            user = create_root_user_with_company(session, "E574B")
            user_id = user.id
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    new_engine = create_engine_from_settings(db_url)
    try:
        inspector = inspect(new_engine)
        column = next(
            column
            for column in inspector.get_columns("users")
            if column["name"] == "is_external_collaborator"
        )
        assert column["nullable"] is False
        assert column["default"] is None

        with Session(new_engine) as session:
            value = session.scalar(
                select(User.is_external_collaborator).where(User.id == user_id)
            )
        assert value is False
    finally:
        new_engine.dispose()
