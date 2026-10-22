"""Project and ProjectMember management API checks."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path
from typing import TypedDict
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session

from app.api.errors import ErrorCode
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db import clock
from app.db.engine import get_engine
from app.models import (
    AuditLog,
    Company,
    CreatorRoleSetting,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    User,
    UserModulePermission,
)
from app.services import projects as project_service
from app.services.companies import create_company
from app.services.module_permissions import InvalidCreatorRoleUserError
from app.services.project_members import add_project_member
from app.services.projects import create_project
from app.services.roles import create_role
from app.services.users import create_user
from tests.db.conftest import create_root_user_with_company


class ProjectApiContext(TypedDict):
    admin: User
    actor: User
    target: User
    project: Project
    other_project: Project
    role: Role
    plain_client: TestClient
    admin_client: TestClient
    actor_client: TestClient
    anonymous_client: TestClient


@contextmanager
def _select_statements(engine: Engine) -> Iterator[list[str]]:
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def _make_user_client(
    db_session: Session,
    make_client,
    user: User,
) -> TestClient:
    _session, token = create_session(db_session, user)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


def _audit_field(payload: object, key: str) -> object:
    assert isinstance(payload, dict)
    return payload[key]


@pytest.fixture
def project_api(
    db_session: Session,
    make_client,
) -> ProjectApiContext:
    admin = create_root_user_with_company(db_session, "ADM275")
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

    actor = create_user(
        db_session,
        is_external_collaborator=False,
        username="project.manager",
        email="manager@demo.example",
        name_zh="專案管理者",
    )
    target = create_user(
        db_session,
        is_external_collaborator=False,
        username="project.member",
        email="member@demo.example",
        name_zh="專案成員",
    )
    plain = create_user(
        db_session,
        is_external_collaborator=False,
        username="project.viewer",
        email="viewer@demo.example",
        name_zh="一般檢視者",
    )
    project = create_project(
        db_session,
        project_code="DEMO-275",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
    )
    other_project = create_project(
        db_session,
        project_code="DEMO-OTHER-275",
        name="另一示範工程",
        client_name="示範業主",
        site_location="另一示範工地",
    )
    manage_role = create_role(
        db_session,
        name="專案成員管理",
        permission_codes=["project_member.manage"],
    )
    manage_role.is_assignable = True
    db_session.add(
        UserModulePermission(
            user_id=actor.id,
            permission_code="project.use",
            source="manual",
        )
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=actor.id,
        role_ids=[manage_role.id],
    )
    db_session.commit()

    return {
        "admin": admin,
        "actor": actor,
        "target": target,
        "project": project,
        "other_project": other_project,
        "role": manage_role,
        "plain_client": _make_user_client(db_session, make_client, plain),
        "admin_client": _make_user_client(db_session, make_client, admin),
        "actor_client": _make_user_client(db_session, make_client, actor),
        "anonymous_client": make_client(),
    }


def _same_company(db_session: Session, project_api: ProjectApiContext):
    """Give the manager and add-target company data for related assertions."""
    company = create_company(db_session, name="示範同公司")
    for key in ("actor", "target"):
        user = project_api[key]
        assert isinstance(user, User)
        user.company_id = company.id
    db_session.commit()
    return company


def test_non_admin_cannot_assign_role_outside_approved_list(
    project_api, db_session
):
    target = project_api["target"]
    project = project_api["project"]
    _same_company(db_session, project_api)
    restricted_role = create_role(
        db_session,
        name="不可指派角色",
        permission_codes=["project.read"],
    )
    db_session.commit()

    response = project_api["actor_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(target.id),
            "role_ids": [str(restricted_role.id)],
        },
    )

    assert response.status_code == 422, response.text
    assert (
        response.json()["error"]["code"]
        == ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE.value
    )
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(ProjectMember).where(
                ProjectMember.project_id == project.id,
                ProjectMember.user_id == target.id,
            )
        )
        is None
    )
    denied = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "project_member.assignment_denied",
            AuditLog.project_id == project.id,
        )
    )
    assert denied is not None
    assert (
        denied.after["reason"] == ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE.value
    )


@pytest.mark.parametrize(
    "action", ["replace", "remove_roles", "remove_member"]
)
def test_non_admin_cannot_remove_existing_unapproved_role(
    project_api, db_session: Session, action: str
):
    project = project_api["project"]
    target = project_api["target"]
    restricted_role = create_role(
        db_session,
        name=f"既有不可指派角色-{action}",
        permission_codes=["project.read"],
    )
    db_session.commit()
    seeded = project_api["admin_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(target.id),
            "role_ids": [str(restricted_role.id)],
        },
    )
    assert seeded.status_code == 201, seeded.text

    member_url = f"/api/v1/projects/{project.id}/members/{target.id}"
    if action == "replace":
        response = project_api["actor_client"].put(
            f"{member_url}/roles",
            json={"role_ids": [str(project_api["role"].id)]},
        )
    elif action == "remove_roles":
        response = project_api["actor_client"].put(
            f"{member_url}/roles", json={"role_ids": []}
        )
    else:
        response = project_api["actor_client"].delete(member_url)

    assert response.status_code == 422, response.text
    assert (
        response.json()["error"]["code"]
        == ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE.value
    )
    db_session.expire_all()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == target.id,
        )
    )
    assert member is not None
    assert {assignment.role_id for assignment in member.role_assignments} == {
        restricted_role.id
    }
    denied = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "project_member.assignment_denied",
            AuditLog.project_id == project.id,
            AuditLog.after["reason"].as_string()
            == ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE.value,
        )
    )
    assert denied is not None


def test_admin_can_assign_unapproved_project_role(project_api, db_session):
    project = project_api["project"]
    target = project_api["target"]
    restricted_role = create_role(
        db_session,
        name="Admin 可指派的角色",
        permission_codes=["project.read"],
    )
    db_session.commit()

    response = project_api["admin_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(target.id),
            "role_ids": [str(restricted_role.id)],
        },
    )

    assert response.status_code == 201, response.text


def test_project_crud_duplicate_code_warning_and_dates(project_api):
    client = project_api["admin_client"]
    first = client.post(
        "/api/v1/projects",
        json={
            "project_code": "DEMO-DUP",
            "name": "示範工程甲",
            "client_name": "示範業主",
            "site_location": "示範工地",
            "planned_start_date": "2026-10-01",
            "planned_completion_date": "2027-04-01",
        },
    )
    assert first.status_code == 201
    first_body = first.json()
    assert first_body["warnings"] == []
    assert first_body["planned_start_date"] == "2026-10-01"
    assert first_body["planned_completion_date"] == "2027-04-01"

    second = client.post(
        "/api/v1/projects",
        json={
            "project_code": "DEMO-DUP",
            "name": "示範工程乙",
            "client_name": "示範業主",
            "site_location": "另一示範工地",
        },
    )
    assert second.status_code == 201
    assert second.json()["warnings"] == [{"code": "project_code.duplicate"}]

    edited = client.patch(
        f"/api/v1/projects/{first_body['id']}",
        json={"name": "修改後工程"},
    )
    assert edited.status_code == 200
    assert edited.json()["name"] == "修改後工程"
    assert edited.json()["warnings"] == [{"code": "project_code.duplicate"}]
    listed = client.get("/api/v1/projects")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 4
    fetched = client.get(f"/api/v1/projects/{first_body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["warnings"] == [{"code": "project_code.duplicate"}]


def test_project_creator_membership_and_admin_handoff(
    project_api, db_session: Session
):
    actor = project_api["actor"]
    db_session.add(
        UserModulePermission(
            user_id=actor.id,
            permission_code="project.create",
            source="manual",
        )
    )
    creator_role = create_role(
        db_session,
        name="建立者角色",
        permission_codes=[
            "project.update",
            "project_member.manage",
            "project.read",
        ],
    )
    db_session.add(CreatorRoleSetting(role_id=creator_role.id))
    db_session.commit()
    body = {
        "project_code": "CREATOR-AUTO",
        "name": "建立者自動加入",
        "client_name": "示範業主",
        "site_location": "示範工地",
    }
    created = project_api["actor_client"].post("/api/v1/projects", json=body)
    assert created.status_code == 201, created.text
    project_id = UUID(created.json()["id"])
    creator_role_id = db_session.scalar(
        select(CreatorRoleSetting.role_id).where(
            CreatorRoleSetting.setting_key == "creator_role"
        )
    )
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == actor.id,
        )
    )
    assert member is not None
    assert [item.role_id for item in member.role_assignments] == [
        creator_role_id
    ]
    event_types = set(
        db_session.scalars(
            select(AuditLog.event_type).where(
                AuditLog.project_id == project_id
            )
        )
    )
    assert event_types == {"project.created", "project_member.roles_changed"}

    rejected_override = project_api["actor_client"].post(
        "/api/v1/projects",
        json={
            **body,
            "project_code": "CREATOR-OVERRIDE",
            "creator_role_user_id": None,
        },
    )
    assert rejected_override.status_code == 422

    admin_created = project_api["admin_client"].post(
        "/api/v1/projects",
        json={**body, "project_code": "CREATOR-ADMIN"},
    )
    assert admin_created.status_code == 201
    admin_project_id = UUID(admin_created.json()["id"])
    assert (
        db_session.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == admin_project_id,
                ProjectMember.user_id == project_api["admin"].id,
            )
        )
        is None
    )

    handoff = project_api["admin_client"].post(
        "/api/v1/projects",
        json={
            **body,
            "project_code": "CREATOR-HANDOFF",
            "creator_role_user_id": str(project_api["target"].id),
        },
    )
    assert handoff.status_code == 201
    handoff_project_id = UUID(handoff.json()["id"])
    assert (
        db_session.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == handoff_project_id,
                ProjectMember.user_id == project_api["target"].id,
            )
        )
        is not None
    )


def test_project_creator_membership_failure_rolls_back_all_writes(
    project_api, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    actor = project_api["actor"]
    db_session.add(
        UserModulePermission(
            user_id=actor.id,
            permission_code="project.create",
            source="manual",
        )
    )
    creator_role = create_role(
        db_session,
        name="回滾測試建立者角色",
        permission_codes=[
            "project.update",
            "project_member.manage",
            "project.read",
        ],
    )
    db_session.add(CreatorRoleSetting(role_id=creator_role.id))
    db_session.commit()
    before_events = db_session.scalar(
        select(func.count(AuditLog.id)).where(
            AuditLog.event_type == "project.created"
        )
    )

    def fail_membership(*args, **kwargs):
        raise InvalidCreatorRoleUserError("injected membership failure")

    monkeypatch.setattr(project_service, "add_project_member", fail_membership)
    response = project_api["actor_client"].post(
        "/api/v1/projects",
        json={
            "project_code": "CREATOR-ROLLBACK",
            "name": "回滾專案",
            "client_name": "示範業主",
            "site_location": "示範工地",
        },
    )
    assert response.status_code == 422
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(Project.id).where(
                Project.project_code == "CREATOR-ROLLBACK"
            )
        )
        is None
    )
    assert (
        db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.event_type == "project.created"
            )
        )
        == before_events
    )


def test_project_list_query_count_does_not_grow(
    project_api, db_session: Session
):
    client = project_api["admin_client"]
    with _select_statements(get_engine()) as baseline:
        first = client.get("/api/v1/projects")
    assert first.status_code == 200
    assert len(first.json()["items"]) == 2

    for index in range(8):
        create_project(
            db_session,
            project_code="DEMO-DUP" if index < 2 else f"DEMO-{index}",
            name=f"示範工程 {index}",
            client_name="示範業主",
            site_location="示範工地",
        )
    db_session.commit()

    with _select_statements(get_engine()) as expanded:
        listed = client.get("/api/v1/projects")
    assert listed.status_code == 200
    rows = listed.json()
    assert len(rows["items"]) == 10
    assert sum(bool(row["warnings"]) for row in rows["items"]) == 2
    assert baseline
    assert len(expanded) == len(baseline)
    assert all("member_count" in row for row in rows["items"])


def test_project_list_counts_only_active_members(project_api, db_session):
    project = project_api["project"]
    other_project = project_api["other_project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(target, User)
    assert isinstance(role, Role)

    inactive = create_user(
        db_session,
        is_external_collaborator=True,
        account_expires_on=date(2099, 12, 31),
        username="inactive.project.member",
        email="inactive.project.member@demo.example",
        name_zh="停用專案成員",
    )
    external = create_user(
        db_session,
        is_external_collaborator=True,
        username="active.external.member",
        email="active.external.member@demo.example",
        name_zh="啟用外部成員",
    )
    expires_today = create_user(
        db_session,
        is_external_collaborator=True,
        account_expires_on=clock.utc_now().date(),
        username="today.external.member",
        email="today.external.member@demo.example",
        name_zh="到期日外部成員",
    )
    expired_external = create_user(
        db_session,
        is_external_collaborator=True,
        account_expires_on=date(2000, 1, 1),
        username="expired.external.member",
        email="expired.external.member@demo.example",
        name_zh="到期外部成員",
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=target.id,
        role_ids=[role.id],
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=inactive.id,
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=external.id,
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=expires_today.id,
    )
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=expired_external.id,
    )
    inactive.is_active = False
    db_session.commit()

    response = project_api["admin_client"].get("/api/v1/projects")
    assert response.status_code == 200
    counts = {
        row["id"]: row["member_count"] for row in response.json()["items"]
    }
    assert counts[str(project.id)] == 4
    assert counts[str(other_project.id)] == 0


def test_project_list_search_cursor_and_validation(project_api):
    client = project_api["admin_client"]
    first = client.get("/api/v1/projects", params={"limit": 1})
    assert first.status_code == 200
    assert first.json()["next_cursor"]
    last = client.get(
        "/api/v1/projects",
        params={"limit": 1, "cursor": first.json()["next_cursor"]},
    )
    assert last.status_code == 200
    assert last.json()["items"][0]["id"] != first.json()["items"][0]["id"]
    assert last.json()["next_cursor"] is None
    assert (
        client.get("/api/v1/projects", params={"q": "demo-other"}).json()[
            "items"
        ][0]["project_code"]
        == "DEMO-OTHER-275"
    )
    project_name = project_api["project"].name
    assert client.get("/api/v1/projects", params={"q": project_name}).json()[
        "items"
    ]

    duplicate_first = client.post(
        "/api/v1/projects",
        json={
            "project_code": "SAME-NAME-A",
            "name": "同名分頁測試",
            "client_name": "測試業主",
            "site_location": "測試地點",
        },
    )
    duplicate_second = client.post(
        "/api/v1/projects",
        json={
            "project_code": "SAME-NAME-B",
            "name": "同名分頁測試",
            "client_name": "測試業主",
            "site_location": "測試地點",
        },
    )
    assert duplicate_first.status_code == duplicate_second.status_code == 201
    first_same = client.get(
        "/api/v1/projects", params={"q": "同名分頁測試", "limit": 1}
    ).json()
    second_same = client.get(
        "/api/v1/projects",
        params={
            "q": "同名分頁測試",
            "limit": 1,
            "cursor": first_same["next_cursor"],
        },
    ).json()
    assert [
        row["id"] for row in first_same["items"] + second_same["items"]
    ] == sorted([duplicate_first.json()["id"], duplicate_second.json()["id"]])
    assert second_same["next_cursor"] is None
    max_page = client.get("/api/v1/projects", params={"limit": 100})
    assert max_page.status_code == 200
    for params in (
        {"limit": 0},
        {"limit": 101},
        {"cursor": "invalid!"},
        {"q": "x" * 257},
    ):
        assert client.get("/api/v1/projects", params=params).status_code == 422


def test_project_listing_and_creation_require_admin_or_permission(
    project_api, db_session: Session
):
    actor_client = project_api["actor_client"]
    project = project_api["project"]
    project_id = project.id
    body = {
        "project_code": "DENIED",
        "name": "不得新增",
        "client_name": "示範業主",
        "site_location": "示範工地",
    }
    assert actor_client.get("/api/v1/projects").status_code == 403
    assert (
        actor_client.get(f"/api/v1/projects/{project_id}").status_code == 403
    )
    assert actor_client.post("/api/v1/projects", json=body).status_code == 403
    assert (
        actor_client.patch(
            f"/api/v1/projects/{project_id}", json={"name": "不得修改"}
        ).status_code
        == 403
    )
    db_session.expire_all()
    unchanged = db_session.get(Project, project_id)
    assert unchanged is not None
    assert unchanged.name == "示範工程"


def test_project_update_permission_is_scoped_and_audited(
    project_api, db_session: Session
):
    project = project_api["project"]
    other_project = project_api["other_project"]
    actor = project_api["actor"]
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == actor.id,
        )
    )
    assert member is not None
    editor_role = create_role(
        db_session,
        name="專案資料編輯者",
        permission_codes=["project.update", "project.read"],
    )
    member.role_assignments.append(ProjectMemberRole(role_id=editor_role.id))
    db_session.commit()

    response = project_api["actor_client"].patch(
        f"/api/v1/projects/{project.id}", json={"name": "更新後名稱"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["name"] == "更新後名稱"
    [event] = _events(db_session, "project.updated", str(project.id))
    assert event.before == {"name": "示範工程"}
    assert event.after == {"name": "更新後名稱"}
    assert event.created_by == actor.id

    denied = project_api["actor_client"].patch(
        f"/api/v1/projects/{other_project.id}",
        json={"name": "不得跨專案修改"},
    )

    assert denied.status_code == 403
    db_session.expire_all()
    unchanged = db_session.get(Project, other_project.id)
    assert unchanged is not None
    assert unchanged.name == "另一示範工程"
    assert _events(db_session, "project.updated", str(other_project.id)) == []


def test_project_read_response_depends_on_effective_update_permission(
    project_api, db_session: Session, make_client
):
    project = project_api["project"]
    reader = project_api["target"]
    actor_member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == project_api["actor"].id,
        )
    )
    assert actor_member is not None
    editor_role = create_role(
        db_session,
        name="專案資料編輯者供讀取測試",
        permission_codes=["project.update", "project.read"],
    )
    actor_member.role_assignments.append(
        ProjectMemberRole(role_id=editor_role.id)
    )
    reader_module_permission = UserModulePermission(
        user_id=reader.id,
        permission_code="project.use",
        source="manual",
    )
    reader_role = create_role(
        db_session,
        name="專案基本資料查閱者",
        permission_codes=["project.read"],
    )
    db_session.add(reader_module_permission)
    add_project_member(
        db_session,
        project_id=project.id,
        user_id=reader.id,
        role_ids=[reader_role.id],
    )
    db_session.commit()
    reader_client = _make_user_client(db_session, make_client, reader)

    full = project_api["actor_client"].get(f"/api/v1/projects/{project.id}")
    admin = project_api["admin_client"].get(f"/api/v1/projects/{project.id}")
    basic = reader_client.get(f"/api/v1/projects/{project.id}")

    assert full.status_code == admin.status_code == 200
    assert basic.status_code == 200
    assert full.json()["client_name"] == admin.json()["client_name"]
    assert full.json()["site_location"] == admin.json()["site_location"]
    assert basic.json()["name"] == project.name
    assert "client_name" not in basic.json()
    assert "site_location" not in basic.json()


def _create_body(**extra):
    return {
        "project_code": "ROLE-1",
        "name": "角色示範工程",
        "client_name": "示範業主",
        "site_location": "示範工地",
        **extra,
    }


def _events(db_session: Session, event_type: str, project_id: str):
    db_session.expire_all()
    return list(
        db_session.scalars(
            select(AuditLog)
            .where(
                AuditLog.event_type == event_type,
                AuditLog.project_id == UUID(project_id),
            )
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )


def test_company_role_defaults_and_is_returned_with_audit(
    project_api, db_session
):
    client = project_api["admin_client"]

    omitted = client.post("/api/v1/projects", json=_create_body())
    explicit = client.post(
        "/api/v1/projects",
        json=_create_body(project_code="ROLE-2", company_role="supervisor"),
    )

    assert omitted.status_code == 201, omitted.text
    assert omitted.json()["company_role"] == "contractor"
    assert explicit.status_code == 201, explicit.text
    assert explicit.json()["company_role"] == "supervisor"
    [event] = _events(db_session, "project.created", explicit.json()["id"])
    assert event.after == {
        "project_code": "ROLE-2",
        "name": "角色示範工程",
        "company_role": "supervisor",
    }
    fetched = client.get(f"/api/v1/projects/{explicit.json()['id']}")
    assert fetched.json()["company_role"] == "supervisor"
    listed = client.get("/api/v1/projects?q=ROLE-2")
    assert listed.json()["items"][0]["company_role"] == "supervisor"


@pytest.mark.parametrize("bad", [None, "unknown", ""])
def test_company_role_create_rejects_null_and_unregistered(
    project_api, db_session, bad
):
    client = project_api["admin_client"]

    response = client.post(
        "/api/v1/projects", json=_create_body(company_role=bad)
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request.validation_failed"
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(Project)
            .where(Project.project_code == "ROLE-1")
        )
        == 0
    )


def test_company_role_change_needs_a_reason(project_api, db_session):
    client = project_api["admin_client"]
    project = project_api["project"]
    url = f"/api/v1/projects/{project.id}"

    for body in (
        {"company_role": "supervisor"},
        {"company_role": "supervisor", "company_role_change_reason": None},
        {"company_role": "supervisor", "company_role_change_reason": "  "},
    ):
        response = client.patch(url, json=body)
        assert response.status_code == 422, response.text
        assert (
            response.json()["error"]["code"]
            == "project.company_role_reason_required"
        )
    db_session.expire_all()
    assert db_session.get(Project, project.id).company_role == "contractor"
    assert _events(db_session, "project.updated", str(project.id)) == []

    changed = client.patch(
        url,
        json={
            "company_role": "supervisor",
            "company_role_change_reason": "合約改為監造",
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["company_role"] == "supervisor"
    [event] = _events(db_session, "project.updated", str(project.id))
    assert event.before == {"company_role": "contractor"}
    assert event.after == {
        "company_role": "supervisor",
        "company_role_change_reason": "合約改為監造",
    }
    assert event.created_by == project_api["admin"].id


def test_company_role_reason_length_and_same_value(project_api, db_session):
    client = project_api["admin_client"]
    project = project_api["project"]
    url = f"/api/v1/projects/{project.id}"

    too_long = client.patch(
        url,
        json={
            "company_role": "supervisor",
            "company_role_change_reason": "字" * 257,
        },
    )
    assert too_long.status_code == 422
    assert too_long.json()["error"] == {
        "code": ErrorCode.REQUEST_VALIDATION_FAILED.value,
        "fields": [
            {"path": "/company_role_change_reason", "code": "field.too_long"}
        ],
    }
    exact = client.patch(
        url,
        json={
            "company_role": "supervisor",
            "company_role_change_reason": "字" * 256,
        },
    )
    assert exact.status_code == 200, exact.text

    # 相同值不需原因、不寫稽核。
    same = client.patch(url, json={"company_role": "supervisor"})
    assert same.status_code == 200, same.text
    assert len(_events(db_session, "project.updated", str(project.id))) == 1

    # 改回承攬方同樣要原因；只改名稱的事件不含原因欄。
    back = client.patch(
        url,
        json={
            "company_role": "contractor",
            "company_role_change_reason": "改回承攬",
        },
    )
    assert back.status_code == 200, back.text
    renamed = client.patch(url, json={"name": "只改名稱"})
    assert renamed.status_code == 200, renamed.text
    events = _events(db_session, "project.updated", str(project.id))
    assert [event.after for event in events][-1] == {"name": "只改名稱"}
    assert len(events) == 3


@pytest.mark.parametrize("bad", [None, "unknown"])
def test_company_role_patch_rejects_null_and_unregistered(
    project_api, db_session, bad
):
    client = project_api["admin_client"]
    project = project_api["project"]

    response = client.patch(
        f"/api/v1/projects/{project.id}",
        json={"company_role": bad, "company_role_change_reason": "原因"},
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "request.validation_failed"
    # 未登記的值指到 /company_role；null 沒有欄位指標。
    assert error.get("fields") == (
        None
        if bad is None
        else [{"path": "/company_role", "code": "field.invalid"}]
    )
    db_session.expire_all()
    assert db_session.get(Project, project.id).company_role == "contractor"


@pytest.mark.parametrize("padding", [3, 257, 5000])
def test_blank_reason_is_required_error_at_any_length(
    project_api, db_session, padding
):
    """DOM-R76：全空白原因不論多長，都是專用錯誤碼而非長度錯誤。"""
    project = project_api["project"]

    response = project_api["admin_client"].patch(
        f"/api/v1/projects/{project.id}",
        json={
            "company_role": "supervisor",
            "company_role_change_reason": " " * padding,
        },
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": ErrorCode.PROJECT_COMPANY_ROLE_REASON_REQUIRED.value
    }
    db_session.expire_all()
    assert db_session.get(Project, project.id).company_role == "contractor"


def test_padded_reason_within_limit_is_not_rejected_by_request_cap(
    project_api, db_session
):
    """去空白後 256 字元的原因，前後有再多空白也不被請求上限誤擋。"""
    project = project_api["project"]
    reason = "字" * 256

    response = project_api["admin_client"].patch(
        f"/api/v1/projects/{project.id}",
        json={
            "company_role": "supervisor",
            "company_role_change_reason": f"{' ' * 600}{reason}{' ' * 600}",
        },
    )

    assert response.status_code == 200, response.text
    [event] = _events(db_session, "project.updated", str(project.id))
    assert event.after == {
        "company_role": "supervisor",
        "company_role_change_reason": reason,
    }


def test_create_with_unregistered_role_points_at_the_role_field(project_api):
    response = project_api["admin_client"].post(
        "/api/v1/projects", json=_create_body(company_role="unknown")
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": ErrorCode.REQUEST_VALIDATION_FAILED.value,
        "fields": [{"path": "/company_role", "code": "field.invalid"}],
    }


def test_company_role_api_matches_frontend_contract_fixture(
    project_api, db_session
):
    """RG-M22：前端 mock 用的角色清單、請求本體與錯誤形狀都是真的。"""
    fixture = _company_role_contract()
    client = project_api["admin_client"]
    project = project_api["project"]
    url = f"/api/v1/projects/{project.id}"

    listed = client.get("/api/v1/project-company-roles")
    assert listed.status_code == 200
    assert listed.json() == fixture["roles_response"]
    assert all(
        sorted(item) == fixture["role_item_keys"]
        for item in listed.json()["items"]
    )

    def error_of(body: dict) -> tuple[int, dict]:
        response = client.patch(url, json=body)
        return response.status_code, response.json()["error"]

    patch_body = fixture["patch_request"]
    status, error = error_of({"company_role": patch_body["company_role"]})
    expected = fixture["reason_required_error"]
    assert (status, error) == (
        expected["status"],
        {"code": expected["code"]},
    )

    status, error = error_of({**patch_body, "company_role": "unknown"})
    expected = fixture["invalid_role_error"]
    assert (status, error) == (
        expected["status"],
        {"code": expected["code"], "fields": expected["fields"]},
    )

    status, error = error_of(
        {**patch_body, "company_role_change_reason": "字" * 257}
    )
    expected = fixture["reason_too_long_error"]
    assert (status, error) == (
        expected["status"],
        {"code": expected["code"], "fields": expected["fields"]},
    )

    changed = client.patch(url, json=patch_body)
    assert changed.status_code == 200, changed.text
    assert changed.json()["company_role"] == patch_body["company_role"]


def test_company_role_change_requires_project_update_permission(
    project_api, db_session
):
    project = project_api["project"]

    response = project_api["actor_client"].patch(
        f"/api/v1/projects/{project.id}",
        json={
            "company_role": "supervisor",
            "company_role_change_reason": "不得修改",
        },
    )

    assert response.status_code == 403
    db_session.expire_all()
    assert db_session.get(Project, project.id).company_role == "contractor"


def test_project_company_roles_endpoint_lists_registry(
    project_api, extra_company_role
):
    expected = [
        {
            "value": "contractor",
            "label": "承攬施工方",
            "inspection_level": "self_inspection",
        },
        {
            "value": "supervisor",
            "label": "監造方",
            "inspection_level": "spot_check",
        },
        {
            "value": extra_company_role,
            "label": "專案管理顧問",
            "inspection_level": "spot_check",
        },
    ]

    anonymous = project_api["anonymous_client"].get(
        "/api/v1/project-company-roles"
    )
    plain = project_api["plain_client"].get("/api/v1/project-company-roles")

    assert anonymous.status_code == 401
    assert plain.status_code == 200
    assert plain.json() == {"items": expected}


def test_project_company_roles_endpoint_default_registry(project_api):
    response = project_api["plain_client"].get("/api/v1/project-company-roles")

    assert [item["value"] for item in response.json()["items"]] == [
        "contractor",
        "supervisor",
    ]


def test_template_manager_can_list_projects_but_project_members_cannot(
    project_api, db_session: Session, make_client
):
    admin_client = project_api["admin_client"]
    actor_client = project_api["actor_client"]
    plain_client = project_api["plain_client"]
    target = project_api["target"]
    assert isinstance(target, User)
    add_project_member(
        db_session,
        project_id=project_api["project"].id,
        user_id=target.id,
        role_ids=[],
    )
    db_session.commit()
    target_client = _make_user_client(db_session, make_client, target)
    assert target_client.get("/api/v1/projects").status_code == 403

    db_session.add(
        UserModulePermission(
            user_id=target.id,
            permission_code="template.manage",
            source="manual",
        )
    )
    db_session.commit()
    assert (
        target_client.get(
            f"/api/v1/projects/{project_api['project'].id}"
        ).status_code
        == 403
    )

    admin_projects = admin_client.get("/api/v1/projects")
    template_manager_projects = target_client.get("/api/v1/projects")
    assert admin_projects.status_code == 200
    assert template_manager_projects.status_code == 200
    assert admin_projects.json() == template_manager_projects.json()
    assert actor_client.get("/api/v1/projects").status_code == 403
    assert plain_client.get("/api/v1/projects").status_code == 403


def test_system_role_assignment_routes_are_removed(project_api):
    target = project_api["target"]
    assert isinstance(target, User)
    url = f"/api/v1/system-role-assignments/template_admin/{target.id}"

    assert project_api["admin_client"].put(url).status_code == 404
    assert project_api["admin_client"].delete(url).status_code == 404


def test_project_member_role_ids_payload_is_limited_to_64(
    project_api, db_session: Session
):
    """兩種成員角色寫入 body 都拒絕超過 64 個 role id。"""
    project = project_api["project"]
    target = project_api["target"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    members_url = f"/api/v1/projects/{project.id}/members"
    role_ids = [str(uuid4()) for _ in range(65)]
    before = db_session.scalar(
        select(func.count(ProjectMember.id)).where(
            ProjectMember.project_id == project.id
        )
    )

    added = project_api["admin_client"].post(
        members_url,
        json={"user_id": str(target.id), "role_ids": role_ids},
    )
    replaced = project_api["admin_client"].put(
        f"{members_url}/{target.id}/roles", json={"role_ids": role_ids}
    )

    assert added.status_code == 422
    assert replaced.status_code == 422
    after = db_session.scalar(
        select(func.count(ProjectMember.id)).where(
            ProjectMember.project_id == project.id
        )
    )
    assert after == before


def test_project_member_role_ids_payload_accepts_exactly_64(
    project_api, db_session: Session
):
    """64 個 role id 通過 body 驗證，只因角色不存在回 404；65 個才 422。"""
    project = project_api["project"]
    target = project_api["target"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    members_url = f"/api/v1/projects/{project.id}/members"
    role_ids = [str(uuid4()) for _ in range(64)]

    added = project_api["admin_client"].post(
        members_url,
        json={"user_id": str(target.id), "role_ids": role_ids},
    )
    replaced = project_api["admin_client"].put(
        f"{members_url}/{target.id}/roles", json={"role_ids": role_ids}
    )
    rejected = project_api["admin_client"].post(
        members_url,
        json={
            "user_id": str(target.id),
            "role_ids": [*role_ids, str(uuid4())],
        },
    )

    assert added.status_code == 404
    assert added.json()["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND.value
    assert replaced.status_code == 404
    assert (
        replaced.json()["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND.value
    )
    assert rejected.status_code == 422


def test_member_operations_require_project_permission_and_audit(
    project_api, db_session: Session
):
    _same_company(db_session, project_api)
    client = project_api["actor_client"]
    plain_client = project_api["plain_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)

    denied_writes = [
        plain_client.post(
            f"/api/v1/projects/{project.id}/members",
            json={"user_id": str(target.id)},
        ),
        plain_client.put(
            f"/api/v1/projects/{project.id}/members/{target.id}/roles",
            json={"role_ids": []},
        ),
        plain_client.delete(
            f"/api/v1/projects/{project.id}/members/{project_api['actor'].id}"
        ),
    ]
    assert all(response.status_code == 403 for response in denied_writes)

    added = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(target.id), "role_ids": [str(role.id)]},
    )
    assert added.status_code == 201
    body = added.json()
    member_id = UUID(body["id"])
    assert body["user_id"] == str(target.id)
    assert body["username"] == target.username
    assert body["role_ids"] == [str(role.id)]

    other_role = create_role(
        db_session,
        name="現場查核",
        permission_codes=["project_member.manage"],
    )
    other_role.is_assignable = True
    db_session.commit()
    replaced = client.put(
        f"/api/v1/projects/{project.id}/members/{target.id}/roles",
        json={"role_ids": [str(other_role.id)]},
    )
    assert replaced.status_code == 200
    assert replaced.json()["role_ids"] == [str(other_role.id)]
    db_session.expire_all()
    member = db_session.get(ProjectMember, member_id)
    assert member is not None
    assert member.updated_by == project_api["actor"].id
    events = list(
        db_session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == member_id)
            .order_by(AuditLog.created_at)
        )
    )
    assert [event.event_type for event in events] == [
        "project_member.roles_changed",
        "project_member.roles_changed",
    ]
    assert _audit_field(events[-1].before, "role_ids") == [str(role.id)]
    assert _audit_field(events[-1].after, "role_ids") == [str(other_role.id)]
    db_session.commit()

    removed = client.delete(
        f"/api/v1/projects/{project.id}/members/{target.id}"
    )
    assert removed.status_code == 204
    db_session.expire_all()
    assert db_session.get(ProjectMember, member_id) is None
    all_events = list(
        db_session.scalars(
            select(AuditLog).where(AuditLog.entity_id == member_id)
        )
    )
    assert all_events[-1].event_type == "project_member.removed"


def test_non_admin_cannot_change_own_project_roles(
    project_api, db_session: Session
):
    project = project_api["project"]
    actor = project_api["actor"]
    role = create_role(
        db_session,
        name="另一個可指派角色",
        permission_codes=["project.read"],
    )
    role.is_assignable = True
    db_session.commit()

    response = project_api["actor_client"].put(
        f"/api/v1/projects/{project.id}/members/{actor.id}/roles",
        json={"role_ids": [str(role.id)]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == (
        ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE.value
    )
    db_session.expire_all()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == actor.id,
        )
    )
    assert member is not None
    assert {item.role_id for item in member.role_assignments} == {
        project_api["role"].id
    }
    denied = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "project_member.assignment_denied",
            AuditLog.project_id == project.id,
            AuditLog.after["reason"].as_string()
            == ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE.value,
        )
    )
    assert denied is not None


def test_member_nested_malformed_user_ids_return_validation_error(project_api):
    project = project_api["project"]
    assert isinstance(project, Project)
    paths = (
        (
            "PUT",
            f"/api/v1/projects/{project.id}/members/not-a-uuid/roles",
            {"role_ids": []},
        ),
        (
            "DELETE",
            f"/api/v1/projects/{project.id}/members/not-a-uuid",
            None,
        ),
    )
    for method, path, body in paths:
        for client in (
            project_api["admin_client"],
            project_api["actor_client"],
            project_api["plain_client"],
        ):
            response = client.request(method, path, json=body)
            assert response.status_code == 422, response.text
            assert response.json() == {
                "error": {"code": "request.validation_failed"}
            }


def test_project_member_permission_does_not_apply_to_other_projects(
    project_api,
):
    client = project_api["actor_client"]
    project = project_api["other_project"]
    target = project_api["target"]
    assert isinstance(project, Project)
    assert isinstance(target, User)

    responses = [
        client.post(
            f"/api/v1/projects/{project.id}/members",
            json={"user_id": str(target.id)},
        ),
        client.put(
            f"/api/v1/projects/{project.id}/members/{target.id}/roles",
            json={"role_ids": []},
        ),
        client.delete(f"/api/v1/projects/{project.id}/members/{target.id}"),
    ]
    assert [response.status_code for response in responses] == [403, 403, 403]


def test_admin_can_manage_members_and_anonymous_is_rejected(project_api):
    project = project_api["project"]
    target = project_api["target"]
    admin_client = project_api["admin_client"]
    anonymous_client = project_api["anonymous_client"]
    assert isinstance(project, Project)
    assert isinstance(target, User)

    anonymous = anonymous_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(target.id)},
    )
    assert anonymous.status_code == 401
    assert anonymous.json()["error"]["code"] == "auth.not_authenticated"

    added = admin_client.post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(target.id),
            "role_ids": [str(project_api["role"].id)],
        },
    )
    assert added.status_code == 201
    assert added.json()["role_ids"] == [str(project_api["role"].id)]


def test_member_conflict_and_unknown_role_errors(
    project_api, db_session: Session
):
    _same_company(db_session, project_api)
    client = project_api["actor_client"]
    project = project_api["project"]
    actor = project_api["actor"]
    assert isinstance(project, Project)
    assert isinstance(actor, User)

    duplicate = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(actor.id),
            "role_ids": [str(project_api["role"].id)],
        },
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "project.member_conflict"

    missing_role = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(project_api["target"].id),
            "role_ids": ["00000000-0000-7000-8000-000000000001"],
        },
    )
    assert missing_role.status_code == 404
    assert missing_role.json()["error"]["code"] == "resource.not_found"


def test_member_roles_are_required_on_create_and_update(
    project_api, db_session: Session
):
    """ADM-AC20: zero-role writes are 422 and change nothing."""
    _same_company(db_session, project_api)
    client = project_api["actor_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)
    members_url = f"/api/v1/projects/{project.id}/members"
    roles_url = f"{members_url}/{target.id}/roles"

    for body in (
        {"user_id": str(target.id)},
        {
            "user_id": str(target.id),
            "role_ids": [],
        },
    ):
        refused = client.post(members_url, json=body)
        assert refused.status_code == 422
        assert (
            refused.json()["error"]["code"]
            == ErrorCode.PROJECT_MEMBER_ROLES_REQUIRED.value
            == "project.member_roles_required"
        )
    assert (
        db_session.scalar(
            select(ProjectMember.id).where(ProjectMember.user_id == target.id)
        )
        is None
    )

    created = client.post(
        members_url,
        json={"user_id": str(target.id), "role_ids": [str(role.id)]},
    )
    assert created.status_code == 201

    refused = client.put(roles_url, json={"role_ids": []})
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "project.member_roles_required"

    # Permission is checked before the role rule: no 422 leaks to outsiders.
    plain = project_api["plain_client"]
    assert (
        plain.post(members_url, json={"user_id": str(target.id)}).status_code
        == 403
    )
    assert plain.put(roles_url, json={"role_ids": []}).status_code == 403
    unchanged = client.get(members_url)
    assert unchanged.status_code == 200
    rows = {row["user_id"]: row for row in unchanged.json()}
    assert rows[str(target.id)]["role_ids"] == [str(role.id)]

    # A body with no role_ids field is a plain schema error, not this rule.
    malformed = client.put(roles_url, json={})
    assert malformed.status_code == 422
    assert (
        malformed.json()["error"]["code"]
        == ErrorCode.REQUEST_VALIDATION_FAILED.value
    )


def test_member_api_matches_frontend_contract_fixture(
    project_api, db_session: Session
):
    """RG-M22: the shapes the member page's tests mock are the real ones."""
    _same_company(db_session, project_api)
    fixture = json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/admin/projects/fixtures"
            / "member-roles-contract.json"
        ).read_text(encoding="utf-8")
    )
    client = project_api["actor_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)
    members_url = f"/api/v1/projects/{project.id}/members"

    add_body = {"user_id": str(target.id), "role_ids": [str(role.id)]}
    assert sorted(add_body) == fixture["add_request_keys"]
    created = client.post(members_url, json=add_body)
    assert created.status_code == 201
    assert sorted(created.json()) == fixture["member_write_response_keys"]

    set_body = {"role_ids": [str(role.id)]}
    assert sorted(set_body) == fixture["set_roles_request_keys"]
    replaced = client.put(f"{members_url}/{target.id}/roles", json=set_body)
    assert replaced.status_code == 200
    assert sorted(replaced.json()) == fixture["member_write_response_keys"]

    listed = client.get(members_url)
    assert listed.status_code == 200
    assert all(
        sorted(row) == fixture["member_list_item_keys"]
        for row in listed.json()
    )

    zero_role_target = create_user(
        db_session,
        is_external_collaborator=False,
        username="contract.zero_role",
        email="contract.zero_role@demo.example",
        name_zh="零角色測試",
    )
    db_session.commit()
    refused = client.post(
        members_url,
        json={"user_id": str(zero_role_target.id), "role_ids": []},
    )
    expected = fixture["zero_role_error"]
    assert refused.status_code == expected["status"]
    assert refused.json()["error"]["code"] == expected["code"]


def test_member_list_names_roles_even_when_not_assignable(
    project_api, db_session: Session
):
    """#713: 建立者角色不可指派，成員頁仍要顯示它的名稱。"""
    _same_company(db_session, project_api)
    client = project_api["actor_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)
    members_url = f"/api/v1/projects/{project.id}/members"
    created = client.post(
        members_url,
        json={"user_id": str(target.id), "role_ids": [str(role.id)]},
    )
    assert created.status_code == 201
    role.is_assignable = False
    db_session.commit()

    listed = client.get(members_url)

    assert listed.status_code == 200
    row = next(
        item for item in listed.json() if item["user_id"] == str(target.id)
    )
    assert row["role_ids"] == [str(role.id)]
    assert row["role_names"] == [role.name]


def test_member_missing_resources_and_duplicate_roles(
    project_api, db_session: Session
):
    _same_company(db_session, project_api)
    client = project_api["actor_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)

    missing_project = project_api["admin_client"].post(
        "/api/v1/projects/00000000-0000-7000-8000-000000000003/members",
        json={"user_id": str(target.id)},
    )
    assert missing_project.status_code == 404
    assert missing_project.json()["error"]["code"] == "resource.not_found"

    missing_user = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": "00000000-0000-7000-8000-000000000004"},
    )
    assert missing_user.status_code == 404
    assert missing_user.json()["error"]["code"] == "resource.not_found"

    missing_member_roles = client.put(
        f"/api/v1/projects/{project.id}/members/{target.id}/roles",
        json={"role_ids": []},
    )
    assert missing_member_roles.status_code == 404
    assert missing_member_roles.json()["error"]["code"] == "resource.not_found"
    missing_member_removal = client.delete(
        f"/api/v1/projects/{project.id}/members/{target.id}"
    )
    assert missing_member_removal.status_code == 404
    assert (
        missing_member_removal.json()["error"]["code"] == "resource.not_found"
    )

    duplicate_roles = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(target.id), "role_ids": [str(role.id)] * 2},
    )
    assert duplicate_roles.status_code == 422
    assert (
        duplicate_roles.json()["error"]["code"]
        == ErrorCode.REQUEST_VALIDATION_FAILED.value
    )


