"""Project and ProjectMember management API checks."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TypedDict
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.v1 import system_role_assignments
from app.auth.access import require_system_role
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import get_engine
from app.models import (
    AuditLog,
    Company,
    Project,
    ProjectMember,
    Role,
    SystemRoleAssignment,
    SystemRoleCode,
    User,
)
from app.services.companies import create_company
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
    registered_permission_codes,
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
        username="project.manager",
        email="manager@demo.example",
        name_zh="專案管理者",
    )
    target = create_user(
        db_session,
        username="project.member",
        email="member@demo.example",
        name_zh="專案成員",
    )
    plain = create_user(
        db_session,
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
    """Put the manager and the add-target in one company (#481).

    A non-Admin may only add people of their own company, so tests that
    add the target as the manager need them to share one.
    """
    company = create_company(db_session, name="示範同公司")
    for key in ("actor", "target"):
        user = project_api[key]
        assert isinstance(user, User)
        user.company_id = company.id
    db_session.commit()
    return company


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


def test_project_crud_requires_admin(project_api):
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


def test_template_admin_can_list_projects_but_project_members_cannot(
    project_api, db_session: Session, make_client
):
    admin_client = project_api["admin_client"]
    actor_client = project_api["actor_client"]
    plain_client = project_api["plain_client"]
    actor = project_api["actor"]
    target = project_api["target"]
    assert isinstance(actor, User)
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

    assigned = admin_client.put(
        f"/api/v1/system-role-assignments/template_admin/{target.id}"
    )
    assert assigned.status_code == 204
    db_session.refresh(target)
    assert target.is_admin is False
    assert (
        target_client.get(
            f"/api/v1/projects/{project_api['project'].id}"
        ).status_code
        == 403
    )
    assert (
        target_client.put(
            f"/api/v1/system-role-assignments/template_admin/{target.id}"
        ).status_code
        == 403
    )
    assert (
        target_client.delete(
            f"/api/v1/system-role-assignments/template_admin/{target.id}"
        ).status_code
        == 403
    )

    admin_projects = admin_client.get("/api/v1/projects")
    template_admin_projects = target_client.get("/api/v1/projects")
    assert admin_projects.status_code == 200
    assert template_admin_projects.status_code == 200
    assert admin_projects.json() == template_admin_projects.json()
    assert actor_client.get("/api/v1/projects").status_code == 403
    assert plain_client.get("/api/v1/projects").status_code == 403

    assert (
        admin_client.delete(
            f"/api/v1/system-role-assignments/template_admin/{actor.id}"
        ).status_code
        == 404
    )
    missing_user_id = uuid4()
    assert (
        admin_client.delete(
            f"/api/v1/system-role-assignments/template_admin/{missing_user_id}"
        ).status_code
        == 404
    )
    assert (
        admin_client.put(
            f"/api/v1/system-role-assignments/template_admin/{missing_user_id}"
        ).status_code
        == 404
    )

    assert (
        admin_client.delete(
            f"/api/v1/system-role-assignments/template_admin/{target.id}"
        ).status_code
        == 204
    )
    assert target_client.get("/api/v1/projects").status_code == 403


def test_template_admin_guard_requires_assignment_not_project_permissions(
    project_api, db_session: Session
):
    admin_client = project_api["admin_client"]
    actor = project_api["actor"]
    target = project_api["target"]
    assert isinstance(actor, User)
    assert isinstance(target, User)

    assigned = admin_client.put(
        f"/api/v1/system-role-assignments/template_admin/{target.id}"
    )
    assert assigned.status_code == 204

    check_template_admin = require_system_role(SystemRoleCode.TEMPLATE_ADMIN)
    assert check_template_admin(user=target, db=db_session) is target
    with pytest.raises(APIError) as denied:
        check_template_admin(user=actor, db=db_session)
    assert denied.value.status_code == 403
    assert denied.value.code is ErrorCode.PERMISSION_DENIED


def test_system_role_assignment_endpoints_are_admin_only_and_audited(
    project_api, db_session: Session
):
    admin_client = project_api["admin_client"]
    actor_client = project_api["actor_client"]
    target = project_api["target"]
    assert isinstance(target, User)
    assign_url = f"/api/v1/system-role-assignments/template_admin/{target.id}"

    assert actor_client.put(assign_url).status_code == 403
    assert actor_client.delete(assign_url).status_code == 403

    assigned = admin_client.put(assign_url)
    assert assigned.status_code == 204
    repeated = admin_client.put(assign_url)
    assert repeated.status_code == 204
    db_session.expire_all()
    events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "system_role_assignment.created"
            )
        )
    )
    assert len(events) == 1
    assert events[0].entity_type == "system_role_assignment"
    assert _audit_field(events[0].after, "user_id") == str(target.id)
    assert _audit_field(events[0].after, "role_code") == "template_admin"

    revoked = admin_client.delete(assign_url)
    assert revoked.status_code == 204
    db_session.expire_all()
    deleted_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "system_role_assignment.deleted"
            )
        )
    )
    assert len(deleted_events) == 1
    assert _audit_field(deleted_events[0].before, "user_id") == str(target.id)
    assert (
        _audit_field(deleted_events[0].before, "role_code") == "template_admin"
    )


def test_concurrent_duplicate_template_admin_assignment_is_idempotent(
    project_api, db_session: Session, monkeypatch
):
    admin_client = project_api["admin_client"]
    admin = project_api["admin"]
    target = project_api["target"]
    assert isinstance(admin, User)
    assert isinstance(target, User)
    assign_url = f"/api/v1/system-role-assignments/template_admin/{target.id}"
    assert admin_client.put(assign_url).status_code == 204

    def insert_racing_assignment(session, user_id, role_code):
        session.add(
            SystemRoleAssignment(
                user_id=user_id,
                role_code=role_code.value,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )
        session.flush()

    monkeypatch.setattr(
        system_role_assignments,
        "assign_system_role",
        insert_racing_assignment,
    )
    before_events = db_session.scalar(
        select(AuditLog.id).where(
            AuditLog.event_type == "system_role_assignment.created"
        )
    )
    response = admin_client.put(assign_url)
    assert response.status_code == 204
    db_session.expire_all()
    events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "system_role_assignment.created"
            )
        )
    )
    assert len(events) == 1
    assert events[0].id == before_events


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

    refused = client.post(
        members_url,
        json={"user_id": str(target.id), "role_ids": []},
    )
    expected = fixture["zero_role_error"]
    assert refused.status_code == expected["status"]
    assert refused.json()["error"]["code"] == expected["code"]


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
    target.is_active = False
    add_project_member(db_session, project_id=project.id, user_id=target.id)
    db_session.commit()

    response = project_api["admin_client"].get(
        f"/api/v1/projects/{project.id}/members"
    )
    row = next(r for r in response.json() if r["user_id"] == str(target.id))
    assert row["company_id"] == str(company.id)
    assert row["company_name"] == company.name
    assert row["is_active"] is False


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


def test_member_candidates_are_company_scoped_for_non_admin(
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
    # Same company only; members, inactive and other-company users are
    # left out, and so is the caller (already a member).
    assert [row["username"] for row in body["items"]] == [
        "cand.same_a",
        "cand.same_b",
    ]
    assert body["next_cursor"] is None
    expected_keys = _contract_fixture()["member_candidate_item_keys"]
    assert all(sorted(row) == expected_keys for row in body["items"])
    assert body["items"][0]["id"] == str(users["same_a"].id)
    assert body["items"][0]["name_zh"] == "候選 same_a"
    serialized = json.dumps(body)
    assert "demo.example" not in serialized
    assert "other_company" not in serialized


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


def test_member_candidates_are_empty_for_a_caller_without_company(
    project_api,
):
    project = project_api["project"]
    assert isinstance(project, Project)
    # The default manager has no company: nobody can be offered.
    response = project_api["actor_client"].get(
        f"/api/v1/projects/{project.id}/member-candidates"
    )
    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


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
        "cand.same_a"
    ]
    cursor = first.json()["next_cursor"]
    assert cursor
    second = client.get(url, params={"limit": 1, "cursor": cursor})
    assert [row["username"] for row in second.json()["items"]] == [
        "cand.same_b"
    ]
    assert second.json()["next_cursor"] is None
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
        permission_codes=["report.read", "evidence.read"],
    )
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
        "evidence.read",
        "report.read",
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
                username=f"perf.{suffix}.{index}",
                email=f"perf.{suffix}.{index}@demo.example",
                name_zh=f"效能 {index}",
                company_id=company_id,
            )
            create_role(
                db_session,
                name=f"效能角色 {suffix} {index}",
                permission_codes=["report.read"],
            )
        db_session.commit()
        with _select_statements(get_engine()) as expanded:
            assert client.get(path).status_code == 200
        assert baseline
        assert len(expanded) == len(baseline)


def test_non_admin_can_only_add_users_of_their_own_company(
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
        refused = client.post(
            url,
            json={"user_id": str(users[key].id), "role_ids": [str(role.id)]},
        )
        assert refused.status_code == 422
        assert (
            refused.json()["error"]["code"]
            == ErrorCode.PROJECT_MEMBER_COMPANY_MISMATCH.value
            == _contract_fixture()["company_mismatch_error"]["code"]
        )
        assert (
            refused.status_code
            == _contract_fixture()["company_mismatch_error"]["status"]
        )
    # A user without a company is not "the same company" either.
    refused = client.post(
        url,
        json={
            "user_id": str(project_api["target"].id),
            "role_ids": [str(role.id)],
        },
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "project.member_company_mismatch"
    # The company rule comes before the zero-role rule, after existence.
    mismatch_first = client.post(
        url, json={"user_id": str(users["other_company"].id)}
    )
    assert mismatch_first.json()["error"]["code"] == (
        "project.member_company_mismatch"
    )
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
    assert users["other_company"].id not in joined
    assert project_api["target"].id not in joined

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


def test_non_admin_without_company_cannot_add_anyone(
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
        username="cand.companyless_target",
        email="cand.companyless_target@demo.example",
        name_zh="候選",
        company_id=company.id,
    )
    db_session.commit()
    refused = project_api["actor_client"].post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(member.id), "role_ids": [str(role.id)]},
    )
    assert refused.status_code == 422
    assert refused.json()["error"]["code"] == "project.member_company_mismatch"


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
