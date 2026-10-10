"""PostgreSQL-backed API acceptance for Field planning endpoints (#552).

Run these tests with ``make check-postgres``. It uses
``INSPECTFLOW_TEST_POSTGRES_URL`` and clears that database's ``public``
schema. Set it only to a disposable test database. To run this file alone
with the variable set, use::

    cd backend && uv run --locked pytest \
        tests/db/test_planning_api_postgresql.py --db-backend=postgresql

Pytest refuses to fall back to SQLite when the PostgreSQL backend is
requested without the URL.
"""

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import (
    Company,
    InspectionTask,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from tests.api.query_count import select_count
from tests.api.test_inspection_planning_api import _planning_world
from tests.api.test_planning_query_counts import (
    _create_permission_test_project,
)
from tests.db.conftest import build_root_user

_BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url: str) -> str:
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    return db_url


@pytest.fixture
def engine(
    request: pytest.FixtureRequest, migrated_url: str
) -> Generator[Engine, None, None]:
    test_engine = create_engine_from_settings(migrated_url)
    expected_dialect = request.config.getoption("--db-backend")
    assert test_engine.dialect.name == expected_dialect
    try:
        yield test_engine
    finally:
        test_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def make_client(engine: Engine):
    def create_client() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return create_client


def test_field_task_list_permissions_cursor_and_response_on_database(
    db_session: Session, make_client
):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]
    project_id = world["project"].id
    prefix = "/api/v1/field/inspection-tasks"

    denied = world["reader"].get(prefix)
    assert denied.status_code == 403, denied.text

    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "PostgreSQL Field list"},
    )
    assert plan.status_code == 201, plan.text
    task_ids = []
    for _ in range(5):
        created = admin.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={"item_ids": [str(world["item"].id)]},
        )
        assert created.status_code == 201, created.text
        task_id = created.json()["id"]
        dispatched = admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
        assert dispatched.status_code == 200, dispatched.text
        task_ids.append(UUID(task_id))

    # The first cursor boundary falls within the three-row newer group;
    # the second boundary crosses from that group to the older two rows.
    newer_time = datetime(2026, 10, 1, 0, 0, 0, 123456, tzinfo=UTC)
    older_time = datetime(2026, 9, 30, 23, 59, 59, 654321, tzinfo=UTC)
    task_times = {
        task_id: newer_time if index < 3 else older_time
        for index, task_id in enumerate(task_ids)
    }
    for task in db_session.scalars(
        select(InspectionTask).where(InspectionTask.id.in_(task_ids))
    ):
        task.dispatched_at = task_times[task.id]
    db_session.commit()
    expected = [
        str(task_id)
        for task_id in db_session.scalars(
            select(InspectionTask.id)
            .where(InspectionTask.id.in_(task_ids))
            .order_by(
                InspectionTask.dispatched_at.desc(), InspectionTask.id.desc()
            )
        )
    ]

    # The member has inspect access in the current project. Adding a role
    # without inspect access must preserve the union of its project roles.
    url = "/api/v1/field/inspection-tasks"
    params = {"assigned_to_me": "false", "limit": 2}
    small_selects, small_items = select_count(field, url, **params)
    assert small_items == 2
    visible_before_role = _field_task_ids(field, prefix, params)
    assert visible_before_role == expected

    no_inspect_role = Role(
        name="PostgreSQL planning-only role",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[RolePermission(code="inspection_plan.read")],
    )
    db_session.add(no_inspect_role)
    db_session.flush()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == world["field_user"].id,
        )
    )
    assert member is not None
    member.role_assignments.append(
        ProjectMemberRole(role_id=no_inspect_role.id)
    )
    db_session.commit()

    visible_after_role = _field_task_ids(field, prefix, params)
    assert len(visible_after_role) == 5
    assert visible_after_role == visible_before_role

    hidden_project = _create_permission_test_project(
        world,
        db_session,
        project_code="PG-FIELD-NO-INSPECT",
        role_id=no_inspect_role.id,
    )
    large_selects, large_items = select_count(field, url, **params)
    assert (large_selects, large_items) == (small_selects, small_items)

    seen = []
    cursor = None
    while True:
        params = {"assigned_to_me": "false", "limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = field.get(prefix, params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        for row in page["items"]:
            assert set(row) == {
                "id",
                "project_id",
                "project_name",
                "status",
                "dispatched_at",
                "location",
                "suggested_assignee",
                "item_summary",
            }
        seen.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert seen == visible_after_role == expected
    assert len(seen) == 5
    assert hidden_project["task_id"] not in seen


def test_assignee_candidates_union_and_created_at_id_cursor(
    db_session: Session, make_client
):
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    inspect_role = db_session.scalar(
        select(Role).where(Role.name == "API field inspector")
    )
    assert inspect_role is not None
    url = f"/api/v1/projects/{project_id}/inspection-task-assignees"
    assign_role = Role(
        name="PostgreSQL task assigner",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[
            RolePermission(code="inspection_task.assign"),
        ],
    )
    db_session.add(assign_role)
    db_session.flush()
    member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == world["field_user"].id,
        )
    )
    assert member is not None
    member.role_assignments.append(ProjectMemberRole(role_id=assign_role.id))
    db_session.commit()
    small_selects, small_items = select_count(world["field"], url, limit=2)
    assert small_items == 2

    timestamp = datetime(2026, 10, 2, tzinfo=UTC)
    expected_ids = {
        world["field_user"].id,
        world["field_user_two"].id,
        world["field_reader_user"].id,
    }
    for index in range(6):
        user = create_candidate(
            db_session,
            world,
            index,
            user_id=UUID(f"00000000-0000-7000-8000-{(6 - index) * 16:012x}"),
        )
        user.created_at = timestamp
        candidate_member = ProjectMember(
            project_id=project_id,
            user_id=user.id,
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
            role_assignments=[ProjectMemberRole(role_id=inspect_role.id)],
        )
        db_session.add(candidate_member)
        expected_ids.add(user.id)
    db_session.commit()

    large_selects, large_items = select_count(world["field"], url, limit=2)
    assert (large_selects, large_items) == (small_selects, small_items)
    seen: list[str] = []
    cursor = None
    while True:
        params = {"limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = world["field"].get(url, params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        for row in page["items"]:
            assert set(row) == {"id", "username", "name_zh"}
        seen.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    expected_order = [
        str(user_id)
        for user_id in db_session.scalars(
            select(User.id)
            .where(User.id.in_(expected_ids))
            .order_by(User.created_at, User.id)
        )
    ]
    assert seen == expected_order
    assert set(seen) == {str(user_id) for user_id in expected_ids}
    assert len(seen) == len(set(seen))
    assert str(world["plain_user"].id) not in seen
    assert str(world["admin_user"].id) not in seen


def create_candidate(
    db_session: Session,
    world: dict,
    index: int,
    *,
    user_id: UUID,
) -> User:
    company_id = uuid7()
    user = build_root_user(
        f"PG-CANDIDATE-{index:02}", company_id, self_id=user_id
    )
    db_session.add(user)
    db_session.flush()
    db_session.add(
        Company(
            id=company_id,
            name=f"Company for PG-CANDIDATE-{index:02}",
            created_by=user_id,
            updated_by=user_id,
        )
    )
    user.created_at = datetime(2026, 10, 2, tzinfo=UTC)
    user.name_zh = f"候選人 {index}"
    db_session.flush()
    return user


def _field_task_ids(client, prefix: str, params: dict[str, str]) -> list[str]:
    seen = []
    cursor = None
    while True:
        page_params = dict(params)
        if cursor is not None:
            page_params["cursor"] = cursor
        response = client.get(prefix, params=page_params)
        assert response.status_code == 200, response.text
        page = response.json()
        seen.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            return seen
