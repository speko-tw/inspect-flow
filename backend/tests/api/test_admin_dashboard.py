"""ADM-AC01～05、13：驗證後台 Dashboard API 契約與權限範圍。"""

from sqlalchemy import delete, select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectMember,
    ProjectMemberRole,
    ProjectZone,
    Role,
    RolePermission,
    UserModulePermission,
)
from tests.api.test_inspection_planning_api import _planning_world
from tests.db.conftest import create_root_user_with_company


def _dashboard_fixture(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin_user"]
    project = world["project"]
    active_plan = InspectionPlan(
        project_id=project.id,
        name="使用中",
        created_by=admin.id,
        updated_by=admin.id,
    )
    archived_plan = InspectionPlan(
        project_id=project.id,
        name="已封存",
        is_archived=True,
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add_all([active_plan, archived_plan])
    db_session.flush()
    tasks = [
        InspectionTask(
            plan_id=active_plan.id,
            project_id=project.id,
            name="待開始",
            status="PENDING",
            assignee_id=world["field_user"].id,
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=active_plan.id,
            project_id=project.id,
            name="進行中",
            status="IN_PROGRESS",
            assignee_id=world["field_user"].id,
            started_by=world["field_user_two"].id,
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=active_plan.id,
            project_id=project.id,
            name="已完成",
            status="COMPLETED",
            completed_by=world["field_user_two"].id,
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=archived_plan.id,
            project_id=project.id,
            name="封存完成",
            status="COMPLETED",
            completed_by=world["field_reader_user"].id,
            created_by=admin.id,
            updated_by=admin.id,
        ),
        InspectionTask(
            plan_id=active_plan.id,
            project_id=project.id,
            name="已取消",
            status="CANCELLED",
            cancelled_from_status="PENDING",
            cancellation_reason="工作取消",
            created_by=admin.id,
            updated_by=admin.id,
        ),
    ]
    db_session.add_all(tasks)
    db_session.commit()
    return world


def _grant_task_read(db_session, world, user):
    admin = world["admin_user"]
    role = Role(
        name=f"Dashboard {user.username}",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[RolePermission(code="inspection_task.read")],
    )
    db_session.add(role)
    db_session.flush()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == world["project"].id,
            ProjectMember.user_id == user.id,
        )
    )
    assert member is not None
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    db_session.commit()


def test_dashboard_counts_and_engineer_attribution(db_session, make_client):
    world = _dashboard_fixture(db_session, make_client)
    response = world["admin"].get("/api/v1/admin/dashboard/summary")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "pending_count": 1,
        "in_progress_count": 1,
        "completed_count": 2,
        "completion_rate": 0.5,
    }

    project_response = world["admin"].get("/api/v1/admin/dashboard/projects")
    assert project_response.status_code == 200, project_response.text
    project_item = project_response.json()["items"][0]
    assert project_item["project_id"] == str(world["project"].id)
    assert project_item["pending_count"] == 1
    assert project_item["in_progress_count"] == 1
    assert project_item["completed_count"] == 2
    assert project_item["completion_denominator_count"] == 4
    assert project_item["completion_rate"] == 0.5
    assert "member_count" not in project_item

    engineers = world["admin"].get(
        "/api/v1/admin/dashboard/engineers",
        params={"project_id": str(world["project"].id)},
    )
    assert engineers.status_code == 200, engineers.text
    by_id = {row["user_id"]: row for row in engineers.json()["items"]}
    assigned = by_id[str(world["field_user"].id)]
    assert assigned["assigned_pending_count"] == 1
    assert assigned["assigned_in_progress_count"] == 1
    assert assigned["completed_by_count"] == 0
    assert assigned["started_in_progress_count"] == 0
    operator = by_id[str(world["field_user_two"].id)]
    assert operator["assigned_pending_count"] == 0
    assert operator["assigned_in_progress_count"] == 0
    assert operator["completed_by_count"] == 1
    assert operator["started_in_progress_count"] == 1
    assert all(
        set(row)
        == {
            "user_id",
            "username",
            "name_zh",
            "assigned_pending_count",
            "assigned_in_progress_count",
            "completed_by_count",
            "started_in_progress_count",
        }
        for row in engineers.json()["items"]
    )


