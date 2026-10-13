"""Inspection planning HTTP contracts (IP-AC01 through IP-AC11)."""

import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import event, func, select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db import base as db_base
from app.db.base import uuid7
from app.db.clock import reset_clock, set_clock
from app.db.engine import get_engine
from app.models import (
    AuditLog,
    InspectionTask,
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
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
        id=uuid7(),
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
        id=uuid7(),
        project_id=project.id,
        sequence=2,
        title="鋼筋檢查",
        instruction="確認鋼筋間距",
        source_template_name="示範範本",
        applied_at=admin.created_at,
        created_by=admin.id,
        updated_by=admin.id,
    )
    # IP-R14：一般規劃案例使用可建立 Task 的有效來源項目。
    item_point = ProjectInspectionPoint(
        project_inspection_item_id=item.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
        created_by=admin.id,
        updated_by=admin.id,
    )
    item_two_point = ProjectInspectionPoint(
        project_inspection_item_id=item_two.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
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
            item_point,
            item_two_point,
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
        "field_reader_user": field_reader,
        "plain_user": plain_member,
        "admin_user": admin,
        "project": project,
        "item": item,
        "item_two": item_two,
    }


def _bind_boundary_fixture(value: Any, ids: dict[str, str]) -> Any:
    """將前端契約 fixture 的識別代碼換成 API 測試建立的真實 ID。"""
    if isinstance(value, str):
        for token, identifier in ids.items():
            value = value.replace(token, identifier)
        return value
    if isinstance(value, list):
        return [_bind_boundary_fixture(item, ids) for item in value]
    if isinstance(value, dict):
        return {
            key: _bind_boundary_fixture(item, ids)
            for key, item in value.items()
        }
    return value


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
        "company_role",
        "planned_start_date",
        "planned_completion_date",
    }
    assert basic.json()["project_code"] == "PLAN-API-1"
    assert basic.json()["company_role"] == "contractor"
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


def test_assignee_candidates_keep_inactive_members_until_ip_r12_activation(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    inactive = world["field_user_two"]
    inactive.is_active = False
    db_session.commit()

    response = world["admin"].get(
        f"/api/v1/projects/{world['project'].id}/inspection-task-assignees"
    )

    assert response.status_code == 200, response.text
    candidate_ids = {UUID(row["id"]) for row in response.json()["items"]}
    assert world["field_user"].id in candidate_ids
    assert inactive.id in candidate_ids
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
            "name": "示範任務",
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
        id=uuid7(),
        project_id=project.id,
        sequence=2,
        title="第二查核項目",
        instruction="示範指示",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_at=world["item"].created_at + timedelta(seconds=1),
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    # IP-R14：此列表案例要涵蓋有效的第二項目與外部任務。
    second_item_point = ProjectInspectionPoint(
        project_inspection_item_id=second_item.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add_all([second_item, second_item_point])
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
        id=uuid7(),
        project_id=foreign_project.id,
        sequence=1,
        title="未授權查核項目",
        instruction="示範指示",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    # IP-R14：外部任務須有有效點位，才能測試專案邊界而非建立驗證。
    foreign_item_point = ProjectInspectionPoint(
        project_inspection_item_id=foreign_item.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add_all([foreign_item, foreign_item_point])
    db_session.commit()
    foreign_plan = admin.post(
        f"/api/v1/projects/{foreign_project.id}/inspection-plans",
        json={"name": "未授權計畫"},
    )
    assert foreign_plan.status_code == 201, foreign_plan.text
    foreign_task = admin.post(
        f"/api/v1/inspection-plans/{foreign_plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(foreign_item.id)]},
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
            "name": "示範任務",
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
                "name": "示範任務",
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
                    "name": "示範任務",
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
        assert detail.json()["started_by"] is None
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
                name="示範任務",
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
                    name="示範任務",
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


def test_field_task_items_keep_request_order_within_one_millisecond(
    db_session, make_client, monkeypatch
):
    # #475: a task's items share created_at under a frozen clock, so the
    # list summary and the detail fall back to the id tie-break. Pin
    # every id to one millisecond to cover a fast database.
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]
    item, item_two = world["item"], world["item_two"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "Item order"},
    )
    assert plan.status_code == 201, plan.text
    now_ns = time.time_ns()
    monkeypatch.setattr(
        db_base, "time", SimpleNamespace(time_ns=lambda: now_ns)
    )
    frozen = datetime.now(UTC).replace(microsecond=0)
    set_clock(lambda: frozen)
    try:
        expected = {}
        for order in [(item, item_two), (item_two, item)] * 3:
            created = admin.post(
                f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
                json={
                    "name": "示範任務",
                    "item_ids": [str(row.id) for row in order],
                    "suggested_assignee_id": str(world["field_user"].id),
                },
            )
            assert created.status_code == 201, created.text
            task_id = created.json()["id"]
            dispatched = admin.post(
                f"/api/v1/inspection-tasks/{task_id}:dispatch"
            )
            assert dispatched.status_code == 200, dispatched.text
            expected[task_id] = [row.title for row in order]

        listed = field.get("/api/v1/field/inspection-tasks")
        assert listed.status_code == 200, listed.text
        assert {
            row["id"]: row["item_summary"]["first_title"]
            for row in listed.json()["items"]
        } == {task_id: titles[0] for task_id, titles in expected.items()}
        for task_id, titles in expected.items():
            detail = field.get(f"/api/v1/field/inspection-tasks/{task_id}")
            assert detail.status_code == 200, detail.text
            assert [row["title"] for row in detail.json()["items"]] == titles
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
                            "unit": None,
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    updated_point = updated.json()["inspection_points"][0]
    assert updated_point["numeric_standard"]["unit"] == "mm"
    assert updated_point["measurement_fields"][1]["unit"] == "mm"

    listed = admin.get(f"/api/v1/projects/{project.id}/inspection-items")
    assert listed.status_code == 200, listed.text
    listed_item = next(
        item
        for item in listed.json()["items"]
        if item["id"] == str(world["item"].id)
    )
    persisted_point = listed_item["inspection_points"][0]
    assert persisted_point["measurement_fields"][1]["unit"] == "mm"
    assert persisted_point["numeric_standard"]["unit"] == "mm"

    client_ids = {
        field["id"]: str(uuid4())
        for field in persisted_point["measurement_fields"]
    }
    numeric = persisted_point["numeric_standard"]
    patch_numeric = {
        key: numeric[key]
        for key in (
            "value",
            "condition",
            "unit",
            "tolerance",
            "range_form",
            "lower_bound",
            "upper_bound",
        )
    }
    patch_numeric["measurement_field_client_id"] = client_ids[
        str(numeric["measurement_field_id"])
    ]
    roundtrip_point = {
        key: persisted_point[key]
        for key in ("sequence", "title", "instruction", "text_standard")
    }
    roundtrip_point["numeric_standard"] = patch_numeric
    roundtrip_point["measurement_fields"] = [
        {
            "client_id": client_ids[str(field["id"])],
            "name": field["name"],
            "field_type": field["field_type"],
            "unit": (
                None
                if field["id"] == numeric["measurement_field_id"]
                else field["unit"]
            ),
        }
        for field in persisted_point["measurement_fields"]
    ]
    roundtrip_point["evidence_requirements"] = [
        {"min_count": requirement["min_count"]}
        for requirement in persisted_point["evidence_requirements"]
    ]
    roundtrip = admin.patch(
        item_url, json={"inspection_points": [roundtrip_point]}
    )
    assert roundtrip.status_code == 200, roundtrip.text
    roundtrip_result = roundtrip.json()["inspection_points"][0]
    assert roundtrip_result["measurement_fields"][1]["unit"] == "mm"
    assert roundtrip_result["numeric_standard"]["unit"] == "mm"

    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "量測欄位排序"},
    )
    assert plan.status_code == 201, plan.text
    created = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
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


def test_project_item_patch_preserves_point_and_field_ids(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    item = world["item"]
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    kept_field_client_id = uuid4()
    removed_field_client_id = uuid4()
    initial = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "量測點",
                    "instruction": "初始量測說明",
                    "numeric_standard": {
                        "value": "10",
                        "condition": "=",
                        "unit": "mm",
                        "measurement_field_client_id": str(
                            kept_field_client_id
                        ),
                    },
                    "measurement_fields": [
                        {
                            "client_id": str(kept_field_client_id),
                            "name": "保留欄位",
                            "field_type": "number",
                            "unit": None,
                        },
                        {
                            "client_id": str(removed_field_client_id),
                            "name": "移除欄位",
                            "field_type": "text",
                            "unit": None,
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                },
                {
                    "sequence": 2,
                    "title": "移除點",
                    "instruction": "移除的說明",
                    "text_standard": {"text": "舊標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
            ]
        },
    )
    assert initial.status_code == 200, initial.text
    initial_points = initial.json()["inspection_points"]
    first_point = initial_points[0]
    removed_point = initial_points[1]
    kept_field_id = first_point["measurement_fields"][0]["id"]
    removed_field_id = first_point["measurement_fields"][1]["id"]

    new_field_client_id = uuid4()
    updated = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "id": first_point["id"],
                    "sequence": 2,
                    "title": "量測點更新",
                    "instruction": "更新量測說明",
                    "numeric_standard": {
                        "value": "12",
                        "condition": "=",
                        "unit": "cm",
                        "measurement_field_client_id": kept_field_id,
                    },
                    "measurement_fields": [
                        {
                            "id": kept_field_id,
                            "client_id": kept_field_id,
                            "name": "保留欄位更新",
                            "field_type": "number",
                            "unit": None,
                        },
                        {
                            "client_id": str(new_field_client_id),
                            "name": "新增欄位",
                            "field_type": "text",
                            "unit": None,
                        },
                    ],
                    "evidence_requirements": [{"min_count": 2}],
                },
                {
                    "sequence": 1,
                    "title": "新增點",
                    "instruction": "新增的說明",
                    "text_standard": {"text": "新標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
            ]
        },
    )
    assert updated.status_code == 200, updated.text
    points = updated.json()["inspection_points"]
    point_ids = {point["id"] for point in points}
    assert len(points) == 2
    assert first_point["id"] in point_ids
    assert removed_point["id"] not in point_ids
    preserved = next(
        point for point in points if point["id"] == first_point["id"]
    )
    assert preserved["sequence"] == 2
    assert preserved["title"] == "量測點更新"
    fields = preserved["measurement_fields"]
    kept_field = next(
        field for field in fields if field["name"] == "保留欄位更新"
    )
    new_field = next(field for field in fields if field["name"] == "新增欄位")
    assert kept_field["id"] == kept_field_id
    assert removed_field_id not in {field["id"] for field in fields}
    assert new_field["id"] != removed_field_id
    assert new_field["id"] != kept_field_id
    assert preserved["numeric_standard"]["measurement_field_id"] == (
        kept_field_id
    )
    assert len(point_ids) == 2

    legacy = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "舊契約點一",
                    "instruction": "仍接受未提供 client_id 的舊請求",
                    "text_standard": {"text": "舊契約標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
                {
                    "sequence": 2,
                    "title": "舊契約點二",
                    "instruction": "以整組替換維持舊契約",
                    "text_standard": {"text": "舊契約標準二"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
            ]
        },
    )
    assert legacy.status_code == 200, legacy.text
    legacy_ids = {point["id"] for point in legacy.json()["inspection_points"]}
    assert legacy_ids.isdisjoint(point_ids)


