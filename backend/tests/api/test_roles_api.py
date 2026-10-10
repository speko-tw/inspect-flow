"""Role-management HTTP API tests (DOM-R55, DOM-AC47~DOM-AC49)."""

from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    User,
)
from tests.db.conftest import create_root_user_with_company


@pytest.fixture
def role_admin_client(db_session, make_client) -> tuple[TestClient, User]:
    admin = create_root_user_with_company(db_session, "ROLE-API-ADMIN")
    admin.is_admin = True
    _, token = create_session(db_session, admin)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client, admin


def _role_payload(name: str, codes: list[str] | None = None) -> dict:
    return {"name": name, "permission_codes": codes or []}


def test_every_role_endpoint_requires_admin(
    db_session, make_client, role_admin_client
):
    _admin_client, admin = role_admin_client
    user = create_root_user_with_company(db_session, "ROLE-API-USER")
    _, token = create_session(db_session, user)
    db_session.flush()
    role = Role(
        name="Authorization fixture",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(role)
    db_session.commit()
    non_admin = make_client()
    non_admin.cookies.set(SESSION_COOKIE_NAME, token)
    anonymous = make_client()
    endpoints = (
        ("get", "/api/v1/roles", None),
        ("get", "/api/v1/roles/permission-codes", None),
        ("get", f"/api/v1/roles/{role.id}", None),
        ("post", "/api/v1/roles", _role_payload("Denied create")),
        ("patch", f"/api/v1/roles/{role.id}", {"name": "Denied"}),
        ("delete", f"/api/v1/roles/{role.id}", None),
    )
    before = (
        db_session.scalar(select(func.count()).select_from(Role)),
        db_session.scalar(select(func.count()).select_from(AuditLog)),
    )

    for method, path, body in endpoints:
        response = anonymous.request(method.upper(), path, json=body)
        assert response.status_code == 401, response.text
        response = non_admin.request(method.upper(), path, json=body)
        assert response.status_code == 403, response.text
        assert response.json() == {"error": {"code": "permission.denied"}}

    db_session.expire_all()
    after = (
        db_session.scalar(select(func.count()).select_from(Role)),
        db_session.scalar(select(func.count()).select_from(AuditLog)),
    )
    assert after == before


def test_role_api_permission_catalog_and_crud_with_audit(
    role_admin_client, db_session, registered_permission_codes
):
    client, admin = role_admin_client

    catalog = client.get("/api/v1/roles/permission-codes")
    assert catalog.status_code == 200
    assert catalog.json() == {
        "items": [
            {"code": "evidence.create", "description": "test"},
            {"code": "evidence.delete", "description": "test"},
            {"code": "evidence.read", "description": "test"},
            {"code": "evidence.update", "description": "test"},
            {"code": "project.use", "description": "test"},
            {"code": "project_member.manage", "description": "test"},
            {"code": "report.approve", "description": "test"},
            {"code": "report.read", "description": "test"},
        ]
    }

    created = client.post(
        "/api/v1/roles",
        json=_role_payload("Inspector", ["report.read"]),
    )
    assert created.status_code == 201
    role = created.json()
    assert role["name"] == "Inspector"
    assert role["permission_codes"] == ["report.read"]
    role_id = role["id"]

    fetched = client.get(f"/api/v1/roles/{role_id}")
    assert fetched.status_code == 200
    assert fetched.json() == role

    duplicate = client.post("/api/v1/roles", json=_role_payload("inspector"))
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": {"code": "role.name_conflict"}}

    other_role = client.post("/api/v1/roles", json=_role_payload("Viewer"))
    assert other_role.status_code == 201
    duplicate_update = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"name": "viewer"},
    )
    assert duplicate_update.status_code == 409
    assert duplicate_update.json() == {"error": {"code": "role.name_conflict"}}

    invalid_code = client.post(
        "/api/v1/roles",
        json=_role_payload("Invalid", ["not.registered"]),
    )
    assert invalid_code.status_code == 422
    assert invalid_code.json() == {
        "error": {"code": "role.permission_code_invalid"}
    }

    invalid_update = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"name": "Must Not Persist", "permission_codes": ["reprot.read"]},
    )
    assert invalid_update.status_code == 422
    assert invalid_update.json() == {
        "error": {"code": "role.permission_code_invalid"}
    }
    invalid_format = client.post(
        "/api/v1/roles",
        json=_role_payload("Invalid Format", ["Report.read"]),
    )
    assert invalid_format.status_code == 422
    assert invalid_format.json() == {
        "error": {"code": "role.permission_code_invalid"}
    }
    duplicate_codes = client.post(
        "/api/v1/roles",
        json=_role_payload("Deduplicated", ["report.read", "report.read"]),
    )
    assert duplicate_codes.status_code == 201
    assert duplicate_codes.json()["permission_codes"] == ["report.read"]
    unchanged = client.get(f"/api/v1/roles/{role_id}")
    assert unchanged.json()["name"] == "Inspector"
    assert unchanged.json()["permission_codes"] == ["report.read"]
    audit_before_update = db_session.scalars(
        select(AuditLog).where(AuditLog.entity_id == UUID(role_id))
    ).all()
    assert [item.event_type for item in audit_before_update] == [
        "role.created"
    ]

    no_op = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"name": "Inspector"},
    )
    assert no_op.status_code == 422
    empty_patch = client.patch(f"/api/v1/roles/{role_id}", json={})
    assert empty_patch.status_code == 422
    assert empty_patch.json() == {
        "error": {"code": "request.validation_failed"}
    }

    updated = client.patch(
        f"/api/v1/roles/{role_id}",
        json={
            "name": "Field Inspector",
            "permission_codes": [
                "report.read",
                "report.approve",
                "report.read",
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Field Inspector"
    assert updated.json()["permission_codes"] == [
        "report.approve",
        "report.read",
    ]

    project = Project(
        project_code="ROLE-API-PROJECT",
        name="示範專案",
        client_name="示範業主",
        site_location="示範地點",
        created_by=admin.id,
        updated_by=admin.id,
    )
    member_user = create_root_user_with_company(db_session, "ROLE-API-MEMBER")
    db_session.add(project)
    db_session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=member_user.id,
        created_by=admin.id,
        updated_by=admin.id,
    )
    member.role_assignments.append(ProjectMemberRole(role_id=UUID(role_id)))
    db_session.add(member)
    db_session.commit()

    deleted = client.delete(f"/api/v1/roles/{role_id}")
    assert deleted.status_code == 204
    assert db_session.get(Role, UUID(role_id)) is None
    db_session.expire_all()
    assert db_session.get(ProjectMember, member.id) is not None
    assert (
        db_session.scalars(
            select(ProjectMemberRole).where(
                ProjectMemberRole.role_id == UUID(role_id)
            )
        ).all()
        == []
    )

    events = list(
        db_session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == UUID(role_id))
            .order_by(AuditLog.created_at)
        ).all()
    )
    assert [event.event_type for event in events] == [
        "role.created",
        "role.updated",
        "role.deleted",
    ]
    assert events[-1].before["project_member_ids"] == [str(member.id)]

    missing = client.get(f"/api/v1/roles/{role_id}")
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "role.not_found"}}


