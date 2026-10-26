"""List endpoints batch-load children instead of querying per row (#462)."""

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import get_engine
from app.models import (
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModulePermission,
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
                "unit": None,
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
                "name": "查詢計數任務",
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


def test_project_item_list_includes_batched_distinct_task_counts(
    world, db_session
):
    """驗證 TPL-R27 列表涵蓋 IP-R21 刪除 guard 的各種任務狀態。"""
    tasks = db_session.scalars(
        select(InspectionTask)
        .where(InspectionTask.plan_id == UUID(world["plan_id"]))
        .order_by(InspectionTask.id)
    ).all()
    for index, task in enumerate(tasks):
        task.status = [
            "CANCELLED",
            "COMPLETED",
            "DRAFT",
            "IN_PROGRESS",
            "PENDING",
            "COMPLETED",
        ][index]
        if task.status == "CANCELLED":
            task.cancelled_from_status = "PENDING"
            task.cancellation_reason = "測試取消"
    db_session.commit()

    admin = world["admin"]
    url = _urls(world)["project items"]
    small_count, small_rows = select_count(admin, url, limit=1)
    large_count, large_rows = select_count(admin, url, limit=100)
    assert small_rows == 1
    assert large_rows >= 5
    assert small_count > 0
    assert small_count == large_count
    items = admin.get(url, params={"limit": 100}).json()["items"]
    counts = {row["id"]: row["task_count"] for row in items}
    assert counts[str(world["item"].id)] == _TASKS
    assert counts[str(world["item_two"].id)] == _TASKS
    assert counts[str(items[-1]["id"])] == 0


def test_plan_detail_select_count_is_fixed_for_many_tasks(world):
    admin = world["admin"]
    url = f"/api/v1/inspection-plans/{world['plan_id']}"
    count, tasks = select_count(admin, url)
    assert tasks == _TASKS
    assert count <= _MAX_SELECTS
    extra = admin.post(
        f"/api/v1/inspection-plans/{world['plan_id']}/tasks",
        json={
            "name": "查詢計數任務",
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


def test_project_item_patch_batches_associated_task_loads(world, db_session):
    admin = world["admin"]
    item = db_session.scalar(
        select(ProjectInspectionItem).where(
            ProjectInspectionItem.project_id == world["project"].id,
            ProjectInspectionItem.sequence == 5,
        )
    )
    assert item is not None
    plan_id = world["plan_id"]
    task_url = f"/api/v1/inspection-plans/{plan_id}/tasks"
    zones = admin.get(f"{world['base']}/zones")
    assert zones.status_code == 200, zones.text
    zone_id = zones.json()["items"][0]["id"]
    created = admin.post(
        task_url,
        json={
            "name": "單一關聯",
            "item_ids": [str(item.id)],
            "zone_id": zone_id,
        },
    )
    assert created.status_code == 201, created.text

    engine = get_engine()

    def count_patch_selects(title: str, expected_tasks: int) -> int:
        count = 0

        def record_select(_conn, _cursor, statement, _params, _context, _many):
            nonlocal count
            if statement.lstrip().lower().startswith("select"):
                count += 1

        event.listen(engine, "before_cursor_execute", record_select)
        db_session.expire_all()
        try:
            response = admin.patch(
                f"{world['base']}/inspection-items/{item.id}",
                json={"title": title, "reinspect": False},
            )
        finally:
            event.remove(engine, "before_cursor_execute", record_select)
        assert response.status_code == 200, response.text
        assert len(response.json()["affected_tasks"]) == expected_tasks
        return count

    one_task_selects = count_patch_selects("單筆更新", 1)
    for _ in range(19):
        created = admin.post(
            task_url,
            json={
                "name": "多筆關聯",
                "item_ids": [str(item.id)],
                "zone_id": zone_id,
            },
        )
        assert created.status_code == 201, created.text
    twenty_task_selects = count_patch_selects("多筆更新", 20)

    # 計入 PATCH 的全部 SELECT（不只 inspection_tasks）。目前 1 與 20 個
    # 關聯皆為 24 次；容許差距上限 2 次，以免無關的固定查詢造成誤報，
    # 但 Plan 狀態重算與快照載入不得再逐 Task 重複查詢。
    assert abs(twenty_task_selects - one_task_selects) <= 2


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
        id=uuid4(),
        project_id=project.id,
        sequence=1,
        title="查核項目",
        instruction="確認項目",
        source_template_name="測試範本",
        applied_at=creator.created_at,
        created_by=creator.id,
        updated_by=creator.id,
    )
    # IP-R14：此測試需要有效 Task 才能量測列表權限查詢數。
    point = ProjectInspectionPoint(
        project_inspection_item_id=item.id,
        sequence=1,
        title="檢查點",
        instruction="確認項目狀況",
        created_by=creator.id,
        updated_by=creator.id,
    )
    db_session.add_all([member, item, point])
    db_session.commit()

    base = f"/api/v1/projects/{project.id}"
    plan = admin.post(f"{base}/inspection-plans", json={"name": "測試計畫"})
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "權限查詢計數任務", "item_ids": [str(item.id)]},
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
            db_session.add(
                UserModulePermission(
                    user_id=person.id,
                    permission_code="inspection.use",
                    source="manual",
                )
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


def _locked_item_patch_selects(
    client, project_id, item_id, points
) -> tuple[int, int]:
    """回傳鎖結構 PATCH（`reinspect=false`）的照片需求查詢次數。

    回傳 ``(依 inspection_point_id 逐點查詢, 依項目整批查詢)``。逐點
    查詢是修正前的 N+1 形狀；回應序列化的 relationship 延遲載入不在此計數內。
    """
    per_point = 0
    per_item = 0

    def record(conn, cursor, statement, parameters, context, many):
        nonlocal per_point, per_item
        if not statement.lstrip().upper().startswith("SELECT"):
            return
        if "FROM project_evidence_requirements" not in statement:
            return
        # 帶 ORDER BY 的是回應序列化時 relationship 的延遲載入，另案處理；
        # 這裡只計修正前逐點取 min_count 的查詢。
        if (
            "evidence_requirements.inspection_point_id = " in statement
            and "ORDER BY" not in statement
        ):
            per_point += 1
        elif (
            "evidence_requirements.project_inspection_item_id = " in statement
        ):
            per_item += 1

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.patch(
            f"/api/v1/projects/{project_id}/inspection-items/{item_id}",
            json={
                "inspection_points": [
                    {
                        "id": point["id"],
                        "sequence": point["sequence"],
                        "title": point["title"],
                        "instruction": point["instruction"],
                        "evidence_requirements": [{"min_count": 1}],
                    }
                    for point in points
                ],
                "reinspect": False,
            },
        )
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    return per_point, per_item


def test_locked_item_patch_batches_evidence_lookup(db_session, make_client):
    """#643：點數增加時，照片需求的查詢次數不得跟著增加。"""
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    base = f"/api/v1/projects/{project_id}"
    plan = admin.post(f"{base}/inspection-plans", json={"name": "Plan"})
    assert plan.status_code == 201, plan.text
    counts = []
    for key, size in (("item", 2), ("item_two", 8)):
        item_id = world[key].id
        saved = admin.patch(
            f"{base}/inspection-items/{item_id}",
            json={
                "inspection_points": [
                    {
                        "sequence": sequence,
                        "title": f"point {sequence}",
                        "instruction": "check",
                        "evidence_requirements": [{"min_count": 1}],
                    }
                    for sequence in range(1, size + 1)
                ]
            },
        )
        assert saved.status_code == 200, saved.text
        task = admin.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={"item_ids": [str(item_id)], "name": f"Task {key}"},
        )
        assert task.status_code == 201, task.text
        points = saved.json()["inspection_points"]
        assert len(points) == size
        counts.append(
            _locked_item_patch_selects(admin, project_id, item_id, points)
        )
    # 兩種點數下都不得逐點查詢，依項目整批的查詢次數也不隨點數增加。
    assert counts[0][0] == counts[1][0] == 0
    assert counts[0][1] == counts[1][1]


@pytest.mark.parametrize("inspection_enabled", [True, False])
def test_project_item_task_counts_are_only_computed_for_editors(
    world, db_session, make_client, inspection_enabled
):
    """TPL-R27：唯讀項目清單不計算編輯專用的引用數。"""
    project_id = world["project"].id
    url = f"/api/v1/projects/{project_id}/inspection-items"
    editor = create_root_user_with_company(db_session, "COUNT-EDITOR")
    role = Role(
        name="Item editor",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[RolePermission(code="project_inspection_item.edit")],
    )
    db_session.add(role)
    db_session.flush()
    db_session.add(
        ProjectMember(
            project_id=project_id,
            user_id=editor.id,
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
            role_assignments=[ProjectMemberRole(role_id=role.id)],
        )
    )
    if inspection_enabled:
        db_session.add(
            UserModulePermission(
                user_id=editor.id,
                permission_code="inspection.use",
                source="manual",
            )
        )
    manager = create_root_user_with_company(db_session, "COUNT-MANAGER")
    db_session.add(
        UserModulePermission(
            user_id=manager.id,
            permission_code="template.manage",
            source="manual",
        )
    )
    db_session.commit()

    editor_client = make_client()
    editor_client.cookies.set(
        SESSION_COOKIE_NAME, create_session(db_session, editor)[1]
    )
    manager_client = make_client()
    manager_client.cookies.set(
        SESSION_COOKIE_NAME, create_session(db_session, manager)[1]
    )
    db_session.commit()

    def get_with_sql(client):
        statements: list[str] = []

        def record(conn, cursor, statement, parameters, context, many):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", record)
        try:
            response = client.get(url)
        finally:
            event.remove(engine, "before_cursor_execute", record)
        return response, statements

    editors = [world["admin"]]
    readers = [world["field"], world["plain"], manager_client]
    # AUT-R19：角色編輯權限須搭配 inspection.use 才能讀引用數。
    (editors if inspection_enabled else readers).append(editor_client)
    for client in editors:
        response, statements = get_with_sql(client)
        assert response.status_code == 200, response.text
        counts = {
            row["id"]: row["task_count"] for row in response.json()["items"]
        }
        assert counts[str(world["item"].id)] == _TASKS
        assert counts[str(world["item_two"].id)] == _TASKS
        assert statements
        assert any(
            "task_inspection_items" in statement.lower()
            and "group by" in statement.lower()
            for statement in statements
        )

    for client in readers:
        response, statements = get_with_sql(client)
        assert response.status_code == 200, response.text
        assert statements
        assert all(
            row["task_count"] is None for row in response.json()["items"]
        )
        assert not any(
            "task_inspection_items" in statement.lower()
            and "group by" in statement.lower()
            for statement in statements
        )
