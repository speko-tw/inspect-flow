"""Shared frontend/backend contract for planning 422 field errors (#451).

The frontend planning section replays the JSON fixtures below in its own
tests to prove it binds each ``fields[].path`` to the right input. This
file sends the matching invalid request to the real API and asserts the
response equals the fixture, so a drift on either side turns a test red.
"""

import json
from pathlib import Path
from uuid import uuid4

from app.api.limits import (
    ITEM_IDS_MAX,
    LOCATION_TEXT_MAX,
    LONG_TEXT_MAX,
    PLANNING_NAME_MAX,
)
from tests.api.test_inspection_planning_api import _planning_world

_FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "frontend/src/admin/planning/fixtures"
)


def _fixture(name: str) -> dict:
    return json.loads((_FIXTURES / name).read_text(encoding="utf-8"))


def _draft_task(world) -> str:
    """Create a plan with one draft task and return the task id."""
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "欄位錯誤契約"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    )
    assert task.status_code == 201, task.text
    return task.json()["id"]


def test_zone_name_too_long_matches_frontend_fixture(db_session, make_client):
    world = _planning_world(db_session, make_client)

    response = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/zones",
        json={"name": "區" * (PLANNING_NAME_MAX + 1)},
    )

    assert response.status_code == 422, response.text
    assert response.json() == _fixture("name-too-long-422.json")


def test_task_create_validation_matches_frontend_fixture(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    plan = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "建立任務契約"},
    )
    assert plan.status_code == 201, plan.text

    response = world["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "item_ids": [str(uuid4()) for _ in range(ITEM_IDS_MAX + 1)],
            "zone_id": "not-a-uuid",
            "location_text": "址" * (LOCATION_TEXT_MAX + 1),
            "suggested_assignee_id": "not-a-uuid",
        },
    )

    assert response.status_code == 422, response.text
    assert response.json() == _fixture("task-create-validation-422.json")


def test_task_location_validation_matches_frontend_fixture(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    task_id = _draft_task(world)

    response = world["admin"].patch(
        f"/api/v1/inspection-tasks/{task_id}",
        json={
            "zone_id": "not-a-uuid",
            "location_text": "址" * (LOCATION_TEXT_MAX + 1),
        },
    )

    assert response.status_code == 422, response.text
    assert response.json() == _fixture("task-location-validation-422.json")


def test_task_assignee_validation_matches_frontend_fixture(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    task_id = _draft_task(world)

    response = world["admin"].post(
        f"/api/v1/inspection-tasks/{task_id}:assign",
        json={"assignee_id": "not-a-uuid"},
    )

    assert response.status_code == 422, response.text
    assert response.json() == _fixture("task-assignee-validation-422.json")


def test_task_cancel_validation_matches_frontend_fixture(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    task_id = _draft_task(world)

    response = world["admin"].post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "因" * (LONG_TEXT_MAX + 1)},
    )

    assert response.status_code == 422, response.text
    assert response.json() == _fixture("task-cancel-validation-422.json")