def test_role_api_list_uses_cursor_pagination(role_admin_client):
    client, _admin = role_admin_client

    for name in ("Page A", "Page B", "Page C"):
        response = client.post("/api/v1/roles", json=_role_payload(name))
        assert response.status_code == 201

    catalog = client.get("/api/v1/roles/permission-codes")
    assert catalog.status_code == 200
    assert catalog.json() == {
        "items": [
            {
                "code": "all_project_progress.read",
                "description": "檢視所有專案進度",
            },
            {
                "code": "inspection.use",
                "description": "使用查核模組",
            },
            {
                "code": "inspection_plan.archive",
                "description": "封存查核計畫",
            },
            {
                "code": "inspection_plan.create",
                "description": "建立查核計畫",
            },
            {
                "code": "inspection_plan.manage",
                "description": "管理查核計畫",
            },
            {
                "code": "inspection_plan.read",
                "description": "讀取查核計畫",
            },
            {
                "code": "inspection_plan.unarchive",
                "description": "取消封存查核計畫",
            },
            {
                "code": "inspection_task.assign",
                "description": "指派查核任務",
            },
            {
                "code": "inspection_task.cancel",
                "description": "取消或恢復查核任務",
            },
            {
                "code": "inspection_task.create",
                "description": "建立查核任務",
            },
            {
                "code": "inspection_task.delete_draft",
                "description": "刪除草稿查核任務",
            },
            {
                "code": "inspection_task.dispatch",
                "description": "派出查核任務",
            },
            {
                "code": "inspection_task.inspect",
                "description": "執行現場查核",
            },
            {
                "code": "inspection_task.manage",
                "description": "管理查核任務",
            },
            {
                "code": "inspection_task.read",
                "description": "讀取查核任務",
            },
            {"code": "project.create", "description": "開設專案"},
            {"code": "project.read", "description": "檢視專案"},
            {"code": "project.update", "description": "調整專案"},
            {"code": "project.use", "description": "使用專案模組"},
            {
                "code": "project_inspection_item.edit",
                "description": "編輯專案查核項目",
            },
            {
                "code": "project_inspection_item.read",
                "description": "讀取專案查核項目",
            },
            {
                "code": "project_member.manage",
                "description": "管理專案成員與其角色",
            },
            {
                "code": "project_zone.manage",
                "description": "管理專案分區",
            },
            {
                "code": "project_zone.read",
                "description": "讀取專案分區",
            },
            {"code": "template.manage", "description": "管理範本庫"},
            {"code": "template.use", "description": "使用範本模組"},
        ]
    }

    first = client.get("/api/v1/roles?limit=2")
    assert first.status_code == 200
    assert len(first.json()["items"]) == 2
    assert first.json()["next_cursor"]
    second = client.get(
        "/api/v1/roles",
        params={"limit": 2, "cursor": first.json()["next_cursor"]},
    )
    assert second.status_code == 200
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None
    listed_ids = [
        item["id"]
        for page in (first.json(), second.json())
        for item in page["items"]
    ]
    assert len(set(listed_ids)) == 3
    invalid_cursor = client.get("/api/v1/roles?cursor=not-a-cursor")
    assert invalid_cursor.status_code == 422
    assert invalid_cursor.json() == {
        "error": {"code": "request.validation_failed"}
    }


