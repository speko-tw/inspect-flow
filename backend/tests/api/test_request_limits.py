"""Request fields have upper bounds; oversized payloads get 422 (SEC-004)."""

from copy import deepcopy
from uuid import uuid4

import pytest

from app.api import limits
from tests.api.test_inspection_planning_api import _planning_world
from tests.api.test_template_library import (  # noqa: F401
    _template,
    _tree,
    clients,
)

_VALIDATION = {"error": {"code": "request.validation_failed"}}


def _assert_validation(response) -> None:
    error = response.json()["error"]
    assert error["code"] == _VALIDATION["error"]["code"]
    assert error["fields"]
    assert all(set(field) == {"path", "code"} for field in error["fields"])


def _numeric_point() -> dict:
    field_id = str(uuid4())
    return {
        "sequence": 1,
        "title": "point",
        "instruction": "check",
        "numeric_standard": {
            "value": "5",
            "condition": "=",
            "unit": "mm",
            "measurement_field_client_id": field_id,
        },
        "measurement_fields": [
            {
                "client_id": field_id,
                "name": "thickness",
                "field_type": "number",
            }
        ],
        "evidence_requirements": [{"min_count": 1}],
    }


def _too_many_points(body: dict) -> None:
    body["inspection_points"] = [
        {**_numeric_point(), "sequence": 1}
        for _ in range(limits.POINTS_MAX + 1)
    ]


def _first_point(body: dict) -> dict:
    return body["inspection_points"][0]


_TEMPLATE_MUTATIONS = {
    "template title": lambda b: b.update(title="t" * (limits.TITLE_MAX + 1)),
    "template instruction": lambda b: b.update(
        instruction="i" * (limits.LONG_TEXT_MAX + 1)
    ),
    "point count": _too_many_points,
    "point title": lambda b: _first_point(b).update(
        title="p" * (limits.TITLE_MAX + 1)
    ),
    "point instruction": lambda b: _first_point(b).update(
        instruction="i" * (limits.LONG_TEXT_MAX + 1)
    ),
    "text standard": lambda b: _first_point(b).update(
        numeric_standard=None,
        measurement_fields=[],
        text_standard={"text": "x" * (limits.LONG_TEXT_MAX + 1)},
    ),
    "numeric unit": lambda b: _first_point(b)["numeric_standard"].update(
        unit="u" * (limits.UNIT_MAX + 1)
    ),
    "numeric value": lambda b: _first_point(b)["numeric_standard"].update(
        value="1" * (limits.NUMBER_TEXT_MAX + 1)
    ),
    "measurement field name": lambda b: _first_point(b)["measurement_fields"][
        0
    ].update(name="n" * (limits.TITLE_MAX + 1)),
    "measurement field count": lambda b: _first_point(b).update(
        numeric_standard=None,
        measurement_fields=[
            {
                "client_id": str(uuid4()),
                "name": f"f{index}",
                "field_type": "text",
            }
            for index in range(limits.MEASUREMENT_FIELDS_MAX + 1)
        ],
    ),
    "evidence count": lambda b: _first_point(b).update(
        evidence_requirements=[{"min_count": 1}, {"min_count": 1}]
    ),
    "min photo count": lambda b: _first_point(b).update(
        evidence_requirements=[{"min_count": limits.MIN_PHOTO_COUNT_MAX + 1}]
    ),
}


def _valid_template(system_id: str) -> dict:
    body = deepcopy(_template(system_id))
    body["inspection_points"] = [_numeric_point()]
    return body


@pytest.mark.parametrize("name", sorted(_TEMPLATE_MUTATIONS))
def test_template_body_rejects_oversized_fields(clients, name):  # noqa: F811
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _valid_template(system_id)
    _TEMPLATE_MUTATIONS[name](body)

    response = manager.post("/api/v1/templates", json=body)
    assert response.status_code == 422, response.text
    _assert_validation(response)

    system_put = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={"items": [body]},
    )
    assert system_put.status_code == 422, system_put.text
    _assert_validation(system_put)