def test_invalid_project_fields_are_422_and_missing_project_is_404(
    project_api,
):
    client = project_api["admin_client"]
    response = client.post(
        "/api/v1/projects",
        json={
            "project_code": "TOO-LONG" * 5,
            "name": "示範工程",
            "client_name": "示範業主",
            "site_location": "示範工地",
        },
    )
    assert response.status_code == 422
    assert (
        response.json()["error"]["code"]
        == ErrorCode.REQUEST_VALIDATION_FAILED.value
    )

    missing = client.get(
        "/api/v1/projects/00000000-0000-7000-8000-000000000002"
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "resource.not_found"


def test_project_patch_null_required_field_and_empty_body_are_422(project_api):
    client = project_api["admin_client"]
    project = project_api["project"]
    assert isinstance(project, Project)

    null_required_field = client.patch(
        f"/api/v1/projects/{project.id}", json={"name": None}
    )
    assert null_required_field.status_code == 422
    assert (
        null_required_field.json()["error"]["code"]
        == ErrorCode.REQUEST_VALIDATION_FAILED.value
    )

    empty_body = client.patch(f"/api/v1/projects/{project.id}", json={})
    assert empty_body.status_code == 422
    assert (
        empty_body.json()["error"]["code"]
        == ErrorCode.REQUEST_VALIDATION_FAILED.value
    )


def test_list_members_returns_user_fields_roles_and_join_order(
    project_api, db_session: Session
):
    project = project_api["project"]
    other_project = project_api["other_project"]
    actor = project_api["actor"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(other_project, Project)
    assert isinstance(actor, User)
    assert isinstance(target, User)
    assert isinstance(role, Role)
    add_project_member(
        db_session, project_id=project.id, user_id=target.id, role_ids=[]
    )
    add_project_member(
        db_session,
        project_id=other_project.id,
        user_id=project_api["admin"].id,
        role_ids=[role.id],
    )
    db_session.commit()

    for key in ("actor_client", "admin_client"):
        response = project_api[key].get(
            f"/api/v1/projects/{project.id}/members"
        )
        assert response.status_code == 200
        rows = response.json()
        assert [row["user_id"] for row in rows] == [
            str(actor.id),
            str(target.id),
        ]
        assert rows[0]["username"] == "project.manager"
        assert rows[0]["name_zh"] == "專案管理者"
        assert rows[0]["email"] == "manager@demo.example"
        assert rows[0]["company_id"] is None
        assert rows[0]["company_name"] is None
        assert rows[0]["is_active"] is True
        assert rows[0]["is_effectively_active"] is True
        assert rows[0]["role_ids"] == [str(role.id)]
        assert rows[1]["role_ids"] == []

    other = project_api["admin_client"].get(
        f"/api/v1/projects/{other_project.id}/members"
    )
    assert [row["user_id"] for row in other.json()] == [
        str(project_api["admin"].id)
    ]


def test_list_members_includes_company_and_inactive_user(
    project_api, db_session: Session
):
    project = project_api["project"]
    target = project_api["target"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    root = create_root_user_with_company(db_session, "CO277")
    assert root.company_id is not None
    company = db_session.get(Company, root.company_id)
    assert company is not None
    target.company_id = company.id
    add_project_member(db_session, project_id=project.id, user_id=target.id)
    target.is_active = False
    db_session.commit()

    response = project_api["admin_client"].get(
        f"/api/v1/projects/{project.id}/members"
    )
    row = next(r for r in response.json() if r["user_id"] == str(target.id))
    assert row["company_id"] == str(company.id)
    assert row["company_name"] == company.name
    assert row["is_active"] is False
    assert row["is_effectively_active"] is False


def test_list_members_marks_expired_account_without_writing_inactive(
    project_api, db_session: Session
):
    project = project_api["project"]
    admin = project_api["admin"]
    assert isinstance(project, Project)
    assert isinstance(admin, User)
    expired = create_user(
        db_session,
        username="expired.member",
        email="expired.member@demo.example",
        name_zh="到期未停用成員",
        is_external_collaborator=True,
        account_expires_on=clock.utc_now().date() - timedelta(days=1),
    )
    expires_today = create_user(
        db_session,
        username="expires.today.member",
        email="expires.today.member@demo.example",
        name_zh="今日到期成員",
        is_external_collaborator=True,
        account_expires_on=clock.utc_now().date(),
    )
    add_project_member(db_session, project_id=project.id, user_id=expired.id)
    add_project_member(
        db_session, project_id=project.id, user_id=expires_today.id
    )
    db_session.commit()

    response = project_api["admin_client"].get(
        f"/api/v1/projects/{project.id}/members"
    )
    row = next(
        item for item in response.json() if item["user_id"] == str(expired.id)
    )
    today_row = next(
        item
        for item in response.json()
        if item["user_id"] == str(expires_today.id)
    )

    assert response.status_code == 200
    assert row["is_active"] is True
    assert row["is_effectively_active"] is False
    assert today_row["is_active"] is True
    assert today_row["is_effectively_active"] is True
    db_session.refresh(expired)
    assert expired.is_active is True


def test_list_members_marks_external_collaborators(
    project_api, db_session: Session
):
    project = project_api["project"]
    assert isinstance(project, Project)
    company_user = create_root_user_with_company(db_session, "EXT278")
    assert company_user.company_id is not None
    external = create_user(
        db_session,
        username="external.member",
        email="external.member@demo.example",
        name_zh="外部成員",
        is_external_collaborator=True,
    )
    external.company_id = company_user.company_id
    add_project_member(db_session, project_id=project.id, user_id=external.id)
    db_session.commit()

    response = project_api["admin_client"].get(
        f"/api/v1/projects/{project.id}/members"
    )

    assert response.status_code == 200
    row = next(r for r in response.json() if r["user_id"] == str(external.id))
    assert row["is_external_collaborator"] is True


def test_member_list_query_count_does_not_grow(
    project_api, db_session: Session
):
    client = project_api["admin_client"]
    project = project_api["project"]
    assert isinstance(project, Project)
    path = f"/api/v1/projects/{project.id}/members"
    with _select_statements(get_engine()) as baseline:
        first = client.get(path)
    assert first.status_code == 200
    assert len(first.json()) == 1

    root = create_root_user_with_company(db_session, "PERF299")
    assert root.company_id is not None
    for index in range(8):
        user = create_user(
            db_session,
            is_external_collaborator=False,
            username=f"member.perf.{index}",
            email=f"member.perf.{index}@demo.example",
            name_zh=f"示範成員 {index}",
        )
        user.company_id = root.company_id
        add_project_member(db_session, project_id=project.id, user_id=user.id)
    db_session.commit()

    with _select_statements(get_engine()) as expanded:
        listed = client.get(path)
    assert listed.status_code == 200
    assert len(listed.json()) == 9
    assert all(row["company_name"] for row in listed.json()[1:])
    assert baseline
    assert len(expanded) == len(baseline)


def test_list_members_permission_and_missing_project(project_api):
    project = project_api["project"]
    other_project = project_api["other_project"]
    assert isinstance(project, Project)
    assert isinstance(other_project, Project)
    path = f"/api/v1/projects/{project.id}/members"

    assert project_api["plain_client"].get(path).status_code == 403
    # Holding the permission on one project does not cover another.
    other = project_api["actor_client"].get(
        f"/api/v1/projects/{other_project.id}/members"
    )
    assert other.status_code == 403
    anonymous = project_api["anonymous_client"].get(path)
    assert anonymous.status_code == 401

    missing = project_api["admin_client"].get(
        "/api/v1/projects/00000000-0000-7000-8000-000000000001/members"
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "resource.not_found"


def _contract_fixture() -> dict:
    return json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/admin/projects/fixtures"
            / "member-roles-contract.json"
        ).read_text(encoding="utf-8")
    )


def _company_role_contract() -> dict:
    """前後端共用的本公司角色契約（RG-M22）。"""
    return json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/admin/projects/fixtures"
            / "company-role-contract.json"
        ).read_text(encoding="utf-8")
    )