def test_role_api_cursor_breaks_same_timestamp_ties_by_id(
    role_admin_client, db_session
):
    client, admin = role_admin_client
    created_at = datetime(2026, 9, 30, 12, 0, tzinfo=UTC)
    role_ids = [UUID(int=101), UUID(int=102), UUID(int=103)]
    db_session.add_all(
        Role(
            id=role_id,
            name=f"Same time {index}",
            created_at=created_at,
            updated_at=created_at,
            created_by=admin.id,
            updated_by=admin.id,
        )
        for index, role_id in enumerate(role_ids)
    )
    db_session.commit()

    seen: list[str] = []
    cursor = None
    while True:
        response = client.get(
            "/api/v1/roles",
            params={"limit": 1, **({"cursor": cursor} if cursor else {})},
        )
        assert response.status_code == 200
        page = response.json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert [UUID(item) for item in seen] == role_ids


def test_unknown_integrity_error_is_not_reported_as_name_conflict(
    role_admin_client, monkeypatch
):
    client, _admin = role_admin_client

    def raise_unrecognized_error(*_args, **_kwargs):
        raise IntegrityError(
            "INSERT INTO roles", {}, Exception("FOREIGN KEY constraint failed")
        )

    monkeypatch.setattr(
        "app.api.v1.roles.create_role", raise_unrecognized_error
    )
    unhandled_error_client = TestClient(
        client.app,
        base_url="https://testserver",
        raise_server_exceptions=False,
    )
    unhandled_error_client.cookies.set(
        SESSION_COOKIE_NAME, client.cookies.get(SESSION_COOKIE_NAME)
    )
    response = unhandled_error_client.post(
        "/api/v1/roles", json=_role_payload("Unknown constraint")
    )
    assert response.status_code == 500


def test_role_api_reports_user_and_project_counts(
    role_admin_client, db_session
):
    client, admin = role_admin_client
    held = client.post("/api/v1/roles", json=_role_payload("Held")).json()
    unused = client.post("/api/v1/roles", json=_role_payload("Unused")).json()
    assert (held["user_count"], held["project_count"]) == (0, 0)

    projects = []
    for index in range(2):
        project = Project(
            project_code=f"ROLE-COUNT-{index}",
            name="示範專案",
            client_name="示範業主",
            site_location="示範地點",
            created_by=admin.id,
            updated_by=admin.id,
        )
        db_session.add(project)
        projects.append(project)
    db_session.flush()
    # 三筆成員指派都持有 Held：A、B 在專案 0，A 又在專案 1；
    # 因此是 2 位不重複使用者、2 個專案（同一人跨專案只算 1 人）。
    users = {
        label: create_root_user_with_company(db_session, f"ROLE-COUNT-{label}")
        for label in ("A", "B")
    }
    for project, label in (
        (projects[0], "A"),
        (projects[0], "B"),
        (projects[1], "A"),
    ):
        user = users[label]
        member = ProjectMember(
            project_id=project.id,
            user_id=user.id,
            created_by=admin.id,
            updated_by=admin.id,
        )
        member.role_assignments.append(
            ProjectMemberRole(role_id=UUID(held["id"]))
        )
        db_session.add(member)
    db_session.commit()

    expected = {"user_count": 2, "project_count": 2}
    single = client.get(f"/api/v1/roles/{held['id']}").json()
    assert {key: single[key] for key in expected} == expected
    listed = {
        item["id"]: item
        for item in client.get("/api/v1/roles").json()["items"]
    }
    assert {key: listed[held["id"]][key] for key in expected} == expected
    assert (
        listed[unused["id"]]["user_count"],
        listed[unused["id"]]["project_count"],
    ) == (0, 0)

    renamed = client.patch(
        f"/api/v1/roles/{held['id']}", json={"name": "Held renamed"}
    ).json()
    assert {key: renamed[key] for key in expected} == expected