def test_project_item_patch_locks_task_structure_without_reinspection(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    item = world["item"]
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    initial = []
    for sequence in (1, 2):
        initial.append(
            {
                "sequence": sequence,
                "title": f"項次 {sequence}",
                "instruction": "初始說明",
                "text_standard": {"text": "初始標準"},
                "measurement_fields": [
                    {
                        "client_id": str(uuid4()),
                        "name": f"欄位 {sequence}",
                        "field_type": "text",
                        "unit": None,
                    }
                ],
                "evidence_requirements": [{"min_count": 1}],
            }
        )
    created = admin.patch(item_url, json={"inspection_points": initial})
    assert created.status_code == 200, created.text
    points = created.json()["inspection_points"]
    foreign_point_response = admin.patch(
        f"/api/v1/projects/{project.id}/inspection-items/{world['item_two'].id}",
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "同專案外項目點位",
                    "instruction": "外項目",
                    "text_standard": {"text": "不可修改"},
                    "measurement_fields": [
                        {
                            "client_id": str(uuid4()),
                            "name": "外項目欄位",
                            "field_type": "text",
                            "unit": None,
                        }
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert foreign_point_response.status_code == 200
    same_project_foreign = foreign_point_response.json()["inspection_points"][
        0
    ]

    other_project = Project(
        project_code="PLAN-API-FOREIGN",
        name="其他專案",
        client_name="其他業主",
        site_location="其他工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(other_project)
    db_session.flush()
    other_project_item = ProjectInspectionItem(
        project_id=other_project.id,
        sequence=1,
        title="其他專案項目",
        instruction="其他專案說明",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(other_project_item)
    db_session.commit()
    other_project_response = admin.patch(
        f"/api/v1/projects/{other_project.id}/inspection-items/"
        f"{other_project_item.id}",
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "其他專案點位",
                    "instruction": "其他專案",
                    "text_standard": {"text": "不可修改"},
                    "measurement_fields": [
                        {
                            "client_id": str(uuid4()),
                            "name": "其他專案欄位",
                            "field_type": "text",
                            "unit": None,
                        }
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert other_project_response.status_code == 200
    other_project_foreign = other_project_response.json()["inspection_points"][
        0
    ]

    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "結構鎖定"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(item.id)]},
    )
    assert task.status_code == 201, task.text
    dispatched = admin.post(
        f"/api/v1/inspection-tasks/{task.json()['id']}:dispatch"
    )
    assert dispatched.status_code == 200, dispatched.text

    def point_payload(point, *, title=None, field_type="text", fields=None):
        field = point["measurement_fields"][0]
        return {
            "id": point["id"],
            "sequence": point["sequence"],
            "title": title or point["title"],
            "instruction": "更新說明",
            "text_standard": {"text": "更新標準"},
            "measurement_fields": fields
            if fields is not None
            else [
                {
                    "id": field["id"],
                    "client_id": field["id"],
                    "name": "更新欄位",
                    "field_type": field_type,
                    "unit": None,
                }
            ],
            "evidence_requirements": [{"min_count": 1}],
        }

    updated_points = [
        point_payload(point, title="內容可更正") for point in points
    ]
    original_field_ids = {
        field["id"]
        for point in points
        for field in point["measurement_fields"]
    }
    updated_points[0]["sequence"] = 2
    updated_points[1]["sequence"] = 1
    allowed = admin.patch(
        item_url,
        json={"inspection_points": updated_points, "reinspect": False},
    )
    assert allowed.status_code == 200, allowed.text
    allowed_ids = {
        point["id"]: {field["id"] for field in point["measurement_fields"]}
        for point in allowed.json()["inspection_points"]
    }
    assert set(allowed_ids) == {point["id"] for point in points}
    assert {
        field_id
        for field_ids in allowed_ids.values()
        for field_id in field_ids
    } == original_field_ids
    task_id = task.json()["id"]
    snapshot_before_rejections = admin.get(
        f"/api/v1/inspection-tasks/{task_id}"
    ).json()["items"][0]["current_snapshot"]
    snapshot_points_before = db_session.scalars(
        select(TaskSnapshotPoint).where(
            TaskSnapshotPoint.snapshot_id
            == db_session.scalar(
                select(TaskRequirementSnapshot.id).where(
                    TaskRequirementSnapshot.task_inspection_item_id
                    == db_session.scalar(
                        select(TaskInspectionItem.id).where(
                            TaskInspectionItem.task_id == UUID(task_id),
                            TaskInspectionItem.project_inspection_item_id
                            == item.id,
                        )
                    ),
                    TaskRequirementSnapshot.is_current.is_(True),
                )
            )
        )
    ).all()
    assert {row.source_point_id for row in snapshot_points_before} == {
        UUID(point_id) for point_id in allowed_ids
    }
    snapshot_field_ids_before = set(
        db_session.scalars(
            select(TaskSnapshotMeasurementField.source_field_id).where(
                TaskSnapshotMeasurementField.point_id.in_(
                    [row.id for row in snapshot_points_before]
                )
            )
        ).all()
    )
    assert snapshot_field_ids_before == {
        UUID(field_id) for field_id in original_field_ids
    }
    assert {
        point_row["title"]
        for point_row in snapshot_before_rejections["inspection_points"]
    } == {"內容可更正"}

    photo_requirement_changes = [
        {**point, "evidence_requirements": [{"min_count": 2}]}
        for point in updated_points
    ]
    photo_change = admin.patch(
        item_url,
        json={
            "inspection_points": photo_requirement_changes,
            "reinspect": False,
        },
    )
    assert photo_change.status_code == 422, photo_change.text
    assert photo_change.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    missing_point_identity = [
        {key: value for key, value in point.items() if key != "id"}
        for point in updated_points
    ]
    missing_point_identity_response = admin.patch(
        item_url,
        json={
            "inspection_points": missing_point_identity,
            "reinspect": False,
        },
    )
    assert missing_point_identity_response.status_code == 422
    assert missing_point_identity_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    missing_field_identity = [
        {
            **point,
            "measurement_fields": [
                dict(field) for field in point["measurement_fields"]
            ],
        }
        for point in updated_points
    ]
    missing_field_identity[0]["measurement_fields"][0].pop("id")
    missing_field_identity_response = admin.patch(
        item_url,
        json={
            "inspection_points": missing_field_identity,
            "reinspect": False,
        },
    )
    assert missing_field_identity_response.status_code == 422
    assert missing_field_identity_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    db_session.expire_all()
    stored_point_ids = set(
        db_session.scalars(
            select(ProjectInspectionPoint.id).where(
                ProjectInspectionPoint.project_inspection_item_id == item.id
            )
        ).all()
    )
    assert stored_point_ids == {UUID(point_id) for point_id in allowed_ids}
    for point_id, field_ids in allowed_ids.items():
        stored_field_ids = set(
            db_session.scalars(
                select(ProjectMeasurementField.id).where(
                    ProjectMeasurementField.inspection_point_id
                    == UUID(point_id)
                )
            ).all()
        )
        assert stored_field_ids == {UUID(field_id) for field_id in field_ids}
    snapshot_after_rejections = admin.get(
        f"/api/v1/inspection-tasks/{task_id}"
    ).json()["items"][0]["current_snapshot"]
    assert snapshot_after_rejections == snapshot_before_rejections

    added_point = {
        "sequence": 3,
        "title": "新增項次",
        "instruction": "新增說明",
        "text_standard": {"text": "新增標準"},
        "measurement_fields": [],
        "evidence_requirements": [{"min_count": 1}],
    }
    added_point_response = admin.patch(
        item_url,
        json={
            "inspection_points": [*updated_points, added_point],
            "reinspect": False,
        },
    )
    assert added_point_response.status_code == 422
    assert added_point_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    removed_point_response = admin.patch(
        item_url,
        json={"inspection_points": updated_points[:1], "reinspect": False},
    )
    assert removed_point_response.status_code == 422
    assert removed_point_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    point = points[0]
    field = point["measurement_fields"][0]
    added_field = {
        "client_id": str(uuid4()),
        "name": "新增欄位",
        "field_type": "text",
        "unit": None,
    }
    field_add_point = point_payload(
        point,
        fields=[
            {
                "id": field["id"],
                "client_id": field["id"],
                "name": "更新欄位",
                "field_type": "text",
                "unit": None,
            },
            added_field,
        ],
    )
    field_add_point["sequence"] = 2
    field_add_response = admin.patch(
        item_url,
        json={
            "inspection_points": [field_add_point, updated_points[1]],
            "reinspect": False,
        },
    )
    assert field_add_response.status_code == 422
    assert field_add_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    field_remove_point = point_payload(point, fields=[])
    field_remove_point["sequence"] = 2
    field_remove_response = admin.patch(
        item_url,
        json={
            "inspection_points": [field_remove_point, updated_points[1]],
            "reinspect": False,
        },
    )
    assert field_remove_response.status_code == 422
    assert field_remove_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    field_type_point = point_payload(point, field_type="number")
    field_type_point["measurement_fields"][0]["unit"] = "mm"
    field_type_point["sequence"] = 2
    field_type_response = admin.patch(
        item_url,
        json={
            "inspection_points": [field_type_point, updated_points[1]],
            "reinspect": False,
        },
    )
    assert field_type_response.status_code == 422
    assert field_type_response.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    )

    empty_response = admin.patch(
        item_url, json={"inspection_points": [], "reinspect": True}
    )
    assert empty_response.status_code == 422
    assert empty_response.json()["error"]["code"] == (
        "project_inspection_item.points_required"
    )

    foreign_point = point_payload(point)
    foreign_point["id"] = same_project_foreign["id"]
    same_project_foreign_response = admin.patch(
        item_url,
        json={
            "inspection_points": [foreign_point, point_payload(points[1])],
            "reinspect": True,
        },
    )
    assert same_project_foreign_response.status_code == 422
    assert same_project_foreign_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    other_project_point = point_payload(point)
    other_project_point["id"] = other_project_foreign["id"]
    other_project_point_response = admin.patch(
        item_url,
        json={
            "inspection_points": [
                other_project_point,
                point_payload(points[1]),
            ],
            "reinspect": True,
        },
    )
    assert other_project_point_response.status_code == 422
    assert other_project_point_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    foreign_field_point = point_payload(point)
    foreign_field_point["measurement_fields"][0]["id"] = same_project_foreign[
        "measurement_fields"
    ][0]["id"]
    same_project_foreign_field_response = admin.patch(
        item_url,
        json={
            "inspection_points": [
                foreign_field_point,
                point_payload(points[1]),
            ],
            "reinspect": True,
        },
    )
    assert same_project_foreign_field_response.status_code == 422
    assert same_project_foreign_field_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    foreign_field_point = point_payload(point)
    foreign_field_point["measurement_fields"][0]["id"] = other_project_foreign[
        "measurement_fields"
    ][0]["id"]
    foreign_field_response = admin.patch(
        item_url,
        json={
            "inspection_points": [foreign_field_point, updated_points[1]],
            "reinspect": True,
        },
    )
    assert foreign_field_response.status_code == 422
    assert foreign_field_response.json()["error"]["code"] == (
        "request.validation_failed"
    )
    assert (
        db_session.get(
            ProjectInspectionPoint, UUID(same_project_foreign["id"])
        ).title
        == "同專案外項目點位"
    )
    assert (
        db_session.get(
            ProjectMeasurementField,
            UUID(same_project_foreign["measurement_fields"][0]["id"]),
        ).name
        == "外項目欄位"
    )
    assert (
        db_session.get(
            ProjectInspectionPoint, UUID(other_project_foreign["id"])
        ).title
        == "其他專案點位"
    )
    assert (
        db_session.get(
            ProjectMeasurementField,
            UUID(other_project_foreign["measurement_fields"][0]["id"]),
        ).name
        == "其他專案欄位"
    )

    duplicate_id = point_payload(points[1])
    duplicate_id["id"] = point["id"]
    duplicate_response = admin.patch(
        item_url,
        json={
            "inspection_points": [
                point_payload(point),
                duplicate_id,
            ],
            "reinspect": True,
        },
    )
    assert duplicate_response.status_code == 422
    assert duplicate_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    duplicate_field_point = point_payload(point)
    duplicate_field = duplicate_field_point["measurement_fields"][0]
    duplicate_field_point["measurement_fields"] = [
        dict(duplicate_field),
        dict(duplicate_field),
    ]
    duplicate_field_response = admin.patch(
        item_url,
        json={
            "inspection_points": [
                duplicate_field_point,
                point_payload(points[1]),
            ],
            "reinspect": True,
        },
    )
    assert duplicate_field_response.status_code == 422
    assert duplicate_field_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    point_client_alias = point_payload(point)
    point_client_alias["client_id"] = point["id"]
    point_client_alias_response = admin.patch(
        item_url,
        json={"inspection_points": [point_client_alias]},
    )
    assert point_client_alias_response.status_code == 422
    assert point_client_alias_response.json()["error"]["code"] == (
        "request.validation_failed"
    )

    numeric_field_alias = point_payload(point, field_type="number")
    numeric_field_alias["text_standard"] = None
    numeric_field_alias["numeric_standard"] = {
        "value": "12",
        "condition": "=",
        "unit": "mm",
        "measurement_field_id": point["measurement_fields"][0]["id"],
        "measurement_field_client_id": point["measurement_fields"][0]["id"],
    }
    numeric_field_alias_response = admin.patch(
        item_url,
        json={"inspection_points": [numeric_field_alias]},
    )
    assert numeric_field_alias_response.status_code == 422
    assert numeric_field_alias_response.json()["error"]["code"] == (
        "request.validation_failed"
    )


def test_reinspect_point_deletion_refreshes_only_the_changed_task_snapshot(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]

    def patch_item(item, points, *, reinspect=None):
        payload = {"inspection_points": points}
        if reinspect is not None:
            payload["reinspect"] = reinspect
        return admin.patch(
            f"/api/v1/projects/{project.id}/inspection-items/{item.id}",
            json=payload,
        )

    def point(sequence, title):
        return {
            "sequence": sequence,
            "title": title,
            "instruction": f"{title} 說明",
            "text_standard": {"text": f"{title} 標準"},
            "measurement_fields": [],
            "evidence_requirements": [{"min_count": 1}],
        }

    created = patch_item(
        world["item"], [point(1, "保留點"), point(2, "刪除點")]
    )
    assert created.status_code == 200, created.text
    source_points = created.json()["inspection_points"]
    kept_point_id = UUID(source_points[0]["id"])
    deleted_point_id = UUID(source_points[1]["id"])
    second_item_created = patch_item(
        world["item_two"], [point(1, "未變更項目點")]
    )
    assert second_item_created.status_code == 200, second_item_created.text

    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "刪除點位重查"},
    )
    assert plan.status_code == 201, plan.text
    created_task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "示範任務",
            "item_ids": [str(world["item"].id), str(world["item_two"].id)],
        },
    )
    assert created_task.status_code == 201, created_task.text
    task_id = UUID(created_task.json()["id"])
    dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
    assert dispatched.status_code == 200, dispatched.text

    task_items = db_session.scalars(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task_id)
    ).all()
    changed_task_item = next(
        row
        for row in task_items
        if row.project_inspection_item_id == world["item"].id
    )
    unchanged_task_item = next(
        row
        for row in task_items
        if row.project_inspection_item_id == world["item_two"].id
    )
    unchanged_snapshot_before = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id
            == unchanged_task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert unchanged_snapshot_before is not None

    patched = patch_item(
        world["item"],
        [
            {
                "id": str(kept_point_id),
                "sequence": 1,
                "title": "保留點更新",
                "instruction": "更新說明",
                "text_standard": {"text": "更新標準"},
                "measurement_fields": [],
                "evidence_requirements": [{"min_count": 1}],
            }
        ],
        reinspect=True,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["affected_tasks"][0]["action"] == "updated"

    db_session.expire_all()
    changed_snapshots = db_session.scalars(
        select(TaskRequirementSnapshot)
        .where(
            TaskRequirementSnapshot.task_inspection_item_id
            == changed_task_item.id
        )
        .order_by(TaskRequirementSnapshot.revision)
    ).all()
    assert len(changed_snapshots) == 2
    assert changed_snapshots[0].is_current is False
    assert changed_snapshots[0].superseded_reason == "STANDARD_CHANGED"
    assert changed_snapshots[1].is_current is True
    old_snapshot_points = db_session.scalars(
        select(TaskSnapshotPoint).where(
            TaskSnapshotPoint.snapshot_id == changed_snapshots[0].id
        )
    ).all()
    assert {row.source_point_id for row in old_snapshot_points} == {
        kept_point_id,
        deleted_point_id,
    }
    current_snapshot_points = db_session.scalars(
        select(TaskSnapshotPoint).where(
            TaskSnapshotPoint.snapshot_id == changed_snapshots[1].id
        )
    ).all()
    assert {row.source_point_id for row in current_snapshot_points} == {
        kept_point_id
    }
    unchanged_snapshot_after = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id
            == unchanged_task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert unchanged_snapshot_after is not None
    assert unchanged_snapshot_after.id == unchanged_snapshot_before.id
    assert (
        unchanged_snapshot_after.revision == unchanged_snapshot_before.revision
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
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
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


def test_draft_task_allows_project_item_structure_update_in_place(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    item = world["item"]
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    initial = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "保留項次",
                    "instruction": "原說明",
                    "text_standard": {"text": "原標準"},
                    "measurement_fields": [
                        {
                            "client_id": str(uuid4()),
                            "name": "保留欄位",
                            "field_type": "text",
                            "unit": None,
                        },
                        {
                            "client_id": str(uuid4()),
                            "name": "移除欄位",
                            "field_type": "text",
                            "unit": None,
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                },
                {
                    "sequence": 2,
                    "title": "移除項次",
                    "instruction": "原說明",
                    "text_standard": {"text": "原標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
            ]
        },
    )
    assert initial.status_code == 200, initial.text
    original_points = initial.json()["inspection_points"]
    retained = original_points[0]
    retained_field = retained["measurement_fields"][0]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "草稿同步結構"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "草稿結構更新", "item_ids": [str(item.id)]},
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]

    updated = admin.patch(
        item_url,
        json={
            "reinspect": True,
            "inspection_points": [
                {
                    "id": retained["id"],
                    "sequence": 1,
                    "title": "保留項次更新",
                    "instruction": "新說明",
                    "text_standard": {"text": "新標準"},
                    "measurement_fields": [
                        {
                            "id": retained_field["id"],
                            "client_id": retained_field["id"],
                            "name": "保留欄位更新",
                            "field_type": "text",
                            "unit": None,
                        },
                        {
                            "client_id": str(uuid4()),
                            "name": "新增欄位",
                            "field_type": "number",
                            "unit": "mm",
                        },
                    ],
                    "evidence_requirements": [{"min_count": 2}],
                },
                {
                    "sequence": 2,
                    "title": "新增項次",
                    "instruction": "新說明",
                    "text_standard": {"text": "新標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                },
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    updated_points = updated.json()["inspection_points"]
    assert len(updated_points) == 2
    assert updated_points[0]["id"] == retained["id"]
    assert updated_points[0]["title"] == "保留項次更新"
    assert [
        field["name"] for field in updated_points[0]["measurement_fields"]
    ] == [
        "保留欄位更新",
        "新增欄位",
    ]
    assert updated_points[1]["title"] == "新增項次"
    assert updated_points[1]["id"] != original_points[1]["id"]
    assert updated.json()["affected_tasks"] == [
        {
            "task_id": task_id,
            "prior_status": "DRAFT",
            "status": "DRAFT",
            "action": "draft_updated",
            "needs_reinspection": False,
        }
    ]
    current_task = admin.get(f"/api/v1/inspection-tasks/{task_id}")
    assert current_task.status_code == 200
    assert current_task.json()["status"] == "DRAFT"
    snapshot = current_task.json()["items"][0]["current_snapshot"]
    assert [point["title"] for point in snapshot["inspection_points"]] == [
        "保留項次更新",
        "新增項次",
    ]
    assert (
        snapshot["inspection_points"][0]["text_standard"]["text"] == "新標準"
    )


def test_dispatched_project_item_rejects_standard_structure_changes(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    item = world["item"]
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    field_client_id = uuid4()
    second_field_client_id = uuid4()
    created = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "厚度",
                    "instruction": "測量厚度",
                    "text_standard": None,
                    "numeric_standard": {
                        "value": "10",
                        "condition": "=",
                        "unit": "mm",
                        "measurement_field_client_id": str(field_client_id),
                    },
                    "measurement_fields": [
                        {
                            "client_id": str(field_client_id),
                            "name": "厚度",
                            "field_type": "number",
                            "unit": None,
                        },
                        {
                            "client_id": str(second_field_client_id),
                            "name": "寬度",
                            "field_type": "number",
                            "unit": "mm",
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert created.status_code == 200, created.text
    point = created.json()["inspection_points"][0]
    fields = point["measurement_fields"]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "標準結構鎖定"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "已派出結構鎖定", "item_ids": [str(item.id)]},
    )
    assert task.status_code == 201, task.text
    dispatched = admin.post(
        f"/api/v1/inspection-tasks/{task.json()['id']}:dispatch"
    )
    assert dispatched.status_code == 200, dispatched.text

    def payload(*, kind="numeric", binding=None, unit="mm"):
        numeric = None
        text = None
        active_binding = binding or fields[0]["id"]
        if kind == "numeric":
            numeric = {
                "value": "12",
                "condition": "=",
                "unit": unit,
                "measurement_field_client_id": active_binding,
            }
        elif kind == "text":
            text = {"text": "文字標準可編"}
        return {
            "reinspect": False,
            "inspection_points": [
                {
                    "id": point["id"],
                    "sequence": 1,
                    "title": "標題可編",
                    "instruction": "說明可編",
                    "text_standard": text,
                    "numeric_standard": numeric,
                    "measurement_fields": [
                        {
                            "id": fields[0]["id"],
                            "client_id": fields[0]["id"],
                            "name": "欄位名稱可編",
                            "field_type": "number",
                            "unit": (
                                None
                                if kind == "numeric"
                                and active_binding == fields[0]["id"]
                                else "mm"
                            ),
                        },
                        {
                            "id": fields[1]["id"],
                            "client_id": fields[1]["id"],
                            "name": "寬度",
                            "field_type": "number",
                            "unit": (
                                None
                                if kind == "numeric"
                                and active_binding == fields[1]["id"]
                                else "mm"
                            ),
                        },
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ],
        }

    changed_field_unit = payload()
    changed_field_unit["inspection_points"][0]["measurement_fields"][1][
        "unit"
    ] = "cm"
    invalid_payloads = [
        payload(kind="text"),
        payload(binding=fields[1]["id"]),
        changed_field_unit,
        payload(unit="cm"),
    ]
    for index, invalid in enumerate(invalid_payloads):
        response = admin.patch(item_url, json=invalid)
        assert response.status_code == 422, f"case {index}: {response.text}"
        assert response.json()["error"]["code"] == (
            "project_inspection_item.structure_locked"
        ), f"case {index}: {response.text}"


def test_project_item_invalid_structure_precedes_missing_reinspect_choice(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "結構錯誤優先序"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    assert task.status_code == 201, task.text

    item_url = (
        f"/api/v1/projects/{world['project'].id}"
        f"/inspection-items/{world['item'].id}"
    )
    # 驗證結構錯誤先回 fields，避免缺少 reinspect 遮蔽可修正原因。
    invalid = admin.patch(
        item_url,
        json={"inspection_points": [_item_point([])]},
    )

    assert invalid.status_code == 422, invalid.text
    error = invalid.json()["error"]
    assert error["code"] == "request.validation_failed"
    assert error["fields"] == [
        {
            "path": "/inspection_points/0/evidence_requirements",
            "code": "field.too_short",
        }
    ]


def _dispatched_field_task(world, plan_name, assignee_id=None):
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": plan_name},
    )
    assert plan.status_code == 201, plan.text
    body: dict[str, Any] = {
        "name": "示範任務",
        "item_ids": [str(world["item"].id)],
    }
    if assignee_id is not None:
        body["suggested_assignee_id"] = str(assignee_id)
    created = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks", json=body
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    assert (
        admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch").status_code
        == 200
    )
    return plan.json()["id"], task_id


def test_field_task_detail_shows_starter_name_and_cancel_reason_only(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    starter = world["field_user"]
    other = world["field_user_two"]
    starter.name_zh = "示範查核員甲"
    other.name_zh = "示範查核員乙"
    db_session.commit()
    _, task_id = _dispatched_field_task(world, "開始者顯示", other.id)
    url = f"/api/v1/field/inspection-tasks/{task_id}"

    before = world["field"].get(url).json()
    assert before["started_by"] is None
    assert before["cancellation_reason"] is None
    assert before["suggested_assignee"] == {
        "name_zh": "示範查核員乙",
        "is_me": False,
    }
    assert world["field_two"].get(url).json()["suggested_assignee"] == {
        "name_zh": "示範查核員乙",
        "is_me": True,
    }

    started = world["field"].post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    mine = world["field"].get(url)
    assert mine.json()["started_by"] == {
        "name_zh": "示範查核員甲",
        "is_me": True,
    }
    theirs = world["field_two"].get(url)
    assert theirs.json()["started_by"] == {
        "name_zh": "示範查核員甲",
        "is_me": False,
    }
    # Names only: no account name, e-mail or user id leaks through.
    for leaked in (starter.username, str(starter.id), str(other.id)):
        assert leaked not in mine.text
        assert leaked not in theirs.text
    assert starter.email is None or starter.email not in mine.text

    cancelled = admin.post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "施工順序調整"},
    )
    assert cancelled.status_code == 200, cancelled.text
    after = world["field"].get(url).json()
    assert after["status"] == "CANCELLED"
    assert after["cancellation_reason"] == "施工順序調整"
    restored = admin.post(f"/api/v1/inspection-tasks/{task_id}:restore")
    assert restored.status_code == 200, restored.text
    assert world["field"].get(url).json()["cancellation_reason"] is None


def test_field_task_detail_hides_starter_and_reason_for_drafts_and_readers(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "草稿不洩漏"},
    )
    draft = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    draft_url = f"/api/v1/field/inspection-tasks/{draft.json()['id']}"
    assert world["field"].get(draft_url).status_code == 404
    _, task_id = _dispatched_field_task(world, "唯讀不可見")
    cancelled = admin.post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "內部原因"},
    )
    assert cancelled.status_code == 200, cancelled.text
    url = f"/api/v1/field/inspection-tasks/{task_id}"
    for client in (world["reader"], world["plain"], world["outsider"]):
        denied = client.get(url)
        assert denied.status_code == 404
        assert "內部原因" not in denied.text
    assert make_client().get(url).status_code == 401


def test_field_start_rejections_map_to_distinct_error_codes(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]

    def start(client, task_id):
        return client.post(f"/api/v1/inspection-tasks/{task_id}:start")

    _, cancelled_id = _dispatched_field_task(world, "取消後開始")
    assert (
        admin.post(
            f"/api/v1/inspection-tasks/{cancelled_id}:cancel",
            json={"reason": "改日重派"},
        ).status_code
        == 200
    )
    rejected = start(field, cancelled_id)
    assert rejected.status_code == 409
    assert rejected.json()["error"]["code"] == (
        "inspection_task.invalid_transition"
    )

    _, started_id = _dispatched_field_task(world, "他人已開始")
    assert start(world["field_two"], started_id).status_code == 200
    again = start(field, started_id)
    assert again.status_code == 409
    assert again.json()["error"]["code"] == (
        "inspection_task.invalid_transition"
    )

    plan_id, archived_id = _dispatched_field_task(world, "封存後開始")
    assert (
        admin.post(f"/api/v1/inspection-plans/{plan_id}:archive").status_code
        == 200
    )
    archived = start(field, archived_id)
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "inspection_plan.archived"

    _, readable_id = _dispatched_field_task(world, "權限不足")
    forbidden = start(world["reader"], readable_id)
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "permission.denied"
    assert start(field, uuid4()).status_code == 404
    assert start(make_client(), readable_id).status_code == 401


def test_task_lifecycle_completion_archiving_and_assignment_are_api_gated(
    db_session, make_client
):
    """驗證 IP-AC06～IP-AC09 的真 API 任務生命週期。"""
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    plan_url = f"/api/v1/projects/{project.id}/inspection-plans"
    plan = admin.post(plan_url, json={"name": "狀態計畫"})
    assert plan.status_code == 201, plan.text
    plan_id = plan.json()["id"]
    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    task_url = f"/api/v1/inspection-plans/{plan_id}/tasks"
    create = admin.post(
        task_url,
        json={
            "name": "示範任務",
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
    # IP-R05：建議指派人不排他，實際操作者必須記在 Task 欄位。
    field_two = world["field_two"]
    started = field_two.post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    assert started.json()["started_by"] == str(world["field_user_two"].id)
    completed = field_two.post(f"/api/v1/inspection-tasks/{task_id}:complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["completed_by"] == str(world["field_user_two"].id)
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
        json={"name": "示範任務", "item_ids": [str(world["item_two"].id)]},
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


def test_frontend_boundary_fixture_is_accepted_and_read_back_by_api(
    db_session, make_client
):
    """驗證 RG-M22 fixture 的計畫、Task 與地點 API 情境。

    涵蓋 IP-AC02、IP-AC04、IP-AC05、IP-AC07 與 IP-AC11 的部分流程。
    """
    repository_root = Path(__file__).resolve().parents[3]
    fixture_path = (
        repository_root
        / "frontend/src/admin/planning/fixtures/"
        / "inspection-planning-boundary.json"
    )
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    requests = fixture["requests"]
    world = _planning_world(db_session, make_client)
    project = world["project"]
    admin = world["admin"]
    # 分區 CRUD 使用獨立專案，
    # 讓端點契約和 Task 地點情境分開。
    zone_project = Project(
        project_code="PLAN-CONTRACT-ZONE",
        name="分區契約專案",
        client_name="示範業主",
        site_location="示範工地",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(zone_project)
    db_session.commit()
    point = db_session.scalar(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id
            == world["item"].id
        )
    )
    assert point is not None
    ids = {
        "$PROJECT_ID": str(project.id),
        "$ZONE_PROJECT_ID": str(zone_project.id),
        "$TASK_ID": "$TASK_ID",
        "$ITEM_ID": str(world["item"].id),
        "$POINT_ID": str(point.id),
        "$ASSIGNEE_ID": str(world["field_user"].id),
    }

    used = set()

    def send(name: str):
        used.add(name)
        request = _bind_boundary_fixture(requests[name], ids)
        kwargs = {}
        if "body" in request:
            kwargs["json"] = request["body"]
        return admin.request(
            request["method"], f"/api/v1{request['path']}", **kwargs
        )

    created_zone = send("zone_create")
    assert created_zone.status_code == 201, created_zone.text
    created_zone_id = created_zone.json()["id"]
    zones_readback = admin.get(f"/api/v1/projects/{zone_project.id}/zones")
    assert zones_readback.status_code == 200, zones_readback.text
    zone_names = {}
    for zone in zones_readback.json()["items"]:
        zone_names[zone["id"]] = zone["name"]
    assert zone_names[created_zone_id] == "第二階段驗收區"

    created_plan = send("plan_create")
    assert created_plan.status_code == 201, created_plan.text
    plan_id = created_plan.json()["id"]
    ids["$PLAN_ID"] = plan_id
    plan_readback = admin.get(f"/api/v1/inspection-plans/{plan_id}")
    assert plan_readback.status_code == 200, plan_readback.text
    assert plan_readback.json()["name"] == "前後端共用契約"

    created_task = send("task_create")
    assert created_task.status_code == 201, created_task.text
    task_id = created_task.json()["id"]
    ids["$TASK_ID"] = task_id
    assert created_task.json()["status"] == "DRAFT"
    assert created_task.json()["name"] == "表面檢查－東側機房"
    assert created_task.json()["zone_id"] is None
    assert created_task.json()["location_text"] == "東側機房"
    task_readback = admin.get(f"/api/v1/inspection-tasks/{task_id}")
    assert task_readback.status_code == 200, task_readback.text
    assert task_readback.json()["zone_id"] is None
    assert task_readback.json()["name"] == "表面檢查－東側機房"
    assert task_readback.json()["location_text"] == "東側機房"

    task_zone = send("task_zone_create")
    assert task_zone.status_code == 201, task_zone.text
    task_zone_id = task_zone.json()["id"]
    ids["$ZONE_ID"] = task_zone_id
    zoned_task = send("task_create_with_zone")
    assert zoned_task.status_code == 201, zoned_task.text
    zoned_task_id = zoned_task.json()["id"]
    zoned_task_readback = admin.get(
        f"/api/v1/inspection-tasks/{zoned_task_id}"
    )
    assert zoned_task_readback.status_code == 200, zoned_task_readback.text
    assert zoned_task_readback.json()["zone_id"] == task_zone_id
    assert zoned_task_readback.json()["location_text"] == "地下室管線區"

    assigned = send("task_assign")
    assert assigned.status_code == 200, assigned.text
    assert assigned.json()["assignee_id"] == str(world["field_user"].id)

    archived_for_blocker = send("plan_archive_blocker")
    assert archived_for_blocker.status_code == 200, archived_for_blocker.text
    blocked_dispatch = send("task_dispatch_blocked")
    assert blocked_dispatch.status_code == 409
    assert (
        blocked_dispatch.json()["error"]["code"]
        == requests["task_dispatch_blocked"]["error_code"]
    )
    unchanged_task = admin.get(f"/api/v1/inspection-tasks/{task_id}")
    assert unchanged_task.status_code == 200, unchanged_task.text
    assert unchanged_task.json()["status"] == "DRAFT"
    assert unchanged_task.json()["dispatched_at"] is None
    restored_plan = send("plan_unarchive_recovery")
    assert restored_plan.status_code == 200, restored_plan.text
    assert restored_plan.json()["status"] == "DRAFT"

    dispatched = send("task_dispatch")
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["status"] == "PENDING"
    started = send("task_start")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "IN_PROGRESS"

    reinspect = send("item_reinspect_yes")
    assert reinspect.status_code == 200, reinspect.text
    assert reinspect.json()["reinspection_selected"] is True
    assert reinspect.json()["title"] == "表面檢查（新標準）"
    reinspect_no = send("item_reinspect_no")
    assert reinspect_no.status_code == 200, reinspect_no.text
    assert reinspect_no.json()["reinspection_selected"] is False
    assert reinspect_no.json()["title"] == "表面檢查（文字更正）"

    task_readback = admin.get(f"/api/v1/inspection-tasks/{task_id}")
    assert task_readback.status_code == 200, task_readback.text
    task_data = task_readback.json()
    assert task_data["status"] == "IN_PROGRESS"
    assert task_data["items"][0]["current_snapshot"]["title"] == (
        "表面檢查（文字更正）"
    )
    assert task_data["items"][0]["needs_reinspection"] is False

    cancelled = send("task_cancel")
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"
    restored = send("task_restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "IN_PROGRESS"

    archived = send("plan_archive")
    assert archived.status_code == 200, archived.text
    assert archived.json()["status"] == "ARCHIVED"
    assert used == set(requests)


def test_project_item_api_refreshes_task_snapshot_and_respects_archived_plan(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{world['item'].id}"
    )
    initial = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": 1,
                    "title": "表面",
                    "instruction": "檢視表面",
                    "text_standard": {"text": "無裂縫"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert initial.status_code == 200, initial.text
    point_id = initial.json()["inspection_points"][0]["id"]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "快照計畫"},
    )
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    task_id = task.json()["id"]
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
                    "id": point_id,
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
            "name": "示範任務",
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
                "name": "示範任務",
                "item_ids": [str(world["item"].id)],
                "zone_id": zones[0].json()["id"],
            },
        )
        assert response.status_code == 201, response.text
        tasks.append(response)
    extra_task = admin.post(
        f"/api/v1/inspection-plans/{plans[0].json()['id']}/tasks",
        json={
            "name": "示範任務",
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
        id=uuid7(),
        project_id=foreign.id,
        sequence=1,
        title="外部項目",
        instruction="外部說明",
        source_template_name="外部範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    # IP-R14：外部任務須有有效點位，才能測試專案邊界而非建立驗證。
    foreign_item_point = ProjectInspectionPoint(
        project_inspection_item_id=foreign_item.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add_all([foreign_zone, foreign_item, foreign_item_point])
    db_session.add(
        ProjectMember(
            project_id=foreign.id,
            user_id=world["plain_user"].id,
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
        )
    )
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
            "name": "示範任務",
            "item_ids": [str(foreign_item.id)],
            "zone_id": str(foreign_zone.id),
        },
    )
    assert foreign_task.status_code == 201, foreign_task.text
    plain = world["plain"]
    outsider = world["outsider"]
    plan_path = f"/api/v1/inspection-plans/{foreign_plan.json()['id']}"
    task_path = f"/api/v1/inspection-tasks/{foreign_task.json()['id']}"
    for path in (
        plan_path,
        f"{plan_path}/tasks",
        task_path,
    ):
        denied = plain.get(path)
        assert denied.status_code == 403, denied.text
        assert denied.json() == {"error": {"code": "permission.denied"}}
        hidden = outsider.get(path)
        assert hidden.status_code == 404, hidden.text
        assert hidden.json() == {"error": {"code": "resource.not_found"}}

    member_plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "成員可讀計畫"},
    )
    assert member_plan.status_code == 201, member_plan.text
    member_task = admin.post(
        f"/api/v1/inspection-plans/{member_plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    assert member_task.status_code == 201, member_task.text
    dispatched_member_task = admin.post(
        f"/api/v1/inspection-tasks/{member_task.json()['id']}:dispatch"
    )
    assert dispatched_member_task.status_code == 200
    member_plan_path = f"/api/v1/inspection-plans/{member_plan.json()['id']}"
    member_task_path = f"/api/v1/inspection-tasks/{member_task.json()['id']}"
    assert world["reader"].get(member_plan_path).status_code == 200
    assert world["reader"].get(f"{member_plan_path}/tasks").status_code == 200
    for path in (member_plan_path, f"{member_plan_path}/tasks"):
        assert world["plain"].get(path).status_code == 403
    assert world["reader"].get(member_task_path).status_code == 403
    assert world["field"].get(member_task_path).status_code == 200

    assert admin.get(plan_path).status_code == 200
    assert admin.get(f"{plan_path}/tasks").status_code == 200
    assert admin.get(task_path).status_code == 200
    missing_plan = (
        "/api/v1/inspection-plans/00000000-0000-7000-8000-000000000000"
    )
    missing_task = (
        "/api/v1/inspection-tasks/00000000-0000-7000-8000-000000000000"
    )
    for client in (admin, outsider):
        for path in (missing_plan, f"{missing_plan}/tasks", missing_task):
            missing = client.get(path)
            assert missing.status_code == 404, missing.text
            assert missing.json() == {"error": {"code": "resource.not_found"}}

    # Project-scoped lists authorize against the project before looking up
    # individual plans/items, so no per-resource existence is exposed.
    scoped_paths = (
        f"/api/v1/projects/{foreign.id}/inspection-plans",
        f"/api/v1/projects/{foreign.id}/inspection-tasks",
        (
            f"/api/v1/projects/{foreign.id}/inspection-items/"
            f"{foreign_item.id}/tasks"
        ),
        (
            f"/api/v1/projects/{foreign.id}/inspection-items/"
            "00000000-0000-7000-8000-000000000000/tasks"
        ),
    )
    for path in scoped_paths:
        denied = outsider.get(path)
        assert denied.status_code == 403, denied.text
        assert denied.json() == {"error": {"code": "permission.denied"}}

    reader = world["reader"]
    for path in (plan_path, f"{plan_path}/tasks", task_path):
        hidden = reader.get(path)
        assert hidden.status_code == 404, hidden.text
        assert hidden.json() == {"error": {"code": "resource.not_found"}}

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


def test_global_plan_task_writes_hide_nonmember_resources(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    outsider = world["outsider"]
    project_id = world["project"].id
    plan_response = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "非成員隱藏測試"},
    )
    assert plan_response.status_code == 201, plan_response.text
    plan_id = plan_response.json()["id"]
    plan_path = f"/api/v1/inspection-plans/{plan_id}"
    task_response = admin.post(
        f"{plan_path}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    assert task_response.status_code == 201, task_response.text
    task_id = task_response.json()["id"]
    task_path = f"/api/v1/inspection-tasks/{task_id}"
    missing_id = "00000000-0000-7000-8000-000000000000"
    missing_plan = f"/api/v1/inspection-plans/{missing_id}"
    missing_task = f"/api/v1/inspection-tasks/{missing_id}"

    plan_operations = (
        ("PATCH", plan_path, {"name": "不應修改"}),
        (
            "POST",
            f"{plan_path}/tasks",
            {"name": "示範任務", "item_ids": [str(world["item"].id)]},
        ),
        ("POST", f"{plan_path}:archive", None),
        ("POST", f"{plan_path}:unarchive", None),
    )
    task_operations = (
        ("POST", f"{task_path}:dispatch", None),
        ("POST", f"{task_path}:assign", {"assignee_id": None}),
        ("POST", f"{task_path}:start", None),
        ("POST", f"{task_path}:complete", None),
        ("POST", f"{task_path}:cancel", {"reason": "不應取消"}),
        ("POST", f"{task_path}:restore", None),
        ("DELETE", task_path, None),
        (
            "PATCH",
            task_path,
            {"zone_id": None, "location_text": "不應修改"},
        ),
    )
    for method, path, body in plan_operations + task_operations:
        response = outsider.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
        assert response.json() == {"error": {"code": "resource.not_found"}}

    missing_operations = (
        ("PATCH", missing_plan, {"name": "不存在"}),
        (
            "POST",
            f"{missing_plan}/tasks",
            {"name": "示範任務", "item_ids": [str(world["item"].id)]},
        ),
        ("POST", f"{missing_plan}:archive", None),
        ("POST", f"{missing_plan}:unarchive", None),
        ("POST", f"{missing_task}:dispatch", None),
        ("POST", f"{missing_task}:assign", {"assignee_id": None}),
        ("POST", f"{missing_task}:start", None),
        ("POST", f"{missing_task}:complete", None),
        ("POST", f"{missing_task}:cancel", {"reason": "不存在"}),
        ("POST", f"{missing_task}:restore", None),
        ("DELETE", missing_task, None),
        (
            "PATCH",
            missing_task,
            {"zone_id": None, "location_text": "不存在"},
        ),
    )
    for method, path, body in missing_operations:
        response = outsider.request(method, path, json=body)
        assert response.status_code == 404, (method, path, response.text)
        assert response.json() == {"error": {"code": "resource.not_found"}}

    role = Role(
        name="API archive member",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[
            RolePermission(code="inspection_plan.archive"),
            RolePermission(code="inspection_plan.unarchive"),
        ],
    )
    db_session.add(role)
    db_session.flush()
    manager_user = create_root_user_with_company(
        db_session, "PLAN-API-MANAGER"
    )
    db_session.add(
        ProjectMember(
            project_id=project_id,
            user_id=manager_user.id,
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
            role_assignments=[ProjectMemberRole(role_id=role.id)],
        )
    )
    db_session.commit()
    manager_token = create_session(db_session, manager_user)[1]
    db_session.commit()
    manager = _client(make_client, manager_token)
    archived = manager.post(f"{plan_path}:archive")
    assert archived.status_code == 200, archived.text
    unarchived = manager.post(f"{plan_path}:unarchive")
    assert unarchived.status_code == 200, unarchived.text
    for path in (f"{missing_plan}:archive", f"{missing_plan}:unarchive"):
        missing = manager.post(path)
        assert missing.status_code == 404, missing.text
        assert missing.json() == {"error": {"code": "resource.not_found"}}


def test_inspection_planning_malformed_ids_use_validation_error(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    outsider = world["outsider"]
    project_id = world["project"].id
    cases = (
        ("GET", "/api/v1/projects/not-a-uuid/inspection-plans", None),
        ("GET", "/api/v1/projects/not-a-uuid/zones", None),
        ("GET", "/api/v1/inspection-plans/not-a-uuid", None),
        ("GET", "/api/v1/inspection-plans/not-a-uuid/tasks", None),
        ("POST", "/api/v1/inspection-plans/not-a-uuid:archive", None),
        ("POST", "/api/v1/inspection-tasks/not-a-uuid:start", None),
        ("GET", "/api/v1/inspection-tasks/not-a-uuid", None),
        ("GET", "/api/v1/field/inspection-tasks/not-a-uuid", None),
        (
            "GET",
            f"/api/v1/projects/{project_id}/inspection-items/not-a-uuid/tasks",
            None,
        ),
        (
            "PATCH",
            f"/api/v1/projects/{project_id}/zones/not-a-uuid",
            {"name": "新名稱"},
        ),
    )
    for method, path, body in cases:
        # Both Admin and nonmember requests reject malformed input before
        # either role can reach a permission or resource lookup.
        for client in (admin, outsider):
            response = client.request(method, path, json=body)
            assert response.status_code == 422, (
                method,
                path,
                response.status_code,
                response.text,
            )
            assert response.json() == {
                "error": {"code": "request.validation_failed"}
            }


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
    missing_name = admin.post(
        create_url, json={"item_ids": [str(world["item"].id)]}
    )
    assert missing_name.status_code == 422
    assert missing_name.json()["error"]["code"] == (
        "request.validation_failed"
    )
    empty_items = admin.post(
        create_url, json={"name": "示範任務", "item_ids": []}
    )
    assert empty_items.status_code == 422
    assert (
        empty_items.json()["error"]["code"] == "inspection_task.items_required"
    )
    invalid_item = admin.post(
        create_url,
        json={
            "name": "示範任務",
            "item_ids": ["00000000-0000-7000-8000-000000000000"],
        },
    )
    assert invalid_item.status_code == 422
    assert invalid_item.json()["error"]["code"] == (
        "inspection_task.invalid_project_item"
    )
    invalid_zone = admin.post(
        create_url,
        json={
            "name": "示範任務",
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
            "name": "示範任務",
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
            "name": "示範任務",
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
            "name": "示範任務",
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
                "name": "示範任務",
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
            "name": "示範任務",
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


def test_task_rename_validates_permissions_state_and_audit(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "任務命名"},
    ).json()
    created = admin.post(
        f"/api/v1/inspection-plans/{plan['id']}/tasks",
        json={
            "name": "初始任務",
            "item_ids": [str(world["item"].id)],
        },
    )
    assert created.status_code == 201, created.text
    task_id = UUID(created.json()["id"])
    task_path = f"/api/v1/inspection-tasks/{task_id}"

    for client in (world["plain"], world["reader"], world["field_reader"]):
        denied = client.patch(task_path, json={"name": "無權改名"})
        assert denied.status_code == 403

    task = db_session.get(InspectionTask, task_id)
    assert task is not None
    manager_role = db_session.scalar(
        select(Role).where(Role.name == "API planning manager")
    )
    manager_member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == world["field_user_two"].id,
        )
    )
    assert manager_role is not None and manager_member is not None
    manager_member.role_assignments.append(
        ProjectMemberRole(role_id=manager_role.id)
    )
    db_session.commit()
    manager = world["field_two"]

    for invalid_name in ("   ", "x" * 129):
        invalid = admin.patch(task_path, json={"name": invalid_name})
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == (
            "inspection_task.invalid_name"
        )

    rejected_combined = admin.patch(
        task_path,
        json={"name": "雙用途欄位", "zone_id": None, "location_text": None},
    )
    assert rejected_combined.status_code == 422
    assert rejected_combined.json()["error"]["code"] == (
        "request.validation_failed"
    )

    renamed = manager.patch(task_path, json={"name": "  更新任務  "})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "更新任務"
    no_op = manager.patch(task_path, json={"name": "更新任務"})
    assert no_op.status_code == 200
    assert no_op.json()["name"] == "更新任務"
    duplicate = admin.post(
        f"/api/v1/inspection-plans/{plan['id']}/tasks",
        json={
            "name": "更新任務",
            "item_ids": [str(world["item"].id)],
        },
    )
    assert duplicate.status_code == 201, duplicate.text
    events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == task_id,
                AuditLog.event_type == "inspection_task.renamed",
            )
        )
    )
    assert len(events) == 1
    assert events[0].before == {"name": "初始任務"}
    assert events[0].after == {"name": "更新任務"}

    dispatched = admin.post(f"{task_path}:dispatch")
    assert dispatched.status_code == 200, dispatched.text
    pending_rename = manager.patch(task_path, json={"name": "待開始已改名"})
    assert pending_rename.status_code == 200, pending_rename.text
    assert pending_rename.json()["status"] == "PENDING"
    started = admin.post(f"{task_path}:start")
    assert started.status_code == 200, started.text
    in_progress_rename = manager.patch(
        task_path, json={"name": "進行中已改名"}
    )
    assert in_progress_rename.status_code == 200, in_progress_rename.text
    assert in_progress_rename.json()["status"] == "IN_PROGRESS"

    task = db_session.get(InspectionTask, task_id)
    assert task is not None
    task.status = "COMPLETED"
    db_session.commit()
    completed = manager.patch(task_path, json={"name": "完成後不可改"})
    assert completed.status_code == 409
    assert completed.json()["error"]["code"] == (
        "inspection_task.invalid_transition"
    )
    db_session.refresh(task)
    assert task.name == "進行中已改名"
    renamed_count = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(
            AuditLog.entity_id == task_id,
            AuditLog.event_type == "inspection_task.renamed",
        )
    )
    assert renamed_count == 3

    cancelled_task = admin.post(
        f"/api/v1/inspection-plans/{plan['id']}/tasks",
        json={
            "name": "取消狀態任務",
            "item_ids": [str(world["item_two"].id)],
        },
    )
    assert cancelled_task.status_code == 201, cancelled_task.text
    cancelled_id = cancelled_task.json()["id"]
    cancelled_path = f"/api/v1/inspection-tasks/{cancelled_id}"
    assert admin.post(f"{cancelled_path}:dispatch").status_code == 200
    assert (
        admin.post(
            f"{cancelled_path}:cancel", json={"reason": "驗證鎖定"}
        ).status_code
        == 200
    )
    before_cancelled_name = cancelled_task.json()["name"]
    before_cancelled_audits = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.entity_id == UUID(cancelled_id))
    )
    cancelled_rename = manager.patch(
        cancelled_path, json={"name": "取消後不可改"}
    )
    assert cancelled_rename.status_code == 409
    assert cancelled_rename.json()["error"]["code"] == (
        "inspection_task.invalid_transition"
    )
    cancelled_row = db_session.get(InspectionTask, UUID(cancelled_id))
    assert cancelled_row is not None
    db_session.refresh(cancelled_row)
    assert cancelled_row.name == before_cancelled_name
    after_cancelled_audits = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.entity_id == UUID(cancelled_id))
    )
    assert after_cancelled_audits == before_cancelled_audits

    archived_plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "封存任務命名"},
    ).json()
    archived_task = admin.post(
        f"/api/v1/inspection-plans/{archived_plan['id']}/tasks",
        json={
            "name": "封存前名稱",
            "item_ids": [str(world["item_two"].id)],
        },
    ).json()
    archived_result = admin.post(
        f"/api/v1/inspection-plans/{archived_plan['id']}:archive"
    )
    assert archived_result.status_code == 200
    archived_rename = admin.patch(
        f"/api/v1/inspection-tasks/{archived_task['id']}",
        json={"name": "封存後不可改"},
    )
    assert archived_rename.status_code == 409
    assert archived_rename.json()["error"]["code"] == (
        "inspection_plan.archived"
    )


