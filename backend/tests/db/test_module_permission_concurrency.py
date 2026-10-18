"""DOM-R62、DOM-R64 模組授權與建立者角色併發驗收。"""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event
from time import monotonic, sleep

import pytest
from alembic.config import Config
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    AuditLog,
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModulePermission,
)
from app.services import module_permissions
from app.services.module_permissions import CreatorRoleInUseError
from app.services.roles import delete_role
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
        pytest.skip("requires PostgreSQL independent-session concurrency")
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    engine = create_engine_from_settings(db_url)
    try:
        yield engine
    finally:
        engine.dispose()


def _wait_for_lock_wait(engine: Engine, pids: list[int]) -> None:
    """等待其中一個 Session 真正進入 PostgreSQL row lock wait。"""
    deadline = monotonic() + 5
    while monotonic() < deadline:
        for pid in pids:
            with Session(engine) as observer:
                wait_type = observer.execute(
                    text(
                        "SELECT wait_event_type FROM pg_stat_activity "
                        "WHERE pid = :pid"
                    ),
                    {"pid": pid},
                ).scalar_one_or_none()
            if wait_type == "Lock":
                return
        sleep(0.01)
    raise AssertionError(f"backends {pids} did not wait for a PostgreSQL lock")


def _prepare_users(session: Session) -> tuple[User, User]:
    actor = create_root_user_with_company(session, "CON581ADMIN")
    make_system_admin(actor)
    target = create_root_user_with_company(session, "CON581TARGET")
    session.flush()
    return actor, target


def _run_two_sessions(
    engine: Engine,
    *,
    actor_id,
    target_id,
    operation,
    insert_started: Event,
    release_insert: Event,
) -> tuple[bool, bool]:
    """讓第二個 INSERT 在第一個交易尚未提交時撞上唯一鍵。"""
    start = Barrier(2)
    backend_pid: dict[str, int] = {}

    def run(label: str) -> bool:
        with Session(engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                backend_pid[label] = worker.execute(
                    text("SELECT pg_backend_pid()")
                ).scalar_one()
                actor = worker.get(User, actor_id)
                target = worker.get(User, target_id)
                assert actor is not None and target is not None
                start.wait(timeout=5)
                return operation(worker, actor, target)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, "first")
        second = pool.submit(run, "second")
        if not insert_started.wait(timeout=5):
            for future in (first, second):
                if future.done():
                    future.result()
            raise AssertionError("no worker completed the conflicting insert")
        _wait_for_lock_wait(engine, list(backend_pid.values()))
        release_insert.set()
        return first.result(timeout=10), second.result(timeout=10)


def test_postgres_duplicate_permission_grants_are_idempotent(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DOM-R62 重複授權只新增一列並只記一筆授予事件。"""
    with Session(postgres_engine) as setup:
        actor, target = _prepare_users(setup)
        actor_id, target_id = actor.id, target.id
        setup.commit()

    insert_started = Event()
    release_insert = Event()
    original = module_permissions._insert_permission

    def pause_after_insert(*args, **kwargs) -> bool:
        inserted = original(*args, **kwargs)
        if inserted and not insert_started.is_set():
            insert_started.set()
            assert release_insert.wait(timeout=5)
        return inserted

    monkeypatch.setattr(
        module_permissions, "_insert_permission", pause_after_insert
    )
    outcomes = _run_two_sessions(
        postgres_engine,
        actor_id=actor_id,
        target_id=target_id,
        operation=lambda session, actor, target: (
            module_permissions.grant_module_permission(
                session,
                actor=actor,
                user=target,
                permission_code="inspection.use",
            )
        ),
        insert_started=insert_started,
        release_insert=release_insert,
    )

    assert sorted(outcomes) == [False, True]
    with Session(postgres_engine) as check:
        rows = check.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target_id,
                UserModulePermission.permission_code == "inspection.use",
            )
        ).all()
        events = check.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.granted",
                AuditLog.entity_id == target_id,
            )
        ).all()
    assert len(rows) == 1
    assert len(events) == 1


def test_postgres_duplicate_bundle_apply_is_idempotent(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DOM-R62 重複組合套用不重複新增授權或稽核。"""
    with Session(postgres_engine) as setup:
        actor, target = _prepare_users(setup)
        bundle = PermissionBundle(
            name="Concurrent bundle",
            created_by=actor.id,
            updated_by=actor.id,
            permission_codes=[
                PermissionBundlePermission(permission_code="inspection.use")
            ],
        )
        setup.add(bundle)
        setup.flush()
        actor_id, target_id, bundle_id = actor.id, target.id, bundle.id
        setup.commit()

    insert_started = Event()
    release_insert = Event()
    original = module_permissions._insert_permission

    def pause_after_insert(*args, **kwargs) -> bool:
        inserted = original(*args, **kwargs)
        if inserted and not insert_started.is_set():
            insert_started.set()
            assert release_insert.wait(timeout=5)
        return inserted

    monkeypatch.setattr(
        module_permissions,
        "_insert_permission",
        pause_after_insert,
    )

    def apply(session: Session, actor: User, target: User) -> bool:
        bundle = session.get(PermissionBundle, bundle_id)
        assert bundle is not None
        return module_permissions.apply_permission_bundle(
            session, actor=actor, user=target, bundle=bundle
        )

    outcomes = _run_two_sessions(
        postgres_engine,
        actor_id=actor_id,
        target_id=target_id,
        operation=apply,
        insert_started=insert_started,
        release_insert=release_insert,
    )

    assert sorted(outcomes) == [False, True]
    with Session(postgres_engine) as check:
        rows = check.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target_id,
                UserModulePermission.permission_code == "inspection.use",
            )
        ).all()
        events = check.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "permission_bundle.applied",
                AuditLog.entity_id == bundle_id,
            )
        ).all()
    assert len(rows) == 1
    assert len(events) == 1


