"""PostgreSQL-backed acceptance for the effective-access API (#702)."""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import UserModuleDelegation, UserModulePermission
from app.services.module_permissions import revoke_module_permission
from app.services.project_members import add_project_member
from app.services.roles import create_role
from tests.api.test_effective_access_api import (
    _admin,
    _client_for,
    _project,
    _url,
    _user,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url: str) -> str:
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    return db_url


@pytest.fixture
def engine(
    request: pytest.FixtureRequest, migrated_url: str
) -> Generator[Engine, None, None]:
    test_engine = create_engine_from_settings(migrated_url)
    assert test_engine.dialect.name == request.config.getoption("--db-backend")
    try:
        yield test_engine
    finally:
        test_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def make_client(engine: Engine):
    def create_client() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return create_client


def test_effective_access_admin_and_delegate_on_database(
    db_session: Session, make_client
) -> None:
    admin = _admin(db_session)
    delegate = _user(db_session, "pg-project-delegate")
    target = _user(db_session, "pg-access-target")
    project = _project(db_session)
    role = create_role(
        db_session,
        name="PostgreSQL access role",
        permission_codes=["project_member.manage"],
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=target.id,
        role_ids=[role.id],
        actor_user_id=admin.id,
    )
    db_session.add(UserModuleDelegation(user_id=delegate.id, module="project"))
    db_session.add_all(
        [
            UserModulePermission(
                user_id=target.id,
                permission_code=code,
                source="manual",
            )
            for code in ("project.use", "project.create")
        ]
    )
    db_session.commit()

    admin_client = _client_for(admin, db_session, make_client)
    delegate_client = _client_for(delegate, db_session, make_client)
    endpoint = _url(target.id, project.id)
    admin_body = admin_client.get(endpoint).json()
    assert admin_body["project_roles"][0]["permission_codes"] == [
        "project_member.manage"
    ]
    assert {
        item["action"]: item["allowed"] for item in admin_body["diagnostics"]
    }["manage_project_members"] is True

    delegate_body = delegate_client.get(endpoint).json()
    assert "project_roles" not in delegate_body
    assert {item["code"] for item in delegate_body["module_permissions"]} == {
        "project.use",
        "project.create",
    }
    assert {item["action"] for item in delegate_body["diagnostics"]} == {
        "create_project",
        "manage_project_members",
    }

    revoke_module_permission(
        db_session,
        actor=admin,
        user=target,
        permission_code="project.create",
    )
    db_session.commit()
    updated = delegate_client.get(endpoint).json()
    create_diagnostic = next(
        item
        for item in updated["diagnostics"]
        if item["action"] == "create_project"
    )
    assert create_diagnostic["allowed"] is False
    assert create_diagnostic["missing_codes"] == ["project.create"]
