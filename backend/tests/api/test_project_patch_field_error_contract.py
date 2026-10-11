"""Shared frontend/backend contract for project inspection-item PATCH."""

import json
from pathlib import Path

from tests.api.test_inspection_planning_api import _planning_world

_REPO_ROOT = Path(__file__).resolve().parents[3]
_FIXTURE = (
    _REPO_ROOT
    / "frontend/src/admin/projectItems/fixtures/project-patch-bound-unit.json"
)


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
