"""IP-AC18、IP-AC19：專案進度清單與唯讀詳情契約。"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import event, select

from app.db.engine import get_engine
from app.models import InspectionPlan, InspectionTask, TaskInspectionItem
from tests.api.test_inspection_planning_api import _planning_world
from tests.api.test_project_workflow_summary import _grant_permission


def test_progress_filters_cursor_summary_and_detail(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    prefix = f"/api/v1/projects/{project_id}/inspection-tasks"
    plan_ids = []
    for name in ("使用中", "已封存"):
        response = admin.post(
            f"/api/v1/projects/{project_id}/inspection-plans",
            json={"name": name},
        )
        assert response.status_code == 201, response.text
        plan_ids.append(response.json()["id"])

    statuses = (
        "DRAFT",
        "PENDING",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
        "PENDING",
    )
    identifiers = []
    for index in range(len(statuses)):
        plan_id = plan_ids[1] if index == 5 else plan_ids[0]
        response = admin.post(
            f"/api/v1/inspection-plans/{plan_id}/tasks",
            json={
                "item_ids": [str(world["item"].id), str(world["item_two"].id)],
                "suggested_assignee_id": None,
                "zone_id": None,
                "location_text": None,
            },
        )
        assert response.status_code == 201, response.text
        identifiers.append(UUID(response.json()["id"]))

    base_time = datetime(2026, 10, 1, tzinfo=UTC)
    for index, task_id in enumerate(identifiers):
        task = db_session.get(InspectionTask, task_id)
        assert task is not None
        task.status = statuses[index]
        if statuses[index] == "CANCELLED":
            task.cancelled_from_status = "PENDING"
            task.cancellation_reason = "停止查核"
        task.created_at = base_time + timedelta(minutes=index)
        task.dispatched_at = (
            None
            if index == 0
            else base_time + timedelta(hours=1 if index == 2 else index)
        )
        if index in (2, 3):
            task.started_by = world["field_user"].id
        if index == 3:
            task.completed_by = world["field_user_two"].id
        if index in (1, 2, 5):
            item = db_session.scalar(
                select(TaskInspectionItem).where(
                    TaskInspectionItem.task_id == task_id
                )
            )
            assert item is not None
            item.needs_reinspection = True
    archived = db_session.get(InspectionPlan, UUID(plan_ids[1]))
    assert archived is not None
    archived.is_archived = True
    db_session.commit()

    summary = admin.get(f"/api/v1/projects/{project_id}/workflow-summary")
    assert summary.status_code == 200, summary.text
    expected_counts = summary.json()["task_counts"]
    for status, count in expected_counts.items():
        response = admin.get(prefix, params={"status": status})
        assert response.status_code == 200, response.text
        assert len(response.json()["items"]) == count
    assert sum(expected_counts.values()) == len(identifiers)

    recheck = admin.get(prefix, params={"needs_reinspection": "true"})
    assert recheck.status_code == 200, recheck.text
    assert {row["id"] for row in recheck.json()["items"]} == {
        str(identifiers[1]),
        str(identifiers[2]),
    }
    assert (
        len(recheck.json()["items"])
        == summary.json()["pending_reinspection_task_count"]
    )
    empty = admin.get(
        prefix,
        params={
            "status": "COMPLETED",
            "needs_reinspection": "true",
        },
    )
    assert empty.status_code == 200
    assert empty.json()["items"] == []
    for params in (
        {"status": "BOGUS"},
        {"needs_reinspection": "false"},
    ):
        invalid = admin.get(prefix, params=params)
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == ("request.validation_failed")

    expected = [
        identifiers[5],
        identifiers[4],
        identifiers[3],
        *sorted((identifiers[1], identifiers[2]), reverse=True),
        identifiers[0],
    ]
    seen = []
    cursor = None
    while True:
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        response = admin.get(prefix, params=params)
        assert response.status_code == 200, response.text
        seen.extend(UUID(row["id"]) for row in response.json()["items"])
        cursor = response.json()["next_cursor"]
        if not cursor:
            break
        mixed = admin.get(
            prefix,
            params={
                "status": "PENDING",
                "cursor": cursor,
            },
        )
        assert mixed.status_code == 422
    assert seen == expected
    first = admin.get(prefix, params={"limit": 1}).json()["items"][0]
    contract = json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/admin/progress/fixtures"
            / "project-progress-contract.json"
        ).read_text(encoding="utf-8")
    )
    assert first["plan"] == {
        "id": plan_ids[1],
        "name": "已封存",
        "archived": True,
    }
    assert set(first["plan"]) == set(contract["plan_keys"])
    assert first["item_summary"] == contract["item_summary"]
    assert (
        world["field"]
        .get(
            prefix,
            params={
                "status": "DRAFT",
            },
        )
        .json()["items"]
        == []
    )

    _grant_permission(
        db_session, world, world["plain_user"], "inspection_task.read"
    )
    detail = world["plain"].get(f"/api/v1/inspection-tasks/{identifiers[3]}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["plan"]["name"] == "使用中"
    assert detail.json()["started_by_user"] == {
        "id": str(world["field_user"].id),
        "name_zh": world["field_user"].name_zh,
    }
    assert detail.json()["completed_by_user"] == {
        "id": str(world["field_user_two"].id),
        "name_zh": world["field_user_two"].name_zh,
    }
    assert set(detail.json()["started_by_user"]) == set(contract["actor_keys"])
    assert set(detail.json()["completed_by_user"]) == set(
        contract["actor_keys"]
    )
    assert (
        world["field"]
        .get(f"/api/v1/inspection-tasks/{identifiers[3]}")
        .status_code
        == 403
    )

    def select_count(limit):
        statements = []

        def record(conn, cursor, statement, parameters, context, many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", record)
        try:
            response = admin.get(prefix, params={"limit": limit})
            assert response.status_code == 200, response.text
            assert len(response.json()["items"]) == limit
        finally:
            event.remove(engine, "before_cursor_execute", record)
        assert statements
        return len(statements)

    assert select_count(4) == select_count(6)
