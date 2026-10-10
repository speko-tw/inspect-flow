"""List endpoints batch-load children instead of querying per row (#462)."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import (
    Project,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from tests.api.query_count import select_count
from tests.api.test_inspection_planning_api import _planning_world
from tests.db.conftest import create_root_user_with_company

# Generous ceiling for the fixed number of statements one list request may
# issue (auth, permission and batched child loads). A per-row query on any
# of the seeded rows would exceed it.
_MAX_SELECTS = 30
_TASKS = 6


def _point(sequence: int, kind: str) -> dict:
    field_id = str(uuid4())
    point: dict = {
        "sequence": sequence,
        "title": f"point {sequence}",
        "instruction": "check",
        "evidence_requirements": [{"min_count": 1}],
    }
    if kind == "numeric":
        point["numeric_standard"] = {
            "value": "5",
            "condition": "=",
            "unit": "mm",
            "measurement_field_client_id": field_id,
        }
        point["measurement_fields"] = [
            {
                "client_id": field_id,
                "name": "thickness",
                "field_type": "number",
                "unit": "mm",
            },
            {
                "client_id": str(uuid4()),
                "name": "note",
                "field_type": "text",
            },
        ]
    elif kind == "text":
        point["text_standard"] = {"text": "no cracks"}
    return point


@pytest.fixture
def world(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    base = f"/api/v1/projects/{project_id}"
    zone = admin.post(f"{base}/zones", json={"name": "North"}).json()
    for key in ("item", "item_two"):
        response = admin.patch(
            f"{base}/inspection-items/{world[key].id}",
            json={
                "inspection_points": [
                    _point(1, "numeric"),
                    _point(2, "text"),
                    _point(3, "plain"),
                ]
            },
        )
        assert response.status_code == 200, response.text
    admin_user = world["admin_user"]
    for sequence in (3, 4, 5):
        extra = ProjectInspectionItem(
            project_id=project_id,
            sequence=sequence,
            title=f"extra {sequence}",
            instruction="check",
            source_template_name="template",
            applied_at=admin_user.created_at,
            created_by=admin_user.id,
            updated_by=admin_user.id,
        )
        db_session.add(extra)
        db_session.commit()
        response = admin.patch(
            f"{base}/inspection-items/{extra.id}",
            json={
                "inspection_points": [_point(1, "text"), _point(2, "plain")]
            },
        )
        assert response.status_code == 200, response.text
    plan = admin.post(f"{base}/inspection-plans", json={"name": "Plan"})
    world["plan_id"] = plan.json()["id"]
    for _ in range(_TASKS):
        response = admin.post(
            f"/api/v1/inspection-plans/{world['plan_id']}/tasks",
            json={
                "item_ids": [str(world["item"].id), str(world["item_two"].id)],
                "zone_id": zone["id"],
                "suggested_assignee_id": str(world["field_user"].id),
            },
        )
        assert response.status_code == 201, response.text
    world["base"] = base
    return world


def _urls(world) -> dict[str, str]:
    base = world["base"]
    return {
        "project tasks": f"{base}/inspection-tasks",
        "plan tasks": f"/api/v1/inspection-plans/{world['plan_id']}/tasks",
        "item tasks": (f"{base}/inspection-items/{world['item'].id}/tasks"),
        "project items": f"{base}/inspection-items",
    }


@pytest.mark.parametrize(
    "name", ["project tasks", "plan tasks", "item tasks", "project items"]
)
def test_list_select_count_does_not_grow_with_page_size(world, name):
    url = _urls(world)[name]
    admin = world["admin"]
    small, small_items = select_count(admin, url, limit=1)
    middle, middle_items = select_count(admin, url, limit=2)
    large, large_items = select_count(admin, url, limit=100)
    assert small_items == 1
    assert middle_items == 2
    assert large_items > middle_items
    assert small == middle == large
    assert large <= _MAX_SELECTS


def test_plan_detail_select_count_is_fixed_for_many_tasks(world):
    admin = world["admin"]
    url = f"/api/v1/inspection-plans/{world['plan_id']}"
    count, tasks = select_count(admin, url)
    assert tasks == _TASKS
    assert count <= _MAX_SELECTS
    extra = admin.post(
        f"/api/v1/inspection-plans/{world['plan_id']}/tasks",
        json={
            "item_ids": [str(world["item"].id)],
            "zone_id": admin.get(f"{world['base']}/zones").json()["items"][0][
                "id"
            ],
        },
    )
    assert extra.status_code == 201, extra.text
    more_count, more_tasks = select_count(admin, url)
    assert more_tasks == _TASKS + 1
    assert more_count == count


def test_field_task_permission_select_count_does_not_grow_with_projects(
    world, db_session
):
    admin = world["admin"]
    tasks = admin.get(_urls(world)["project tasks"], params={"limit": 1})
    assert tasks.status_code == 200, tasks.text
    task_id = tasks.json()["items"][0]["id"]
    dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
    assert dispatched.status_code == 200, dispatched.text

    inspect_role = db_session.scalar(
        select(Role).where(Role.name == "API field inspector")
    )
    assert inspect_role is not None
    no_inspect_role = Role(
        name="Query count without inspection",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[RolePermission(code="inspection_plan.read")],
    )
    db_session.add(no_inspect_role)
    db_session.flush()

    # Project A has two roles: X lacks inspect, while Y grants it.
    member_a = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == world["project"].id,
            ProjectMember.user_id == world["field_user"].id,
        )
    )
    assert member_a is not None
    member_a.role_assignments.append(
        ProjectMemberRole(role_id=no_inspect_role.id)
    )

    # Project B is a member project with a dispatched Task, but only role X.
    project_b = _create_permission_test_project(
        world,
        db_session,
        project_code="PERMISSION-COUNT-NEGATIVE",
        role_id=no_inspect_role.id,
    )
    task_b_id = project_b["task_id"]

    url = "/api/v1/field/inspection-tasks"
    params = {"assigned_to_me": "false", "limit": 10}
    small, small_items = select_count(world["field"], url, **params)
    assert small_items == 1

    visible = world["field"].get(url, params=params)
    assert visible.status_code == 200, visible.text
    assert task_id in {item["id"] for item in visible.json()["items"]}
    assert task_b_id not in {item["id"] for item in visible.json()["items"]}
    denied = world["field"].get(
        url, params={**params, "project_id": project_b["project_id"]}
    )
    assert denied.status_code == 403, denied.text

    counts = [(small, small_items)]
    for target_projects in (5, 9):
        current_projects = counts[-1][1]
        for index in range(current_projects, target_projects):
            _create_permission_test_project(
                world,
                db_session,
                project_code=f"PERMISSION-COUNT-{index}",
                role_id=inspect_role.id,
            )
        count, visible_tasks = select_count(world["field"], url, **params)
        assert visible_tasks == target_projects
        counts.append((count, visible_tasks))
    assert [items for _, items in counts] == [1, 5, 9]
    assert len({count for count, _ in counts}) == 1


def _create_permission_test_project(
    world, db_session, *, project_code, role_id
):
    admin = world["admin"]
    creator = world["admin_user"]
    project = Project(
        project_code=project_code,
        name=f"{project_code} project",
        client_name="示範業主",
        site_location="示範工地",
        created_by=creator.id,
        updated_by=creator.id,
    )
    db_session.add(project)
    db_session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=world["field_user"].id,
        created_by=creator.id,
        updated_by=creator.id,
        role_assignments=[ProjectMemberRole(role_id=role_id)],
    )
    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="查核項目",
        instruction="確認項目",
        source_template_name="測試範本",
        applied_at=creator.created_at,
        created_by=creator.id,
        updated_by=creator.id,
    )
    db_session.add_all([member, item])
    db_session.commit()

    base = f"/api/v1/projects/{project.id}"
    plan = admin.post(f"{base}/inspection-plans", json={"name": "測試計畫"})
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"item_ids": [str(item.id)]},
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]
    dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
    assert dispatched.status_code == 200, dispatched.text
    return {"project_id": str(project.id), "task_id": task_id}


def test_assignee_query_count_and_cursor_page_do_not_grow_with_members(
    world, db_session
):
    url = f"{world['base']}/inspection-task-assignees"
    small, small_items = select_count(world["admin"], url, limit=2)
    assert small_items == 2

    inspect_role = db_session.scalar(
        select(Role).where(Role.name == "API field inspector")
    )
    assert inspect_role is not None
    added_users = []
    for sequence in range(8):
        person = create_root_user_with_company(db_session, f"PQ{sequence:02}")
        member = ProjectMember(
            project_id=world["project"].id,
            user_id=person.id,
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
        )
        if sequence % 2 == 0:
            member.role_assignments.append(
                ProjectMemberRole(role_id=inspect_role.id)
            )
        db_session.add(member)
        added_users.append(person)

    # Interleave eligible and ineligible users in database ordering.
    timestamp = datetime(2026, 1, 1, tzinfo=UTC)
    eligible = [
        world["field_user"],
        added_users[0],
        world["field_user_two"],
        added_users[2],
        world["field_reader_user"],
        added_users[4],
        added_users[6],
    ]
    ineligible = [
        added_users[1],
        added_users[3],
        added_users[5],
        added_users[7],
    ]
    for index, person in enumerate(eligible):
        person.created_at = timestamp + timedelta(minutes=index * 2)
    for index, person in enumerate(ineligible):
        person.created_at = timestamp + timedelta(minutes=index * 2 + 1)
    db_session.commit()

    large, large_items = select_count(world["admin"], url, limit=2)
    assert large_items == 2
    assert large == small

    pages = []
    cursor = None
    while True:
        params = {"limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = world["admin"].get(url, params=params)
        assert response.status_code == 200, response.text
        pages.extend(response.json()["items"])
        cursor = response.json()["next_cursor"]
        if cursor is None:
            break
    candidate_ids = {person["id"] for person in pages}
    expected_ids = {
        str(world[key].id)
        for key in ("field_user", "field_user_two", "field_reader_user")
    }
    expected_ids.update(str(person.id) for person in added_users[::2])
    assert len(pages) == len(expected_ids) == 7
    assert candidate_ids == expected_ids
    assert len(candidate_ids) == len(pages)
    expected_order = [
        str(person.id)
        for person in db_session.scalars(
            select(User)
            .where(User.id.in_([UUID(value) for value in candidate_ids]))
            .order_by(User.created_at, User.id)
        ).all()
    ]
    assert [person["id"] for person in pages] == expected_order
    assert str(world["field_user"].id) in candidate_ids
    assert str(world["field_user_two"].id) in candidate_ids
    assert str(world["plain_user"].id) not in candidate_ids
    assert str(world["admin_user"].id) not in candidate_ids