def test_task_creation_rejects_items_without_points_atomically(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project = world["project"]
    empty_item = world["item_two"]
    empty_item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{empty_item.id}"
    )
    # IP-AC15 允許未被 Task 使用的項目暫時沒有點位；Task 建立端仍須拒絕。
    emptied = admin.patch(empty_item_url, json={"inspection_points": []})
    assert emptied.status_code == 200, emptied.text
    assert emptied.json()["inspection_points"] == []
    plan = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "零點位拒絕"},
    )
    assert plan.status_code == 201, plan.text
    create_url = f"/api/v1/inspection-plans/{plan.json()['id']}/tasks"
    audit_count = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.project_id == project.id)
    )

    single_item = admin.post(
        create_url, json={"name": "示範任務", "item_ids": [str(empty_item.id)]}
    )
    assert single_item.status_code == 422, single_item.text
    assert single_item.json()["error"]["code"] == (
        "inspection_task.item_without_points"
    )

    mixed_items = admin.post(
        create_url,
        json={
            "name": "示範任務",
            "item_ids": [str(world["item"].id), str(empty_item.id)],
        },
    )
    assert mixed_items.status_code == 422, mixed_items.text
    assert mixed_items.json()["error"]["code"] == (
        "inspection_task.item_without_points"
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(InspectionTask)
            .where(InspectionTask.project_id == project.id)
        )
        == 0
    )
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.project_id == project.id)
        )
        == audit_count
    )

    # IP-AC15：已被 Task 使用的項目不得改成零項次，且資料維持不變。
    used_item = world["item"]
    used_item_url = (
        f"/api/v1/projects/{project.id}/inspection-items/{used_item.id}"
    )
    list_url = f"/api/v1/projects/{project.id}/inspection-items"

    def read_points() -> list[dict]:
        listed = admin.get(list_url)
        assert listed.status_code == 200, listed.text
        return next(
            item["inspection_points"]
            for item in listed.json()["items"]
            if item["id"] == str(used_item.id)
        )

    used_task = admin.post(
        create_url, json={"name": "示範任務", "item_ids": [str(used_item.id)]}
    )
    assert used_task.status_code == 201, used_task.text
    before = read_points()
    assert before
    emptied_used = admin.patch(used_item_url, json={"inspection_points": []})
    assert emptied_used.status_code == 422, emptied_used.text
    assert emptied_used.json()["error"]["code"] == (
        "project_inspection_item.points_required"
    )
    assert read_points() == before


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
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
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