def _candidate_world(db_session: Session, project_api: ProjectApiContext):
    """The manager joins company A; users around them cover each rule."""
    company_a = create_company(db_session, name="示範公司甲")
    company_b = create_company(db_session, name="示範公司乙")
    actor = project_api["actor"]
    project = project_api["project"]
    assert isinstance(actor, User)
    assert isinstance(project, Project)
    actor.company_id = company_a.id
    users = {}
    for key, company, active in (
        ("same_b", company_a, True),
        ("same_a", company_a, True),
        ("same_joined", company_a, True),
        ("same_inactive", company_a, False),
        ("other_company", company_b, True),
    ):
        users[key] = create_user(
            db_session,
            is_external_collaborator=False,
            username=f"cand.{key}",
            email=f"cand.{key}@demo.example",
            name_zh=f"候選 {key}",
            company_id=company.id,
            is_active=active,
        )
    add_project_member(
        db_session, project_id=project.id, user_id=users["same_joined"].id
    )
    db_session.commit()
    return users


def test_member_candidates_include_cross_company_display_data(
    project_api, db_session: Session
):
    users = _candidate_world(db_session, project_api)
    project = project_api["project"]
    assert isinstance(project, Project)
    url = f"/api/v1/projects/{project.id}/member-candidates"

    response = project_api["actor_client"].get(url)
    assert response.status_code == 200
    body = response.json()
    assert sorted(body) == _contract_fixture()["candidate_page_keys"]
    names = [row["username"] for row in body["items"]]
    assert names == [
        "cand.other_company",
        "cand.same_a",
        "cand.same_b",
        "project.member",
        "project.viewer",
    ]
    assert "cand.same_joined" not in names
    assert "cand.same_inactive" not in names
    assert "project.manager" not in names
    assert body["next_cursor"] is None
    expected_keys = _contract_fixture()["member_candidate_item_keys"]
    assert all(sorted(row) == expected_keys for row in body["items"])
    other_company = body["items"][0]
    assert other_company["id"] == str(users["other_company"].id)
    assert other_company["company_name"] == "示範公司乙"
    assert other_company["module_status"] == {
        "project_use": False,
        "inspection_use": False,
    }
    serialized = json.dumps(body)
    assert "demo.example" not in serialized


