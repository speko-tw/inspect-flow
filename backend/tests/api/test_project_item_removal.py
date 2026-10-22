"""#435：未使用項目刪除與專案內改名衝突的 API 驗收。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models import (
    AuditLog,
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    ProjectInspectionPoint,
)
from tests.api.test_inspection_planning_api import _planning_world


def test_delete_unused_item_clears_changes_and_records_audit(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    item = world["item"]
    item_id = item.id
    path = f"/api/v1/projects/{world['project'].id}/inspection-items/{item_id}"
    renamed = world["admin"].patch(path, json={"title": "未使用的新名稱"})
    assert renamed.status_code == 200, renamed.text
    assert (
        db_session.scalar(
            select(func.count()).select_from(ProjectInspectionItemChange)
        )
        == 1
    )
    deleted = world["admin"].delete(path)
    assert deleted.status_code == 204, deleted.text
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item_id) is None
    for model in (ProjectInspectionItemChange, ProjectInspectionPoint):
        assert (
            db_session.scalar(
                select(func.count())
                .select_from(model)
                .where(model.project_inspection_item_id == item_id)
            )
            == 0
        )
    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "project_inspection_item.deleted"
        )
    )
    assert audit is not None
    assert audit.entity_id == item_id
    assert audit.project_id == world["project"].id
    assert audit.before == {
        "project_id": str(world["project"].id),
        "title": "未使用的新名稱",
    }
    assert audit.after is None
    assert world["admin"].delete(path).status_code == 404


@pytest.mark.parametrize("status", ["DRAFT", "CANCELLED", "COMPLETED"])
def test_delete_used_item_rejects_every_task_status(
    db_session, make_client, status
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    item = world["item"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "刪除限制"},
    )
    assert plan.status_code == 201, plan.text
    task_ids = []
    for number in (1, 2):
        task = admin.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={"name": f"引用任務 {number}", "item_ids": [str(item.id)]},
        )
        assert task.status_code == 201, task.text
        task_ids.append(task.json()["id"])
        if status != "DRAFT":
            from app.models import InspectionTask

            stored = db_session.get(InspectionTask, UUID(task.json()["id"]))
            stored.status = status
            if status == "CANCELLED":
                stored.cancelled_from_status = "PENDING"
                stored.cancellation_reason = "停止施工"
            db_session.commit()
    before_count = db_session.scalar(
        select(func.count()).select_from(AuditLog)
    )
    path = f"/api/v1/projects/{world['project'].id}/inspection-items/{item.id}"
    deleted = admin.delete(path)
    assert deleted.status_code == 409, deleted.text
    expected_code = "project_inspection_item.in_use"
    assert deleted.json()["error"] == {
        "code": expected_code,
        "details": ["2"],
    }
    assert (
        db_session.scalar(select(func.count()).select_from(AuditLog))
        == before_count
    )
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item.id) is not None

    if status == "DRAFT":
        # 最新提示指向真正能解除引用的操作：刪除草稿，而非取消。
        for task_id in task_ids:
            response = admin.delete(f"/api/v1/inspection-tasks/{task_id}")
            assert response.status_code == 204, response.text
        assert admin.delete(path).status_code == 204


def test_delete_item_requires_edit_permission_and_project_boundary(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    path = (
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}"
    )
    assert world["field"].delete(path).status_code == 403
    assert world["outsider"].delete(path).status_code == 403
    foreign = path.replace(str(world["project"].id), str(uuid4()))
    assert world["admin"].delete(foreign).status_code == 404
    assert (
        world["admin"]
        .delete(path.replace(str(world["item"].id), str(uuid4())))
        .status_code
        == 404
    )


def test_rename_item_rejects_normalized_duplicate_without_mutation(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    world["item_two"].title = " Pump A "
    db_session.commit()
    item = world["item"]
    path = f"/api/v1/projects/{world['project'].id}/inspection-items/{item.id}"
    before_count = db_session.scalar(
        select(func.count()).select_from(AuditLog)
    )
    rejected = world["admin"].patch(path, json={"title": "  pUmP a  "})
    assert rejected.status_code == 409, rejected.text
    expected_code = "project_inspection_item.duplicate_name"
    assert rejected.json()["error"] == {
        "code": expected_code,
        "details": ["pUmP a"],
    }
    db_session.expire_all()
    assert item.title == "表面檢查"
    assert item.standard_revision == 1
    assert (
        db_session.scalar(select(func.count()).select_from(AuditLog))
        == before_count
    )
    own_name = world["admin"].patch(path, json={"title": " 表面檢查 "})
    assert own_name.status_code == 200, own_name.text


def test_delete_item_audit_failure_rolls_back_all_changes(
    db_session, make_client, monkeypatch
):
    from app.services import inspection_planning

    world = _planning_world(db_session, make_client)
    item_id = world["item"].id
    path = f"/api/v1/projects/{world['project'].id}/inspection-items/{item_id}"
    assert (
        world["admin"].patch(path, json={"title": "保留歷史"}).status_code
        == 200
    )

    def fail_audit(*args, **kwargs):
        raise RuntimeError("audit storage unavailable")

    monkeypatch.setattr(inspection_planning, "record_audit_event", fail_audit)
    with pytest.raises(RuntimeError, match="audit storage unavailable"):
        world["admin"].delete(path)
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item_id) is not None
    assert (
        db_session.scalar(
            select(func.count()).select_from(ProjectInspectionItemChange)
        )
        == 1
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(ProjectInspectionPoint)
            .where(
                ProjectInspectionPoint.project_inspection_item_id == item_id
            )
        )
        == 1
    )


@pytest.mark.parametrize(
    ("current", "title"),
    [
        ("表面檢查", None),
        ("表面檢查", " 表面檢查 "),
        ("表面檢查", "表面檢查"),
        ("Pump A", " pUmP a "),
    ],
)
def test_legacy_duplicate_allows_edits_without_normalized_rename(
    db_session, make_client, current, title
):
    """#435：舊資料同名不能阻擋與名稱無關的修改。"""
    world = _planning_world(db_session, make_client)
    world["item"].title = current
    world["item_two"].title = f" {current} "
    db_session.commit()
    path = (
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}"
    )
    body = {"instruction": "更正既有同名項目的說明"}
    if title is not None:
        body["title"] = title
    response = world["admin"].patch(path, json=body)
    assert response.status_code == 200, response.text
    assert response.json()["instruction"] == body["instruction"]
    assert response.json()["title"] == (title or current).strip()
