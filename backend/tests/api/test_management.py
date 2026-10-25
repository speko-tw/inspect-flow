"""Admin management API checks, including first-user attribution."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.errors import ErrorCode
from app.auth.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    verify_password,
)
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db import clock
from app.main import create_app
from app.models import (
    AuditLog,
    AuthSession,
    Company,
    InspectionPlan,
    InspectionTask,
    LoginCounter,
    LoginFailure,
    Project,
    ProjectMember,
    User,
    UserModuleDelegation,
    UserModulePermission,
    UserPassword,
)
from app.services.audit import InvalidAuditEventShapeError
from app.services.users import create_user
from tests.api.query_count import select_count
from tests.db.conftest import create_root_user_with_company
from tests.response_order import observed_client


@pytest.fixture
def admin_client(db_session, make_client) -> tuple[TestClient, User]:
    admin = create_root_user_with_company(db_session, "ADM263")
    admin.is_system = True
    admin.is_admin = True
    admin.username = "admin"
    admin.company_id = None
    admin.employee_no = None
    admin.department = None
    admin.location = None
    admin.name_en = None
    admin.name_zh = None
    db_session.flush()
    _, token = create_session(db_session, admin)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client, admin


def test_dom_ac46_first_user_and_temporary_password(admin_client, db_session):
    client, admin = admin_client
    response = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "first.user",
            "email": "first@demo.example",
            "name_zh": "示範使用者",
            "is_admin": True,
        },
    )
    assert response.status_code == 201
    body = response.json()
    password = body.pop("temporary_password")
    assert len(password) == 20
    assert password.isascii() and password.isdecimal()
    assert MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH
    assert response.headers["cache-control"] == "no-store"
    assert body["is_admin"] is True
    user = db_session.scalar(select(User).where(User.username == "first.user"))
    assert user is not None
    assert user.created_by == admin.id
    assert user.updated_by == admin.id
    stored = db_session.scalar(
        select(UserPassword).where(UserPassword.user_id == user.id)
    )
    assert stored is not None

    assert stored.must_change_password is True
    assert password not in client.get(f"/api/v1/users/{user.id}").text
    assert password not in client.get("/api/v1/users").text
    events = list(
        db_session.scalars(
            select(AuditLog).where(AuditLog.entity_id == user.id)
        )
    )
    assert {event.event_type for event in events} == {
        "user.created",
        "user.admin_changed",
        "user.password_set",
    }
    created = next(
        event for event in events if event.event_type == "user.created"
    )
    assert created.created_by == admin.id
    assert created.before is None
    assert created.after == {
        "username": "first.user",
        "name_zh": "示範使用者",
        "email": "first@demo.example",
        "is_external_collaborator": False,
        "auth_source": "local",
    }
    assert password not in str(created.after)


def test_deactivate_commits_before_response(admin_client, db_session):
    """停用帳號須在 ASGI 開始回應前提交。"""
    original_client, _admin = admin_client
    token = original_client.cookies.get(SESSION_COOKIE_NAME)
    user = create_root_user_with_company(db_session, "R618ACTIVE")
    db_session.commit()

    with observed_client(create_app()) as (client, events):
        client.cookies.set(SESSION_COOKIE_NAME, token)
        response = client.put(
            f"/api/v1/users/{user.id}/active",
            json={"is_active": False},
        )

    assert response.status_code == 200
    assert events.index("commit") < events.index("response_started")
    db_session.expire(user)
    assert user.is_active is False


def test_admin_temporary_password_reset_is_one_time_and_revokes_sessions(
    admin_client, db_session, make_client
):
    client, _admin = admin_client
    created = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "reset.target",
            "email": "reset.target@example.test",
            "name_zh": "重設對象",
        },
    )
    assert created.status_code == 201
    user_id = UUID(created.json()["id"])
    target = db_session.get(User, user_id)
    assert target is not None
    target.is_active = True
    tokens = [create_session(db_session, target)[1] for _ in range(2)]
    now = datetime.now(UTC)
    counter = db_session.scalar(
        select(LoginCounter).where(LoginCounter.user_id == user_id)
    )
    assert counter is not None
    counter.failure_count = 10
    counter.locked_until = now + timedelta(minutes=10)
    db_session.add(LoginFailure(user_id=user_id, failed_at=now))
    db_session.commit()
    events_before = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.event_type == "user.password_set",
            AuditLog.entity_id == user_id,
        )
    )

    reset = client.post(f"/api/v1/users/{user_id}/temporary-password", json={})
    assert reset.status_code == 200, reset.text
    body = reset.json()
    password = body.pop("temporary_password")
    assert len(password) == 20
    assert password.isascii() and password.isdecimal()
    assert MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH
    assert body == {
        "user_id": str(user_id),
        "username": "reset.target",
        "must_change_password": True,
    }
    assert reset.headers["cache-control"] == "no-store"
    assert password not in client.get("/api/v1/users").text
    assert password not in client.get(f"/api/v1/users/{user_id}").text
    stored = db_session.scalar(
        select(UserPassword).where(UserPassword.user_id == user_id)
    )
    assert stored is not None and stored.must_change_password is True
    assert verify_password(stored.password_hash, password)
    assert (
        db_session.scalar(
            select(func.count(AuthSession.id)).where(
                AuthSession.user_id == user_id
            )
        )
        == 0
    )
    counter = db_session.scalar(
        select(LoginCounter).where(LoginCounter.user_id == user_id)
    )
    assert counter is not None
    assert counter.failure_count == 0
    assert counter.locked_until is None
    assert (
        db_session.scalar(
            select(func.count(LoginFailure.id)).where(
                LoginFailure.user_id == user_id
            )
        )
        == 0
    )
    assert (
        db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.event_type == "user.password_set",
                AuditLog.entity_id == user_id,
            )
        )
        == events_before + 1
    )
    for token in tokens:
        old_client = make_client()
        old_client.cookies.set(SESSION_COOKIE_NAME, token)
        assert old_client.get("/api/v1/auth/me").status_code == 401


def test_temporary_password_reset_rejects_protected_accounts_without_changes(
    admin_client, db_session
):
    client, admin = admin_client
    external = create_user(
        db_session,
        is_external_collaborator=False,
        username="reset.external",
        email="reset.external@example.test",
        name_zh="外部帳號",
        auth_source="external",
        external_source="ldap",
        external_id="reset-external",
    )
    db_session.commit()
    protected_ids = (admin.id, external.id)
    audit_count = db_session.scalar(select(func.count(AuditLog.id)))

    for user_id in protected_ids:
        response = client.post(
            f"/api/v1/users/{user_id}/temporary-password", json={}
        )
        assert response.status_code == 422

    db_session.expire_all()
    assert db_session.scalar(select(func.count(AuditLog.id))) == audit_count
    assert (
        db_session.scalar(
            select(func.count(UserPassword.id)).where(
                UserPassword.user_id.in_(protected_ids)
            )
        )
        == 0
    )


def test_batch_user_deactivation_is_atomic_and_revokes_all_sessions(
    admin_client, db_session
):
    client, _admin = admin_client
    users = []
    tokens: dict[UUID, list[str]] = {}
    for suffix in ("one", "two"):
        created = client.post(
            "/api/v1/users",
            json={
                "is_external_collaborator": False,
                "username": f"batch.{suffix}",
                "email": f"batch.{suffix}@example.test",
                "name_zh": f"批次{suffix}",
            },
        )
        assert created.status_code == 201
        user_id = UUID(created.json()["id"])
        user = db_session.get(User, user_id)
        assert user is not None
        users.append(user_id)
        tokens[user_id] = [create_session(db_session, user)[1]]
        db_session.commit()
    db_session.commit()
    unknown_id = UUID("00000000-0000-7000-8000-000000000001")

    rejected = client.post(
        "/api/v1/users:batch-active-status",
        json={
            "user_ids": [str(users[0]), str(unknown_id)],
            "is_active": False,
        },
    )
    assert rejected.status_code == 422
    db_session.expire_all()
    assert all(db_session.get(User, user_id).is_active for user_id in users)
    assert all(
        db_session.scalar(
            select(func.count(AuthSession.id)).where(
                AuthSession.user_id == user_id
            )
        )
        == 1
        for user_id in users
    )

    changed = client.post(
        "/api/v1/users:batch-active-status",
        json={
            "user_ids": [str(user_id) for user_id in users],
            "is_active": False,
        },
    )
    assert changed.status_code == 200, changed.text
    assert {item["id"] for item in changed.json()["items"]} == {
        str(user_id) for user_id in users
    }
    db_session.expire_all()
    assert all(
        not db_session.get(User, user_id).is_active for user_id in users
    )
    assert all(
        db_session.scalar(
            select(func.count(AuthSession.id)).where(
                AuthSession.user_id == user_id
            )
        )
        == 0
        for user_id in users
    )


def test_batch_reactivation_keeps_each_accounts_restore_choices_atomic(
    admin_client, db_session
):
    client, admin = admin_client
    user_ids = []
    task_ids = []
    permission_codes = ("project.use", "template.use")
    project = Project(
        project_code="BATCH-RESTORE",
        name="批次恢復專案",
        client_name="業主",
        site_location="工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(project)
    db_session.flush()
    plan = InspectionPlan(
        project_id=project.id,
        name="批次恢復計畫",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(plan)
    db_session.flush()
    db_session.commit()
    for suffix, permission_code in zip(
        ("one", "two"), permission_codes, strict=True
    ):
        created = client.post(
            "/api/v1/users",
            json={
                "is_external_collaborator": False,
                "username": f"restore.{suffix}",
                "email": f"restore.{suffix}@example.test",
                "name_zh": f"重新啟用{suffix}",
            },
        )
        assert created.status_code == 201
        user_id = UUID(created.json()["id"])
        user_ids.append(user_id)
        db_session.add_all(
            [
                UserModuleDelegation(user_id=user_id, module="template"),
                ProjectMember(
                    project_id=project.id,
                    user_id=user_id,
                    created_by=admin.id,
                    updated_by=admin.id,
                ),
            ]
        )
        task = InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            name=f"批次恢復任務{suffix}",
            status="PENDING",
            dispatched_at=datetime.now(UTC),
            assignee_id=user_id,
            created_by=admin.id,
            updated_by=admin.id,
        )
        db_session.add(task)
        db_session.flush()
        task_ids.append(task.id)
        db_session.commit()
        granted = client.put(
            f"/api/v1/users/{user_id}/module-permissions/{permission_code}"
        )
        assert granted.status_code == 204
        disabled = client.put(
            f"/api/v1/users/{user_id}/active",
            json={"is_active": False},
        )
        assert disabled.status_code == 200

    invalid_restore = client.post(
        "/api/v1/users:batch-active-status",
        json={
            "user_ids": [str(user_id) for user_id in user_ids],
            "is_active": True,
            "restore": [
                {
                    "user_id": str(user_ids[0]),
                    "restore": {
                        "permission_codes": ["project.use"],
                        "delegated_modules": ["template"],
                        "project_ids": [str(project.id)],
                        "task_ids": [str(task_ids[0])],
                    },
                },
                {
                    "user_id": str(user_ids[1]),
                    "restore": {
                        "permission_codes": ["project.manage"],
                        "delegated_modules": [],
                        "project_ids": [],
                        "task_ids": [],
                    },
                },
            ],
        },
    )
    assert invalid_restore.status_code == 422
    db_session.expire_all()
    assert all(
        not db_session.get(User, user_id).is_active for user_id in user_ids
    )
    assert {
        (row.user_id, row.permission_code)
        for row in db_session.scalars(select(UserModulePermission))
        if row.user_id in user_ids
    } == set(zip(user_ids, permission_codes, strict=True))
    assert {
        row.user_id
        for row in db_session.scalars(select(UserModuleDelegation))
        if row.user_id in user_ids
    } == set(user_ids)
    assert {
        row.user_id
        for row in db_session.scalars(select(ProjectMember))
        if row.project_id == project.id and row.user_id in user_ids
    } == set(user_ids)
    assert {
        row.id
        for row in db_session.scalars(select(InspectionTask))
        if row.id in task_ids and row.assignee_id in user_ids
    } == set(task_ids)

    restored = client.post(
        "/api/v1/users:batch-active-status",
        json={
            "user_ids": [str(user_id) for user_id in user_ids],
            "is_active": True,
            "restore": [
                {
                    "user_id": str(user_ids[0]),
                    "restore": {
                        "permission_codes": ["project.use"],
                        "delegated_modules": ["template"],
                        "project_ids": [str(project.id)],
                        "task_ids": [str(task_ids[0])],
                    },
                },
                {
                    "user_id": str(user_ids[1]),
                    "restore": {
                        "permission_codes": [],
                        "delegated_modules": [],
                        "project_ids": [],
                        "task_ids": [],
                    },
                },
            ],
        },
    )
    assert restored.status_code == 200, restored.text
    db_session.expire_all()
    assert all(db_session.get(User, user_id).is_active for user_id in user_ids)
    assert {
        (row.user_id, row.permission_code)
        for row in db_session.scalars(select(UserModulePermission))
        if row.user_id in user_ids
    } == {(user_ids[0], "project.use")}
    assert {
        row.user_id
        for row in db_session.scalars(select(UserModuleDelegation))
        if row.user_id in user_ids
    } == {user_ids[0]}
    assert {
        row.user_id
        for row in db_session.scalars(select(ProjectMember))
        if row.project_id == project.id and row.user_id in user_ids
    } == {user_ids[0]}
    assert {
        row.id
        for row in db_session.scalars(select(InspectionTask))
        if row.id in task_ids and row.assignee_id in user_ids
    } == {task_ids[0]}


def test_batch_company_status_is_atomic_across_companies(
    admin_client, db_session
):
    client, _admin = admin_client
    company_ids = []
    user_ids = []
    for suffix in ("one", "two"):
        company = client.post(
            "/api/v1/companies", json={"name": f"批次公司{suffix}"}
        )
        assert company.status_code == 201
        company_ids.append(UUID(company.json()["id"]))
        user = create_user(
            db_session,
            username=f"batch.company.{suffix}",
            email=f"batch.company.{suffix}@example.test",
            name_zh=f"公司帳號{suffix}",
            company_id=company_ids[-1],
            is_external_collaborator=False,
        )
        user_ids.append(user.id)
        db_session.commit()
    db_session.commit()

    rejected = client.post(
        "/api/v1/companies:batch-status",
        json={
            "items": [
                {
                    "company_id": str(company_ids[0]),
                    "is_active": False,
                    "disable_user_ids": [str(user_ids[0])],
                },
                {
                    "company_id": str(company_ids[1]),
                    "is_active": False,
                    "disable_user_ids": [
                        "00000000-0000-7000-8000-000000000002"
                    ],
                },
            ]
        },
    )
    assert rejected.status_code == 422
    db_session.expire_all()
    assert all(
        db_session.get(Company, company_id).is_active
        for company_id in company_ids
    )
    assert all(db_session.get(User, user_id).is_active for user_id in user_ids)

    changed = client.post(
        "/api/v1/companies:batch-status",
        json={
            "items": [
                {
                    "company_id": str(company_ids[0]),
                    "is_active": False,
                    "disable_user_ids": [str(user_ids[0])],
                },
                {
                    "company_id": str(company_ids[1]),
                    "is_active": False,
                    "disable_user_ids": [],
                },
            ]
        },
    )
    assert changed.status_code == 200, changed.text
    db_session.expire_all()
    assert all(
        not db_session.get(Company, company_id).is_active
        for company_id in company_ids
    )
    assert not db_session.get(User, user_ids[0]).is_active
    assert db_session.get(User, user_ids[1]).is_active


def test_reactivation_preview_and_choice_api(admin_client, db_session):
    client, _admin = admin_client
    user = create_root_user_with_company(db_session, "R578RESTORE")
    user.is_active = False
    db_session.commit()

    preview = client.get(f"/api/v1/users/{user.id}/reactivation-preview")
    assert preview.status_code == 200
    assert preview.json()["permission_codes"] == []
    assert preview.json()["project_memberships"] == []
    assert user.is_active is False

    direct_enable = client.put(
        f"/api/v1/users/{user.id}/active",
        json={"is_active": True},
    )
    assert direct_enable.status_code == 422
    assert (
        direct_enable.json()["error"]["code"] == "user.reactivation_required"
    )

    restored = client.post(
        f"/api/v1/users/{user.id}:reactivate",
        json={
            "restore": {
                "permission_codes": [],
                "delegated_modules": [],
                "project_ids": [],
                "task_ids": [],
            }
        },
    )
    assert restored.status_code == 200
    db_session.refresh(user)
    assert user.is_active is True


def test_external_and_unmanaged_admin_lists(admin_client):
    client, _admin = admin_client
    external = client.get("/api/v1/admin/users/external-without-project")
    unmanaged = client.get("/api/v1/admin/projects/unmanaged")
    assert external.status_code == 200
    assert external.json()["next_cursor"] is None
    assert unmanaged.status_code == 200
    assert unmanaged.json()["next_cursor"] is None


@pytest.mark.parametrize(
    ("active", "external", "expiry_days", "expected_count"),
    [
        (False, False, None, 0),
        (False, True, None, 0),
        (True, True, -1, 0),
        (True, True, 0, 1),
        (True, True, 1, 1),
        (True, True, None, 1),
        (True, False, None, 1),
    ],
)
def test_unmanaged_list_counts_only_effectively_active_members(
    admin_client,
    db_session,
    monkeypatch,
    active,
    external,
    expiry_days,
    expected_count,
):
    """ADM-R36、#286：啟用成員含無角色者，排除停用及到期外部帳號。"""
    now = clock.utc_now()
    monkeypatch.setattr(clock, "utc_now", lambda: now)
    client, admin = admin_client
    member = create_root_user_with_company(db_session, "COUNT286")
    member.is_active = active
    member.is_external_collaborator = external
    member.account_expires_on = (
        now.date() + timedelta(days=expiry_days)
        if expiry_days is not None
        else None
    )
    project = Project(
        project_code="COUNT286",
        name="啟用成員數測試",
        client_name="業主",
        site_location="工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(project)
    db_session.flush()
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=member.id,
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    db_session.commit()
    project_id = str(project.id)

    response = client.get("/api/v1/admin/projects/unmanaged")

    assert response.status_code == 200
    item = next(
        item for item in response.json()["items"] if item["id"] == project_id
    )
    assert item["member_count"] == expected_count
    db_session.refresh(member)
    assert member.is_active is active


def test_admin_status_commits_before_response_start(admin_client, db_session):
    """管理員身分變更須在 ASGI 開始回應前提交。"""
    original_client, _admin = admin_client
    token = original_client.cookies.get(SESSION_COOKIE_NAME)
    user = create_root_user_with_company(db_session, "R618ADMIN")
    db_session.commit()

    with observed_client(create_app()) as (client, events):
        client.cookies.set(SESSION_COOKIE_NAME, token)
        response = client.put(
            f"/api/v1/users/{user.id}/admin",
            json={"is_admin": True},
        )

    assert response.status_code == 200
    assert events.index("commit") < events.index("response_started")
    db_session.expire(user)
    assert user.is_admin is True


def test_template_manage_prevents_external_flag_change(
    admin_client, db_session
):
    """外部身分切換須拒絕不允許的範本管理權限。"""
    client, admin = admin_client
    target = create_root_user_with_company(db_session, "R618TPLFLAG")
    db_session.add(
        UserModulePermission(
            user_id=target.id,
            permission_code="template.manage",
            source="manual",
        )
    )
    db_session.commit()

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"is_external_collaborator": True},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "user.external_not_qualified"
    assert response.json()["error"]["details"] == [
        "module permission: template.manage"
    ]
    db_session.refresh(target)
    assert target.is_external_collaborator is False
    assert (
        db_session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == target.id,
                UserModulePermission.permission_code == "template.manage",
            )
        )
        is not None
    )