def test_member_candidates_for_admin_cover_every_company(
    project_api, db_session: Session
):
    _candidate_world(db_session, project_api)
    project = project_api["project"]
    assert isinstance(project, Project)
    response = project_api["admin_client"].get(
        f"/api/v1/projects/{project.id}/member-candidates"
    )
    assert response.status_code == 200
    names = [row["username"] for row in response.json()["items"]]
    assert "cand.other_company" in names
    assert "cand.same_a" in names
    assert "cand.same_joined" not in names
    assert "cand.same_inactive" not in names
    assert "admin" not in names
    assert "project.manager" not in names


def test_member_candidates_include_users_when_caller_has_no_company(
    project_api,
):
    project = project_api["project"]
    assert isinstance(project, Project)
    # 沒有公司歸屬的管理者仍能指派任何公司的人員。
    response = project_api["actor_client"].get(
        f"/api/v1/projects/{project.id}/member-candidates"
    )
    assert response.status_code == 200
    assert "project.member" in {
        row["username"] for row in response.json()["items"]
    }


def test_member_candidates_follow_cursor_pages(
    project_api, db_session: Session
):
    _candidate_world(db_session, project_api)
    project = project_api["project"]
    assert isinstance(project, Project)
    client = project_api["actor_client"]
    url = f"/api/v1/projects/{project.id}/member-candidates"
    first = client.get(url, params={"limit": 1})
    assert [row["username"] for row in first.json()["items"]] == [
        "cand.other_company"
    ]
    cursor = first.json()["next_cursor"]
    assert cursor
    second = client.get(url, params={"limit": 1, "cursor": cursor})
    assert [row["username"] for row in second.json()["items"]] == [
        "cand.same_a"
    ]
    assert second.json()["next_cursor"] is not None
    assert client.get(url, params={"cursor": "bad"}).status_code == 422
    assert client.get(url, params={"limit": 0}).status_code == 422


