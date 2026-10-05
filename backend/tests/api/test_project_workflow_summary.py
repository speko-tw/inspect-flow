"""Project workflow summary API contract (Issue #446)."""

from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectZone,
    TaskInspectionItem,
)
from tests.api.test_inspection_planning_api import _planning_world


def _summary_path(project_id):
    return f"/api/v1/projects/{project_id}/workflow-summary"


def test_empty_project_reports_first_three_setup_steps(
    db_session, make_client
):
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
    assert response.json()["next_steps"] == [
        {"code": "add_members", "count": 0},
        {"code": "add_inspection_items", "count": 0},
        {"code": "create_plan", "count": 0},
        {"code": "dispatch_draft_tasks", "count": 0},
        {"code": "complete_reinspection", "count": 0},
    ]


def test_summary_counts_project_workflow_and_isolates_other_projects(
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
    db_session.add_all([zone, plan])
    db_session.flush()
    tasks = []
    for status in (
        "DRAFT",
        "PENDING",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
    ):
        task = InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            status=status,
            cancelled_from_status="PENDING" if status == "CANCELLED" else None,
            cancellation_reason="測試取消" if status == "CANCELLED" else None,
            created_by=admin.id,
            updated_by=admin.id,
        )
        db_session.add(task)
        tasks.append(task)
    db_session.flush()
    db_session.add(
        TaskInspectionItem(
            task_id=tasks[3].id,
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
        "member_count": 6,
        "inspection_item_count": 2,
        "zone_count": 1,
        "plan_count": 1,
        "task_counts": {
            "DRAFT": 1,
            "PENDING": 1,
            "IN_PROGRESS": 1,
            "COMPLETED": 1,
            "CANCELLED": 1,
        },
        "pending_reinspection_task_count": 1,
        "next_steps": [
            {"code": "add_members", "count": 6},
            {"code": "add_inspection_items", "count": 2},
            {"code": "create_plan", "count": 1},
            {"code": "dispatch_draft_tasks", "count": 1},
            {"code": "complete_reinspection", "count": 1},
        ],
    }


def test_summary_respects_draft_visibility_and_requires_project_read_access(
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
    assert field.json()["task_counts"]["DRAFT"] == 0
    assert field.json()["task_counts"]["PENDING"] == 1
    assert field.json()["next_steps"][3]["count"] == 0
    assert world["plain"].get(_summary_path(project.id)).status_code == 403
    assert world["outsider"].get(_summary_path(project.id)).status_code == 403
    missing = world["admin"].get(
        _summary_path("00000000-0000-7000-8000-000000000000")
    )
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "resource.not_found"}}