def test_nonmember_admin_can_start_and_complete_tasks(db_session, make_client):
    """Admin 即使不是專案成員，仍可依 IP-AC10 操作任務。"""
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "非成員 Admin 現場操作"},
    )
    assert plan.status_code == 201

    task_paths = []
    for _ in range(2):
        task = admin.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
        )
        assert task.status_code == 201
        task_path = f"/api/v1/inspection-tasks/{task.json()['id']}"
        assert admin.post(f"{task_path}:dispatch").status_code == 200
        task_paths.append(task_path)

    admin_member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == world["admin_user"].id,
        )
    )
    assert admin_member is not None
    db_session.delete(admin_member)
    db_session.commit()

    started = admin.post(f"{task_paths[0]}:start")
    assert started.status_code == 200, started.text
    assert started.json()["started_by"] == str(world["admin_user"].id)

    member_started = field.post(f"{task_paths[1]}:start")
    assert member_started.status_code == 200, member_started.text
    completed = admin.post(f"{task_paths[1]}:complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["completed_by"] == str(world["admin_user"].id)


def _item_point(rows: list[dict], sequence: int = 1) -> dict:
    return {
        "sequence": sequence,
        "title": "外觀",
        "instruction": "拍照",
        "text_standard": {"text": "無破損"},
        "evidence_requirements": rows,
    }


def test_project_item_patch_rejects_invalid_point_structure(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    item_url = (
        f"/api/v1/projects/{world['project'].id}"
        f"/inspection-items/{world['item'].id}"
    )
    two_rows = admin.patch(
        item_url,
        json={
            "inspection_points": [
                _item_point([{"min_count": 1}, {"min_count": 2}])
            ]
        },
    )
    assert two_rows.status_code == 422, two_rows.text
    assert two_rows.json()["error"]["code"] == "request.validation_failed"
    assert two_rows.json()["error"]["fields"] == [
        {
            "path": "/inspection_points/0/evidence_requirements",
            "code": "field.too_long",
        }
    ]
    no_rows = admin.patch(
        item_url, json={"inspection_points": [_item_point([])]}
    )
    assert no_rows.status_code == 422, no_rows.text
    assert no_rows.json()["error"]["fields"] == [
        {
            "path": "/inspection_points/0/evidence_requirements",
            "code": "field.too_short",
        }
    ]
    repeated_sequence = admin.patch(
        item_url,
        json={
            "inspection_points": [
                _item_point([{"min_count": 1}]),
                _item_point([{"min_count": 1}]),
            ]
        },
    )
    assert repeated_sequence.status_code == 422, repeated_sequence.text
    assert repeated_sequence.json()["error"]["code"] == (
        "request.validation_failed"
    )
    assert repeated_sequence.json()["error"]["fields"] == [
        {
            "path": "/inspection_points/0/sequence",
            "code": "template.sequence_duplicate",
        },
        {
            "path": "/inspection_points/1/sequence",
            "code": "template.sequence_duplicate",
        },
    ]
    client_id = str(uuid4())
    bound_unit = admin.patch(
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
                        "measurement_field_client_id": client_id,
                    },
                    "measurement_fields": [
                        {
                            "client_id": client_id,
                            "name": "綁定欄位",
                            "field_type": "number",
                            "unit": "mm",
                        }
                    ],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ]
        },
    )
    assert bound_unit.status_code == 422, bound_unit.text
    assert bound_unit.json()["error"]["fields"] == [
        {
            "path": "/inspection_points/0/measurement_fields/0/unit",
            "code": "template.bound_field_unit_forbidden",
        }
    ]
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(func.count()).select_from(ProjectEvidenceRequirement)
        )
        == 0
    )
    unchanged = db_session.get(ProjectInspectionItem, world["item"].id)
    assert unchanged is not None
    assert unchanged.standard_revision == 1


