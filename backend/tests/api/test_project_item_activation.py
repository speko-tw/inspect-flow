"""IP-AC23～26：停用保留任務、權限、名稱與稽核的真 API 驗收。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models import (
    AuditLog,
    InspectionTask,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    UserModulePermission,
)
from tests.api.test_inspection_planning_api import _planning_world
from tests.api.test_project_template_application import _create_templates


@pytest.fixture
def world(db_session, make_client):
    """沿用正式 migration 與登入 cookie，不繞過授權或交易。"""
    return _planning_world(db_session, make_client)


def _path(world, key="item"):
    return (
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world[key].id}"
    )


def _task(world, item_ids=None):
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "停用保留"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "原有草稿",
            "item_ids": item_ids or [str(world["item"].id)],
        },
    )
    assert task.status_code == 201, task.text
    return plan.json()["id"], task.json()


@pytest.mark.parametrize(
    "status", ["DRAFT", "PENDING", "COMPLETED", "CANCELLED"]
)
def test_activation_preserves_existing_tasks_and_snapshots(
    world, db_session, status
):
    """停用／恢復不走 KD-55，不改 Task 或快照的任何內容。"""
    _, task = _task(world)
    stored = db_session.get(InspectionTask, UUID(task["id"]))
    stored.status = status
    if status == "CANCELLED":
        stored.cancelled_from_status = "PENDING"
        stored.cancellation_reason = "暫停施工"
    db_session.commit()
    admin = world["admin"]
    task_path = f"/api/v1/inspection-tasks/{task['id']}"
    before = admin.get(task_path).json()
    path = _path(world)
    for action, active in (("deactivate", False), ("activate", True)):
        response = admin.post(f"{path}:{action}")
        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is active
        assert admin.get(task_path).json() == before
    db_session.expire_all()
    assert world["item"].standard_revision == 1


def test_new_selection_rejected_but_retained_inactive_draft_can_dispatch(
    world,
):
    """可保留舊項目，不能在另一草稿或新增時偷偷選入停用項目。"""
    admin = world["admin"]
    plan_id, task = _task(world)
    _, other = _task(world, [str(world["item_two"].id)])
    assert admin.post(f"{_path(world)}:deactivate").status_code == 200
    url = f"/api/v1/inspection-plans/{plan_id}/tasks"
    rejected = admin.post(
        url,
        json={"name": "不可新選", "item_ids": [str(world["item"].id)]},
    )
    assert rejected.status_code == 409, rejected.text
    assert (
        rejected.json()["error"]["code"] == "project_inspection_item.inactive"
    )
    task_path = f"/api/v1/inspection-tasks/{task['id']}"
    before = admin.get(task_path).json()
    retained = admin.put(
        f"{task_path}/items", json={"item_ids": [str(world["item"].id)]}
    )
    assert retained.status_code == 200, retained.text
    assert admin.get(task_path).json() == before
    rejected = admin.put(
        f"/api/v1/inspection-tasks/{other['id']}/items",
        json={"item_ids": [str(world["item"].id)]},
    )
    assert rejected.status_code == 409, rejected.text
    kept = admin.put(
        f"{task_path}/items",
        json={"item_ids": [str(world[k].id) for k in ("item", "item_two")]},
    )
    assert kept.status_code == 200, kept.text
    assert len(kept.json()["items"]) == 2
    dispatched = admin.post(f"{task_path}:dispatch")
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["status"] == "PENDING"
    assert any(
        row["id"] == str(world["item"].id)
        for row in dispatched.json()["items"]
    )


def test_activation_permissions_module_boundary_and_scope(world, db_session):
    """有 edit 但無 inspection.use 不得切換；Admin 及有效編輯者可切換。"""
    admin_id = world["admin_user"].id
    user_id = world["plain_user"].id
    role = Role(
        name="停用編輯者",
        created_by=admin_id,
        updated_by=admin_id,
        permission_codes=[RolePermission(code="project_inspection_item.edit")],
    )
    db_session.add(role)
    db_session.flush()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.user_id == user_id,
            ProjectMember.project_id == world["project"].id,
        )
    )
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    grant = db_session.scalar(
        select(UserModulePermission).where(
            UserModulePermission.user_id == user_id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    db_session.delete(grant)
    db_session.commit()
    path = _path(world)
    for action in ("deactivate", "activate"):
        for who in ("plain", "field", "outsider"):
            response = world[who].post(f"{path}:{action}")
            assert response.status_code == 403, response.text
        for foreign in (
            path.replace(str(world["project"].id), str(uuid4())),
            path.replace(str(world["item"].id), str(uuid4())),
        ):
            assert (
                world["admin"].post(f"{foreign}:{action}").status_code == 404
            )
    db_session.add(
        UserModulePermission(
            user_id=user_id,
            permission_code="inspection.use",
            source="manual",
        )
    )
    db_session.commit()
    for action in ("deactivate", "activate"):
        response = world["plain"].post(f"{path}:{action}")
        assert response.status_code == 200, response.text


def test_list_filter_inactive_patch_and_name_conflicts(world):
    """停用仍佔名稱；列表可取全體，選用端可只取啟用。"""
    admin = world["admin"]
    path = _path(world)
    assert admin.post(f"{path}:deactivate").status_code == 200
    base = f"/api/v1/projects/{world['project'].id}/inspection-items"
    rows = admin.get(base).json()["items"]
    assert {row["is_active"] for row in rows} == {True, False}
    active = admin.get(f"{base}?active_only=true").json()["items"]
    assert active and all(row["is_active"] for row in active)
    assert str(world["item"].id) not in {row["id"] for row in active}
    rejected = admin.patch(path, json={"instruction": "不可改"})
    assert rejected.status_code == 409, rejected.text
    rejected = admin.patch(
        _path(world, "item_two"), json={"title": world["item"].title}
    )
    assert rejected.status_code == 409, rejected.text
    assert (
        rejected.json()["error"]["code"]
        == "project_inspection_item.inactive_name"
    )
    system_id, template_ids = _create_templates(admin)
    copied = admin.post(
        f"{base}:apply-template", json={"template_id": template_ids[0]}
    )
    assert copied.status_code == 201, copied.text
    copy_path = f"{base}/{copied.json()[0]['id']}"
    assert admin.post(f"{copy_path}:deactivate").status_code == 200
    count = len(admin.get(base).json()["items"])
    for body in ({"template_id": template_ids[0]}, {"system_id": system_id}):
        rejected = admin.post(f"{base}:apply-template", json=body)
        assert rejected.status_code == 409, rejected.text
        assert (
            rejected.json()["error"]["code"]
            == "project_inspection_item.inactive_name"
        )
        assert len(admin.get(base).json()["items"]) == count
    rejected = admin.post(
        f"/api/v1/projects/{world['project'].id}/templates",
        json={
            "project_inspection_item_id": copied.json()[0]["id"],
            "system_id": system_id,
            "name": "另存項目",
        },
    )
    assert rejected.status_code == 409, rejected.text
    assert (
        rejected.json()["error"]["code"]
        == "project_inspection_item.inactive_name"
    )
    assert admin.post(f"{path}:activate").status_code == 200
    assert admin.patch(path, json={"instruction": "可修改"}).status_code == 200


def test_activation_audit_noop_and_atomic_rollback(
    world, db_session, monkeypatch
):
    """真正轉換各一筆事件；重送無副作用；稽核失敗連同旗標回滾。"""
    from app.services import inspection_planning

    admin = world["admin"]
    path = _path(world)
    item_id = world["item"].id

    def count():
        return db_session.scalar(select(func.count()).select_from(AuditLog))

    for action, active in (("deactivate", False), ("activate", True)):
        before_count = count()
        response = admin.post(f"{path}:{action}")
        assert response.status_code == 200, response.text
        event = db_session.scalar(
            select(AuditLog).where(
                AuditLog.entity_id == item_id,
                AuditLog.event_type
                == (
                    "project_inspection_item.reactivated"
                    if active
                    else "project_inspection_item.deactivated"
                ),
            )
        )
        assert event is not None
        assert event.project_id == world["project"].id
        assert event.created_by == world["admin_user"].id
        assert event.before == {
            "is_active": not active,
            "title": world["item"].title,
        }
        assert event.after == {
            "is_active": active,
            "title": world["item"].title,
        }
        assert count() == before_count + 1
        db_session.expire_all()
        updated_at = world["item"].updated_at
        assert admin.post(f"{path}:{action}").status_code == 200
        db_session.expire_all()
        assert count() == before_count + 1
        assert world["item"].updated_at == updated_at

    def fail(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(inspection_planning, "record_audit_event", fail)
    before_count = count()
    with pytest.raises(RuntimeError, match="audit unavailable"):
        admin.post(f"{path}:deactivate")
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item_id).is_active is True
    assert count() == before_count
