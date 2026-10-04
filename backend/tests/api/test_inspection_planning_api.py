"""Inspection planning HTTP contracts (IP-AC01 through IP-AC11)."""

from uuid import UUID

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
)
from tests.db.conftest import create_root_user_with_company


def _client(make_client, token):
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


def _planning_world(db_session, make_client):
    admin = create_root_user_with_company(db_session, "PLAN-API-ADMIN")
    admin.is_admin = True
    field_user = create_root_user_with_company(db_session, "PLAN-API-FIELD")
    outsider = create_root_user_with_company(db_session, "PLAN-API-OUT")
    project = Project(
        project_code="PLAN-API-1",
        name="示範專案",
        client_name="示範業主",
        site_location="示範工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role = Role(
        name="API field inspector",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[
            RolePermission(code="inspection_task.inspect"),
        ],
    )
    manager_role = Role(
        name="API planning manager",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[
            RolePermission(code=code)
            for code in (
                "inspection_plan.read",
                "inspection_plan.create",
                "inspection_plan.manage",
                "inspection_plan.archive",
                "inspection_plan.unarchive",
                "inspection_task.read",
                "inspection_task.manage",
                "inspection_task.create",
                "inspection_task.dispatch",
                "inspection_task.assign",
                "inspection_task.inspect",
                "inspection_task.delete_draft",
                "inspection_task.cancel",
                "project_zone.read",
                "project_zone.manage",
                "project_inspection_item.edit",
            )
        ],
    )
    db_session.add_all([project, role, manager_role])
    db_session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=field_user.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    manager_member = ProjectMember(
        project_id=project.id,
        user_id=admin.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=manager_role.id)],
    )
    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="表面檢查",
        instruction="確認表面狀況",
        source_template_name="示範範本",
        applied_at=admin.created_at,
        created_by=admin.id,
        updated_by=admin.id,
    )
    item_two = ProjectInspectionItem(
        project_id=project.id,
        sequence=2,
        title="鋼筋檢查",
        instruction="確認鋼筋間距",
        source_template_name="示範範本",
        applied_at=admin.created_at,
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add_all([member, manager_member, item, item_two])
    db_session.commit()
    tokens = {
        "admin": create_session(db_session, admin)[1],
        "field": create_session(db_session, field_user)[1],
        "outsider": create_session(db_session, outsider)[1],
    }
    db_session.commit()
    return {
        "admin": _client(make_client, tokens["admin"]),
        "field": _client(make_client, tokens["field"]),
        "outsider": _client(make_client, tokens["outsider"]),
        "field_user": field_user,
        "admin_user": admin,
        "project": project,
        "item": item,
        "item_two": item_two,
    }


def test_plan_task_authorization_cursor_and_draft_visibility(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    field = world["field"]
    base = f"/api/v1/projects/{project.id}/inspection-plans"

    first = admin.post(base, json={"name": "計畫一"})
    second = admin.post(base, json={"name": "計畫二"})
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["status"] == "DRAFT"
    assert "tasks" not in first.json()

    page = admin.get(base, params={"limit": 1})
    assert page.status_code == 200, page.text
    assert len(page.json()["items"]) == 1
    assert page.json()["next_cursor"]
    next_page = admin.get(
        base,
        params={"limit": 1, "cursor": page.json()["next_cursor"]},
    )
    assert next_page.status_code == 200, next_page.text
    assert len(next_page.json()["items"]) == 1
    assert next_page.json()["next_cursor"] is None
    invalid_cursor = admin.get(base, params={"cursor": "not-a-cursor"})
    assert invalid_cursor.status_code == 422
    assert invalid_cursor.json() == {
        "error": {"code": "request.validation_failed"}
    }
    assert (
        admin.post(
            base, json={"name": "非法狀態", "status": "COMPLETED"}
        ).json()["error"]["code"]
        == "request.validation_failed"
    )
    assert (
        world["outsider"].post(base, json={"name": "無權限"}).status_code
        == 403
    )

    zone_response = admin.post(
        f"/api/v1/projects/{project.id}/zones", json={"name": "北區"}
    )
    assert zone_response.status_code == 201, zone_response.text
    zone = zone_response.json()
    duplicate_zone = admin.post(
        f"/api/v1/projects/{project.id}/zones", json={"name": " 北區 "}
    )
    assert duplicate_zone.status_code == 409
    assert (
        duplicate_zone.json()["error"]["code"] == "project_zone.name_conflict"
    )
    blank_zone = admin.post(
        f"/api/v1/projects/{project.id}/zones", json={"name": "   "}
    )
    assert blank_zone.status_code == 422
    plan_id = first.json()["id"]
    task_response = admin.post(
        f"/api/v1/inspection-plans/{plan_id}/tasks",
        json={
            "item_ids": [
                str(world["item"].id),
                str(world["item_two"].id),
            ],
            "suggested_assignee_id": str(world["field_user"].id),
            "zone_id": zone["id"],
            "location_text": "地下室",
        },
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()
    task_id = task["id"]
    assert task["status"] == "DRAFT"
    assert task["zone"] == {"id": zone["id"], "name": "北區"}
    assert task["items"][0]["current_snapshot"]["title"] == "表面檢查"
    assert len(task["items"]) == 2

    detail_url = f"/api/v1/inspection-tasks/{task_id}"
    hidden = field.get(detail_url)
    assert hidden.status_code == 404
    assert hidden.json() == {"error": {"code": "inspection_task.not_found"}}
    listing = field.get(f"/api/v1/projects/{project.id}/inspection-tasks")
    assert listing.status_code == 200, listing.text
    assert listing.json()["items"] == []
    foreign_project = Project(
        project_code="PLAN-API-FOREIGN",
        name="其他專案",
        client_name="其他業主",
        site_location="其他工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign_project)
    db_session.flush()
    foreign_item = ProjectInspectionItem(
        project_id=foreign_project.id,
        sequence=1,
        title="其他專案項目",
        instruction="其他專案說明",
        source_template_name="其他範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign_item)
    db_session.commit()
    cross_project = admin.get(
        f"/api/v1/projects/{project.id}/inspection-items/"
        f"{foreign_item.id}/tasks"
    )
    assert cross_project.status_code == 404
    assert cross_project.json() == {"error": {"code": "resource.not_found"}}
    impact = admin.get(
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}/tasks"
    )
    assert impact.status_code == 200, impact.text
    assert impact.json()["items"][0]["plan_name"] == "計畫一"
    assert impact.json()["items"][0]["plan_archived"] is False
    assert impact.json()["items"][0]["has_result"] is False
    missing_item_tasks = admin.get(
        f"/api/v1/projects/{project.id}/inspection-items/"
        "00000000-0000-7000-8000-000000000000/tasks"
    )
    assert missing_item_tasks.status_code == 404
    candidates = admin.get(
        f"/api/v1/projects/{project.id}/inspection-task-assignees"
    )
    assert candidates.status_code == 200, candidates.text
    assert world["field_user"].id in [
        UUID(person["id"]) for person in candidates.json()["items"]
    ]

    dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
    assert dispatched.status_code == 200, dispatched.text
    visible = field.get(detail_url)
    assert visible.status_code == 200, visible.text
    assert visible.json()["status"] == "PENDING"
    assert visible.json()["zone"]["name"] == "北區"
    listed = field.get(f"/api/v1/projects/{project.id}/inspection-tasks")
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()["items"]] == [task_id]

    changed_location = admin.patch(
        detail_url,
        json={"zone_id": zone["id"], "location_text": "一樓"},
    )
    assert changed_location.status_code == 200, changed_location.text
    assert changed_location.json()["location_text"] == "一樓"
    assert (
        field.get(f"/api/v1/inspection-tasks/{task_id}").json()["status"]
        == "PENDING"
    )
    assert (
        admin.delete(
            f"/api/v1/projects/{project.id}/zones/{zone['id']}"
        ).json()["error"]["code"]
        == "project_zone.in_use"
    )


def test_project_item_change_requires_choice_and_returns_task_actions(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "標準修改計畫"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    )
    assert task.status_code == 201, task.text

    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    missing_choice = admin.patch(item_url, json={"title": "新標準"})
    assert missing_choice.status_code == 422
    assert missing_choice.json() == {
        "error": {
            "code": "project_inspection_item.reinspection_choice_required"
        }
    }
    updated = admin.patch(
        item_url, json={"title": "新標準", "reinspect": True}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "新標準"
    assert updated.json()["reinspection_selected"] is True
    assert updated.json()["affected_tasks"] == [
        {
            "task_id": task.json()["id"],
            "prior_status": "DRAFT",
            "status": "DRAFT",
            "action": "draft_updated",
            "needs_reinspection": False,
        }
    ]
    db_session.expire_all()
    task_model = db_session.get(InspectionTask, UUID(task.json()["id"]))
    assert task_model is not None
    assert task_model.status == "DRAFT"


def test_task_lifecycle_completion_archiving_and_assignment_are_api_gated(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    field = world["field"]
    plan_url = f"/api/v1/projects/{project.id}/inspection-plans"
    plan = admin.post(plan_url, json={"name": "狀態計畫"})
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]
    task_url = f"/api/v1/inspection-plans/{plan_id}/tasks"
    create = admin.post(
        task_url,
        json={
            "item_ids": [str(world["item"].id)],
            "suggested_assignee_id": str(world["admin_user"].id),
        },
    )
    assert create.status_code == 201, create.text
    task_id = create.json()["id"]
    assert (
        admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch").status_code
        == 200
    )
    started = field.post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    assert started.json()["started_by"] == str(world["field_user"].id)
    completed = field.post(f"/api/v1/inspection-tasks/{task_id}:complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["completed_by"] == str(world["field_user"].id)
    assert completed.json()["assignee_id"] == str(world["admin_user"].id)
    plan_detail = admin.get(f"/api/v1/inspection-plans/{plan_id}")
    assert plan_detail.json()["status"] == "COMPLETED"
    assert len(plan_detail.json()["tasks"]) == 1
    completed_cancel = admin.post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "不應允許"},
    )
    assert completed_cancel.status_code == 409
    assert (
        completed_cancel.json()["error"]["code"]
        == "inspection_task.invalid_transition"
    )

    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    reopened = admin.patch(
        item_url, json={"title": "標準變更", "reinspect": True}
    )
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["affected_tasks"][0]["action"] == (
        "returned_to_in_progress"
    )
    assert (
        admin.get(f"/api/v1/inspection-plans/{plan_id}").json()["status"]
        == "IN_PROGRESS"
    )
    corrected = admin.patch(
        item_url, json={"instruction": "只修正文案", "reinspect": False}
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["affected_tasks"][0]["status"] == "IN_PROGRESS"

    cancelled = admin.post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "工作區調整"},
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["cancelled_from"] == "IN_PROGRESS"
    restored = admin.post(f"/api/v1/inspection-tasks/{task_id}:restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "IN_PROGRESS"

    draft = admin.post(
        task_url,
        json={"item_ids": [str(world["item_two"].id)]},
    )
    assert draft.status_code == 201, draft.text
    assert (
        admin.get(f"/api/v1/inspection-plans/{plan_id}").json()["status"]
        == "IN_PROGRESS"
    )
    delete_draft = admin.delete(
        f"/api/v1/inspection-tasks/{draft.json()['id']}"
    )
    assert delete_draft.status_code == 204
    assert (
        admin.get(f"/api/v1/inspection-plans/{plan_id}").json()["status"]
        == "IN_PROGRESS"
    )
    archived = admin.post(f"/api/v1/inspection-plans/{plan_id}:archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "ARCHIVED"
    restored_plan = admin.post(f"/api/v1/inspection-plans/{plan_id}:unarchive")
    assert restored_plan.status_code == 200
    assert restored_plan.json()["status"] == "IN_PROGRESS"
    missing_reason = admin.post(f"/api/v1/inspection-tasks/{task_id}:cancel")
    assert missing_reason.status_code == 422
    assert (
        missing_reason.json()["error"]["code"]
        == "inspection_task.reason_required"
    )


def test_project_item_api_refreshes_task_snapshot_and_respects_archived_plan(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "快照計畫"},
    )
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    )
    task_id = task.json()["id"]
    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    world["item"].title = "來源資料更新"
    db_session.commit()
    unchanged_snapshot = admin.get(f"/api/v1/inspection-tasks/{task_id}")
    assert unchanged_snapshot.status_code == 200
    assert (
        unchanged_snapshot.json()["items"][0]["current_snapshot"]["title"]
        == "表面檢查"
    )
    corrected = admin.patch(
        item_url,
        json={
            "title": "文字更正",
            "reinspect": False,
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "表面",
                    "instruction": "檢視表面",
                    "text_standard": {"text": "無裂縫"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ],
        },
    )
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["affected_tasks"][0]["action"] == "draft_updated"
    refreshed = admin.get(f"/api/v1/inspection-tasks/{task_id}").json()
    assert refreshed["items"][0]["current_snapshot"]["title"] == "文字更正"
    assert refreshed["items"][0]["current_snapshot"]["inspection_points"][0][
        "text_standard"
    ] == {"text": "無裂縫"}

    archived = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}:archive"
    )
    assert archived.status_code == 200
    rejected = admin.patch(
        item_url, json={"title": "封存中修改", "reinspect": False}
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "inspection_plan.archived"