def test_project_item_patch_orders_mixed_errors_by_body_position(
    db_session, make_client
):
    """API-R10：同一請求的不同類錯誤依本文位置排序，不依偵測順序。"""
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    item_url = (
        f"/api/v1/projects/{world['project'].id}"
        f"/inspection-items/{world['item'].id}"
    )
    client_id = str(uuid4())
    bound_point = {
        "sequence": 1,
        "title": "量測項次",
        "instruction": "量測說明",
        "numeric_standard": {
            "value": "5",
            "condition": "=",
            "unit": "mm",
            "measurement_field_client_id": client_id,
        },
        "measurement_fields": [
            {
                "client_id": client_id,
                "name": "綁定欄位",
                "field_type": "number",
                "unit": "mm",
            }
        ],
        "evidence_requirements": [{"min_count": 1}],
    }

    # sequence 重複在彙整階段才偵測，晚於 unit 違規；但同一項次的
    # sequence 在模型中排在 measurement_fields 之前，須依本文位置排序。
    response = admin.patch(
        item_url,
        json={
            "inspection_points": [
                bound_point,
                _item_point([{"min_count": 1}]),
            ]
        },
    )

    assert response.status_code == 422, response.text
    assert [
        (field["path"], field["code"])
        for field in response.json()["error"]["fields"]
    ] == [
        (
            "/inspection_points/0/sequence",
            "template.sequence_duplicate",
        ),
        (
            "/inspection_points/0/measurement_fields/0/unit",
            "template.bound_field_unit_forbidden",
        ),
        (
            "/inspection_points/1/sequence",
            "template.sequence_duplicate",
        ),
    ]