def test_eligible_external_flag_change_requires_confirmation(
    admin_client, db_session
):
    client, _admin = admin_client
    target = create_root_user_with_company(db_session, "R624FLAGCONF")
    db_session.commit()

    response = client.patch(
        f"/api/v1/users/{target.id}",
        json={"is_external_collaborator": True},
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "user.external_confirmation_required"
    assert error["details"]
    db_session.refresh(target)
    assert target.is_external_collaborator is False


def test_external_collaborator_cannot_be_created_as_admin(
    admin_client, db_session
):
    client, _admin = admin_client

    response = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": True,
            "username": "external.admin",
            "email": "external-admin@demo.example",
            "name_zh": "外部管理者",
            "is_admin": True,
        },
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "user.external_not_qualified"}
    }
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(User).where(User.username == "external.admin")
        )
        is None
    )


@pytest.mark.parametrize("is_external", [False, True])
def test_new_user_requires_explicit_external_flag_and_persists_value(
    admin_client, db_session, is_external
):
    client, _admin = admin_client
    payload = {
        "username": f"flag.{str(is_external).lower()}",
        "email": f"flag.{str(is_external).lower()}@demo.example",
        "name_zh": "標記測試人員",
        "is_external_collaborator": is_external,
    }

    response = client.post("/api/v1/users", json=payload)

    assert response.status_code == 201
    assert response.json()["is_external_collaborator"] is is_external
    stored = db_session.scalar(
        select(User).where(User.username == payload["username"])
    )
    assert stored is not None
    assert stored.is_external_collaborator is is_external


