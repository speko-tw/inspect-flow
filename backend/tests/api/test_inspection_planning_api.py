"""Inspection planning HTTP contracts (IP-AC01 through IP-AC11)."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import event, select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.base import uuid7
from app.db.clock import reset_clock, set_clock
from app.db.engine import get_engine
from app.models import (
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    ProjectZone,
    Role,
    RolePermission,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotMeasurementField,
    TaskSnapshotPoint,
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
    field_reader = create_root_user_with_company(db_session, "PLAN-API-F-READ")
    field_user_two = create_root_user_with_company(
        db_session, "PLAN-API-FIELD-2"
    )
    reader = create_root_user_with_company(db_session, "PLAN-API-READER")
    plain_member = create_root_user_with_company(db_session, "PLAN-API-PLAIN")
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
    field_reader_role = Role(
        name="API field planning reader",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[
            RolePermission(code="inspection_task.inspect"),
            RolePermission(code="inspection_plan.read"),
        ],
    )
    reader_role = Role(
        name="API planning reader",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[RolePermission(code="inspection_plan.read")],
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
    db_session.add_all(
        [project, role, field_reader_role, reader_role, manager_role]
    )
    db_session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=field_user.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    field_member_two = ProjectMember(
        project_id=project.id,
        user_id=field_user_two.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    field_reader_member = ProjectMember(
        project_id=project.id,
        user_id=field_reader.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=field_reader_role.id)],
    )
    reader_member = ProjectMember(
        project_id=project.id,
        user_id=reader.id,
        created_by=admin.id,
        updated_by=admin.id,
        role_assignments=[ProjectMemberRole(role_id=reader_role.id)],
    )
    plain_member_row = ProjectMember(
        project_id=project.id,
        user_id=plain_member.id,
        created_by=admin.id,
        updated_by=admin.id,
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
    db_session.add_all(
        [
            member,
            field_member_two,
            field_reader_member,
            reader_member,
            plain_member_row,
            manager_member,
            item,
            item_two,
        ]
    )
    db_session.commit()
    tokens = {
        "admin": create_session(db_session, admin)[1],
        "field": create_session(db_session, field_user)[1],
        "field_two": create_session(db_session, field_user_two)[1],
        "field_reader": create_session(db_session, field_reader)[1],
        "reader": create_session(db_session, reader)[1],
        "plain": create_session(db_session, plain_member)[1],
        "outsider": create_session(db_session, outsider)[1],
    }
    db_session.commit()
    return {
        "admin": _client(make_client, tokens["admin"]),
        "field": _client(make_client, tokens["field"]),
        "field_two": _client(make_client, tokens["field_two"]),
        "field_reader": _client(make_client, tokens["field_reader"]),
        "reader": _client(make_client, tokens["reader"]),
        "plain": _client(make_client, tokens["plain"]),
        "outsider": _client(make_client, tokens["outsider"]),
        "field_user": field_user,
        "field_user_two": field_user_two,
        "plain_user": plain_member,
        "admin_user": admin,
        "project": project,
        "item": item,
        "item_two": item_two,
    }


def test_single_project_read_is_limited_for_planning_members(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    path = f"/api/v1/projects/{project_id}"

    basic = world["reader"].get(path)
    assert basic.status_code == 200, basic.text
    assert set(basic.json()) == {
        "id",
        "project_code",
        "name",
        "planned_start_date",
        "planned_completion_date",
    }
    assert basic.json()["project_code"] == "PLAN-API-1"
    assert world["field"].get(path).status_code == 403
    assert world["outsider"].get(path).status_code == 403
    world["admin"].post(
        f"/api/v1/projects/{project_id}/zones", json={"name": "讀取區"}
    )
    zones = world["reader"].get(f"/api/v1/projects/{project_id}/zones")
    assert zones.status_code == 200, zones.text
    assert zones.json()["items"][0]["name"] == "讀取區"

    full = world["admin"].get(path)
    assert full.status_code == 200, full.text
    assert {"client_name", "site_location", "warnings"} <= set(full.json())
    missing = world["admin"].get(
        "/api/v1/projects/00000000-0000-7000-8000-000000000000"
    )
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "resource.not_found"}}


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
    denied_assignees = world["plain"].get(
        f"/api/v1/projects/{project.id}/inspection-task-assignees"
    )
    assert denied_assignees.status_code == 403
    missing_project_assignees = world["plain"].get(
        "/api/v1/projects/00000000-0000-7000-8000-000000000000"
        "/inspection-task-assignees"
    )
    assert missing_project_assignees.status_code == 403

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
    assert hidden.json() == {"error": {"code": "resource.not_found"}}
    field_reader = world["field_reader"]
    plan_detail = field_reader.get(f"/api/v1/inspection-plans/{plan_id}")
    assert plan_detail.status_code == 200, plan_detail.text
    assert plan_detail.json()["tasks"] == []
    plan_task_list = field_reader.get(
        f"/api/v1/inspection-plans/{plan_id}/tasks"
    )
    assert plan_task_list.status_code == 200, plan_task_list.text
    assert plan_task_list.json()["items"] == []
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
        f"/api/v1/projects/{project.id}/inspection-items/"
        f"{world['item'].id}/tasks"
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


def test_field_task_api_filters_safely_and_pages_by_dispatch_time(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    field = world["field"]
    prefix = "/api/v1/field/inspection-tasks"
    assert make_client().get(prefix).status_code == 401
    assert world["outsider"].get(prefix).status_code == 403
    assert world["reader"].get(prefix).status_code == 403
    empty = field.get(prefix)
    assert empty.status_code == 200, empty.text
    assert empty.json() == {"items": [], "next_cursor": None}
    admin_empty = admin.get(prefix, params={"project_id": str(uuid4())})
    assert admin_empty.status_code == 200, admin_empty.text
    assert admin_empty.json() == {"items": [], "next_cursor": None}

    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "Field task contract"},
    )
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]
    second_item = ProjectInspectionItem(
        project_id=project.id,
        sequence=2,
        title="第二查核項目",
        instruction="示範指示",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(second_item)
    db_session.commit()

    foreign_project = Project(
        project_code="FIELD-API-FOREIGN",
        name="未授權專案",
        client_name="示範業主",
        site_location="示範地點",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign_project)
    db_session.flush()
    foreign_item = ProjectInspectionItem(
        project_id=foreign_project.id,
        sequence=1,
        title="未授權查核項目",
        instruction="示範指示",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign_item)
    db_session.commit()
    foreign_plan = admin.post(
        f"/api/v1/projects/{foreign_project.id}/inspection-plans",
        json={"name": "未授權計畫"},
    )
    assert foreign_plan.status_code == 201, foreign_plan.text
    foreign_task = admin.post(
        f"/api/v1/inspection-plans/{foreign_plan.json()['id']}/tasks",
        json={"item_ids": [str(foreign_item.id)]},
    )
    assert foreign_task.status_code == 201, foreign_task.text
    foreign_task_id = foreign_task.json()["id"]
    assert (
        admin.post(
            f"/api/v1/inspection-tasks/{foreign_task_id}:dispatch"
        ).status_code
        == 200
    )
    assert (
        field.get(
            prefix, params={"project_id": str(foreign_project.id)}
        ).status_code
        == 403
    )
    assert field.get(f"{prefix}/{foreign_task_id}").status_code == 404
    draft = admin.post(
        f"/api/v1/inspection-plans/{plan_id}/tasks",
        json={
            "item_ids": [str(world["item"].id)],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]
    assert field.get(f"{prefix}/{draft_id}").status_code == 404

    timestamp = datetime.now(UTC).replace(microsecond=0)
    older_timestamp = timestamp - timedelta(days=1)
    set_clock(lambda: timestamp)
    dispatched_ids = []
    try:
        older = admin.post(
            f"/api/v1/inspection-plans/{plan_id}/tasks",
            json={
                "item_ids": [str(world["item"].id)],
                "suggested_assignee_id": str(world["field_user_two"].id),
            },
        )
        assert older.status_code == 201, older.text
        older_id = older.json()["id"]
        old_dispatch = admin.post(
            f"/api/v1/inspection-tasks/{older_id}:dispatch"
        )
        assert old_dispatch.status_code == 200, old_dispatch.text
        older_row = db_session.get(InspectionTask, UUID(older_id))
        assert older_row is not None
        older_row.dispatched_at = older_timestamp
        db_session.commit()
        for assignee_id in (
            world["field_user"].id,
            world["field_user_two"].id,
            world["field_user"].id,
        ):
            created = admin.post(
                f"/api/v1/inspection-plans/{plan_id}/tasks",
                json={
                    "item_ids": [str(world["item"].id), str(second_item.id)],
                    "suggested_assignee_id": str(assignee_id),
                },
            )
            assert created.status_code == 201, created.text
            task_id = created.json()["id"]
            dispatched = admin.post(
                f"/api/v1/inspection-tasks/{task_id}:dispatch"
            )
            assert dispatched.status_code == 200, dispatched.text
            assert dispatched.json()["dispatched_at"] == timestamp.strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            dispatched_ids.append(task_id)

        own = field.get(prefix)
        assert own.status_code == 200, own.text
        assert {row["id"] for row in own.json()["items"]} == {
            dispatched_ids[0],
            dispatched_ids[2],
        }
        assert own.json()["items"][0]["item_summary"] == {
            "first_title": "表面檢查",
            "item_count": 2,
        }
        all_tasks = field.get(prefix, params={"assigned_to_me": "false"})
        assert all_tasks.status_code == 200, all_tasks.text
        expected = sorted(dispatched_ids, reverse=True) + [older_id]
        assert [row["id"] for row in all_tasks.json()["items"]] == expected
        assert foreign_task_id not in {
            row["id"] for row in all_tasks.json()["items"]
        }

        def select_count(limit: int) -> int:
            statements: list[str] = []

            def record(conn, cursor, statement, parameters, context, many):
                if statement.lstrip().upper().startswith("SELECT"):
                    statements.append(statement)

            engine = get_engine()
            event.listen(engine, "before_cursor_execute", record)
            try:
                measured = field.get(
                    prefix,
                    params={"assigned_to_me": "false", "limit": limit},
                )
                assert measured.status_code == 200, measured.text
                assert len(measured.json()["items"]) == limit
            finally:
                event.remove(engine, "before_cursor_execute", record)
            assert statements
            return len(statements)

        assert select_count(2) == select_count(4)
        first_page = field.get(
            prefix, params={"assigned_to_me": "false", "limit": 2}
        )
        assert [row["id"] for row in first_page.json()["items"]] == expected[
            :2
        ]
        assert first_page.json()["next_cursor"]
        second_page = field.get(
            prefix,
            params={
                "assigned_to_me": "false",
                "limit": 2,
                "cursor": first_page.json()["next_cursor"],
            },
        )
        assert [row["id"] for row in second_page.json()["items"]] == expected[
            2:
        ]
        assert second_page.json()["next_cursor"] is None
        pending_first = field.get(
            prefix,
            params={
                "assigned_to_me": "false",
                "status": "PENDING",
                "limit": 2,
            },
        )
        assert [row["id"] for row in pending_first.json()["items"]] == (
            expected[:2]
        )
        pending_next = field.get(
            prefix,
            params={
                "assigned_to_me": "false",
                "status": "PENDING",
                "limit": 2,
                "cursor": pending_first.json()["next_cursor"],
            },
        )
        assert [row["id"] for row in pending_next.json()["items"]] == (
            expected[2:]
        )
        assert (
            field.get(prefix, params={"status": "COMPLETED"}).status_code
            == 422
        )
        assert field.get(prefix, params={"limit": 101}).status_code == 422
        assert (
            field.get(prefix, params={"cursor": "invalid"}).status_code == 422
        )

        detail = field.get(f"{prefix}/{dispatched_ids[0]}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["project_name"] == project.name
        assert detail.json()["items"][0]["title"] == "表面檢查"
        assert "plan_id" not in detail.json()
        assert "assignee_id" not in detail.json()
        assert "started_by" not in detail.json()
        assert "source_template_name" not in str(detail.json())
        assert (
            world["reader"].get(f"{prefix}/{dispatched_ids[0]}").status_code
            == 404
        )
        assert field.get(f"{prefix}/{uuid4()}").status_code == 404

        completed_id = uuid7()
        db_session.add(
            InspectionTask(
                id=completed_id,
                plan_id=UUID(plan_id),
                project_id=project.id,
                status="COMPLETED",
                dispatched_at=timestamp,
                created_by=world["admin_user"].id,
                updated_by=world["admin_user"].id,
            )
        )
        db_session.commit()
        after_completed = field.get(prefix, params={"assigned_to_me": "false"})
        assert str(completed_id) not in {
            row["id"] for row in after_completed.json()["items"]
        }

        started = field.post(
            f"/api/v1/inspection-tasks/{dispatched_ids[0]}:start"
        )
        assert started.status_code == 200, started.text
        progress = field.get(
            prefix,
            params={
                "assigned_to_me": "false",
                "status": "IN_PROGRESS",
            },
        )
        assert [row["id"] for row in progress.json()["items"]] == [
            dispatched_ids[0]
        ]
        pending = field.get(prefix, params={"status": "PENDING"})
        assert dispatched_ids[0] not in {
            row["id"] for row in pending.json()["items"]
        }
        cancelled = admin.post(
            f"/api/v1/inspection-tasks/{dispatched_ids[0]}:cancel",
            json={"reason": "migration contract"},
        )
        assert cancelled.status_code == 200, cancelled.text
        after_cancelled = field.get(prefix, params={"assigned_to_me": "false"})
        assert dispatched_ids[0] not in {
            row["id"] for row in after_cancelled.json()["items"]
        }
        restored = admin.post(
            f"/api/v1/inspection-tasks/{dispatched_ids[0]}:restore"
        )
        assert restored.status_code == 200, restored.text
        row = db_session.get(InspectionTask, UUID(dispatched_ids[0]))
        assert row is not None and row.dispatched_at == timestamp

        db_session.add_all(
            [
                InspectionTask(
                    id=uuid7(),
                    plan_id=UUID(plan_id),
                    project_id=project.id,
                    status="PENDING",
                    dispatched_at=timestamp,
                    assignee_id=world["field_user_two"].id,
                    created_by=world["admin_user"].id,
                    updated_by=world["admin_user"].id,
                )
                for _ in range(51)
            ]
        )
        db_session.commit()
        first_default_page = field.get(
            prefix, params={"assigned_to_me": "false"}
        )
        assert len(first_default_page.json()["items"]) == 50
        assert first_default_page.json()["next_cursor"]
    finally:
        reset_clock()


def test_field_task_detail_keeps_numeric_measurement_mapping_and_order(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]
    project = world["project"]
    first_client_id = uuid4()
    second_client_id = uuid4()
    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    updated = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "量測項次",
                    "instruction": "量測說明",
                    "numeric_standard": {
                        "value": "5",
                        "condition": "=",
                        "unit": "mm",
                        "measurement_field_client_id": str(second_client_id),
                    },
                    "measurement_fields": [
                        {
                            "client_id": str(first_client_id),
                            "name": "第一量測欄位",
                            "field_type": "number",
                            "unit": "mm",
                        },
                        {
                            "client_id": str(second_client_id),
                            "name": "第二量測欄位",
                            "field_type": "number",
                            "unit": "mm",
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "量測欄位排序"},
    )
    assert plan.status_code == 201, plan.text
    created = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    task_item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert task_item is not None
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point = db_session.scalar(
        select(TaskSnapshotPoint).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point is not None
    fields = db_session.scalars(
        select(TaskSnapshotMeasurementField).where(
            TaskSnapshotMeasurementField.point_id == point.id
        )
    ).all()
    assert {row.name for row in fields} == {
        "第一量測欄位",
        "第二量測欄位",
    }
    for row in fields:
        row.sort_order = 0 if row.name == "第二量測欄位" else 1
    db_session.commit()

    dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
    assert dispatched.status_code == 200, dispatched.text
    detail = field.get(f"/api/v1/field/inspection-tasks/{task_id}")
    assert detail.status_code == 200, detail.text
    point_detail = detail.json()["items"][0]["inspection_points"][0]
    assert [row["name"] for row in point_detail["measurement_fields"]] == [
        "第二量測欄位",
        "第一量測欄位",
    ]
    assert (
        point_detail["numeric_standard"]["measurement_field_id"]
        == (point_detail["measurement_fields"][0]["id"])
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
            "suggested_assignee_id": str(world["field_user"].id),
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
    assert completed.json()["assignee_id"] == str(world["field_user"].id)
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
    locked_location = admin.patch(
        f"/api/v1/inspection-tasks/{task_id}",
        json={"zone_id": None, "location_text": "取消後不可改"},
    )
    assert locked_location.status_code == 409
    assert locked_location.json()["error"]["code"] == (
        "inspection_task.location_locked"
    )
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


def test_planning_denies_each_endpoint_before_body_validation(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    plain = world["plain"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "權限測試"},
    )
    plan_id = plan.json()["id"]
    zone = admin.post(
        f"/api/v1/projects/{project_id}/zones", json={"name": "權限區"}
    ).json()
    task = admin.post(
        f"/api/v1/inspection-plans/{plan_id}/tasks",
        json={
            "item_ids": [str(world["item"].id)],
            "zone_id": str(zone["id"]),
        },
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]
    base = f"/api/v1/projects/{project_id}"
    task_path = f"/api/v1/inspection-tasks/{task_id}"
    plan_path = f"/api/v1/inspection-plans/{plan_id}"
    cases = [
        ("GET", f"{base}/inspection-plans", None),
        ("POST", f"{base}/inspection-plans", {}),
        ("GET", f"{base}/zones", None),
        ("POST", f"{base}/zones", {}),
        ("PATCH", f"{base}/zones/{zone['id']}", {}),
        ("DELETE", f"{base}/zones/{zone['id']}", None),
        ("GET", plan_path, None),
        ("PATCH", plan_path, {}),
        ("POST", f"{plan_path}/tasks", {}),
        ("GET", f"{plan_path}/tasks", None),
        ("GET", f"{base}/inspection-tasks", None),
        (
            "GET",
            f"{base}/inspection-items/{world['item'].id}/tasks",
            None,
        ),
        ("GET", f"{base}/inspection-task-assignees", None),
        ("POST", f"{task_path}:dispatch", None),
        ("POST", f"{task_path}:assign", {}),
        ("POST", f"{task_path}:start", None),
        ("POST", f"{task_path}:complete", None),
        ("DELETE", task_path, None),
        ("POST", f"{task_path}:cancel", {}),
        ("POST", f"{task_path}:restore", None),
        ("PATCH", task_path, {}),
        ("GET", task_path, None),
        ("POST", f"{plan_path}:archive", None),
        ("POST", f"{plan_path}:unarchive", None),
        (
            "PATCH",
            f"{base}/inspection-items/{world['item'].id}",
            {},
        ),
    ]
    for method, url, body in cases:
        response = plain.request(method, url, json=body)
        assert response.status_code == 403, (
            method,
            url,
            response.status_code,
            response.text,
        )
        assert response.json() == {"error": {"code": "permission.denied"}}


def test_every_planning_list_uses_cursor_pages(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    base = f"/api/v1/projects/{project_id}"
    plans = [
        admin.post(f"{base}/inspection-plans", json={"name": f"計畫{i}"})
        for i in range(2)
    ]
    assert all(response.status_code == 201 for response in plans)
    zones = [
        admin.post(f"{base}/zones", json={"name": f"區域{i}"})
        for i in range(2)
    ]
    assert all(response.status_code == 201 for response in zones)
    tasks = []
    for plan in plans:
        response = admin.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={
                "item_ids": [str(world["item"].id)],
                "zone_id": zones[0].json()["id"],
            },
        )
        assert response.status_code == 201, response.text
        tasks.append(response)
    extra_task = admin.post(
        f"/api/v1/inspection-plans/{plans[0].json()['id']}/tasks",
        json={
            "item_ids": [str(world["item"].id)],
            "zone_id": zones[0].json()["id"],
        },
    )
    assert extra_task.status_code == 201, extra_task.text

    endpoints = [
        f"{base}/inspection-plans",
        f"{base}/zones",
        f"{base}/inspection-tasks",
        f"/api/v1/inspection-plans/{plans[0].json()['id']}/tasks",
        f"{base}/inspection-items/{world['item'].id}/tasks",
        f"{base}/inspection-task-assignees",
    ]
    for url in endpoints:
        first = admin.get(url, params={"limit": 1})
        assert first.status_code == 200, (url, first.text)
        assert len(first.json()["items"]) == 1
        cursor = first.json()["next_cursor"]
        assert cursor, url
        seen = list(first.json()["items"])
        while cursor is not None:
            page = admin.get(url, params={"limit": 1, "cursor": cursor})
            assert page.status_code == 200, (url, page.text)
            assert len(page.json()["items"]) == 1
            seen.extend(page.json()["items"])
            cursor = page.json()["next_cursor"]
            assert len(seen) <= 10
        assert len(seen) >= 2


def test_project_scoped_resources_hide_cross_project_rows_and_candidates(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    foreign = Project(
        project_code="PLAN-API-FOREIGN-2",
        name="外部專案",
        client_name="外部業主",
        site_location="外部工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign)
    db_session.flush()
    foreign_zone = ProjectZone(
        project_id=foreign.id,
        name="外區",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    foreign_item = ProjectInspectionItem(
        project_id=foreign.id,
        sequence=1,
        title="外部項目",
        instruction="外部說明",
        source_template_name="外部範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add_all([foreign_zone, foreign_item])
    db_session.commit()
    for method, path, body in (
        (
            "PATCH",
            f"/api/v1/projects/{project_id}/zones/{foreign_zone.id}",
            {"name": "不應更新"},
        ),
        (
            "DELETE",
            f"/api/v1/projects/{project_id}/zones/{foreign_zone.id}",
            None,
        ),
        (
            "GET",
            f"/api/v1/projects/{project_id}/inspection-items/"
            f"{foreign_item.id}/tasks",
            None,
        ),
    ):
        response = admin.request(method, path, json=body)
        assert response.status_code == 404, response.text
        assert response.json() == {"error": {"code": "resource.not_found"}}

    foreign_plan = admin.post(
        f"/api/v1/projects/{foreign.id}/inspection-plans",
        json={"name": "外部計畫"},
    )
    assert foreign_plan.status_code == 201, foreign_plan.text
    foreign_task = admin.post(
        f"/api/v1/inspection-plans/{foreign_plan.json()['id']}/tasks",
        json={
            "item_ids": [str(foreign_item.id)],
            "zone_id": str(foreign_zone.id),
        },
    )
    assert foreign_task.status_code == 201, foreign_task.text
    plain = world["plain"]
    for path in (
        f"/api/v1/inspection-plans/{foreign_plan.json()['id']}",
        f"/api/v1/inspection-tasks/{foreign_task.json()['id']}",
    ):
        denied = plain.get(path)
        assert denied.status_code == 403, denied.text
        assert denied.json() == {"error": {"code": "permission.denied"}}

    candidates = admin.get(
        f"/api/v1/projects/{project_id}/inspection-task-assignees"
    )
    assert candidates.status_code == 200, candidates.text
    candidate_rows = candidates.json()["items"]
    assert set(candidate_rows[0]) == {"id", "username", "name_zh"}
    candidate_ids = {person["id"] for person in candidate_rows}
    assert str(world["field_user"].id) in candidate_ids
    assert str(world["field_user_two"].id) in candidate_ids
    assert str(world["plain_user"].id) not in candidate_ids
    assert str(world["admin_user"].id) not in candidate_ids


def test_planning_error_codes_archive_immutability_and_plan_states(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    base = f"/api/v1/projects/{project_id}"
    plan_response = admin.post(
        f"{base}/inspection-plans", json={"name": "邊界測試"}
    )
    plan_id = plan_response.json()["id"]
    plan_path = f"/api/v1/inspection-plans/{plan_id}"
    long_name = admin.post(
        f"{base}/inspection-plans", json={"name": "x" * 129}
    )
    assert long_name.status_code == 422
    assert long_name.json()["error"]["code"] == "inspection_plan.invalid_name"
    long_zone = admin.post(f"{base}/zones", json={"name": "x" * 129})
    assert long_zone.status_code == 422
    assert long_zone.json()["error"]["code"] == "project_zone.invalid_name"
    zone = admin.post(f"{base}/zones", json={"name": "初始分區"}).json()
    renamed = admin.patch(
        f"{base}/zones/{zone['id']}", json={"name": "更新分區"}
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json() == {
        "id": zone["id"],
        "name": "更新分區",
        "project_id": str(project_id),
    }
    unused = admin.post(f"{base}/zones", json={"name": "待刪分區"})
    assert unused.status_code == 201
    deleted = admin.delete(f"{base}/zones/{unused.json()['id']}")
    assert deleted.status_code == 204

    create_url = f"{plan_path}/tasks"
    empty_items = admin.post(create_url, json={"item_ids": []})
    assert empty_items.status_code == 422
    assert (
        empty_items.json()["error"]["code"] == "inspection_task.items_required"
    )
    invalid_item = admin.post(
        create_url, json={"item_ids": ["00000000-0000-7000-8000-000000000000"]}
    )
    assert invalid_item.status_code == 422
    assert invalid_item.json()["error"]["code"] == (
        "inspection_task.invalid_project_item"
    )
    invalid_zone = admin.post(
        create_url,
        json={
            "item_ids": [str(world["item"].id)],
            "zone_id": "00000000-0000-7000-8000-000000000000",
        },
    )
    assert invalid_zone.status_code == 422
    assert (
        invalid_zone.json()["error"]["code"] == "inspection_task.invalid_zone"
    )
    invalid_assignee = admin.post(
        create_url,
        json={
            "item_ids": [str(world["item"].id)],
            "suggested_assignee_id": str(world["plain_user"].id),
        },
    )
    assert invalid_assignee.status_code == 422
    assert invalid_assignee.json()["error"]["code"] == (
        "inspection_task.invalid_assignee"
    )
    invalid_location = admin.post(
        create_url,
        json={
            "item_ids": [str(world["item"].id)],
            "location_text": "x" * 257,
        },
    )
    assert invalid_location.status_code == 422
    assert invalid_location.json()["error"]["code"] == (
        "inspection_task.invalid_location"
    )

    task = admin.post(
        create_url,
        json={
            "item_ids": [str(world["item"].id)],
            "zone_id": zone["id"],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]
    task_path = f"/api/v1/inspection-tasks/{task_id}"
    assert admin.post(f"{task_path}:dispatch").status_code == 200
    duplicate_dispatch = admin.post(f"{task_path}:dispatch")
    assert duplicate_dispatch.status_code == 409
    assert duplicate_dispatch.json()["error"]["code"] == (
        "inspection_task.invalid_transition"
    )
    assert admin.post(f"{task_path}:start").status_code == 200
    locked_location = admin.patch(
        task_path, json={"zone_id": zone["id"], "location_text": "新地點"}
    )
    assert locked_location.status_code == 200
    task_item = (
        db_session.query(TaskInspectionItem)
        .filter_by(task_id=UUID(task_id))
        .one()
    )
    task_item.item_status = "COMPLETED"
    db_session.commit()
    item_path = f"{base}/inspection-items/{world['item'].id}"
    changed = admin.patch(
        item_path, json={"title": "待重查標準", "reinspect": True}
    )
    assert changed.status_code == 200, changed.text
    incomplete = admin.post(f"{task_path}:complete")
    assert incomplete.status_code == 422
    assert (
        incomplete.json()["error"]["code"]
        == "inspection_task.items_incomplete"
    )

    zero_plan_body = {"name": "零任務"}
    zero_plan = admin.post(f"{base}/inspection-plans", json=zero_plan_body)
    assert zero_plan.json()["status"] == "DRAFT"
    cancelled_plan = admin.post(
        f"{base}/inspection-plans", json={"name": "全取消"}
    )
    cancelled_plan_id = cancelled_plan.json()["id"]
    cancelled_task_ids = []
    for _ in range(2):
        response = admin.post(
            f"/api/v1/inspection-plans/{cancelled_plan_id}/tasks",
            json={
                "item_ids": [str(world["item_two"].id)],
                "zone_id": zone["id"],
            },
        )
        assert response.status_code == 201, response.text
        cancelled_task_ids.append(response.json()["id"])
    for task_id in cancelled_task_ids:
        assert (
            admin.post(
                f"/api/v1/inspection-tasks/{task_id}:dispatch"
            ).status_code
            == 200
        )
        cancelled = admin.post(
            f"/api/v1/inspection-tasks/{task_id}:cancel",
            json={"reason": "測試取消"},
        )
        assert cancelled.status_code == 200, cancelled.text
    all_cancelled = admin.get(f"/api/v1/inspection-plans/{cancelled_plan_id}")
    assert all_cancelled.json()["status"] == "CANCELLED"

    archived_plan = admin.post(
        f"{base}/inspection-plans", json={"name": "封存不可變"}
    )
    archived_id = archived_plan.json()["id"]
    draft_task = admin.post(
        f"/api/v1/inspection-plans/{archived_id}/tasks",
        json={
            "item_ids": [str(world["item_two"].id)],
            "zone_id": zone["id"],
        },
    )
    assert draft_task.status_code == 201
    archived = admin.post(f"/api/v1/inspection-plans/{archived_id}:archive")
    assert archived.status_code == 200
    archived_task_path = f"/api/v1/inspection-tasks/{draft_task.json()['id']}"
    archived_operations = (
        admin.post(f"{archived_task_path}:start"),
        admin.post(f"{archived_task_path}:complete"),
        admin.post(f"{archived_task_path}:cancel", json={"reason": "封存中"}),
        admin.post(f"{archived_task_path}:restore"),
        admin.delete(archived_task_path),
        admin.post(f"{archived_task_path}:dispatch"),
        admin.post(
            f"{archived_task_path}:assign",
            json={"assignee_id": str(world["field_user"].id)},
        ),
        admin.patch(
            archived_task_path,
            json={"zone_id": None, "location_text": "封存地點"},
        ),
    )
    for response in archived_operations:
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "inspection_plan.archived"
    before_title = world["item_two"].title
    before_revision = world["item_two"].standard_revision
    rejected = admin.patch(
        f"{base}/inspection-items/{world['item_two'].id}",
        json={"title": "封存拒絕後不得變更", "reinspect": False},
    )
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == "inspection_plan.archived"
    db_session.refresh(world["item_two"])
    db_session.refresh(world["project"])
    assert world["item_two"].title == before_title
    assert world["item_two"].standard_revision == before_revision
    stored_task = db_session.get(InspectionTask, UUID(draft_task.json()["id"]))
    assert stored_task is not None and stored_task.status == "DRAFT"


def test_cancelled_task_restore_uses_current_item_standard(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "還原標準"},
    )
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    )
    task_id = task.json()["id"]
    task_path = f"/api/v1/inspection-tasks/{task_id}"
    assert admin.post(f"{task_path}:dispatch").status_code == 200
    assert admin.post(f"{task_path}:start").status_code == 200
    cancelled = admin.post(
        f"{task_path}:cancel", json={"reason": "標準更新期間"}
    )
    assert cancelled.status_code == 200
    item_path = (
        f"/api/v1/projects/{project_id}/inspection-items/{world['item'].id}"
    )
    changed = admin.patch(
        item_path, json={"title": "目前採用標準", "reinspect": False}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["affected_tasks"][0]["action"] == (
        "apply_current_standard_on_restore"
    )
    restored = admin.post(f"{task_path}:restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "IN_PROGRESS"
    assert restored.json()["items"][0]["current_snapshot"]["title"] == (
        "目前採用標準"
    )
