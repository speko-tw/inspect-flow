"""Admin audit query contract and stable cursor regression checks."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import AuditLog
from tests.db.conftest import create_root_user_with_company


def test_admin_query_filters_and_descending_cursor(db_session, make_client):
    admin = create_root_user_with_company(db_session, "AUD412A")
    admin.is_admin = True
    other = create_root_user_with_company(db_session, "AUD412B")
    _, token = create_session(db_session, admin)
    project = UUID(int=412)
    another_project = UUID(int=413)
    moment = datetime(2026, 10, 10, 8, 30, tzinfo=UTC)
    rows = [
        (1, project, admin.id, "project_zone.created", moment),
        (2, project, admin.id, "project_zone.created", moment),
        (3, project, admin.id, "project_zone.created", moment),
        (4, another_project, admin.id, "project_zone.created", moment),
        (5, None, admin.id, "role.created", moment),
        (6, project, other.id, "project_zone.created", moment),
        (
            7,
            project,
            admin.id,
            "project_zone.created",
            moment - timedelta(days=1),
        ),
        (8, project, admin.id, "inspection_task.deleted", moment),
        (
            9,
            project,
            admin.id,
            "project_zone.created",
            moment + timedelta(days=1),
        ),
        (
            10,
            project,
            admin.id,
            "project_zone.created",
            moment + timedelta(days=2),
        ),
    ]
    for number, project_id, actor_id, event_type, created_at in rows:
        db_session.add(
            AuditLog(
                id=UUID(int=number),
                created_at=created_at,
                created_by=actor_id,
                project_id=project_id,
                event_type=event_type,
                entity_type=event_type.split(".")[0],
                entity_id=UUID(int=number),
            )
        )
    db_session.commit()

    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    query = {
        "project_id": str(project),
        "actor_id": str(admin.id),
        "event_type": "project_zone.created",
        "from": moment.isoformat(),
        "to": (moment + timedelta(days=1)).isoformat(),
        "limit": 2,
    }
    first = client.get("/api/v1/audit-logs", params=query)
    assert first.status_code == 200
    assert [row["id"] for row in first.json()["items"]] == [
        str(UUID(int=3)),
        str(UUID(int=2)),
    ]
    assert first.json()["items"][0]["project_id"] == str(project)
    assert first.json()["next_cursor"]
    second = client.get(
        "/api/v1/audit-logs",
        params={**query, "cursor": first.json()["next_cursor"]},
    )
    assert second.status_code == 200
    assert [row["id"] for row in second.json()["items"]] == [str(UUID(int=1))]
    assert second.json()["next_cursor"] is None
    unfiltered = client.get("/api/v1/audit-logs", params={"limit": 100})
    assert unfiltered.status_code == 200
    assert {row["id"] for row in unfiltered.json()["items"]} == {
        str(UUID(int=number)) for number in range(1, 11)
    }
    assert any(
        row["id"] == str(UUID(int=5)) and row["project_id"] is None
        for row in unfiltered.json()["items"]
    )
    missing = client.get(
        "/api/v1/audit-logs", params={"project_id": str(UUID(int=999))}
    )
    assert missing.status_code == 200
    assert missing.json() == {"items": [], "next_cursor": None}
    assert db_session.query(AuditLog).count() == len(rows)


def test_audit_query_authentication_and_validation(db_session, make_client):
    admin = create_root_user_with_company(db_session, "AUD412C")
    admin.is_admin = True
    member = create_root_user_with_company(db_session, "AUD412D")
    _, member_token = create_session(db_session, member)
    _, admin_token = create_session(db_session, admin)
    db_session.commit()
    client = make_client()
    assert client.get("/api/v1/audit-logs").status_code == 401
    client.cookies.set(SESSION_COOKIE_NAME, member_token)
    assert client.get("/api/v1/audit-logs").status_code == 403
    client.cookies.set(SESSION_COOKIE_NAME, admin_token)
    invalid = [
        {"project_id": "bad"},
        {"actor_id": "bad"},
        {"cursor": "bad"},
        {"limit": 0},
        {"limit": 101},
        {"event_type": "bad event"},
        {"from": "123"},
        {"from": "2026-10-10T10:00:00+08:00"},
        {"from": "2026-10-11T00:00:00Z", "to": "2026-10-10T00:00:00Z"},
    ]
    for params in invalid:
        response = client.get("/api/v1/audit-logs", params=params)
        assert response.status_code == 422, params
        assert response.json()["error"]["code"] == (
            "request.validation_failed"
        )