def test_new_user_without_external_flag_is_rejected_without_insert(
    admin_client, db_session
):
    client, _admin = admin_client
    payload = {
        "username": "flag.omitted",
        "email": "flag.omitted@demo.example",
        "name_zh": "缺少標記",
    }

    response = client.post("/api/v1/users", json=payload)

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == ErrorCode.REQUEST_VALIDATION_FAILED
    assert error["fields"] == [
        {
            "path": "/is_external_collaborator",
            "code": "field.required",
        }
    ]
    assert (
        db_session.scalar(
            select(User).where(User.username == payload["username"])
        )
        is None
    )


def test_local_external_collaborator_keeps_flag_when_company_changes(
    admin_client, db_session
):
    client, _admin = admin_client
    first_company = client.post(
        "/api/v1/companies", json={"name": "外部協作者原公司"}
    )
    next_company = client.post(
        "/api/v1/companies", json={"name": "外部協作者新公司"}
    )
    assert first_company.status_code == 201
    assert next_company.status_code == 201
    external = create_user(
        db_session,
        is_external_collaborator=True,
        username="local.external.company",
        email="local.external.company@demo.example",
        name_zh="本地外部協作者",
        company_id=UUID(first_company.json()["id"]),
    )
    db_session.commit()

    response = client.put(
        f"/api/v1/users/{external.id}/company",
        json={"company_id": next_company.json()["id"]},
    )

    assert response.status_code == 200, response.text
    db_session.expire_all()
    stored = db_session.get(User, external.id)
    assert stored is not None
    assert stored.company_id == UUID(next_company.json()["id"])
    assert stored.is_external_collaborator is True