def test_one_photo_requirement_keeps_task_flows_working(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    item_url = (
        f"/api/v1/projects/{project_id}/inspection-items/{world['item'].id}"
    )
    patched = admin.patch(
        item_url,
        json={"inspection_points": [_item_point([{"min_count": 3}])]},
    )
    assert patched.status_code == 200, patched.text
    point_id = patched.json()["inspection_points"][0]["id"]
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "單一照片需求"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    assert task.status_code == 201, task.text

    used_by_draft = admin.patch(
        item_url,
        json={
            "reinspect": True,
            "inspection_points": [
                {
                    **_item_point([{"min_count": 2}]),
                    "id": point_id,
                }
            ],
        },
    )
    assert used_by_draft.status_code == 200, used_by_draft.text
    assert used_by_draft.json()["affected_tasks"][0]["action"] == (
        "draft_updated"
    )

    task_path = f"/api/v1/inspection-tasks/{task.json()['id']}"
    assert admin.post(f"{task_path}:dispatch").status_code == 200
    assert admin.post(f"{task_path}:start").status_code == 200
    cancelled = admin.post(f"{task_path}:cancel", json={"reason": "暫停"})
    assert cancelled.status_code == 200, cancelled.text
    restored = admin.post(f"{task_path}:restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["status"] == "IN_PROGRESS"


def test_cancelled_task_locks_structure_when_reinspection_is_false(
    db_session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    item_id = world["item"].id
    item_url = f"/api/v1/projects/{project_id}/inspection-items/{item_id}"
    current_point = _item_point([{"min_count": 1}])
    created = admin.patch(
        item_url,
        json={"inspection_points": [current_point]},
    )
    assert created.status_code == 200, created.text
    current_point["id"] = created.json()["inspection_points"][0]["id"]
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "取消任務結構鎖"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "取消狀態結構鎖定", "item_ids": [str(item_id)]},
    )
    assert task.status_code == 201, task.text
    task_url = f"/api/v1/inspection-tasks/{task.json()['id']}"
    assert admin.post(f"{task_url}:dispatch").status_code == 200
    cancelled = admin.post(f"{task_url}:cancel", json={"reason": "計畫調整"})
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["status"] == "CANCELLED"

    added_point = {
        "sequence": 2,
        "title": "新增項次",
        "instruction": "新增說明",
        "text_standard": {"text": "新增標準"},
        "measurement_fields": [],
        "evidence_requirements": [{"min_count": 1}],
    }
    locked = admin.patch(
        item_url,
        json={
            "reinspect": False,
            "inspection_points": [current_point, added_point],
        },
    )
    assert locked.status_code == 422, locked.text
    assert locked.json()["error"]["code"] == (
        "project_inspection_item.structure_locked"
    ), locked.text


def _items_world(db_session, make_client, name):
    """建立含一個草稿任務的情境，供 PUT /items 測試共用。"""
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    plan = admin.post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": name},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "項目更新時保留名稱",
            "item_ids": [str(world["item"].id)],
        },
    )
    assert task.status_code == 201, task.text
    world["plan_id"] = plan.json()["id"]
    world["task_id"] = task.json()["id"]
    world["items_url"] = f"/api/v1/inspection-tasks/{task.json()['id']}/items"
    return world


