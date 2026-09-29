"""Admin management API checks, including first-user attribution."""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.auth.login import authenticate
from app.auth.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    verify_password,
)
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import AuditLog, User, UserPassword
from app.services.audit import InvalidAuditEventShapeError
from app.services.users import create_user
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
        "user.admin_changed",
        "user.password_set",
    }


def test_aut_ac61_default_user_password_and_change_gate(
    admin_client, db_session, make_client
):
    client, _admin = admin_client
    response = client.post(
        "/api/v1/users",
        json={
            "username": "temporary.user",
            "email": "temporary@demo.example",
            "name_zh": "臨時密碼使用者",
        },
    )
    assert response.status_code == 201
    body = response.json()
    password = body.pop("temporary_password")
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
    assert [event.event_type for event in events] == ["user.password_set"]

    user = db_session.get(User, user_id)
    assert authenticate(db_session, user.email, password) is user
    _, token = create_session(db_session, user)
    db_session.commit()
    temporary_client = make_client()
    temporary_client.cookies.set(SESSION_COOKIE_NAME, token)
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
        item["id"] for item in client.get("/api/v1/companies").json()
    }
    duplicate_company = client.post(
        "/api/v1/companies", json={"name": "示範公司"}
    )
    assert duplicate_company.status_code == 422
    assert duplicate_company.json()["error"]["code"] == (
        "company.name_conflict"
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
    inactive_company = client.post(
        "/api/v1/users",
        json={
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
            "username": "old.name",
            "email": "old@demo.example",
            "name_zh": "本地人員",
        },
    )
    user_id = created.json()["id"]
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
            json={"username": username, "email": email, "name_zh": "第二位"},
        )
        assert response.status_code == 422
        assert response.json()["error"]["code"] == expected
    company = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    assert company.status_code == 201
    duplicate = client.post("/api/v1/companies", json={"name": "示範公司甲"})
    assert duplicate.status_code == 422
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
    assert employee_conflict.status_code == 422
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
        raise ValueError("program error")

    monkeypatch.setattr("app.api.v1.companies.create_company", broken_company)
    failed = error_client.post("/api/v1/companies", json={"name": "示範公司"})
    assert failed.status_code == 500
    assert failed.json()["error"]["code"] == "server.internal_error"