def test_internal_user_expiry_constraint_returns_422(admin_client, db_session):
    client, _admin = admin_client
    user = create_root_user_with_company(db_session, "EXPIRY01")
    db_session.commit()

    response = client.patch(
        f"/api/v1/users/{user.id}",
        json={"account_expires_on": "2027-01-01"},
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "request.validation_failed"}}


def test_aut_ac61_default_user_password_and_change_gate(
    admin_client, db_session, make_client
):
    client, _admin = admin_client
    response = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "temporary.user",
            "email": "temporary@demo.example",
            "name_zh": "臨時密碼使用者",
        },
    )
    assert response.status_code == 201
    body = response.json()
    password = body.pop("temporary_password")
    assert len(password) == 20
    assert password.isascii() and password.isdecimal()
    assert MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH
    user_id = UUID(body["id"])
    assert body["is_admin"] is False
    assert MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH
    assert response.headers["cache-control"] == "no-store"
    assert password not in client.get("/api/v1/users").text
    assert password not in client.get(f"/api/v1/users/{user_id}").text

    stored = db_session.scalar(
        select(UserPassword).where(UserPassword.user_id == user_id)
    )
    assert stored is not None
    assert password != stored.password_hash
    assert verify_password(stored.password_hash, password)
    assert stored.must_change_password is True
    events = list(
        db_session.scalars(
            select(AuditLog).where(AuditLog.entity_id == user_id)
        )
    )
    assert {event.event_type for event in events} == {
        "user.created",
        "user.password_set",
    }

    temporary_client = make_client()
    login = temporary_client.post(
        "/api/v1/auth/login",
        json={"login": "temporary.user", "password": password},
    )
    assert login.status_code == 200
    assert (
        temporary_client.get("/api/v1/auth/me").json()["must_change_password"]
        is True
    )
    blocked = temporary_client.get("/api/v1/users")
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == ("auth.password_change_required")


