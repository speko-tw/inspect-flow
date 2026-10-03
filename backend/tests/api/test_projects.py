"""Project and ProjectMember management API checks."""

from collections.abc import Iterator
from contextlib import contextmanager
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
    assert len(listed.json()) == 4
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
    assert len(first.json()) == 2

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
    assert len(rows) == 10
    assert sum(bool(row["warnings"]) for row in rows) == 2
    assert baseline
    assert len(expanded) == len(baseline)


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
    client = project_api["actor_client"]
    plain_client = project_api["plain_client"]
    project = project_api["project"]
    target = project_api["target"]
    role = project_api["role"]
    assert isinstance(project, Project)
    assert isinstance(target, User)
    assert isinstance(role, Role)
    assert target.company_id is None

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

    replaced = client.put(
        f"/api/v1/projects/{project.id}/members/{target.id}/roles",
        json={"role_ids": []},
    )
    assert replaced.status_code == 200
    assert replaced.json()["role_ids"] == []
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
    assert _audit_field(events[-1].after, "role_ids") == []
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
        json={"user_id": str(target.id)},
    )
    assert added.status_code == 201
    assert added.json()["role_ids"] == []


def test_member_conflict_and_unknown_role_errors(project_api):
    client = project_api["actor_client"]
    project = project_api["project"]
    actor = project_api["actor"]
    assert isinstance(project, Project)
    assert isinstance(actor, User)

    duplicate = client.post(
        f"/api/v1/projects/{project.id}/members",
        json={"user_id": str(actor.id)},
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


def test_member_missing_resources_and_duplicate_roles(project_api):
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