def test_postgres_creator_role_change_serializes_with_delete(
    postgres_engine: Engine, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DOM-R64 設定先取得角色鎖後，刪除回穩定的使用中錯誤。"""
    required = ["project.update", "project_member.manage", "project.read"]
    with Session(postgres_engine) as setup:
        actor, target = _prepare_users(setup)
        current = Role(
            name="Current creator",
            created_by=actor.id,
            updated_by=actor.id,
            permission_codes=[RolePermission(code=code) for code in required],
        )
        candidate = Role(
            name="Candidate creator",
            created_by=actor.id,
            updated_by=actor.id,
            permission_codes=[RolePermission(code=code) for code in required],
        )
        project = Project(
            project_code="CON581",
            name="併發鎖定專案",
            client_name="測試業主",
            site_location="測試地點",
            created_by=actor.id,
            updated_by=actor.id,
        )
        setup.add_all([current, candidate, project])
        setup.flush()
        member = ProjectMember(
            project_id=project.id,
            user_id=target.id,
            created_by=actor.id,
            updated_by=actor.id,
        )
        setup.add(member)
        setup.flush()
        setup.add(
            ProjectMemberRole(
                project_member_id=member.id, role_id=candidate.id
            )
        )
        setup.add(CreatorRoleSetting(role_id=current.id))
        setup.flush()
        actor_id, candidate_id = actor.id, candidate.id
        setup.commit()

    setting_written = Event()
    release_patch = Event()
    delete_started = Event()
    backend_pid: dict[str, int] = {}
    original = module_permissions.audit_service.record_audit_event

    def pause_setting_audit(*args, **kwargs):
        result = original(*args, **kwargs)
        if args[1] == "creator_role.changed":
            setting_written.set()
            assert release_patch.wait(timeout=5)
        return result

    monkeypatch.setattr(
        module_permissions.audit_service,
        "record_audit_event",
        pause_setting_audit,
    )

    def change_setting() -> str:
        with Session(postgres_engine) as worker:
            with worker.begin():
                actor = worker.get(User, actor_id)
                role = worker.get(Role, candidate_id)
                assert actor is not None and role is not None
                module_permissions.change_creator_role(
                    worker, actor=actor, role=role
                )
        return "changed"

    def remove_candidate() -> str:
        assert setting_written.wait(timeout=5)
        with Session(postgres_engine) as worker:
            with worker.begin():
                worker.execute(text("SET LOCAL lock_timeout = '5s'"))
                backend_pid["delete"] = worker.execute(
                    text("SELECT pg_backend_pid()")
                ).scalar_one()
                role = worker.get(Role, candidate_id)
                assert role is not None
                delete_started.set()
                try:
                    delete_role(worker, role)
                except CreatorRoleInUseError:
                    return "creator-role-in-use"
        return "deleted"

    with ThreadPoolExecutor(max_workers=2) as pool:
        patch_future = pool.submit(change_setting)
        delete_future = pool.submit(remove_candidate)
        assert delete_started.wait(timeout=5)
        _wait_for_lock_wait(postgres_engine, [backend_pid["delete"]])
        release_patch.set()
        assert patch_future.result(timeout=10) == "changed"
        assert delete_future.result(timeout=10) == "creator-role-in-use"

    with Session(postgres_engine) as check:
        setting = check.scalar(select(CreatorRoleSetting))
        assert setting is not None and setting.role_id == candidate_id
        assert check.get(Role, candidate_id) is not None