def test_admin_access_and_company_lifecycle(admin_client, db_session):
    client, _admin = admin_client
    unauthenticated = TestClient(client.app, base_url="https://testserver")
    assert unauthenticated.get("/api/v1/users").status_code == 401
    assert unauthenticated.get("/api/v1/companies").status_code == 401

    company = client.post("/api/v1/companies", json={"name": " 示範公司 "})
    assert company.status_code == 201
    company_id = company.json()["id"]
    assert company.json()["name"] == "示範公司"
    assert company_id in {
        item["id"] for item in client.get("/api/v1/companies").json()["items"]
    }
    duplicate_company = client.post(
        "/api/v1/companies", json={"name": "示範公司"}
    )
    assert duplicate_company.status_code == 409
    assert duplicate_company.json()["error"]["code"] == (
        "company.name_conflict"
    )

    created = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "sample.user",
            "email": "sample@demo.example",
            "name_zh": "測試人員",
            "company_id": company_id,
            "department": "舊部門",
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]
    preview = client.get(f"/api/v1/companies/{company_id}/active-users")
    assert preview.json()["count"] == 1
    assert preview.json()["users"][0]["id"] == user_id

    disabled = client.put(
        f"/api/v1/companies/{company_id}/active",
        json={"is_active": False, "disable_user_ids": []},
    )
    assert disabled.status_code == 200
    db_session.expire_all()
    assert db_session.get(User, UUID(user_id)).is_active is True
    inactive_company = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "second.user",
            "email": "second@demo.example",
            "name_zh": "第二位",
            "company_id": company_id,
        },
    )
    assert inactive_company.status_code == 422
    assert inactive_company.json()["error"]["code"] == "company.inactive"
    assert (
        client.put(
            f"/api/v1/users/{user_id}/company",
            json={"company_id": None},
        ).status_code
        == 200
    )
    assert client.get(f"/api/v1/users/{user_id}").json()["department"] is None

    renamed = client.patch(
        f"/api/v1/companies/{company_id}",
        json={"name": "示範公司新名稱"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "示範公司新名稱"
    assert (
        client.put(
            f"/api/v1/companies/{company_id}/active",
            json={"is_active": True},
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/users/{user_id}/company",
            json={"company_id": company_id},
        ).status_code
        == 200
    )
    assert (
        client.put(
            f"/api/v1/companies/{company_id}/active",
            json={"is_active": False, "disable_user_ids": [user_id]},
        ).status_code
        == 200
    )
    db_session.expire_all()
    assert db_session.get(User, UUID(user_id)).is_active is False


def test_user_company_lists_search_cursor_and_validation(
    admin_client, db_session
):
    client, _admin = admin_client
    first_company = client.post(
        "/api/v1/companies", json={"name": "示範甲公司"}
    )
    assert first_company.status_code == 201
    for name in ("示範乙公司", "其他公司"):
        assert (
            client.post("/api/v1/companies", json={"name": name}).status_code
            == 201
        )
    for username, name, employee_no in (
        ("alpha.user", "阿爾法", "E-101"),
        ("bravo.user", "布拉沃", "E-202"),
        ("charlie.user", "查理", "E-303"),
    ):
        create_user(
            db_session,
            is_external_collaborator=False,
            username=username,
            email=f"{username}@demo.example",
            name_zh=name,
            employee_no=employee_no,
            company_id=UUID(first_company.json()["id"]),
        )
    create_user(
        db_session,
        is_external_collaborator=False,
        username="literal.query.person",
        email="literal%_\\query@example.test",
        name_zh="符號%_\\人員",
        employee_no="LITERAL",
        company_id=UUID(first_company.json()["id"]),
    )
    db_session.commit()

    first = client.get("/api/v1/users", params={"limit": 1, "q": "user"})
    assert first.status_code == 200
    first_body = first.json()
    assert [item["username"] for item in first_body["items"]] == ["alpha.user"]
    assert first_body["next_cursor"]
    second = client.get(
        "/api/v1/users",
        params={
            "limit": 1,
            "q": "user",
            "cursor": first_body["next_cursor"],
        },
    )
    assert [item["username"] for item in second.json()["items"]] == [
        "bravo.user"
    ]
    last = client.get(
        "/api/v1/users",
        params={
            "limit": 1,
            "q": "user",
            "cursor": second.json()["next_cursor"],
        },
    )
    assert [item["username"] for item in last.json()["items"]] == [
        "charlie.user"
    ]
    assert last.json()["next_cursor"] is None
    assert (
        client.get("/api/v1/users", params={"q": "E-303"}).json()["items"][0][
            "username"
        ]
        == "charlie.user"
    )
    assert (
        client.get("/api/v1/users", params={"q": "ALPHA"}).json()["items"][0][
            "username"
        ]
        == "alpha.user"
    )
    for literal in ("%", "_", "\\"):
        matches = client.get("/api/v1/users", params={"q": literal}).json()[
            "items"
        ]
        assert "literal.query.person" in {item["username"] for item in matches}

    companies = client.get("/api/v1/companies", params={"limit": 1})
    assert companies.status_code == 200
    assert companies.json()["next_cursor"]
    next_company = client.get(
        "/api/v1/companies",
        params={
            "limit": 1,
            "cursor": companies.json()["next_cursor"],
        },
    )
    assert len(next_company.json()["items"]) == 1
    assert next_company.json()["next_cursor"]
    assert (
        client.get("/api/v1/companies", params={"q": "乙公"}).json()["items"][
            0
        ]["name"]
        == "示範乙公司"
    )
    literal_company = client.post(
        "/api/v1/companies", json={"name": "字面%_\\公司"}
    )
    assert literal_company.status_code == 201
    for literal in ("%", "_", "\\"):
        matches = client.get(
            "/api/v1/companies", params={"q": literal}
        ).json()["items"]
        assert "字面%_\\公司" in {item["name"] for item in matches}

    for path in ("/api/v1/users", "/api/v1/companies"):
        assert client.get(path, params={"limit": 0}).status_code == 422
        assert client.get(path, params={"limit": 101}).status_code == 422
        assert client.get(path, params={"limit": 100}).status_code == 200
        invalid_cursor = client.get(path, params={"cursor": "invalid!"})
        assert invalid_cursor.status_code == 422
        assert client.get(path, params={"q": "x" * 257}).status_code == 422


def test_user_list_includes_company_name_without_query_growth(
    admin_client, db_session
):
    client, _admin = admin_client
    company = client.post("/api/v1/companies", json={"name": "公司名稱"})
    assert company.status_code == 201
    company_id = UUID(company.json()["id"])
    for index in range(6):
        create_user(
            db_session,
            username=f"company.name.{index}",
            email=f"company.name.{index}@example.test",
            name_zh=f"公司人員 {index}",
            company_id=company_id,
            is_external_collaborator=False,
        )
    create_user(
        db_session,
        username="without.company",
        email="without.company@example.test",
        name_zh="無公司人員",
        is_external_collaborator=False,
    )
    db_session.commit()

    one_count, one_items = select_count(
        client, "/api/v1/users", q="company.name", limit=1
    )
    many_count, many_items = select_count(
        client, "/api/v1/users", q="company.name", limit=6
    )
    response = client.get(
        "/api/v1/users", params={"q": "company.name", "limit": 6}
    )
    assert response.status_code == 200
    assert one_items == 1
    assert many_items == 6
    assert many_count == one_count
    assert {item["company_name"] for item in response.json()["items"]} == {
        "公司名稱"
    }

    without_company = client.get(
        "/api/v1/users", params={"q": "without.company"}
    )
    assert without_company.status_code == 200
    assert without_company.json()["items"][0]["company_name"] is None


def test_non_admin_cannot_manage(admin_client, db_session, make_client):
    client, _admin = admin_client
    response = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "normal.user",
            "email": "normal@demo.example",
            "name_zh": "一般人員",
        },
    )
    assert response.status_code == 201
    user_id = response.json()["id"]
    user = db_session.get(User, UUID(user_id))
    stored = db_session.scalar(
        select(UserPassword).where(UserPassword.user_id == user.id)
    )
    stored.must_change_password = False
    _, token = create_session(db_session, user)
    db_session.commit()
    other_client = make_client()
    other_client.cookies.set(SESSION_COOKIE_NAME, token)
    for path in ("/api/v1/users", "/api/v1/companies"):
        denied = other_client.get(path)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "permission.denied"

    company = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    company_id = company.json()["id"]
    before = (
        db_session.scalar(select(func.count()).select_from(User)),
        db_session.scalar(select(func.count()).select_from(AuditLog)),
    )
    writes = (
        (
            "post",
            "/api/v1/users",
            {
                "username": "denied.user",
                "email": "denied@demo.example",
                "name_zh": "不得新增",
            },
        ),
        ("patch", f"/api/v1/users/{user_id}", {"name_zh": "不得修改"}),
        ("put", f"/api/v1/users/{user_id}/admin", {"is_admin": True}),
        ("put", f"/api/v1/users/{user_id}/active", {"is_active": False}),
        (
            "put",
            f"/api/v1/users/{user_id}/company",
            {
                "company_id": company_id,
            },
        ),
        ("post", "/api/v1/companies", {"name": "不得新增公司"}),
        (
            "patch",
            f"/api/v1/companies/{company_id}",
            {
                "name": "不得改名",
            },
        ),
        (
            "put",
            f"/api/v1/companies/{company_id}/active",
            {
                "is_active": False,
            },
        ),
    )
    for method, path, body in writes:
        denied = getattr(other_client, method)(path, json=body)
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "permission.denied"
    db_session.expire_all()
    after = (
        db_session.scalar(select(func.count()).select_from(User)),
        db_session.scalar(select(func.count()).select_from(AuditLog)),
    )
    assert after == before
    assert db_session.get(User, UUID(user_id)).name_zh == "一般人員"


