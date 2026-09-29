"""Admin management API checks, including first-user attribution."""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import AuditLog, User, UserPassword
from tests.db.conftest import create_root_user_with_company


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
            "username": "first.user",
            "email": "first@demo.example",
            "name_zh": "示範使用者",
            "is_admin": True,
        },
    )
    assert response.status_code == 201
    body = response.json()
    password = body.pop("temporary_password")
    assert len(password) >= 8
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
        "user.admin_changed",
        "user.password_set",
    }


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
        item["id"] for item in client.get("/api/v1/companies").json()
    }
    assert (
        client.post("/api/v1/companies", json={"name": "示範公司"}).status_code
        == 422
    )

    created = client.post(
        "/api/v1/users",
        json={
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
    assert (
        client.post(
            "/api/v1/users",
            json={
                "username": "second.user",
                "email": "second@demo.example",
                "name_zh": "第二位",
                "company_id": company_id,
            },
        ).status_code
        == 422
    )
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


def test_non_admin_cannot_manage(admin_client, db_session, make_client):
    client, _admin = admin_client
    response = client.post(
        "/api/v1/users",
        json={
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