def test_dashboard_two_layer_scope_and_no_scope_escalation(
    db_session, make_client
):
    world = _dashboard_fixture(db_session, make_client)
    _grant_task_read(db_session, world, world["plain_user"])
    client = world["plain"]
    project_id = str(world["project"].id)

    summary = client.get(
        "/api/v1/admin/dashboard/summary",
        params={"project_id": project_id},
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["completed_count"] == 2
    assert client.get("/api/v1/admin/dashboard/summary").status_code == 403
    assert client.get("/api/v1/admin/dashboard/projects").status_code == 200
    engineers = client.get("/api/v1/admin/dashboard/engineers")
    assert engineers.status_code == 403
    outsider_project = Project(
        project_code="DASHBOARD-OTHER",
        name="其他專案",
        client_name="業主",
        site_location="工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(outsider_project)
    db_session.commit()
    visible_projects = client.get("/api/v1/admin/dashboard/projects")
    assert visible_projects.status_code == 200, visible_projects.text
    assert [
        item["project_id"] for item in visible_projects.json()["items"]
    ] == [project_id]
    denied = client.get(
        "/api/v1/admin/dashboard/summary",
        params={"project_id": str(outsider_project.id)},
    )
    assert denied.status_code == 403
    missing = client.get(
        "/api/v1/admin/dashboard/summary",
        params={"project_id": "00000000-0000-0000-0000-000000000000"},
    )
    assert missing.status_code == 403
    assert (
        world["outsider"].get("/api/v1/admin/dashboard/projects").status_code
        == 403
    )
    assert (
        make_client().get("/api/v1/admin/dashboard/summary").status_code == 401
    )


def test_dashboard_global_permission_does_not_require_inspection_module(
    db_session, make_client
):
    world = _dashboard_fixture(db_session, make_client)
    project_id = str(world["project"].id)
    other = Project(
        project_code="DASHBOARD-GLOBAL",
        name="全域專案",
        client_name="業主",
        site_location="工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(other)
    db_session.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == world["plain_user"].id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    db_session.add(
        UserModulePermission(
            user_id=world["plain_user"].id,
            permission_code="all_project_progress.read",
            source="manual",
        )
    )
    db_session.commit()
    client = world["plain"]

    permissions = db_session.scalars(
        select(UserModulePermission.permission_code).where(
            UserModulePermission.user_id == world["plain_user"].id
        )
    ).all()
    assert "inspection.use" not in permissions
    assert "all_project_progress.read" in permissions
    assert client.get("/api/v1/admin/dashboard/summary").status_code == 200

    projects = client.get("/api/v1/admin/dashboard/projects")
    assert projects.status_code == 200, projects.text
    assert {row["project_id"] for row in projects.json()["items"]} == {
        project_id,
        str(other.id),
    }
    all_engineers = client.get("/api/v1/admin/dashboard/engineers")
    scoped_engineers = client.get(
        "/api/v1/admin/dashboard/engineers",
        params={"project_id": project_id},
    )
    assert all_engineers.status_code == 200, all_engineers.text
    assert scoped_engineers.status_code == 200, scoped_engineers.text
    assert len(all_engineers.json()["items"]) >= len(
        scoped_engineers.json()["items"]
    )


def test_dashboard_cursor_search_and_validation(db_session, make_client):
    world = _dashboard_fixture(db_session, make_client)
    client = world["admin"]
    other = Project(
        project_code="PLAN-API-2",
        name="另一示範專案",
        client_name="業主",
        site_location="工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(other)
    db_session.commit()
    path = "/api/v1/admin/dashboard/projects"
    first = client.get(path, params={"limit": 1, "q": "PLAN"})
    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 1
    assert first.json()["next_cursor"] is not None
    second = client.get(
        path,
        params={
            "limit": 1,
            "q": "PLAN",
            "cursor": first.json()["next_cursor"],
        },
    )
    assert second.status_code == 200, second.text
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None
    assert {
        first.json()["items"][0]["project_id"],
        second.json()["items"][0]["project_id"],
    } == {str(world["project"].id), str(other.id)}
    invalid = client.get(path, params={"cursor": "bad"})
    assert invalid.status_code == 422
    assert client.get(path, params={"limit": 0}).status_code == 422
    assert (
        client.get(
            "/api/v1/admin/dashboard/engineers",
            params={"project_id": str(world["project"].id), "q": "field"},
        ).status_code
        == 200
    )


def test_dashboard_tasks_require_global_permission_and_revoke_immediately(
    db_session, make_client
):
    world = _dashboard_fixture(db_session, make_client)
    user = world["plain_user"]
    task = db_session.scalar(
        select(InspectionTask).where(
            InspectionTask.project_id == world["project"].id,
            InspectionTask.status == "PENDING",
        )
    )
    zone = ProjectZone(
        project_id=world["project"].id,
        name="A 棟 2 樓",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(zone)
    db_session.flush()
    task.zone_id = zone.id
    task.location_text = "機房"
    db_session.add(
        UserModulePermission(
            user_id=user.id,
            permission_code="all_project_progress.read",
            source="manual",
        )
    )
    db_session.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == user.id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    db_session.commit()

    base = f"/api/v1/admin/dashboard/projects/{world['project'].id}/tasks"
    listed = world["plain"].get(base)
    assert listed.status_code == 200, listed.text
    assert listed.json()["next_cursor"] is None
    row = next(
        item
        for item in listed.json()["items"]
        if item["task_id"] == str(task.id)
    )
    assert set(row) == {
        "task_id",
        "status",
        "location",
        "suggested_assignee",
    }
    assert row["location"] == {
        "zone_name": "A 棟 2 樓",
        "location_text": "機房",
    }
    assert row["suggested_assignee"] == {
        "user_id": str(world["field_user"].id),
        "name_zh": world["field_user"].name_zh,
    }
    detail = world["plain"].get(f"{base}/{task.id}")
    assert detail.status_code == 200, detail.text
    assert detail.json() == row

    db_session.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == user.id,
            UserModulePermission.permission_code
            == "all_project_progress.read",
        )
    )
    db_session.commit()
    assert world["plain"].get(base).status_code == 403
    assert world["plain"].get(f"{base}/{task.id}").status_code == 403


def test_dashboard_tasks_allow_admin_and_deny_unentitled_members(
    db_session, make_client
):
    world = _dashboard_fixture(db_session, make_client)
    base = f"/api/v1/admin/dashboard/projects/{world['project'].id}/tasks"
    assert world["admin"].get(base).status_code == 200
    assert world["plain"].get(base).status_code == 403
    task_id = "00000000-0000-0000-0000-000000000001"
    assert world["plain"].get(f"{base}/{task_id}").status_code == 403

    external = create_root_user_with_company(db_session, "DASHBOARD-EXT")
    external.is_external_collaborator = True
    db_session.commit()
    external_token = create_session(db_session, external)[1]
    db_session.commit()
    external_client = make_client()
    external_client.cookies.set(SESSION_COOKIE_NAME, external_token)
    assert external_client.get(base).status_code == 403
    assert external_client.get(f"{base}/{task_id}").status_code == 403


def test_dashboard_task_hides_cross_project_and_missing_ids(
    db_session, make_client
):
    world = _dashboard_fixture(db_session, make_client)
    other = Project(
        project_code="DASHBOARD-TASK-OTHER",
        name="其他任務專案",
        client_name="業主",
        site_location="工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    task = db_session.scalar(select(InspectionTask))
    db_session.add(other)
    db_session.commit()
    base = f"/api/v1/admin/dashboard/projects/{other.id}/tasks"
    assert world["admin"].get(f"{base}/{task.id}").status_code == 404
    assert (
        world["admin"]
        .get(
            f"/api/v1/admin/dashboard/projects/{world['project'].id}/tasks/"
            "00000000-0000-0000-0000-000000000001"
        )
        .status_code
        == 404
    )
    missing_project = "00000000-0000-0000-0000-000000000002"
    assert (
        world["admin"]
        .get(f"/api/v1/admin/dashboard/projects/{missing_project}/tasks")
        .status_code
        == 403
    )


def test_dashboard_engineer_search_matches_visible_fields_only(
    db_session, make_client
):
    """ADM-R51：q 不得用 email、工號、英文姓名探測看不到的欄位。"""
    world = _dashboard_fixture(db_session, make_client)
    user = world["field_user"]
    user.email = "hidden.probe711@example.test"
    user.employee_no = "EMP-711-HIDDEN"
    user.name_en = "Hidden English Probe"
    db_session.commit()
    path = "/api/v1/admin/dashboard/engineers"
    params = {"project_id": str(world["project"].id)}

    def found(term):
        response = world["admin"].get(path, params={**params, "q": term})
        assert response.status_code == 200, response.text
        return {row["user_id"] for row in response.json()["items"]}

    for hidden in ("probe711", "EMP-711", "English Probe"):
        assert str(user.id) not in found(hidden)
    assert str(user.id) in found(user.username[:4])
    assert str(user.id) in found(user.name_zh)


def test_dashboard_tasks_exclude_draft(db_session, make_client):
    """ADM-R51：總覽任務清單與單筆都不含 DRAFT；CANCELLED 照舊。"""
    world = _dashboard_fixture(db_session, make_client)
    admin = world["admin_user"]
    plan = db_session.scalar(
        select(InspectionPlan).where(InspectionPlan.name == "使用中")
    )
    draft = InspectionTask(
        plan_id=plan.id,
        project_id=world["project"].id,
        name="草稿",
        status="DRAFT",
        created_by=admin.id,
        updated_by=admin.id,
    )
    db_session.add(draft)
    db_session.commit()
    base = f"/api/v1/admin/dashboard/projects/{world['project'].id}/tasks"

    listed = world["admin"].get(base, params={"limit": 100})
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert str(draft.id) not in {item["task_id"] for item in items}
    assert "DRAFT" not in {item["status"] for item in items}
    assert "CANCELLED" in {item["status"] for item in items}
    assert world["admin"].get(f"{base}/{draft.id}").status_code == 404