def test_http_builtin_external_and_username_rules(admin_client, db_session):
    client, admin = admin_client
    company = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    company_id = company.json()["id"]
    external = create_user(
        db_session,
        is_external_collaborator=False,
        username="external.user",
        email="external@demo.example",
        name_zh="外部人員",
        company_id=UUID(company_id),
        auth_source="external",
        external_source="ldap",
        external_id="external-263",
    )
    db_session.commit()

    for method, path, body in (
        (
            "put",
            f"/api/v1/users/{admin.id}/active",
            {
                "is_active": False,
            },
        ),
        (
            "put",
            f"/api/v1/users/{admin.id}/admin",
            {
                "is_admin": False,
            },
        ),
        (
            "patch",
            f"/api/v1/users/{admin.id}",
            {
                "username": "other.admin",
            },
        ),
    ):
        denied = getattr(client, method)(path, json=body)
        assert denied.status_code == 422
        assert denied.json()["error"]["code"] == ("user.builtin_protected")
    for method, path, body in (
        (
            "patch",
            f"/api/v1/users/{external.id}",
            {
                "email": "changed@demo.example",
            },
        ),
        (
            "put",
            f"/api/v1/users/{external.id}/company",
            {
                "company_id": None,
            },
        ),
    ):
        denied = getattr(client, method)(path, json=body)
        assert denied.status_code == 422
        assert denied.json()["error"]["code"] == "user.external_managed"
    db_session.expire_all()
    assert db_session.get(User, admin.id).is_active is True
    assert db_session.get(User, admin.id).is_admin is True
    assert db_session.get(User, admin.id).username == "admin"
    assert db_session.get(User, external.id).email == "external@demo.example"
    assert db_session.get(User, external.id).company_id == UUID(company_id)

    created = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "old.name",
            "email": "old@demo.example",
            "name_zh": "本地人員",
        },
    )
    user_id = created.json()["id"]
    duplicate = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "taken.name",
            "email": "taken@demo.example",
            "name_zh": "已存在",
        },
    )
    assert duplicate.status_code == 201
    rejected = client.patch(
        f"/api/v1/users/{user_id}", json={"username": "TAKEN.NAME"}
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "user.username_conflict"
    assert (
        db_session.scalar(
            select(func.count()).where(
                AuditLog.entity_id == UUID(user_id),
                AuditLog.event_type == "user.username_changed",
            )
        )
        == 0
    )
    changed = client.patch(
        f"/api/v1/users/{user_id}", json={"username": "New.Name"}
    )
    assert changed.status_code == 200
    assert changed.json()["username"] == "new.name"
    events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == UUID(user_id),
                AuditLog.event_type == "user.username_changed",
            )
        )
    )
    assert len(events) == 1
    assert events[0].before == {"username": "old.name"}
    assert events[0].after == {"username": "new.name"}


def test_conflict_codes_and_idempotent_admin_put(admin_client, db_session):
    client, admin = admin_client
    no_op = client.put(
        f"/api/v1/users/{admin.id}/admin", json={"is_admin": True}
    )
    assert no_op.status_code == 200
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == 0
    first = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "conflict.one",
            "email": "one@demo.example",
            "name_zh": "第一位",
        },
    )
    assert first.status_code == 201
    for username, email, expected in (
        ("CONFLICT.ONE", "other@demo.example", "user.username_conflict"),
        ("conflict.two", "ONE@demo.example", "user.email_conflict"),
    ):
        response = client.post(
            "/api/v1/users",
            json={
                "username": username,
                "email": email,
                "name_zh": "第二位",
                "is_external_collaborator": False,
            },
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == expected
    company = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    assert company.status_code == 201
    duplicate = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == ("company.name_conflict")
    company_id = company.json()["id"]
    first_link = client.put(
        f"/api/v1/users/{first.json()['id']}/company",
        json={"company_id": company_id, "employee_no": "A001"},
    )
    assert first_link.status_code == 200
    second = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "conflict.three",
            "email": "three@demo.example",
            "name_zh": "第三位",
        },
    )
    assert second.status_code == 201
    employee_conflict = client.put(
        f"/api/v1/users/{second.json()['id']}/company",
        json={"company_id": company_id, "employee_no": "A001"},
    )
    assert employee_conflict.status_code == 409
    assert employee_conflict.json()["error"]["code"] == (
        "user.employee_no_conflict"
    )