def test_template_body_accepts_fields_at_the_limit(clients):  # noqa: F811
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _valid_template(system_id)
    body["title"] = "t" * limits.TITLE_MAX
    body["instruction"] = "i" * limits.LONG_TEXT_MAX
    point = _first_point(body)
    point["title"] = "p" * limits.TITLE_MAX
    point["instruction"] = "i" * limits.LONG_TEXT_MAX
    point["evidence_requirements"] = [
        {"min_count": limits.MIN_PHOTO_COUNT_MAX}
    ]

    response = manager.post("/api/v1/templates", json=body)
    assert response.status_code == 201, response.text


def test_template_system_put_and_names_reject_oversized_values(
    clients,  # noqa: F811
):
    manager = clients["manager"]
    category_id, system_id = _tree(manager)
    long_name = "n" * (limits.TITLE_MAX + 1)

    category = manager.post(
        "/api/v1/template-categories", json={"name": long_name}
    )
    system = manager.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": long_name},
    )
    rename = manager.patch(
        f"/api/v1/template-systems/{system_id}", json={"name": long_name}
    )
    many = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={"items": [{}] * (limits.TEMPLATES_MAX + 1)},
    )

    for response in (category, system, rename, many):
        assert response.status_code == 422, response.text
        _assert_validation(response)


@pytest.fixture
def planning(db_session, make_client):
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "Plan"},
    ).json()
    task = admin.post(
        f"/api/v1/inspection-plans/{plan['id']}/tasks",
        json={"item_ids": [str(world["item"].id)]},
    ).json()
    world["plan"] = plan
    world["task"] = task
    return world


def test_planning_bodies_reject_oversized_fields(planning):
    admin = planning["admin"]
    project_id = planning["project"].id
    plan_id = planning["plan"]["id"]
    task_id = planning["task"]["id"]
    item_url = (
        f"/api/v1/projects/{project_id}/inspection-items/{planning['item'].id}"
    )
    long_name = "n" * (limits.PLANNING_NAME_MAX + 1)
    long_location = "l" * (limits.LOCATION_TEXT_MAX + 1)
    long_text = "x" * (limits.LONG_TEXT_MAX + 1)
    requests = {
        "plan name": admin.post(
            f"/api/v1/projects/{project_id}/inspection-plans",
            json={"name": long_name},
        ),
        "plan rename": admin.patch(
            f"/api/v1/inspection-plans/{plan_id}", json={"name": long_name}
        ),
        "zone name": admin.post(
            f"/api/v1/projects/{project_id}/zones", json={"name": long_name}
        ),
        "task item ids": admin.post(
            f"/api/v1/inspection-plans/{plan_id}/tasks",
            json={"item_ids": [str(uuid4())] * (limits.ITEM_IDS_MAX + 1)},
        ),
        "task location": admin.post(
            f"/api/v1/inspection-plans/{plan_id}/tasks",
            json={
                "item_ids": [str(planning["item"].id)],
                "location_text": long_location,
            },
        ),
        "task location patch": admin.patch(
            f"/api/v1/inspection-tasks/{task_id}",
            json={"zone_id": None, "location_text": long_location},
        ),
        "cancel reason": admin.post(
            f"/api/v1/inspection-tasks/{task_id}:cancel",
            json={"reason": long_text},
        ),
        "item title": admin.patch(
            item_url,
            json={"title": "t" * (limits.TITLE_MAX + 1), "reinspect": False},
        ),
        "item instruction": admin.patch(
            item_url, json={"instruction": long_text, "reinspect": False}
        ),
        "item points": admin.patch(
            item_url,
            json={
                "inspection_points": [_numeric_point()]
                * (limits.POINTS_MAX + 1),
                "reinspect": False,
            },
        ),
    }
    for name, response in requests.items():
        assert response.status_code == 422, (name, response.text)
        _assert_validation(response)


def test_domain_limit_errors_keep_their_codes_below_the_transport_cap(
    planning,
):
    admin = planning["admin"]
    project_id = planning["project"].id

    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "x" * 129},
    )
    assert plan.status_code == 422
    assert plan.json()["error"]["code"] == "inspection_plan.invalid_name"
    zone = admin.post(
        f"/api/v1/projects/{project_id}/zones", json={"name": "x" * 129}
    )
    assert zone.status_code == 422
    assert zone.json()["error"]["code"] == "project_zone.invalid_name"
