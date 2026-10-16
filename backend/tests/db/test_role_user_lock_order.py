"""DOM-R72/R73 role and user lock-order acceptance tests."""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from alembic.config import Config
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from app.services import module_permissions, users
from app.services.project_members import add_project_member
from app.services.roles import update_role
from tests.db.conftest import create_root_user_with_company, make_system_admin

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


@pytest.fixture(autouse=True)
def _dispose_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def postgres_engine(
    db_url: str, request: pytest.FixtureRequest
) -> Generator[Engine, None, None]:
    if request.config.getoption("--db-backend") != "postgresql":
        pytest.skip("requires PostgreSQL row locks and independent sessions")
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    engine = create_engine_from_settings(db_url)
    yield engine
    engine.dispose()


def _prepare_race(
    session: Session,
    *,
    external_allowed: bool = True,
    assign_target: bool = True,
) -> tuple[User, User, Role, Project]:
    actor = create_root_user_with_company(session, "LOCK621ADMIN")
    make_system_admin(actor)
    target = create_root_user_with_company(session, "LOCK621TARGET")
    role = Role(
        name="外部查閱角色",
        is_external_allowed=external_allowed,
        created_by=actor.id,
        updated_by=actor.id,
        permission_codes=[RolePermission(code="project.read")],
    )
    project = Project(
        project_code="LOCK621",
        name="鎖定順序測試",
        client_name="測試業主",
        site_location="測試地點",
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add_all([role, project])
    session.flush()
    if assign_target:
        member = ProjectMember(
            project_id=project.id,
            user_id=target.id,
            created_by=actor.id,
            updated_by=actor.id,
            role_assignments=[ProjectMemberRole(role_id=role.id)],
        )
        session.add(member)
    session.commit()
    return actor, target, role, project


def test_postgres_role_update_serializes_before_external_transition(
    postgres_engine: Engine,
) -> None:
    """角色先取得排他鎖時，外部標記轉換會讀到新限制。"""
    with Session(postgres_engine) as setup:
        actor, target, role, _ = _prepare_race(setup)
        target_id, role_id = target.id, role.id

    role_locked = Event()
    external_started = Event()

    def edit_role() -> str:
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                worker.execute(
                    select(Role.id).where(Role.id == role_id).with_for_update()
                )
                role_locked.set()
                assert external_started.wait(timeout=5)
                role_row = worker.get(Role, role_id)
                assert role_row is not None
                update_role(worker, role_row, is_external_allowed=False)
        return "role"

    def make_external() -> str:
        assert role_locked.wait(timeout=5)
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                target_row = worker.get(User, target_id)
                assert target_row is not None
                external_started.set()
                try:
                    users.set_external_collaborator(
                        worker, target_row, True, confirmed=True
                    )
                except users.ExternalFlagChangeError:
                    return "external-rejected"
        return "external"

    with ThreadPoolExecutor(max_workers=2) as pool:
        role_future = pool.submit(edit_role)
        external_future = pool.submit(make_external)
        outcomes = {
            role_future.result(timeout=10),
            external_future.result(timeout=10),
        }

    assert outcomes == {"role", "external-rejected"}
    with Session(postgres_engine) as check:
        role_row = check.get(Role, role_id)
        user_row = check.get(User, target_id)
        assert role_row is not None
        assert user_row is not None
        assert role_row.is_external_allowed is False
        assert user_row.is_external_collaborator is False


def test_postgres_external_transition_serializes_before_role_update(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """外部標記先取得共享角色鎖時，角色修改會讀到最新人員狀態。"""
    with Session(postgres_engine) as setup:
        actor, target, role, _ = _prepare_race(setup)
        target_id, role_id = target.id, role.id

    external_updated = Event()
    release_external = Event()
    role_update_started = Event()
    original_audit = users.record_audit_event

    def pause_after_external_update(*args, **kwargs):
        original_audit(*args, **kwargs)
        if args[1] == "user.external_flag_changed":
            external_updated.set()
            assert release_external.wait(timeout=5)

    monkeypatch.setattr(
        users, "record_audit_event", pause_after_external_update
    )

    def make_external() -> str:
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                target_row = worker.get(User, target_id)
                assert target_row is not None
                users.set_external_collaborator(
                    worker, target_row, True, confirmed=True
                )
        return "external"

    def edit_role() -> str:
        assert external_updated.wait(timeout=5)
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                role_row = worker.get(Role, role_id)
                assert role_row is not None
                role_update_started.set()
                try:
                    update_role(worker, role_row, is_external_allowed=False)
                except module_permissions.ExternalRoleInUseError:
                    return "role-rejected"
        return "role"

    with ThreadPoolExecutor(max_workers=2) as pool:
        external_future = pool.submit(make_external)
        role_future = pool.submit(edit_role)
        assert role_update_started.wait(timeout=5)
        release_external.set()
        outcomes = {
            external_future.result(timeout=10),
            role_future.result(timeout=10),
        }

    assert outcomes == {"external", "role-rejected"}
    with Session(postgres_engine) as check:
        role_row = check.get(Role, role_id)
        user_row = check.get(User, target_id)
        assert role_row is not None
        assert user_row is not None
        assert role_row.is_external_allowed is True
        assert user_row.is_external_collaborator is True


def test_postgres_assignment_serializes_with_external_transition(
    postgres_engine: Engine,
) -> None:
    """角色指派與外部標記轉換不能同時通過互斥檢查。"""
    with Session(postgres_engine) as setup:
        _, target, role, project = _prepare_race(
            setup, external_allowed=False, assign_target=False
        )
        target_id, role_id, project_id = target.id, role.id, project.id

    assignment_locked = Event()
    transition_started = Event()

    def assign_role() -> str:
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                worker.execute(
                    select(Role.id)
                    .where(Role.id == role_id)
                    .with_for_update(read=True)
                )
                assignment_locked.set()
                assert transition_started.wait(timeout=5)
                try:
                    add_project_member(
                        worker,
                        project_id=project_id,
                        user_id=target_id,
                        role_ids={role_id},
                    )
                except module_permissions.ExternalRoleAssignmentError:
                    return "assignment-rejected"
        return "assignment"

    def make_external() -> str:
        assert assignment_locked.wait(timeout=5)
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                target_row = worker.get(User, target_id)
                assert target_row is not None
                transition_started.set()
                try:
                    users.set_external_collaborator(
                        worker, target_row, True, confirmed=True
                    )
                except users.ExternalFlagChangeError:
                    return "transition-rejected"
        return "transition"

    with ThreadPoolExecutor(max_workers=2) as pool:
        assignment_future = pool.submit(assign_role)
        transition_future = pool.submit(make_external)
        outcomes = {
            assignment_future.result(timeout=10),
            transition_future.result(timeout=10),
        }

    assert len(outcomes) == 2
    assert (
        sum(value in {"assignment", "transition"} for value in outcomes) == 1
    )
    with Session(postgres_engine) as check:
        user = check.get(User, target_id)
        assert user is not None
        assignment_exists = check.scalar(
            select(ProjectMemberRole.id)
            .join(
                ProjectMember,
                ProjectMember.id == ProjectMemberRole.project_member_id,
            )
            .where(
                ProjectMember.user_id == target_id,
                ProjectMemberRole.role_id == role_id,
            )
        )
        assert not (user.is_external_collaborator and assignment_exists)