def test_program_errors_remain_server_errors(
    admin_client, db_session, monkeypatch
):
    client, _admin = admin_client
    created = client.post(
        "/api/v1/users",
        json={
            "is_external_collaborator": False,
            "username": "audit.test",
            "email": "audit@demo.example",
            "name_zh": "稽核測試",
        },
    )
    user_id = created.json()["id"]

    def broken_audit(*args, **kwargs):
        raise InvalidAuditEventShapeError("program error")

    monkeypatch.setattr("app.services.users.record_audit_event", broken_audit)
    error_client = TestClient(
        client.app,
        base_url="https://testserver",
        raise_server_exceptions=False,
    )
    error_client.cookies.set(
        SESSION_COOKIE_NAME, client.cookies[SESSION_COOKIE_NAME]
    )
    failed = error_client.patch(
        f"/api/v1/users/{user_id}", json={"username": "audit.new"}
    )
    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "server.internal_error"
    db_session.expire_all()
    assert db_session.get(User, UUID(user_id)).username == "audit.test"

    def broken_company(*args, **kwargs):
        raise IntegrityError("INSERT", {}, Exception("unexpected index"))

    monkeypatch.setattr("app.api.v1.companies.create_company", broken_company)
    failed = error_client.post("/api/v1/companies", json={"name": "示範公司"})
    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "server.internal_error"


@pytest.mark.parametrize("operation", ["deactivate", "reset", "company"])
def test_batch_and_password_reset_reject_self_without_changes(
    admin_client, db_session, operation
):
    """ADM-R13、#414：一般管理者也不能藉批次停用或重設自己的密碼。"""
    client, _ = admin_client
    actor = create_root_user_with_company(db_session, "SELF414")
    actor.is_admin = True
    other = create_root_user_with_company(db_session, "OTHER414")
    _, token = create_session(db_session, actor)
    db_session.commit()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    before = db_session.scalar(select(func.count()).select_from(AuditLog))
    if operation == "deactivate":
        response = client.post(
            "/api/v1/users:batch-active-status",
            json={
                "user_ids": [str(other.id), str(actor.id)],
                "is_active": False,
            },
        )
    elif operation == "company":
        response = client.post(
            "/api/v1/companies:batch-status",
            json={
                "items": [
                    {
                        "company_id": str(actor.company_id),
                        "is_active": False,
                        "disable_user_ids": [str(actor.id)],
                    }
                ]
            },
        )
    else:
        response = client.post(
            f"/api/v1/users/{actor.id}/temporary-password", json={}
        )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "request.validation_failed"
    db_session.expire_all()
    assert actor.is_active and other.is_active
    assert db_session.scalar(select(func.count()).select_from(AuditLog)) == (
        before
    )
    assert client.get("/api/v1/users").status_code == 200


@pytest.mark.parametrize("resource", ["users", "companies"])
def test_batch_status_rejects_more_than_200_items(admin_client, resource):
    """ADM-R13、#414：批次數量超限須在查資料前回白話錯誤。"""
    client, _ = admin_client
    ids = [str(uuid4()) for _ in range(201)]
    body = (
        {"user_ids": ids, "is_active": False}
        if resource == "users"
        else {
            "items": [{"company_id": id_, "is_active": False} for id_ in ids]
        }
    )
    suffix = "batch-active-status" if resource == "users" else "batch-status"
    response = client.post(f"/api/v1/{resource}:{suffix}", json=body)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["fields"] == [
        {
            "path": "/user_ids" if resource == "users" else "/items",
            "code": "field.too_long",
        }
    ]
    assert error["details"] == ["一次最多選取 200 筆，請減少數量後再試。"]


@pytest.mark.parametrize("linked", [True, False])
def test_user_detail_includes_company_name_without_loading_the_list(
    admin_client, db_session, linked
):
    """ADM-R47、#414：直接開啟非首頁帳號也取得公司名稱，無公司回 null。"""
    client, _ = admin_client
    user = create_root_user_with_company(db_session, "DETAIL414")
    company = db_session.get(Company, user.company_id)
    assert company is not None
    company.name = "詳情的公司"
    if not linked:
        user.company_id = None
        user.employee_no = None
        user.department = None
        user.location = None
    db_session.commit()
    first = client.get("/api/v1/users", params={"limit": 1})
    assert first.status_code == 200
    assert str(user.id) not in {item["id"] for item in first.json()["items"]}

    response = client.get(f"/api/v1/users/{user.id}")

    assert response.status_code == 200
    assert response.json()["company_name"] == (
        "詳情的公司" if linked else None
    )


def test_company_link_write_returns_the_new_company_name(
    admin_client, db_session
):
    """#414：修改公司後直接採用寫入回應也能顯示新公司名稱。"""
    client, _ = admin_client
    user = create_root_user_with_company(db_session, "WRITE414")
    db_session.commit()
    company = client.post("/api/v1/companies", json={"name": "新連結公司"})
    assert company.status_code == 201

    response = client.put(
        f"/api/v1/users/{user.id}/company",
        json={"company_id": company.json()["id"]},
    )

    assert response.status_code == 200
    assert response.json()["company_name"] == "新連結公司"
    assert response.json()["company_id"] == company.json()["id"]


@pytest.mark.parametrize(
    "field",
    [
        "disable_user_ids",
        "restore",
        "permission_codes",
        "delegated_modules",
        "project_ids",
        "task_ids",
    ],
)
def test_batch_nested_lists_validate_before_database_access(
    admin_client, field
):
    """#731：子清單也先驗長度，避免大量 IN 查詢變成 500。"""
    from app.api.v1.companies import BatchCompanyStatusRequest
    from app.api.v1.users import BatchActiveStatusRequest

    client, _ = admin_client
    user_id = str(uuid4())
    ids = [str(uuid4()) for _ in range(200)]
    if field == "disable_user_ids":
        model = BatchCompanyStatusRequest
        path = "/api/v1/companies:batch-status"
        body = {
            "items": [
                {
                    "company_id": str(uuid4()),
                    "is_active": False,
                    field: ids,
                }
            ]
        }
        values = body["items"][0][field]
        pointer = "/items/0/disable_user_ids"
    else:
        model = BatchActiveStatusRequest
        path = "/api/v1/users:batch-active-status"
        selection = {} if field == "restore" else {field: ids}
        item = {"user_id": user_id, "restore": selection}
        body = {
            "user_ids": [user_id],
            "is_active": True,
            "restore": [item] * 200 if field == "restore" else [item],
        }
        values = body["restore"] if field == "restore" else selection[field]
        pointer = (
            "/restore" if field == "restore" else f"/restore/0/restore/{field}"
        )
    model.model_validate(body)
    values.append(values[0])
    response = client.post(path, json=body)
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "request.validation_failed"
    assert error["fields"] == [{"path": pointer, "code": "field.too_long"}]
    assert error["details"] == ["一次最多選取 200 筆，請減少數量後再試。"]


