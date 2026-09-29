"""Role-management HTTP API tests (DOM-R55, DOM-AC47~DOM-AC49)."""

from uuid import UUID

from sqlalchemy import select

from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
)
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.db.conftest import create_root_user_with_company


def _login(client, user) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"login": user.email, "password": DEFAULT_TEST_PASSWORD},
    )
    assert response.status_code == 200
    return response.cookies["__Host-inspectflow_session"]


def _role_payload(name: str, codes: list[str] | None = None) -> dict:
    return {"name": name, "permission_codes": codes or []}


def test_role_api_requires_admin(client, db_session):
    anonymous = client.get("/api/v1/roles")
    assert anonymous.status_code == 401, anonymous.text

    user = make_local_user(db_session, "ROLE-API-USER")
    token = _login(client, user)

    response = client.get(
        "/api/v1/roles", cookies={"__Host-inspectflow_session": token}
    )
    assert response.status_code == 403
    assert response.json() == {"error": {"code": "permission.denied"}}


def test_role_api_permission_catalog_and_crud_with_audit(
    client, db_session, registered_permission_codes
):
    admin = make_local_user(db_session, "ROLE-API-ADMIN")
    admin.is_admin = True
    db_session.commit()
    token = _login(client, admin)
    cookies = {"__Host-inspectflow_session": token}

    catalog = client.get("/api/v1/roles/permission-codes", cookies=cookies)
    assert catalog.status_code == 200
    assert catalog.json() == {
        "items": [
            {"code": "evidence.create", "description": "test"},
            {"code": "evidence.delete", "description": "test"},
            {"code": "evidence.read", "description": "test"},
            {"code": "evidence.update", "description": "test"},
            {"code": "report.approve", "description": "test"},
            {"code": "report.read", "description": "test"},
        ]
    }

    created = client.post(
        "/api/v1/roles",
        json=_role_payload("Inspector", ["report.read"]),
        cookies=cookies,
    )
    assert created.status_code == 201
    role = created.json()
    assert role["name"] == "Inspector"
    assert role["permission_codes"] == ["report.read"]
    role_id = role["id"]

    fetched = client.get(f"/api/v1/roles/{role_id}", cookies=cookies)
    assert fetched.status_code == 200
    assert fetched.json() == role

    duplicate = client.post(
        "/api/v1/roles", json=_role_payload("inspector"), cookies=cookies
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": {"code": "role.name_conflict"}}

    other_role = client.post(
        "/api/v1/roles", json=_role_payload("Viewer"), cookies=cookies
    )
    assert other_role.status_code == 201
    duplicate_update = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"name": "viewer"},
        cookies=cookies,
    )
    assert duplicate_update.status_code == 409
    assert duplicate_update.json() == {"error": {"code": "role.name_conflict"}}

    invalid_code = client.post(
        "/api/v1/roles",
        json=_role_payload("Invalid", ["not.registered"]),
        cookies=cookies,
    )
    assert invalid_code.status_code == 422
    assert invalid_code.json() == {
        "error": {"code": "role.permission_code_invalid"}
    }

    invalid_update = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"name": "Must Not Persist", "permission_codes": ["reprot.read"]},
        cookies=cookies,
    )
    assert invalid_update.status_code == 422
    assert invalid_update.json() == {
        "error": {"code": "role.permission_code_invalid"}
    }
    unchanged = client.get(f"/api/v1/roles/{role_id}", cookies=cookies)
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
        cookies=cookies,
    )
    assert no_op.status_code == 422

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
        cookies=cookies,
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

    deleted = client.delete(f"/api/v1/roles/{role_id}", cookies=cookies)
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

    missing = client.get(f"/api/v1/roles/{role_id}", cookies=cookies)
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "role.not_found"}}


def test_role_api_list_uses_cursor_pagination(client, db_session):
    admin = make_local_user(db_session, "ROLE-PAGE-ADMIN")
    admin.is_admin = True
    db_session.commit()
    token = _login(client, admin)
    cookies = {"__Host-inspectflow_session": token}

    for name in ("Page A", "Page B", "Page C"):
        response = client.post(
            "/api/v1/roles", json=_role_payload(name), cookies=cookies
        )
        assert response.status_code == 201

    catalog = client.get("/api/v1/roles/permission-codes", cookies=cookies)
    assert catalog.status_code == 200
    assert catalog.json() == {"items": []}

    first = client.get("/api/v1/roles?limit=2", cookies=cookies)
    assert first.status_code == 200
    assert len(first.json()["items"]) == 2
    assert first.json()["next_cursor"]
    second = client.get(
        "/api/v1/roles",
        params={"limit": 2, "cursor": first.json()["next_cursor"]},
        cookies=cookies,
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
