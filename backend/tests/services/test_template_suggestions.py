"""TPL-R30～R32：快照形狀、共用完整驗證與不完整退回稿。"""

from copy import deepcopy
from uuid import uuid4

import pytest

from app.api.errors import APIError
from app.services.template_suggestions import content_hash, validate_content


def _content():
    field = str(uuid4())
    return {
        "title": "結構",
        "instruction": "說明",
        "inspection_points": [
            {
                "logical_id": str(uuid4()),
                "sequence": 1,
                "title": "量測",
                "instruction": "確認",
                "text_standard": None,
                "numeric_standard": {
                    "value": "12.5",
                    "condition": ">=",
                    "unit": "mm",
                    "measurement_field_logical_id": field,
                },
                "measurement_fields": [
                    {
                        "logical_id": field,
                        "name": "長度",
                        "field_type": "number",
                        "unit": None,
                        "sort_order": 0,
                    }
                ],
                "evidence_requirements": [
                    {
                        "evidence_type": "photo",
                        "required": True,
                        "min_count": 1,
                        "max_count": None,
                    }
                ],
            }
        ],
    }


def test_complete_validation_preserves_identity_without_mutating_input():
    content = _content()
    before = deepcopy(content)
    validated = validate_content(content, complete=True)
    assert content == before
    assert (
        validated["inspection_points"][0]["logical_id"]
        == (content["inspection_points"][0]["logical_id"])
    )
    shuffled = dict(reversed(list(validated.items())))
    assert content_hash(validated) == content_hash(shuffled)
    validated["title"] = "另一份"
    assert content["title"] == "結構"


@pytest.mark.parametrize(
    "field",
    [
        "id",
        "source_point_id",
        "photos",
        "actual_value",
        "results",
        "task_reference_count",
    ],
)
def test_snapshot_rejects_database_keys_and_field_results(field):
    content = _content()
    content["inspection_points"][0][field] = "must not be retained"
    with pytest.raises(APIError) as error:
        validate_content(content, complete=False)
    assert error.value.status_code == 422
    assert error.value.fields == [
        {"path": "/content", "code": "field.invalid"}
    ]


@pytest.mark.parametrize(
    "invalid", ["nonfinite", "field_unit", "photos", "order"]
)
def test_submission_reuses_existing_template_rules(invalid):
    content = _content()
    point = content["inspection_points"][0]
    if invalid == "nonfinite":
        point["numeric_standard"]["value"] = "NaN"
    elif invalid == "field_unit":
        point["measurement_fields"][0]["unit"] = "mm"
    elif invalid == "photos":
        point["evidence_requirements"] = []
    else:
        duplicate = deepcopy(point)
        duplicate["logical_id"] = str(uuid4())
        duplicate["measurement_fields"][0]["logical_id"] = str(uuid4())
        duplicate["numeric_standard"]["measurement_field_logical_id"] = (
            duplicate["measurement_fields"][0]["logical_id"]
        )
        content["inspection_points"].append(duplicate)
    with pytest.raises(APIError) as error:
        validate_content(content, complete=True)
    assert error.value.status_code == 422 and error.value.fields


def test_returned_draft_can_be_incomplete_but_not_submitted():
    content = _content()
    content["title"] = ""
    content["inspection_points"][0]["numeric_standard"]["value"] = ""
    assert validate_content(content, complete=False) == content
    with pytest.raises(APIError) as error:
        validate_content(content, complete=True)
    assert error.value.status_code == 422


def test_nonportable_json_nan_is_rejected_even_in_drafts():
    with pytest.raises(APIError):
        validate_content({"title": float("nan")}, complete=False)


def test_all_five_suggestion_events_are_registered_with_project_context():
    """TPL-R35：T16 一次登記所有事件，T17 無須重複登記審核事件。"""
    from app.services.audit import _EVENT_CATALOG

    definitions = {
        name: definition
        for name, definition in _EVENT_CATALOG.items()
        if name.startswith("template_suggestion.")
    }
    assert set(definitions) == {
        "template_suggestion.revised",
        "template_suggestion.submitted",
        "template_suggestion.returned",
        "template_suggestion.approved",
        "template_suggestion.withdrawn",
    }
    assert all(
        d.entity_type == "template_suggestion" and d.project_scoped
        for d in definitions.values()
    )
    assert definitions["template_suggestion.submitted"].before_optional
    assert {"review_id", "reason", "reviewed_revision_id", "reviewer_id"} <= (
        definitions["template_suggestion.returned"].fields
    )
    assert {"template_id", "category_id", "system_id"} <= (
        definitions["template_suggestion.approved"].fields
    )