@pytest.mark.parametrize("resource", ["users", "companies"])
def test_batch_status_accepts_exactly_200_items(
    admin_client, db_session, resource
):
    """#731：上限仍能實際成功，不因提早驗證少接受一筆。"""
    client, admin = admin_client
    if resource == "companies":
        companies = [
            Company(
                name=f"邊界公司{index}",
                created_by=admin.id,
                updated_by=admin.id,
            )
            for index in range(200)
        ]
        db_session.add_all(companies)
        db_session.commit()
        body = {
            "items": [
                {"company_id": str(company.id), "is_active": False}
                for company in companies
            ]
        }
        path = "/api/v1/companies:batch-status"
    else:
        users = [
            create_user(
                db_session,
                username=f"limit.{index}",
                email=f"limit.{index}@example.test",
                name_zh=f"邊界{index}",
                is_external_collaborator=False,
            )
            for index in range(200)
        ]
        db_session.commit()
        ids = [str(user.id) for user in users]
        body = {"user_ids": ids, "is_active": False}
        path = "/api/v1/users:batch-active-status"
    response = client.post(path, json=body)
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 200
    if resource == "users":
        response = client.post(
            path,
            json={
                "user_ids": ids,
                "is_active": True,
                "restore": [{"user_id": id_, "restore": {}} for id_ in ids],
            },
        )
        assert response.status_code == 200, response.text
        assert len(response.json()["items"]) == 200


def test_batch_company_accepts_200_selected_users(admin_client, db_session):
    """#731：原先會產生巨大 IN 的欄位在邊界可完成停用。"""
    client, admin = admin_client
    company = Company(
        name="子清單邊界", created_by=admin.id, updated_by=admin.id
    )
    db_session.add(company)
    db_session.flush()
    users = [
        create_user(
            db_session,
            username=f"company.limit.{index}",
            email=f"company.limit.{index}@example.test",
            name_zh=f"成員{index}",
            is_external_collaborator=False,
            company_id=company.id,
        )
        for index in range(200)
    ]
    db_session.commit()
    response = client.post(
        "/api/v1/companies:batch-status",
        json={
            "items": [
                {
                    "company_id": str(company.id),
                    "is_active": False,
                    "disable_user_ids": [str(user.id) for user in users],
                }
            ],
        },
    )
    assert response.status_code == 200, response.text
    db_session.expire_all()
    assert all(not user.is_active for user in users)


@pytest.mark.parametrize("resource", ["companies", "users"])
def test_single_status_entry_rejects_201_selected_ids(
    admin_client, db_session, resource
):
    """#731：單筆入口沿用子清單上限，不能繞過批次保護。"""
    client, _ = admin_client
    user = create_root_user_with_company(db_session, "SINGLE731")
    user.is_active = False
    db_session.commit()
    ids = [str(uuid4()) for _ in range(201)]
    if resource == "companies":
        response = client.put(
            f"/api/v1/companies/{user.company_id}/active",
            json={"is_active": False, "disable_user_ids": ids},
        )
        pointer = "/disable_user_ids"
    else:
        response = client.post(
            f"/api/v1/users/{user.id}:reactivate",
            json={"restore": {"project_ids": ids}},
        )
        pointer = "/restore/project_ids"
    assert response.status_code == 422, response.text
    error = response.json()["error"]
    assert error["code"] == "request.validation_failed"
    assert error["fields"] == [
        {
            "path": pointer,
            "code": "field.too_long",
        }
    ]
    assert error["details"] == ["一次最多選取 200 筆，請減少數量後再試。"]


@pytest.mark.parametrize("total", [200, 201])
def test_batch_company_selected_user_total_limit(
    admin_client, db_session, total
):
    """ADM-R13、#731：跨公司加總仍受限，超限不留下部分停用。"""
    client, admin = admin_client
    items = []
    companies = []
    users = []
    for index, count in enumerate((100, total - 100)):
        company = Company(
            name=f"合計邊界公司{index}",
            created_by=admin.id,
            updated_by=admin.id,
        )
        db_session.add(company)
        db_session.flush()
        selected = [
            create_user(
                db_session,
                username=f"total.{index}.{number}",
                email=f"total.{index}.{number}@example.test",
                name_zh=f"成員{number}",
                is_external_collaborator=False,
                company_id=company.id,
            )
            for number in range(count)
        ]
        companies.append(company)
        users.extend(selected)
        items.append(
            {
                "company_id": str(company.id),
                "is_active": False,
                "disable_user_ids": [str(user.id) for user in selected],
            }
        )
    db_session.commit()
    before = db_session.scalar(select(func.count()).select_from(AuditLog))
    response = client.post(
        "/api/v1/companies:batch-status",
        json={"items": items},
    )
    assert response.status_code == (200 if total == 200 else 422), (
        response.text
    )
    db_session.expire_all()
    if total == 200:
        assert len(response.json()["items"]) == 2
        assert all(not company.is_active for company in companies)
        assert all(not user.is_active for user in users)
    else:
        error = response.json()["error"]
        assert error["code"] == "request.validation_failed"
        assert error["fields"] == [
            {
                "path": "/items",
                "code": "field.too_long",
            }
        ]
        assert error["details"] == [
            "每批最多選取 200 位停用人員，請減少數量後再試。"
        ]
        assert all(company.is_active for company in companies)
        assert all(user.is_active for user in users)
        assert db_session.scalar(
            select(func.count()).select_from(AuditLog)
        ) == (before)


def test_temporary_password_keeps_leading_zeroes(monkeypatch):
    """B2：數字密碼仍是字串；開頭的零不能被數值轉換吃掉。"""
    from app.api.v1 import users
    from app.auth.passwords import check_password_length

    monkeypatch.setattr(users.secrets, "randbelow", lambda _bound: 0)
    password = users._temporary_password()
    assert password == "0" * 20
    assert check_password_length(password)
