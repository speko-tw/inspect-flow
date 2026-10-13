"""Shared frontend/backend contract for project inspection-item PATCH."""

import json
from pathlib import Path

from tests.api.test_inspection_planning_api import _planning_world

_REPO_ROOT = Path(__file__).resolve().parents[3]
_FIXTURE = (
    _REPO_ROOT
    / "frontend/src/admin/projectItems/fixtures/project-patch-bound-unit.json"
)
_STRUCTURE_FIXTURE = _FIXTURE.with_name("project-patch-structure.json")
_LOCKED_FIXTURE = _FIXTURE.with_name("project-patch-structure-locked.json")


def test_project_patch_bound_unit_matches_frontend_contract(
    db_session, make_client
):
    fixture = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    world = _planning_world(db_session, make_client)
    url = (
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}"
    )

    valid = world["admin"].patch(url, json=fixture["request"])
    assert valid.status_code == 200, valid.text
    valid_body = valid.json()
    valid_point = valid_body["inspection_points"][0]
    assert valid_point["numeric_standard"]["unit"] == "mm"
    assert valid_point["measurement_fields"][0]["unit"] == "mm"
    assert (
        valid_point["numeric_standard"]["measurement_field_id"]
        == (valid_point["measurement_fields"][0]["id"])
    )

    invalid_request = json.loads(json.dumps(fixture["request"]))
    invalid_request["inspection_points"][0]["measurement_fields"][0][
        "unit"
    ] = "sentinel-forbidden-bound-unit"
    invalid = world["admin"].patch(url, json=invalid_request)
    assert invalid.status_code == 422, invalid.text
    assert invalid.json() == fixture["error_response"]
    assert "sentinel-forbidden-bound-unit" not in invalid.text


def test_project_patch_structure_fixture_updates_draft_and_reads_back(
    db_session, make_client
):
    fixture = json.loads(_STRUCTURE_FIXTURE.read_text(encoding="utf-8"))
    locked_fixture = json.loads(_LOCKED_FIXTURE.read_text(encoding="utf-8"))
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    item_id = world["item"].id
    item_url = f"/api/v1/projects/{project_id}/inspection-items/{item_id}"
    plan = world["admin"].post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "結構契約"},
    )
    assert plan.status_code == 201, plan.text
    task = world["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "草稿結構契約", "item_ids": [str(item_id)]},
    )
    assert task.status_code == 201, task.text

    locked = world["admin"].patch(
        item_url,
        json={**fixture, "reinspect": False},
    )
    assert locked.status_code == 422, locked.text
    assert locked.json() == locked_fixture

    updated = world["admin"].patch(
        item_url,
        json={**fixture, "reinspect": True},
    )
    assert updated.status_code == 200, updated.text
    point = updated.json()["inspection_points"][0]
    assert point["numeric_standard"]["range_form"] == "interval"
    assert point["numeric_standard"]["lower_bound"] == "10"
    assert point["numeric_standard"]["upper_bound"] == "20"
    fields = point["measurement_fields"]
    assert len(fields) == 2
    assert point["numeric_standard"]["measurement_field_id"] == fields[1]["id"]
    assert fields[1]["unit"] == "mm"
    items_url = f"/api/v1/projects/{project_id}/inspection-items"
    detail = world["admin"].get(items_url)
    assert detail.status_code == 200, detail.text
    item = next(
        entry
        for entry in detail.json()["items"]
        if entry["id"] == str(item_id)
    )
    assert item["inspection_points"][0] == point
    task_detail = world["admin"].get(
        f"/api/v1/inspection-tasks/{task.json()['id']}"
    )
    assert task_detail.status_code == 200, task_detail.text
    snapshot = task_detail.json()["items"][0]["current_snapshot"]
    assert (
        snapshot["inspection_points"][0]["numeric_standard"][
            "measurement_field_id"
        ]
        == fields[1]["id"]
    )


def test_project_patch_locked_structure_allows_numeric_corrections(
    db_session, make_client
):
    fixture = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    item_id = world["item"].id
    item_url = f"/api/v1/projects/{project_id}/inspection-items/{item_id}"
    created = world["admin"].patch(item_url, json=fixture["request"])
    assert created.status_code == 200, created.text
    point = created.json()["inspection_points"][0]
    field = point["measurement_fields"][0]
    plan = world["admin"].post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "鎖定下修正數值"},
    )
    assert plan.status_code == 201, plan.text
    task = world["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={"name": "數值修正結構契約", "item_ids": [str(item_id)]},
    )
    assert task.status_code == 201, task.text
    dispatched = world["admin"].post(
        f"/api/v1/inspection-tasks/{task.json()['id']}:dispatch"
    )
    assert dispatched.status_code == 200, dispatched.text

    def corrected_point(*, interval: bool) -> dict:
        return {
            "id": point["id"],
            "sequence": point["sequence"],
            "title": point["title"],
            "instruction": point["instruction"],
            "text_standard": None,
            "numeric_standard": {
                "value": None if interval else "12",
                "condition": "range",
                "unit": "mm",
                "tolerance": None if interval else "0.5",
                "range_form": "interval" if interval else "tolerance",
                "lower_bound": "8" if interval else None,
                "upper_bound": "14" if interval else None,
                "measurement_field_client_id": field["id"],
            },
            "measurement_fields": [
                {
                    "id": field["id"],
                    "client_id": field["id"],
                    "name": "更正後欄位名稱",
                    "field_type": "number",
                    "unit": None,
                }
            ],
            "evidence_requirements": [{"min_count": 1}],
        }

    tolerated = world["admin"].patch(
        item_url,
        json={
            "inspection_points": [corrected_point(interval=False)],
            "reinspect": False,
        },
    )
    assert tolerated.status_code == 200, tolerated.text
    corrected = tolerated.json()["inspection_points"][0]
    assert corrected["measurement_fields"][0]["name"] == "更正後欄位名稱"
    assert corrected["numeric_standard"]["value"] == "12"
    assert corrected["numeric_standard"]["tolerance"] == "0.5"

    interval = world["admin"].patch(
        item_url,
        json={
            "inspection_points": [corrected_point(interval=True)],
            "reinspect": False,
        },
    )
    assert interval.status_code == 200, interval.text
    standard = interval.json()["inspection_points"][0]["numeric_standard"]
    assert standard["range_form"] == "interval"
    assert standard["lower_bound"] == "8"
    assert standard["upper_bound"] == "14"
