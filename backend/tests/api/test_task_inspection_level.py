"""IP-AC16：任務於建立時帶入並固定檢查層級（#646）。

``assert_inspection_level_flow`` 也被 PostgreSQL 版本
（``tests/db/test_planning_api_postgresql.py``）重用，讓同一套情境在兩種
資料庫上都驗證。
"""

from typing import Any

from sqlalchemy import select

from app.models import InspectionTask
from tests.api.test_inspection_planning_api import _planning_world


def _create_task(admin, plan_id: str, item_id: Any, **extra: Any):
    return admin.post(
        f"/api/v1/inspection-plans/{plan_id}/tasks",
        json={"item_ids": [str(item_id)], **extra},
    )


def _set_role(admin, project_id: Any, role: str):
    return admin.patch(
        f"/api/v1/projects/{project_id}",
        json={
            "company_role": role,
            "company_role_change_reason": "示範：調整本公司角色",
        },
    )


def assert_inspection_level_flow(db_session, make_client) -> None:
    """IP-AC16：建立時帶入、之後改角色不回改既有任務、建立請求不收此欄。"""
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    item_id = world["item"].id

    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "層級計畫"},
    )
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]

    first = _create_task(admin, plan_id, item_id)
    assert first.status_code == 201, first.text
    assert first.json()["inspection_level"] == "self_inspection"

    changed = _set_role(admin, project_id, "supervisor")
    assert changed.status_code == 200, changed.text
    second = _create_task(admin, plan_id, item_id)
    assert second.status_code == 201, second.text
    assert second.json()["inspection_level"] == "spot_check"

    # 建立請求不得帶此欄；被拒時不留下任何資料。
    before = len(
        db_session.scalars(
            select(InspectionTask).where(
                InspectionTask.project_id == project_id
            )
        ).all()
    )
    rejected = _create_task(
        admin, plan_id, item_id, inspection_level="spot_check"
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json()["error"]["code"] == "request.validation_failed"
    db_session.expire_all()
    after = len(
        db_session.scalars(
            select(InspectionTask).where(
                InspectionTask.project_id == project_id
            )
        ).all()
    )
    assert after == before == 2

    # 專案角色改回去，兩筆任務的層級都不變。
    assert _set_role(admin, project_id, "contractor").status_code == 200
    first_id, second_id = first.json()["id"], second.json()["id"]
    detail = admin.get(f"/api/v1/inspection-plans/{plan_id}")
    assert detail.status_code == 200, detail.text
    levels = {
        task["id"]: task["inspection_level"] for task in detail.json()["tasks"]
    }
    assert levels == {first_id: "self_inspection", second_id: "spot_check"}

    listing = admin.get(f"/api/v1/projects/{project_id}/inspection-tasks")
    assert listing.status_code == 200, listing.text
    assert {
        task["id"]: task["inspection_level"]
        for task in listing.json()["items"]
    } == levels

    # 派出（DRAFT → PENDING）與 KD-55 重新查核、取消、恢復都不改層級。
    assert (
        admin.post(
            f"/api/v1/inspection-tasks/{second_id}:dispatch"
        ).status_code
        == 200
    )
    assert (
        admin.post(
            f"/api/v1/inspection-tasks/{second_id}:cancel",
            json={"reason": "示範取消"},
        ).status_code
        == 200
    )
    restored = admin.post(f"/api/v1/inspection-tasks/{second_id}:restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["inspection_level"] == "spot_check"
    single = admin.get(f"/api/v1/inspection-tasks/{second_id}")
    assert single.status_code == 200, single.text
    assert single.json()["inspection_level"] == "spot_check"


def test_level_is_recorded_at_creation_and_fixed_afterwards(
    db_session, make_client
):
    assert_inspection_level_flow(db_session, make_client)


def test_field_api_does_not_expose_inspection_level(db_session, make_client):
    # Field API 為白名單回應（inspection-planning 介面表）；層級屬內業
    # 欄位，現場畫面不顯示，所以不得多出此欄。
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "現場計畫"},
    )
    task = _create_task(
        admin,
        plan.json()["id"],
        world["item"].id,
        suggested_assignee_id=str(world["field_user"].id),
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]
    assert (
        admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch").status_code
        == 200
    )
    field = world["field"]
    listing = field.get("/api/v1/field/inspection-tasks")
    assert listing.status_code == 200, listing.text
    assert listing.json()["items"], listing.text
    assert all(
        "inspection_level" not in row for row in listing.json()["items"]
    )
    detail = field.get(f"/api/v1/field/inspection-tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    assert "inspection_level" not in detail.json()