def test_assignable_roles_expose_only_display_fields(
    project_api, db_session: Session
):
    project = project_api["project"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(role, Role)
    extra = create_role(
        db_session,
        name="現場查核",
        permission_codes=["inspection_task.read", "project.read"],
    )
    extra.is_assignable = True
    db_session.commit()
    url = f"/api/v1/projects/{project.id}/assignable-roles"

    response = project_api["actor_client"].get(url)
    assert response.status_code == 200
    body = response.json()
    assert sorted(body) == _contract_fixture()["candidate_page_keys"]
    expected_keys = _contract_fixture()["assignable_role_item_keys"]
    assert all(sorted(row) == expected_keys for row in body["items"])
    by_id = {row["id"]: row for row in body["items"]}
    assert by_id[str(role.id)]["permission_codes"] == ["project_member.manage"]
    assert by_id[str(extra.id)]["permission_codes"] == [
        "inspection_task.read",
        "project.read",
    ]
    # Admin gets the same list.
    admin = project_api["admin_client"].get(url)
    assert admin.json() == body

    first = project_api["actor_client"].get(url, params={"limit": 1})
    assert len(first.json()["items"]) == 1
    cursor = first.json()["next_cursor"]
    second = project_api["actor_client"].get(
        url, params={"limit": 1, "cursor": cursor}
    )
    assert first.json()["items"][0]["id"] != second.json()["items"][0]["id"]


def test_candidate_endpoints_require_member_manage_permission(project_api):
    project = project_api["project"]
    other_project = project_api["other_project"]
    assert isinstance(project, Project)
    assert isinstance(other_project, Project)
    suffixes = ("member-candidates", "assignable-roles")
    for suffix in suffixes:
        path = f"/api/v1/projects/{project.id}/{suffix}"
        assert project_api["plain_client"].get(path).status_code == 403
        assert project_api["anonymous_client"].get(path).status_code == 401
        # Holding the permission on one project does not cover another.
        other = project_api["actor_client"].get(
            f"/api/v1/projects/{other_project.id}/{suffix}"
        )
        assert other.status_code == 403
        missing = project_api["admin_client"].get(
            f"/api/v1/projects/00000000-0000-7000-8000-000000000001/{suffix}"
        )
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "resource.not_found"


def test_global_user_and_role_lists_stay_admin_only(project_api):
    actor_client = project_api["actor_client"]
    assert actor_client.get("/api/v1/users").status_code == 403
    assert actor_client.get("/api/v1/roles").status_code == 403


def test_candidate_endpoints_query_count_does_not_grow(
    project_api, db_session: Session
):
    _candidate_world(db_session, project_api)
    project = project_api["project"]
    assert isinstance(project, Project)
    client = project_api["actor_client"]
    company_id = project_api["actor"].company_id
    for suffix in ("member-candidates", "assignable-roles"):
        path = f"/api/v1/projects/{project.id}/{suffix}"
        with _select_statements(get_engine()) as baseline:
            assert client.get(path).status_code == 200
        for index in range(6):
            create_user(
                db_session,
                is_external_collaborator=False,
                username=f"perf.{suffix}.{index}",
                email=f"perf.{suffix}.{index}@demo.example",
                name_zh=f"效能 {index}",
                company_id=company_id,
            )
            create_role(
                db_session,
                name=f"效能角色 {suffix} {index}",
                permission_codes=["project.read"],
            )
        db_session.commit()
        with _select_statements(get_engine()) as expanded:
            assert client.get(path).status_code == 200
        assert baseline
        assert len(expanded) == len(baseline)


def test_non_admin_can_add_users_across_companies(
    project_api, db_session: Session
):
    users = _candidate_world(db_session, project_api)
    project = project_api["project"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(role, Role)
    url = f"/api/v1/projects/{project.id}/members"
    client = project_api["actor_client"]

    for key in ("other_company",):
        accepted = client.post(
            url,
            json={"user_id": str(users[key].id), "role_ids": [str(role.id)]},
        )
        assert accepted.status_code == 201
    accepted = client.post(
        url,
        json={
            "user_id": str(project_api["target"].id),
            "role_ids": [str(role.id)],
        },
    )
    assert accepted.status_code == 201
    missing = client.post(
        url, json={"user_id": "00000000-0000-7000-8000-000000000004"}
    )
    assert missing.status_code == 404
    db_session.expire_all()
    joined = set(
        db_session.scalars(
            select(ProjectMember.user_id).where(
                ProjectMember.project_id == project.id
            )
        )
    )
    assert users["other_company"].id in joined
    assert project_api["target"].id in joined

    ok = client.post(
        url,
        json={"user_id": str(users["same_a"].id), "role_ids": [str(role.id)]},
    )
    assert ok.status_code == 201
    # Everyone offered by member-candidates is accepted by the write.
    offered = client.get(
        f"/api/v1/projects/{project.id}/member-candidates"
    ).json()["items"]
    assert offered
    for row in offered:
        accepted = client.post(
            url, json={"user_id": row["id"], "role_ids": [str(role.id)]}
        )
        assert accepted.status_code == 201, row


def test_non_admin_without_company_can_add_anyone(
    project_api, db_session: Session
):
    project = project_api["project"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(role, Role)
    company = create_company(db_session, name="示範公司丙")
    assert project_api["actor"].company_id is None
    member = create_user(
        db_session,
        is_external_collaborator=False,
        username="cand.companyless_target",
        email="cand.companyless_target@demo.example",
        name_zh="候選",
        company_id=company.id,
    )
    db_session.commit()
    accepted = project_api["actor_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(member.id), "role_ids": [str(role.id)]},
    )
    assert accepted.status_code == 201


def test_admin_can_add_users_of_any_company(project_api, db_session: Session):
    users = _candidate_world(db_session, project_api)
    project = project_api["project"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(role, Role)
    added = project_api["admin_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={
            "user_id": str(users["other_company"].id),
            "role_ids": [str(role.id)],
        },
    )
    assert added.status_code == 201
