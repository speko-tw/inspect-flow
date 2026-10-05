"""List endpoints batch-load children instead of querying per row (#462)."""

from uuid import uuid4

import pytest

from app.models import ProjectInspectionItem
from tests.api.query_count import select_count
from tests.api.test_inspection_planning_api import _planning_world

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
