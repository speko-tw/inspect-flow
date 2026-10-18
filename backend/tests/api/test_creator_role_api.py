"""建立者角色設定 API 的 DOM-R64 契約測試。"""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import AuditLog, CreatorRoleSetting, Role, User
from tests.db.conftest import create_root_user_with_company

_REQUIRED_CODES = [
    "project.update",
    "project_member.manage",
    "project.read",
]


@pytest.fixture
def creator_role_admin(db_session, make_client) -> tuple[TestClient, User]:
    admin = create_root_user_with_company(db_session, "CR-ADMIN")
    admin.is_admin = True
    _, token = create_session(db_session, admin)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client, admin


def _create_role(client: TestClient, name: str, codes: list[str]) -> str:
    response = client.post(
        "/api/v1/roles",
        json={"name": name, "permission_codes": codes},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _set_creator_role(db_session, role_id: str) -> None:
    db_session.add(CreatorRoleSetting(role_id=UUID(role_id)))
    db_session.commit()


def test_creator_role_read_returns_current_role(
    creator_role_admin, db_session
):
    client, _admin = creator_role_admin
    role_id = _create_role(client, "Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, role_id)

    response = client.get("/api/v1/roles/creator-role")

    assert response.status_code == 200
    assert response.json() == {"role_id": role_id}


def test_creator_role_change_updates_setting_and_audits_once(
    creator_role_admin, db_session
):
    client, admin = creator_role_admin
    current_id = _create_role(client, "Current Creator", _REQUIRED_CODES)
    next_id = _create_role(client, "Next Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, current_id)

    response = client.patch(
        "/api/v1/roles/creator-role", json={"role_id": next_id}
    )

    assert response.status_code == 200
    assert response.json() == {"role_id": next_id}
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == next_id
    events = db_session.scalars(
        select(AuditLog).where(AuditLog.event_type == "creator_role.changed")
    ).all()
    assert len(events) == 1
    assert events[0].created_by == admin.id
    assert events[0].before == {"creator_role_id": current_id}
    assert events[0].after == {"creator_role_id": next_id}

    repeated = client.patch(
        "/api/v1/roles/creator-role", json={"role_id": next_id}
    )

    assert repeated.status_code == 200
    assert (
        len(
            db_session.scalars(
                select(AuditLog).where(
                    AuditLog.event_type == "creator_role.changed"
                )
            ).all()
        )
        == 1
    )


@pytest.mark.parametrize("missing_code", _REQUIRED_CODES)
def test_creator_role_change_rejects_missing_required_permission(
    creator_role_admin, db_session, missing_code: str
):
    client, _admin = creator_role_admin
    current_id = _create_role(client, "Current Creator", _REQUIRED_CODES)
    candidate_codes = [
        code for code in _REQUIRED_CODES if code != missing_code
    ]
    candidate_id = _create_role(client, "Incomplete Creator", candidate_codes)
    _set_creator_role(db_session, current_id)
    before_events = db_session.scalars(
        select(AuditLog).where(AuditLog.event_type == "creator_role.changed")
    ).all()

    response = client.patch(
        "/api/v1/roles/creator-role", json={"role_id": candidate_id}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == (
        "role.creator_role_requires_permissions"
    )
    db_session.expire_all()
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == current_id
    after_events = db_session.scalars(
        select(AuditLog).where(AuditLog.event_type == "creator_role.changed")
    ).all()
    assert after_events == before_events


def test_creator_role_change_rejects_nonexistent_role_without_changes(
    creator_role_admin, db_session
):
    client, _admin = creator_role_admin
    current_id = _create_role(client, "Current Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, current_id)
    before_events = db_session.scalars(select(AuditLog)).all()

    response = client.patch(
        "/api/v1/roles/creator-role",
        json={"role_id": "00000000-0000-7000-8000-000000000001"},
    )

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "creator_role.invalid"}}
    db_session.expire_all()
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == current_id
    assert db_session.scalars(select(AuditLog)).all() == before_events


def test_creator_role_change_requires_role_id_without_changes(
    creator_role_admin, db_session
):
    client, _admin = creator_role_admin
    current_id = _create_role(client, "Current Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, current_id)
    before_events = db_session.scalars(select(AuditLog)).all()

    response = client.patch("/api/v1/roles/creator-role", json={})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "request.validation_failed"
    db_session.expire_all()
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == current_id
    assert db_session.scalars(select(AuditLog)).all() == before_events


def test_creator_role_delete_guard_still_rejects_and_preserves_data(
    creator_role_admin, db_session
):
    client, _admin = creator_role_admin
    role_id = _create_role(client, "Current Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, role_id)
    before_events = db_session.scalars(select(AuditLog)).all()

    response = client.delete(f"/api/v1/roles/{role_id}")

    assert response.status_code == 422
    assert response.json() == {"error": {"code": "role.creator_role_in_use"}}
    assert db_session.get(Role, UUID(role_id)) is not None
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == role_id
    assert db_session.scalars(select(AuditLog)).all() == before_events


def test_role_flags_are_readable_and_admin_editable(creator_role_admin):
    client, _admin = creator_role_admin
    role_id = _create_role(client, "External Reader", ["project.read"])

    before = client.get(f"/api/v1/roles/{role_id}")
    updated = client.patch(
        f"/api/v1/roles/{role_id}",
        json={"is_assignable": True, "is_external_allowed": True},
    )
    fetched = client.get(f"/api/v1/roles/{role_id}")

    assert before.status_code == 200
    assert before.json()["is_assignable"] is False
    assert before.json()["is_external_allowed"] is False
    assert updated.status_code == 200
    assert updated.json()["is_assignable"] is True
    assert updated.json()["is_external_allowed"] is True
    assert fetched.json() == updated.json()


def test_creator_role_cannot_be_marked_external(
    creator_role_admin, db_session
):
    client, _admin = creator_role_admin
    role_id = _create_role(client, "Creator", _REQUIRED_CODES)
    _set_creator_role(db_session, role_id)
    before_events = db_session.scalars(
        select(AuditLog).where(AuditLog.entity_id == UUID(role_id))
    ).all()

    response = client.patch(
        f"/api/v1/roles/{role_id}", json={"is_external_allowed": True}
    )

    assert response.status_code == 422
    assert response.json() == {
        "error": {"code": "role.external_allowed_invalid"}
    }
    role = db_session.get(Role, UUID(role_id))
    assert role is not None
    assert role.is_external_allowed is False
    assert (
        db_session.scalars(
            select(AuditLog).where(AuditLog.entity_id == UUID(role_id))
        ).all()
        == before_events
    )


def test_non_admin_cannot_read_or_change_creator_role(
    creator_role_admin, db_session, make_client
):
    admin_client, admin = creator_role_admin
    current_id = _create_role(admin_client, "Current Creator", _REQUIRED_CODES)
    candidate_id = _create_role(
        admin_client, "Candidate Creator", _REQUIRED_CODES
    )
    _set_creator_role(db_session, current_id)
    user = create_root_user_with_company(db_session, "CR-USER")
    _, token = create_session(db_session, user)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    before_events = db_session.scalars(select(AuditLog)).all()

    read = client.get("/api/v1/roles/creator-role")
    update = client.patch(
        "/api/v1/roles/creator-role", json={"role_id": candidate_id}
    )

    assert read.status_code == 403
    assert update.status_code == 403
    assert read.json() == {"error": {"code": "permission.denied"}}
    assert update.json() == {"error": {"code": "permission.denied"}}
    db_session.expire_all()
    setting = db_session.scalar(select(CreatorRoleSetting))
    assert setting is not None
    assert str(setting.role_id) == current_id
    assert db_session.scalars(select(AuditLog)).all() == before_events
    assert admin.is_admin
