"""IP-AC18、IP-AC19：專案進度清單與唯讀詳情契約。"""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from sqlalchemy import event, select

from app.db.engine import get_engine
from app.models import InspectionPlan, InspectionTask, Role, TaskInspectionItem
from tests.api.test_inspection_planning_api import _planning_world
from tests.api.test_planning_query_counts import (
    _create_permission_test_project,
)
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
        "PENDING",
    )
    identifiers = []
    for index in range(len(statuses)):
        plan_id = plan_ids[1] if index == 5 else plan_ids[0]
        response = admin.post(
            f"/api/v1/inspection-plans/{plan_id}/tasks",
            json={
                "name": f"進度任務 {index}",
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
        created_minutes = (40, 1, 180, 240, 300, 400, 120)[index]
        dispatched_minutes = (None, 60, 30, 30, 10, 5, 15)[index]
        task.created_at = base_time + timedelta(minutes=created_minutes)
        task.dispatched_at = (
            None
            if dispatched_minutes is None
            else base_time + timedelta(minutes=dispatched_minutes)
        )
        if index in (2, 3):
            task.started_by = world["field_user"].id
        if index == 3:
            task.completed_by = world["field_user_two"].id
        if index in (1, 2, 5, 6):
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
        str(identifiers[6]),
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
        identifiers[1],
        identifiers[0],
        identifiers[3],
        identifiers[2],
        identifiers[6],
        identifiers[4],
        identifiers[5],
    ]
    # IP-R18：草稿以 created_at 排序，剛好位於頁尾時 cursor 仍須續頁。
    draft_tail = admin.get(prefix, params={"limit": 2})
    assert draft_tail.status_code == 200, draft_tail.text
    assert [UUID(row["id"]) for row in draft_tail.json()["items"]] == [
        identifiers[1],
        identifiers[0],
    ]
    assert draft_tail.json()["items"][-1]["dispatched_at"] is None
    after_draft = admin.get(
        prefix, params={"limit": 2, "cursor": draft_tail.json()["next_cursor"]}
    )
    assert after_draft.status_code == 200, after_draft.text
    assert [UUID(row["id"]) for row in after_draft.json()["items"]] == [
        identifiers[3],
        identifiers[2],
    ]

    seen = []
    cursor = None
    while True:
        params = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        response = admin.get(prefix, params=params)
        assert response.status_code == 200, response.text
        seen.extend(UUID(row["id"]) for row in response.json()["items"])
        cursor = response.json()["next_cursor"]
        if not cursor:
            break
        for filters in (
            {"status": "PENDING"},
            {"needs_reinspection": "true"},
            {"status": "PENDING", "needs_reinspection": "true"},
        ):
            mixed = admin.get(prefix, params={**filters, "cursor": cursor})
            assert mixed.status_code == 422
    assert seen == expected
    for filters, matching in (
        (
            {"status": "PENDING"},
            [identifiers[1], identifiers[6], identifiers[5]],
        ),
        (
            {"needs_reinspection": "true"},
            [identifiers[1], identifiers[2], identifiers[6]],
        ),
        (
            {"status": "PENDING", "needs_reinspection": "true"},
            [identifiers[1], identifiers[6]],
        ),
    ):
        filtered_ids = []
        filtered_cursor = None
        while True:
            params = {**filters, "limit": 1}
            if filtered_cursor:
                params["cursor"] = filtered_cursor
            page = admin.get(prefix, params=params)
            assert page.status_code == 200, page.text
            filtered_ids.extend(
                UUID(row["id"]) for row in page.json()["items"]
            )
            filtered_cursor = page.json()["next_cursor"]
            if filtered_cursor is None:
                break
        assert filtered_ids == matching

    cursor_page = admin.get(prefix, params={"limit": 1}).json()
    for filters in (
        {"status": "PENDING"},
        {"needs_reinspection": "true"},
        {"status": "PENDING", "needs_reinspection": "true"},
    ):
        mismatched = admin.get(
            prefix,
            params={**filters, "cursor": cursor_page["next_cursor"]},
        )
        assert mismatched.status_code == 422

    inspect_role = db_session.scalar(
        select(Role).where(Role.name == "API field inspector")
    )
    assert inspect_role is not None
    _create_permission_test_project(
        world,
        db_session,
        project_code="PROGRESS-FOREIGN",
        role_id=inspect_role.id,
    )
    all_ids = {row["id"] for row in admin.get(prefix).json()["items"]}
    assert all_ids == {str(identifier) for identifier in identifiers}

    archived_row = next(
        row
        for row in admin.get(prefix, params={"status": "PENDING"}).json()[
            "items"
        ]
        if row["id"] == str(identifiers[5])
    )
    contract = json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/admin/progress/fixtures"
            / "project-progress-contract.json"
        ).read_text(encoding="utf-8")
    )
    assert archived_row["plan"] == {
        "id": plan_ids[1],
        "name": "已封存",
        "archived": True,
    }
    assert set(archived_row["plan"]) == set(contract["plan_keys"])
    assert archived_row["item_summary"] == contract["item_summary"]
    assert archived_row["name"] == "進度任務 5"
    assert archived_row["inspection_level"] == "self_inspection"
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
    field_list = world["field"].get(prefix)
    assert field_list.status_code == 200
    assert all(row["status"] != "DRAFT" for row in field_list.json()["items"])
    assert len(field_list.json()["items"]) == len(identifiers) - 1

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
    pending_detail = world["field"].get(
        f"/api/v1/inspection-tasks/{identifiers[1]}"
    )
    assert pending_detail.status_code == 200, pending_detail.text
    assert pending_detail.json()["started_by_user"] is None
    assert pending_detail.json()["completed_by_user"] is None
    assert (
        world["field"]
        .get(f"/api/v1/inspection-tasks/{identifiers[3]}")
        .status_code
        == 200
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