def _task_state(db_session, task_id):
    """回傳任務的項目關聯 id 與稽核筆數，用來斷言失敗不留痕跡。"""
    db_session.expire_all()
    associations = db_session.scalars(
        select(TaskInspectionItem.id)
        .where(TaskInspectionItem.task_id == UUID(task_id))
        .order_by(TaskInspectionItem.id)
    ).all()
    audits = db_session.scalar(
        select(func.count())
        .select_from(AuditLog)
        .where(AuditLog.event_type == "inspection_task.items_updated")
    )
    return list(associations), audits


def test_draft_task_items_api_rebuilds_snapshots_and_audits(
    db_session, make_client
):
    world = _items_world(db_session, make_client, "草稿查核項目修改")
    admin = world["admin"]
    task_id = world["task_id"]
    url = world["items_url"]
    old_association = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert old_association is not None
    old_association_id = old_association.id
    task_before = db_session.get(InspectionTask, UUID(task_id))
    assert task_before is not None
    name_before = task_before.name
    # 倒退 updated_at，確認 PUT 會顯式更新它，而不是靠時鐘剛好不同。
    updated_at_before = task_before.updated_at - timedelta(days=1)
    task_before.updated_at = updated_at_before
    db_session.commit()
    updated = admin.put(
        url,
        json={"item_ids": [str(world["item_two"].id), str(world["item"].id)]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["id"] == task_id
    assert updated.json()["name"] == name_before
    assert updated.json()["status"] == "DRAFT"
    assert {item["id"] for item in updated.json()["items"]} == {
        str(world["item_two"].id),
        str(world["item"].id),
    }
    assert {
        item["current_snapshot"]["title"] for item in updated.json()["items"]
    } == {"鋼筋檢查", "表面檢查"}

    db_session.expire_all()
    persisted_task = db_session.get(InspectionTask, UUID(task_id))
    assert persisted_task is not None
    assert persisted_task.name == name_before
    # 舊關聯與其 Snapshot 一併清除，不留下過期需求。
    assert db_session.get(TaskInspectionItem, old_association_id) is None
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(TaskRequirementSnapshot)
            .where(
                TaskRequirementSnapshot.task_inspection_item_id
                == old_association_id
            )
        )
        == 0
    )
    task_after = db_session.get(InspectionTask, UUID(task_id))
    assert task_after is not None
    assert task_after.updated_at > updated_at_before

    audit = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "inspection_task.items_updated",
            AuditLog.entity_id == UUID(task_id),
        )
    )
    assert audit is not None
    assert audit.before["items"] == {str(world["item"].id): "表面檢查"}
    assert audit.after["items"] == {
        str(world["item_two"].id): "鋼筋檢查",
        str(world["item"].id): "表面檢查",
    }


