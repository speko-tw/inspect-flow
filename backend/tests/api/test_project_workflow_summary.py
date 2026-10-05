"""Project workflow summary API contract (Issue #446)."""

from sqlalchemy import select

from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    ProjectZone,
    Role,
    RolePermission,
    TaskInspectionItem,
)
from app.permission_codes import PermissionCode
from tests.api.test_inspection_planning_api import _planning_world


def _summary_path(project_id):
    return f"/api/v1/projects/{project_id}/workflow-summary"


def _grant_permission(db_session, world, user, permission: str) -> None:
    admin = world["admin_user"]
    project = world["project"]
    role = Role(
        name=f"summary {permission}",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[RolePermission(code=permission)],
    )
    db_session.add(role)
    db_session.flush()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user.id,
        )
    )
    assert member is not None
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    db_session.commit()


def test_empty_project_reports_first_setup_step(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin_user"]
    empty_project = Project(
        project_code="SUMMARY-EMPTY",
        name="空專案",
        client_name="示範業主",
        site_location="示範工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(empty_project)
    db_session.commit()

    response = world["admin"].get(_summary_path(empty_project.id))
    assert response.status_code == 200, response.text
    assert response.json()["project"] == {
        "id": str(empty_project.id),
        "project_code": "SUMMARY-EMPTY",
        "name": "空專案",
    }
    assert set(response.json()["viewer_permission_codes"]) == {
        code.value for code in PermissionCode
    }
    assert response.json()["primary_step"] == "add_members"
    assert response.json()["next_steps"] == [
        {"code": "add_members", "count": 0, "pending": True},
        {
            "code": "add_inspection_items",
            "count": 0,
            "pending": True,
        },
        {"code": "create_plan", "count": 0, "pending": True},
        {"code": "dispatch_draft_tasks", "count": 0, "pending": False},
        {
            "code": "complete_reinspection",
            "count": 0,
            "pending": False,
        },
    ]


def test_summary_excludes_cancelled_or_archived_rechecks(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin_user"]
    zone = ProjectZone(
        project_id=project.id,
        name="A 區",
        created_by=admin.id,
        updated_by=admin.id,
    )
    plan = InspectionPlan(
        project_id=project.id,
        name="第一計畫",
        created_by=admin.id,
        updated_by=admin.id,
    )
    archived_plan = InspectionPlan(
        project_id=project.id,
        name="封存計畫",
        is_archived=True,
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add_all([zone, plan, archived_plan])
    db_session.flush()

    drafts = [
        InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            status="DRAFT",
            assignee_id=world["field_user"].id,
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            status="DRAFT",
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=archived_plan.id,
            project_id=project.id,
            status="DRAFT",
            created_by=admin.id,
            updated_by=admin.id,
        ),
    ]
    tasks = {
        status: InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            status=status,
            cancelled_from_status="PENDING" if status == "CANCELLED" else None,
            cancellation_reason="測試取消" if status == "CANCELLED" else None,
            created_by=admin.id,
            updated_by=admin.id,
        )
        for status in (
            "PENDING",
            "IN_PROGRESS",
            "COMPLETED",
            "CANCELLED",
        )
    }
    archived_recheck = InspectionTask(
        plan_id=archived_plan.id,
        project_id=project.id,
        status="IN_PROGRESS",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add_all([*drafts, *tasks.values(), archived_recheck])
    db_session.flush()

    for task in (tasks["IN_PROGRESS"], tasks["CANCELLED"], archived_recheck):
        db_session.add(
            TaskInspectionItem(
                task_id=task.id,
                project_id=project.id,
                project_inspection_item_id=world["item"].id,
                needs_reinspection=True,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )
    other_project = Project(
        project_code="SUMMARY-OTHER",
        name="其他專案",
        client_name="示範業主",
        site_location="其他工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(other_project)
    db_session.flush()
    other_plan = InspectionPlan(
        project_id=other_project.id,
        name="其他計畫",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(other_plan)
    db_session.flush()
    db_session.add(
        InspectionTask(
            plan_id=other_plan.id,
            project_id=other_project.id,
            status="PENDING",
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    db_session.commit()

    response = world["admin"].get(_summary_path(project.id))
    assert response.status_code == 200, response.text
    assert response.json() == {
        "project": {
            "id": str(project.id),
            "project_code": project.project_code,
            "name": project.name,
        },
        "viewer_permission_codes": sorted(
            code.value for code in PermissionCode
        ),
        "member_count": 6,
        "inspection_item_count": 2,
        "zone_count": 1,
        "plan_count": 2,
        "task_counts": {
            "DRAFT": 3,
            "PENDING": 1,
            "IN_PROGRESS": 2,
            "COMPLETED": 1,
            "CANCELLED": 1,
        },
        "task_counts_visible": True,
        "pending_reinspection_task_count": 1,
        "draft_tasks_missing_assignee": 1,
        "primary_step": "dispatch_draft_tasks",
        "next_steps": [
            {"code": "add_members", "count": 6, "pending": False},
            {
                "code": "add_inspection_items",
                "count": 2,
                "pending": False,
            },
            {"code": "create_plan", "count": 2, "pending": False},
            {"code": "dispatch_draft_tasks", "count": 2, "pending": True},
            {
                "code": "complete_reinspection",
                "count": 1,
                "pending": True,
            },
        ],
    }


def test_next_steps_primary_step_moves_through_intermediate_states(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin_user"]
    project = Project(
        project_code="SUMMARY-STEPS",
        name="流程步驟專案",
        client_name="示範業主",
        site_location="示範工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(project)
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] == "add_members"

    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=admin.id,
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] == "add_inspection_items"

    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="步驟測試項目",
        instruction="檢查步驟測試項目",
        source_template_name="示範範本",
        applied_at=admin.created_at,
        created_by=admin.id,
        updated_by=admin.id,
    )
    plan = InspectionPlan(
        project_id=project.id,
        name="下一步計畫",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add_all([item, plan])
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] is None
    assert [step["pending"] for step in response.json()["next_steps"]] == [
        False,
        False,
        False,
        False,
        False,
    ]

    draft = InspectionTask(
        plan_id=plan.id,
        project_id=project.id,
        status="DRAFT",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(draft)
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] == "dispatch_draft_tasks"

    db_session.delete(draft)
    recheck = InspectionTask(
        plan_id=plan.id,
        project_id=project.id,
        status="IN_PROGRESS",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(recheck)
    db_session.flush()
    db_session.add(
        TaskInspectionItem(
            task_id=recheck.id,
            project_id=project.id,
            project_inspection_item_id=item.id,
            needs_reinspection=True,
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] == "complete_reinspection"
    assert response.json()["next_steps"][4]["pending"] is True

    recheck_item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == recheck.id
        )
    )
    assert recheck_item is not None
    recheck_item.needs_reinspection = False
    db_session.commit()
    response = world["admin"].get(_summary_path(project.id))
    assert response.json()["primary_step"] is None
    assert not any(step["pending"] for step in response.json()["next_steps"])


def test_task_count_visibility_draft_permissions_and_access_errors(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin_user"]
    plan = InspectionPlan(
        project_id=project.id,
        name="現場計畫",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(plan)
    db_session.flush()
    for status in ("DRAFT", "PENDING"):
        db_session.add(
            InspectionTask(
                plan_id=plan.id,
                project_id=project.id,
                status=status,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )
    db_session.commit()

    field = world["field"].get(_summary_path(project.id))
    assert field.status_code == 200, field.text
    assert field.json()["project"] == {
        "id": str(project.id),
        "project_code": project.project_code,
        "name": project.name,
    }
    assert field.json()["viewer_permission_codes"] == [
        "inspection_task.inspect"
    ]
    assert field.json()["task_counts_visible"] is True
    assert field.json()["task_counts"]["DRAFT"] == 0
    assert field.json()["task_counts"]["PENDING"] == 1
    assert field.json()["draft_tasks_missing_assignee"] == 0
    assert field.json()["next_steps"][3]["count"] == 0

    plan_reader = world["reader"].get(_summary_path(project.id))
    assert plan_reader.status_code == 200, plan_reader.text
    assert plan_reader.json()["project"] == field.json()["project"]
    assert plan_reader.json()["viewer_permission_codes"] == [
        "inspection_plan.read"
    ]
    assert plan_reader.json()["task_counts_visible"] is False
    assert set(plan_reader.json()["task_counts"].values()) == {0}
    assert plan_reader.json()["pending_reinspection_task_count"] == 0

    plain_member = world["plain"].get(_summary_path(project.id))
    assert plain_member.status_code == 403

    _grant_permission(
        db_session, world, world["plain_user"], "project_zone.read"
    )
    zone_reader = world["plain"].get(_summary_path(project.id))
    assert zone_reader.status_code == 200, zone_reader.text
    assert zone_reader.json()["viewer_permission_codes"] == [
        "project_zone.read"
    ]
    assert zone_reader.json()["task_counts_visible"] is False

    _grant_permission(
        db_session, world, world["plain_user"], "inspection_task.read"
    )
    task_reader = world["plain"].get(_summary_path(project.id))
    assert task_reader.status_code == 200, task_reader.text
    assert task_reader.json()["viewer_permission_codes"] == [
        "inspection_task.read",
        "project_zone.read",
    ]
    assert task_reader.json()["task_counts_visible"] is True
    assert task_reader.json()["task_counts"]["DRAFT"] == 1
    assert task_reader.json()["draft_tasks_missing_assignee"] == 1

    assert world["plain"].get(_summary_path(project.id)).status_code == 200
    assert world["outsider"].get(_summary_path(project.id)).status_code == 403
    missing = world["admin"].get(
        _summary_path("00000000-0000-7000-8000-000000000000")
    )
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "resource.not_found"}}
    invalid_uuid = world["admin"].get(_summary_path("not-a-uuid"))
    assert invalid_uuid.status_code == 422