def test_draft_task_items_api_same_set_is_noop(db_session, make_client):
    world = _items_world(db_session, make_client, "同集合不重建")
    admin = world["admin"]
    before = _task_state(db_session, world["task_id"])

    same = admin.put(
        world["items_url"], json={"item_ids": [str(world["item"].id)]}
    )

    assert same.status_code == 200, same.text
    assert _task_state(db_session, world["task_id"]) == before
    assert before[1] == 0


def test_draft_task_items_api_rejects_invalid_items_without_changes(
    db_session, make_client
):
    world = _items_world(db_session, make_client, "壞項目拒絕")
    admin = world["admin"]
    project = world["project"]
    url = world["items_url"]
    no_points = ProjectInspectionItem(
        id=uuid7(),
        project_id=project.id,
        sequence=3,
        title="無點位項目",
        instruction="示範",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    foreign_project = Project(
        project_code="PLAN-API-ITEMS-FOREIGN",
        name="另一專案",
        client_name="示範業主",
        site_location="示範地點",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add_all([no_points, foreign_project])
    db_session.flush()
    foreign_item = ProjectInspectionItem(
        id=uuid7(),
        project_id=foreign_project.id,
        sequence=1,
        title="跨專案項目",
        instruction="示範",
        source_template_name="示範範本",
        applied_at=world["admin_user"].created_at,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(foreign_item)
    db_session.add(
        ProjectInspectionPoint(
            project_inspection_item_id=foreign_item.id,
            sequence=1,
            title="檢查點",
            instruction="示範",
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
        )
    )
    db_session.commit()
    before = _task_state(db_session, world["task_id"])

    required = "inspection_task.items_required"
    invalid_format = "request.validation_failed"
    invalid_item = "inspection_task.invalid_project_item"
    no_points_code = "inspection_task.item_without_points"
    cases = [
        ([], required),
        ([str(world["item_two"].id)] * 2, invalid_format),
        ([str(uuid4()) for _ in range(201)], invalid_format),
        ([str(uuid4())], invalid_item),
        ([str(foreign_item.id)], invalid_item),
        ([str(world["item_two"].id), str(no_points.id)], no_points_code),
    ]
    for item_ids, code in cases:
        response = admin.put(url, json={"item_ids": item_ids})
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == code, item_ids
        assert _task_state(db_session, world["task_id"]) == before

    no_manage = world["reader"].put(
        url, json={"item_ids": [str(world["item_two"].id)]}
    )
    assert no_manage.status_code == 403
    assert _task_state(db_session, world["task_id"]) == before


def test_draft_task_items_api_checks_state_before_validating_items(
    db_session, make_client
):
    world = _items_world(db_session, make_client, "狀態優先")
    admin = world["admin"]
    url = world["items_url"]
    bad_bodies = (
        {"item_ids": []},
        {"item_ids": [str(uuid4())]},
        {"item_ids": [str(world["item_two"].id)] * 2},
    )

    dispatched = admin.post(
        f"/api/v1/inspection-tasks/{world['task_id']}:dispatch"
    )
    assert dispatched.status_code == 200, dispatched.text
    before = _task_state(db_session, world["task_id"])
    for body in bad_bodies:
        response = admin.put(url, json=body)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == (
            "inspection_task.invalid_transition"
        )
    good = admin.put(url, json={"item_ids": [str(world["item_two"].id)]})
    assert good.status_code == 409, good.text
    assert _task_state(db_session, world["task_id"]) == before

    draft = admin.post(
        f"/api/v1/inspection-plans/{world['plan_id']}/tasks",
        json={
            "name": "封存時保留任務名稱",
            "item_ids": [str(world["item"].id)],
        },
    )
    assert draft.status_code == 201, draft.text
    draft_url = f"/api/v1/inspection-tasks/{draft.json()['id']}/items"
    archived = admin.post(
        f"/api/v1/inspection-plans/{world['plan_id']}:archive"
    )
    assert archived.status_code == 200, archived.text
    draft_before = _task_state(db_session, draft.json()["id"])
    for body in (*bad_bodies, {"item_ids": [str(world["item_two"].id)]}):
        response = admin.put(draft_url, json=body)
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "inspection_plan.archived"
    assert _task_state(db_session, draft.json()["id"]) == draft_before
