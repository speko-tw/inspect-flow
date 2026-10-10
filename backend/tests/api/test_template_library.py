"""Template library HTTP contract (TPL-AC01/02/03/04/07/08/09/11)."""

import json
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    SystemRoleAssignment,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateTextStandard,
)
from tests.db.conftest import create_root_user_with_company


@pytest.fixture
def clients(db_session, make_client):
    admin = create_root_user_with_company(db_session, "TPL-ADMIN")
    admin.is_admin = True
    manager = create_root_user_with_company(db_session, "TPL-MANAGER")
    editor = create_root_user_with_company(db_session, "TPL-EDITOR")
    outsider = create_root_user_with_company(db_session, "TPL-OUTSIDER")
    db_session.flush()
    db_session.add(
        SystemRoleAssignment(
            user_id=manager.id,
            role_code="template_admin",
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    project = Project(
        project_code="TPL-PROJECT",
        name="示範專案",
        client_name="示範業主",
        site_location="示範地點",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role = Role(
        name="Project manager",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role.permission_codes.append(
        RolePermission(code="project_inspection_item.edit")
    )
    db_session.add_all([project, role])
    db_session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=editor.id,
        created_by=admin.id,
        updated_by=admin.id,
    )
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    db_session.add(member)
    users = {
        "admin": admin,
        "manager": manager,
        "editor": editor,
        "outsider": outsider,
    }
    tokens = {}
    for name, user in users.items():
        _, tokens[name] = create_session(db_session, user)
    db_session.commit()
    result = {"anonymous": make_client()}
    for name, token in tokens.items():
        client = make_client()
        client.cookies.set(SESSION_COOKIE_NAME, token)
        result[name] = client
    return result


def _tree(manager):
    category = manager.post(
        "/api/v1/template-categories", json={"name": " Civil "}
    )
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]
    system = manager.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": " Walls "},
    )
    assert system.status_code == 201, system.text
    return category_id, system.json()["id"]


def _template(system_id, title="Foundation"):
    field_id = str(uuid4())
    return {
        "system_id": system_id,
        "sequence": 1,
        "title": title,
        "instruction": "Inspect carefully",
        "inspection_points": [
            {
                "sequence": 1,
                "title": "Point A",
                "instruction": "Follow plan",
                "numeric_standard": {
                    "value": "10",
                    "condition": ">=",
                    "unit": "mm",
                    "tolerance": "1",
                    "measurement_field_client_id": field_id,
                },
                "measurement_fields": [
                    {
                        "client_id": field_id,
                        "name": "Thickness",
                        "field_type": "number",
                    },
                    {
                        "client_id": str(uuid4()),
                        "name": "Comment",
                        "field_type": "text",
                    },
                    {
                        "client_id": str(uuid4()),
                        "name": "Width",
                        "field_type": "number",
                        "unit": "cm",
                    },
                ],
                "evidence_requirements": [{"min_count": 2}],
            },
            {
                "sequence": 2,
                "title": "Point B",
                "instruction": "Read plan",
                "text_standard": {"text": "As approved"},
                "evidence_requirements": [{"min_count": 1}],
            },
        ],
    }


@pytest.mark.parametrize(
    ("standard", "valid"),
    [
        ({"value": "3.3", "tolerance": "0.3"}, True),
        (
            {
                "range_form": "interval",
                "value": None,
                "tolerance": None,
                "lower_bound": "3.0",
                "upper_bound": "3.6",
            },
            True,
        ),
        (
            {"range_form": "tolerance", "value": "3.3", "tolerance": "0.3"},
            True,
        ),
        (
            {
                "range_form": "interval",
                "value": None,
                "tolerance": None,
                "lower_bound": "3.6",
                "upper_bound": "3.0",
            },
            False,
        ),
        (
            {"range_form": "tolerance", "value": "3.3", "tolerance": "-0.3"},
            False,
        ),
        (
            {"range_form": "tolerance", "value": None, "tolerance": "0.3"},
            False,
        ),
        (
            {"range_form": "tolerance", "value": "3.3", "tolerance": None},
            False,
        ),
        (
            {"range_form": "tolerance", "value": "3.3", "tolerance": ""},
            False,
        ),
        (
            {
                "range_form": "interval",
                "value": None,
                "tolerance": None,
                "lower_bound": "3.0",
            },
            False,
        ),
        (
            {
                "range_form": "interval",
                "value": None,
                "tolerance": None,
                "upper_bound": "3.6",
            },
            False,
        ),
        (
            {
                "range_form": "interval",
                "value": "3.3",
                "lower_bound": "3.0",
                "upper_bound": "3.6",
            },
            False,
        ),
        (
            {
                "range_form": "tolerance",
                "value": "3.3",
                "tolerance": "0.3",
                "lower_bound": "3.0",
            },
            False,
        ),
    ],
)
def test_range_forms_validate_on_create_and_update(clients, standard, valid):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id)
    numeric = body["inspection_points"][0]["numeric_standard"]
    numeric.update(standard)
    numeric["condition"] = "range"
    created = manager.post("/api/v1/templates", json=body)
    assert created.status_code == (201 if valid else 422), created.text
    if not valid:
        return
    assert created.json()["inspection_points"][0]["numeric_standard"][
        "range_form"
    ] == standard.get("range_form", "tolerance")
    changed = manager.put(
        f"/api/v1/templates/{created.json()['id']}", json=body
    )
    assert changed.status_code == 200, changed.text
    numeric["range_form"] = None
    invalid = manager.put(
        f"/api/v1/templates/{created.json()['id']}", json=body
    )
    assert invalid.status_code == 422


@pytest.mark.parametrize("tolerance", [None, "", "  ", "omitted"])
def test_legacy_range_empty_tolerance_defaults_to_zero(
    clients, db_session, tolerance
):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id)
    numeric = body["inspection_points"][0]["numeric_standard"]
    numeric["condition"] = "range"
    if tolerance == "omitted":
        numeric.pop("tolerance")
    else:
        numeric["tolerance"] = tolerance

    created = manager.post("/api/v1/templates", json=body)
    assert created.status_code == 201, created.text
    point = created.json()["inspection_points"][0]
    assert point["numeric_standard"]["range_form"] == "tolerance"
    assert point["numeric_standard"]["tolerance"] == "0"

    persisted = db_session.scalar(
        select(TemplateNumericStandard).where(
            TemplateNumericStandard.inspection_point_id == UUID(point["id"])
        )
    )
    assert persisted is not None
    assert persisted.range_form == "tolerance"
    assert persisted.tolerance == "0"


@pytest.mark.parametrize(
    "changes",
    [
        {"range_form": "tolerance"},
        {"lower_bound": "3.0", "upper_bound": "3.6"},
        {"value": None},
    ],
)
def test_non_range_rejects_range_only_fields(clients, changes):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id)
    body["inspection_points"][0]["numeric_standard"].update(changes)
    response = manager.post("/api/v1/templates", json=body)
    assert response.status_code == 422, response.text


def test_access_and_name_conflicts(clients):
    manager = clients["manager"]
    category_id, system_id = _tree(manager)
    for name in ("editor", "outsider", "anonymous"):
        client = clients[name]
        expected = 401 if name == "anonymous" else 403
        assert (
            client.post(
                "/api/v1/template-categories", json={"name": "Denied"}
            ).status_code
            == expected
        )
        assert (
            client.post(
                "/api/v1/templates", json=_template(system_id)
            ).status_code
            == expected
        )
    assert (
        clients["editor"].get("/api/v1/template-categories").status_code == 200
    )
    assert (
        clients["editor"]
        .get("/api/v1/templates", params={"system_id": system_id})
        .status_code
        == 200
    )
    assert (
        clients["outsider"].get("/api/v1/template-categories").status_code
        == 403
    )
    assert (
        clients["admin"].get("/api/v1/template-categories").status_code == 200
    )
    assert (
        clients["admin"]
        .post("/api/v1/template-categories", json={"name": "Admin allowed"})
        .status_code
        == 201
    )

    duplicate = manager.post(
        "/api/v1/template-categories", json={"name": "civil"}
    )
    assert duplicate.status_code == 409
    assert duplicate.json() == {"error": {"code": "template.name_conflict"}}
    duplicate = manager.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": "walls"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "template.name_conflict"
    other_category = manager.post(
        "/api/v1/template-categories", json={"name": "Electrical"}
    ).json()["id"]
    other_system = manager.post(
        f"/api/v1/template-categories/{other_category}/systems",
        json={"name": "Walls"},
    )
    assert other_system.status_code == 201

    assert manager.delete(
        f"/api/v1/template-categories/{category_id}"
    ).json() == {"error": {"code": "template.category_not_empty"}}
    created = manager.post("/api/v1/templates", json=_template(system_id))
    assert created.status_code == 201, created.text
    duplicate = manager.post(
        "/api/v1/templates", json=_template(system_id, " foundation ")
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "template.name_conflict"
    assert (
        manager.post(
            "/api/v1/templates",
            json=_template(other_system.json()["id"], "Foundation"),
        ).status_code
        == 201
    )
    assert (
        manager.patch(
            f"/api/v1/template-categories/{category_id}",
            json={"name": "Electrical"},
        ).status_code
        == 409
    )
    assert (
        manager.patch(
            f"/api/v1/template-systems/{system_id}",
            json={"name": "Renamed walls"},
        ).status_code
        == 200
    )
    assert manager.delete(f"/api/v1/template-systems/{system_id}").json() == {
        "error": {"code": "template.system_not_empty"}
    }


def test_admin_can_perform_all_template_library_writes(clients):
    admin = clients["admin"]
    member = clients["editor"]
    category = admin.post(
        "/api/v1/template-categories", json={"name": "Admin category"}
    )
    assert category.status_code == 201, category.text
    category_id = category.json()["id"]
    system = admin.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": "Admin system"},
    )
    assert system.status_code == 201, system.text
    system_id = system.json()["id"]
    template = admin.post(
        "/api/v1/templates", json=_template(system_id, "Admin template")
    )
    assert template.status_code == 201, template.text
    template_id = template.json()["id"]

    empty_category = admin.post(
        "/api/v1/template-categories", json={"name": "Empty category"}
    ).json()["id"]
    empty_system = admin.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": "Empty system"},
    ).json()["id"]

    writes = [
        ("POST", "/api/v1/template-categories", {"name": "Member cat"}),
        (
            "PATCH",
            f"/api/v1/template-categories/{category_id}",
            {"name": "Member category"},
        ),
        ("DELETE", f"/api/v1/template-categories/{empty_category}", None),
        (
            "POST",
            f"/api/v1/template-categories/{category_id}/systems",
            {"name": "Member system"},
        ),
        (
            "PATCH",
            f"/api/v1/template-systems/{system_id}",
            {"name": "Member system"},
        ),
        ("DELETE", f"/api/v1/template-systems/{empty_system}", None),
        (
            "POST",
            "/api/v1/templates",
            _template(system_id, "Member template"),
        ),
        (
            "PUT",
            f"/api/v1/templates/{template_id}",
            _template(system_id, "Member template"),
        ),
        ("DELETE", f"/api/v1/templates/{template_id}", None),
        (
            "PUT",
            f"/api/v1/template-systems/{system_id}/templates",
            {"items": []},
        ),
    ]
    for method, path, body in writes:
        response = member.request(method, path, json=body)
        assert response.status_code == 403, (method, path, response.text)

    assert (
        admin.patch(
            f"/api/v1/template-categories/{category_id}",
            json={"name": "Renamed category"},
        ).status_code
        == 200
    )
    assert (
        admin.delete(
            f"/api/v1/template-categories/{empty_category}"
        ).status_code
        == 204
    )
    assert (
        admin.patch(
            f"/api/v1/template-systems/{system_id}",
            json={"name": "Renamed system"},
        ).status_code
        == 200
    )
    assert (
        admin.delete(f"/api/v1/template-systems/{empty_system}").status_code
        == 204
    )
    replacement = _template(system_id, "Admin replacement")
    replacement["id"] = template_id
    bulk = admin.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={"items": [replacement]},
    )
    assert bulk.status_code == 200, bulk.text
    assert (
        admin.put(
            f"/api/v1/templates/{template_id}",
            json=_template(system_id, "Updated by Admin"),
        ).status_code
        == 200
    )
    assert admin.delete(f"/api/v1/templates/{template_id}").status_code == 204


def test_structure_replace_and_validation(clients, db_session):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id)
    response = manager.post("/api/v1/templates", json=body)
    assert response.status_code == 201, response.text
    template_id = response.json()["id"]
    point = response.json()["inspection_points"][0]
    assert point["text_standard"] is None
    assert response.json()["inspection_points"][1]["text_standard"] == {
        "text": "As approved"
    }
    assert (
        point["numeric_standard"]["measurement_field_id"]
        == (point["measurement_fields"][0]["id"])
    )
    assert (
        point["measurement_fields"][0]["id"]
        != (body["inspection_points"][0]["measurement_fields"][0]["client_id"])
    )
    assert [
        (field["name"], field["unit"]) for field in point["measurement_fields"]
    ] == [
        ("Thickness", "mm"),
        ("Comment", None),
        ("Width", "cm"),
    ]
    assert len(point["evidence_requirements"]) == 1
    assert "result" not in response.json()
    assert "interval" not in response.json()
    assert "photo" not in response.json()

    old_points = response.json()["inspection_points"]
    old_point_ids = [UUID(point["id"]) for point in old_points]
    old_field_ids = [
        UUID(field["id"])
        for point in old_points
        for field in point["measurement_fields"]
    ]
    old_requirement_ids = [
        UUID(req["id"])
        for point in old_points
        for req in point["evidence_requirements"]
    ]
    old_standard_ids = db_session.scalars(
        select(TemplateNumericStandard.id).where(
            TemplateNumericStandard.inspection_point_id.in_(old_point_ids)
        )
    ).all()
    old_text_ids = db_session.scalars(
        select(TemplateTextStandard.id).where(
            TemplateTextStandard.inspection_point_id.in_(old_point_ids)
        )
    ).all()

    body["title"] = "Replacement"
    body["inspection_points"][0]["title"] = "New point"
    replaced = manager.put(f"/api/v1/templates/{template_id}", json=body)
    assert replaced.status_code == 200, replaced.text
    fetched = manager.get(f"/api/v1/templates/{template_id}")
    assert fetched.json() == replaced.json()
    assert fetched.json()["inspection_points"][0]["title"] == "New point"
    db_session.expire_all()
    for model, identifiers in (
        (TemplateInspectionPoint, old_point_ids),
        (TemplateMeasurementField, old_field_ids),
        (TemplateEvidenceRequirement, old_requirement_ids),
        (TemplateNumericStandard, old_standard_ids),
        (TemplateTextStandard, old_text_ids),
    ):
        assert all(
            db_session.get(model, identifier) is None
            for identifier in identifiers
        )
    assert (
        db_session.scalar(select(func.count()).select_from(TemplateItem)) == 1
    )

    invalid = _template(system_id, "Invalid")
    point_input = invalid["inspection_points"][0]
    point_input["measurement_fields"][0]["unit"] = "mm"
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["measurement_fields"][0].pop("unit")
    point_input["numeric_standard"]["measurement_field_client_id"] = (
        point_input["measurement_fields"][1]["client_id"]
    )
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["numeric_standard"]["measurement_field_client_id"] = str(
        uuid4()
    )
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["numeric_standard"]["measurement_field_client_id"] = (
        point_input["measurement_fields"][0]["client_id"]
    )
    point_input["evidence_requirements"] = []
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["evidence_requirements"] = [{"min_count": 1}]
    point_input["text_standard"] = {"text": "Mixed"}
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input.pop("text_standard")
    invalid["result"] = "pass"
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    assert manager.get(f"/api/v1/templates/{template_id}").status_code == 200


def test_single_template_api_roundtrip_preserves_sibling(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id, "Roundtrip target")
    point_input = body["inspection_points"][0]
    fields_input = point_input["measurement_fields"]
    numeric_input = point_input["numeric_standard"]
    numeric_input.update(
        condition="range",
        range_form="tolerance",
        value="10",
        tolerance="1",
    )
    numeric_input["unit"] = "mm"
    numeric_input["measurement_field_client_id"] = fields_input[0]["client_id"]
    fields_input[0]["unit"] = None

    sibling_body = _template(system_id, "Untouched sibling")
    sibling = manager.post("/api/v1/templates", json=sibling_body)
    assert sibling.status_code == 201, sibling.text
    sibling_id = sibling.json()["id"]
    sibling_before = manager.get(f"/api/v1/templates/{sibling_id}")
    assert sibling_before.status_code == 200, sibling_before.text
    sibling_snapshot = sibling_before.json()

    created = manager.post("/api/v1/templates", json=body)
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]
    initial_read = manager.get(f"/api/v1/templates/{template_id}")
    assert initial_read.status_code == 200, initial_read.text
    initial_point = initial_read.json()["inspection_points"][0]
    initial_numeric = initial_point["numeric_standard"]
    assert initial_numeric["range_form"] == "tolerance"
    assert initial_numeric["unit"] == "mm"
    assert initial_point["measurement_fields"][0]["unit"] == "mm"

    # Rebind to the formerly independent field. The old binding becomes an
    # ordinary numeric field, while the newly bound field sends unit: null.
    fields_input[0]["unit"] = "mm"
    fields_input[2]["unit"] = None
    numeric_input.update(
        value=None,
        tolerance=None,
        range_form="interval",
        lower_bound="9",
        upper_bound="11",
        unit="in",
        measurement_field_client_id=fields_input[2]["client_id"],
    )
    updated = manager.put(f"/api/v1/templates/{template_id}", json=body)
    assert updated.status_code == 200, updated.text
    updated_read = manager.get(f"/api/v1/templates/{template_id}")
    assert updated_read.status_code == 200, updated_read.text
    updated_point = updated_read.json()["inspection_points"][0]
    updated_numeric = updated_point["numeric_standard"]
    assert updated_numeric["range_form"] == "interval"
    assert updated_numeric["lower_bound"] == "9"
    assert updated_numeric["upper_bound"] == "11"
    assert updated_numeric["unit"] == "in"
    assert updated_point["measurement_fields"][0]["unit"] == "mm"
    assert updated_point["measurement_fields"][2]["unit"] == "in"
    assert (
        updated_numeric["measurement_field_id"]
        == updated_point["measurement_fields"][2]["id"]
    )

    sibling_after_update = manager.get(f"/api/v1/templates/{sibling_id}")
    assert sibling_after_update.status_code == 200
    assert sibling_after_update.json() == sibling_snapshot

    deleted = manager.delete(f"/api/v1/templates/{template_id}")
    assert deleted.status_code == 204, deleted.text
    assert manager.get(f"/api/v1/templates/{template_id}").status_code == 404
    sibling_after_delete = manager.get(f"/api/v1/templates/{sibling_id}")
    assert sibling_after_delete.status_code == 200
    assert sibling_after_delete.json() == sibling_snapshot


def test_frontend_payload_fixture_roundtrips_through_single_item_api(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    fixture_path = (
        Path(__file__).parents[3]
        / "frontend/src/admin/templates/fixtures/template-item-payload.json"
    )
    body = json.loads(fixture_path.read_text(encoding="utf-8"))
    body["system_id"] = system_id

    created = manager.post("/api/v1/templates", json=body)
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]

    fetched = manager.get(f"/api/v1/templates/{template_id}")
    assert fetched.status_code == 200, fetched.text
    fetched_points = fetched.json()["inspection_points"]
    assert [
        point["numeric_standard"]["condition"] for point in fetched_points[:4]
    ] == ["range", "<=", ">=", "="]
    assert fetched_points[0]["numeric_standard"]["range_form"] == "interval"
    assert fetched_points[4]["text_standard"]["text"] == (
        "Match the approved sample"
    )
    unbound_point = fetched_points[5]
    assert unbound_point["numeric_standard"] is None
    assert unbound_point["measurement_fields"][0]["unit"] == "m"
    second_bound_point = fetched_points[6]
    assert [
        field["unit"] for field in second_bound_point["measurement_fields"]
    ] == ["m", "cm"]
    assert (
        second_bound_point["numeric_standard"]["measurement_field_id"]
        == second_bound_point["measurement_fields"][1]["id"]
    )
    assert second_bound_point["numeric_standard"]["unit"] == "cm"
    for point in fetched_points[:4]:
        bound_id = point["numeric_standard"]["measurement_field_id"]
        bound = next(
            field
            for field in point["measurement_fields"]
            if field["id"] == bound_id
        )
        assert point["numeric_standard"]["unit"]
        assert bound["unit"] == point["numeric_standard"]["unit"]

    body["title"] = "Edited frontend payload contract"
    updated = manager.put(f"/api/v1/templates/{template_id}", json=body)
    assert updated.status_code == 200, updated.text
    reread = manager.get(f"/api/v1/templates/{template_id}")
    assert reread.status_code == 200, reread.text
    assert reread.json()["title"] == body["title"]

    deleted = manager.delete(f"/api/v1/templates/{template_id}")
    assert deleted.status_code == 204, deleted.text
    assert manager.get(f"/api/v1/templates/{template_id}").status_code == 404


def test_system_put_accepts_frontend_numeric_unit_payload(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    item = _template(system_id, "Frontend numeric payload")
    point = item["inspection_points"][0]
    bound_client_id = point["numeric_standard"]["measurement_field_client_id"]
    for field in point["measurement_fields"]:
        if field["client_id"] == bound_client_id:
            field["unit"] = None

    saved = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={"items": [item]},
    )
    assert saved.status_code == 200, saved.text
    saved_point = saved.json()["items"][0]["inspection_points"][0]
    assert saved_point["numeric_standard"]["unit"] == "mm"
    assert [field["unit"] for field in saved_point["measurement_fields"]] == [
        "mm",
        None,
        "cm",
    ]

    fetched = manager.get(f"/api/v1/template-systems/{system_id}/templates")
    assert fetched.status_code == 200, fetched.text
    fetched_point = fetched.json()["items"][0]["inspection_points"][0]
    assert fetched_point == saved_point


def test_photo_requirements_are_required_unbounded_and_photo_only(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    response = manager.post(
        "/api/v1/templates", json=_template(system_id, "Photo coverage")
    )
    assert response.status_code == 201, response.text

    fetched = manager.get(f"/api/v1/templates/{response.json()['id']}")
    assert fetched.status_code == 200, fetched.text
    points = fetched.json()["inspection_points"]
    assert len(points) == 2
    for point in points:
        requirements = point["evidence_requirements"]
        assert requirements
        assert all(
            requirement["evidence_type"] == "photo"
            and requirement["required"] is True
            and requirement["min_count"] >= 1
            and requirement["max_count"] is None
            for requirement in requirements
        )

    for invalid_requirement in (
        {"min_count": 0},
        {"required": False, "min_count": 1},
        {"min_count": 1, "evidence_type": "text"},
        {"min_count": 1, "max_count": 1},
        {"min_count": 1, "overview": True},
        {"min_count": 1, "is_overview": True},
    ):
        invalid = _template(system_id, "Invalid photo requirement")
        invalid["inspection_points"][0]["evidence_requirements"] = [
            invalid_requirement
        ]
        rejected = manager.post("/api/v1/templates", json=invalid)
        assert rejected.status_code == 422, rejected.text


def test_system_scope_pagination_and_deletion(clients):
    manager = clients["manager"]
    category_id, system_id = _tree(manager)
    ids = []
    for title in ("Alpha", "Beta", "Gamma"):
        response = manager.post(
            "/api/v1/templates", json=_template(system_id, title)
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    seen = []
    cursor = None
    while True:
        params = {"system_id": system_id, "limit": 1}
        if cursor:
            params["cursor"] = cursor
        response = clients["editor"].get("/api/v1/templates", params=params)
        assert response.status_code == 200, response.text
        seen.extend(item["id"] for item in response.json()["items"])
        cursor = response.json()["next_cursor"]
        if cursor is None:
            break
    assert seen == ids
    assert manager.get("/api/v1/templates?cursor=invalid").status_code == 422

    replacement = _template(system_id, "Only one")
    response = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={"items": [replacement]},
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["items"]) == 1
    assert (
        manager.get(
            "/api/v1/templates", params={"system_id": system_id}
        ).json()["items"][0]["title"]
        == "Only one"
    )
    assert (
        manager.delete(
            f"/api/v1/templates/{response.json()['items'][0]['id']}"
        ).status_code
        == 204
    )
    assert (
        manager.delete(f"/api/v1/template-systems/{system_id}").status_code
        == 204
    )
    assert (
        manager.delete(
            f"/api/v1/template-categories/{category_id}"
        ).status_code
        == 204
    )


def test_invalid_nested_inputs_return_validation_envelope(clients, db_session):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    original = manager.post(
        "/api/v1/templates", json=_template(system_id, "Original")
    )
    assert original.status_code == 201
    stored_field_id = original.json()["inspection_points"][0][
        "measurement_fields"
    ][0]["id"]

    def reject(change, expected_fields=None):
        body = _template(system_id, "Rejected")
        change(body)
        response = manager.post("/api/v1/templates", json=body)
        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["code"] == "request.validation_failed"
        assert error["fields"]
        if expected_fields is not None:
            assert error["fields"] == expected_fields
        assert all(set(field) == {"path", "code"} for field in error["fields"])
        db_session.expire_all()
        assert (
            db_session.scalar(select(func.count()).select_from(TemplateItem))
            == 1
        )

    reject(
        lambda body: body["inspection_points"][1].update(sequence=1),
        [
            {
                "path": "/inspection_points/0/sequence",
                "code": "template.sequence_duplicate",
            },
            {
                "path": "/inspection_points/1/sequence",
                "code": "template.sequence_duplicate",
            },
        ],
    )
    reject(
        lambda body: body["inspection_points"][1].update(
            measurement_fields=[
                {
                    "client_id": body["inspection_points"][0][
                        "measurement_fields"
                    ][0]["client_id"],
                    "name": "Repeated",
                    "field_type": "text",
                }
            ]
        ),
        [
            {
                "path": "/inspection_points/0/measurement_fields/0/client_id",
                "code": "template.client_id_duplicate",
            },
            {
                "path": "/inspection_points/1/measurement_fields/0/client_id",
                "code": "template.client_id_duplicate",
            },
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            1
        ].update(
            client_id=body["inspection_points"][0]["measurement_fields"][0][
                "client_id"
            ]
        ),
        [
            {
                "path": (
                    "/inspection_points/0/numeric_standard/"
                    "measurement_field_client_id"
                ),
                "code": "template.numeric_field_unbound",
            },
            {
                "path": "/inspection_points/0/measurement_fields/0/client_id",
                "code": "template.client_id_duplicate",
            },
            {
                "path": "/inspection_points/0/measurement_fields/1/client_id",
                "code": "template.client_id_duplicate",
            },
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            0
        ].update(id=stored_field_id)
    )
    reject(
        lambda body: body["inspection_points"][0]["numeric_standard"].update(
            measurement_field_client_id=str(uuid4())
        ),
        [
            {
                "path": (
                    "/inspection_points/0/numeric_standard/"
                    "measurement_field_client_id"
                ),
                "code": "template.numeric_field_unbound",
            },
            {
                "path": "/inspection_points/0/measurement_fields/0/unit",
                "code": "template.numeric_unit_required",
            },
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            0
        ].update(unit="mm"),
        [
            {
                "path": "/inspection_points/0/measurement_fields/0/unit",
                "code": "template.bound_field_unit_forbidden",
            }
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][2].pop(
            "unit"
        ),
        [
            {
                "path": "/inspection_points/0/measurement_fields/2/unit",
                "code": "template.numeric_unit_required",
            }
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            2
        ].update(unit="   ")
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            1
        ].update(unit="cm"),
        [
            {
                "path": "/inspection_points/0/measurement_fields/1/unit",
                "code": "template.text_unit_forbidden",
            }
        ],
    )
    reject(
        lambda body: body["inspection_points"][0]["numeric_standard"].update(
            unit="  "
        )
    )
    reject(
        lambda body: body["inspection_points"][0]["numeric_standard"].update(
            value="abc"
        )
    )
    reject(
        lambda body: body["inspection_points"][0]["numeric_standard"].update(
            value="NaN"
        )
    )
    reject(lambda body: body.update(sequence=10**12))
    reject(lambda body: body["inspection_points"][0].update(sequence=0))

    another = _template(system_id, "Another")
    another["inspection_points"][0]["measurement_fields"][0]["client_id"] = (
        stored_field_id
    )
    another["inspection_points"][0]["numeric_standard"][
        "measurement_field_client_id"
    ] = stored_field_id
    created = manager.post("/api/v1/templates", json=another)
    assert created.status_code == 201, created.text
    assert (
        created.json()["inspection_points"][0]["measurement_fields"][0]["id"]
        != stored_field_id
    )


def test_template_write_field_error_matches_frontend_contract_fixture(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id, "Template contract")
    body["inspection_points"][1]["sequence"] = 1

    response = manager.post("/api/v1/templates", json=body)

    fixture_path = (
        Path(__file__).parents[3] / "frontend/src/admin/templates/fixtures/"
        "template-write-field-error.json"
    )
    expected = json.loads(fixture_path.read_text())
    assert response.status_code == 422
    assert response.json() == expected


def test_template_write_field_errors_do_not_echo_invalid_values(clients):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    body = _template(system_id)
    body["inspection_points"][0]["measurement_fields"][0][
        "unit"
    ] = "sentinel-forbidden-bound-unit"

    response = manager.post("/api/v1/templates", json=body)

    assert response.status_code == 422
    assert response.json()["error"]["fields"] == [
        {
            "path": "/inspection_points/0/measurement_fields/0/unit",
            "code": "template.bound_field_unit_forbidden",
        }
    ]
    assert "sentinel-forbidden-bound-unit" not in response.text


def test_system_nested_read_swap_and_clear(clients, db_session):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    originals = []
    for title in ("A", "B"):
        response = manager.post(
            "/api/v1/templates", json=_template(system_id, title)
        )
        assert response.status_code == 201, response.text
        originals.append(response.json())

    path = f"/api/v1/template-systems/{system_id}/templates"
    first = clients["editor"].get(path, params={"limit": 1})
    assert first.status_code == 200
    assert first.json()["items"][0]["inspection_points"]
    second = clients["admin"].get(
        path, params={"limit": 1, "cursor": first.json()["next_cursor"]}
    )
    assert second.status_code == 200
    assert second.json()["items"][0]["id"] == originals[1]["id"]
    assert second.json()["next_cursor"] is None
    assert clients["outsider"].get(path).status_code == 403

    a = _template(system_id, "B")
    a["id"] = originals[0]["id"]
    b = _template(system_id, "A")
    b["id"] = originals[1]["id"]
    swapped = manager.put(path, json={"items": [a, b]})
    assert swapped.status_code == 200, swapped.text
    assert [
        (item["id"], item["title"]) for item in swapped.json()["items"]
    ] == [
        (originals[0]["id"], "B"),
        (originals[1]["id"], "A"),
    ]
    assert manager.get(path).json()["items"] == swapped.json()["items"]

    duplicate = _template(system_id, "C")
    duplicate["inspection_points"][0]["measurement_fields"][0]["client_id"] = (
        a["inspection_points"][0]["measurement_fields"][0]["client_id"]
    )
    duplicate["inspection_points"][0]["numeric_standard"][
        "measurement_field_client_id"
    ] = duplicate["inspection_points"][0]["measurement_fields"][0]["client_id"]
    invalid = manager.put(path, json={"items": [a, duplicate]})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "request.validation_failed"
    assert invalid.json()["error"]["fields"] == [
        {
            "path": (
                "/items/0/inspection_points/0/measurement_fields/0/client_id"
            ),
            "code": "template.client_id_duplicate",
        },
        {
            "path": (
                "/items/1/inspection_points/0/measurement_fields/0/client_id"
            ),
            "code": "template.client_id_duplicate",
        },
    ]
    assert manager.get(path).json()["items"] == swapped.json()["items"]

    cleared = manager.put(path, json={"items": []})
    assert cleared.status_code == 200
    assert cleared.json() == {"items": []}
    db_session.expire_all()
    for model in (
        TemplateItem,
        TemplateInspectionPoint,
        TemplateMeasurementField,
        TemplateNumericStandard,
        TemplateTextStandard,
        TemplateEvidenceRequirement,
    ):
        assert db_session.scalar(select(func.count()).select_from(model)) == 0


def test_known_nested_constraint_is_422_and_unknown_error_stays_500(
    clients, monkeypatch
):
    manager = clients["manager"]
    _, system_id = _tree(manager)

    def known_error(*_args, **_kwargs):
        raise IntegrityError(
            "INSERT INTO template_inspection_points",
            {},
            Exception(
                "UNIQUE constraint failed: "
                "template_inspection_points.template_item_id, "
                "template_inspection_points.sequence"
            ),
        )

    monkeypatch.setattr(
        "app.api.v1.template_library.create_template", known_error
    )
    response = manager.post(
        "/api/v1/templates", json=_template(system_id, "Known error")
    )
    assert response.status_code == 422
    assert response.json() == {"error": {"code": "request.validation_failed"}}

    def unknown_error(*_args, **_kwargs):
        raise IntegrityError(
            "INSERT INTO template_items", {}, Exception("unknown constraint")
        )

    monkeypatch.setattr(
        "app.api.v1.template_library.create_template", unknown_error
    )
    no_raise_client = TestClient(
        manager.app,
        base_url="https://testserver",
        raise_server_exceptions=False,
    )
    no_raise_client.cookies.set(
        SESSION_COOKIE_NAME, manager.cookies.get(SESSION_COOKIE_NAME)
    )
    response = no_raise_client.post(
        "/api/v1/templates", json=_template(system_id, "Unknown error")
    )
    assert response.status_code == 500
    assert response.json() == {"error": {"code": "server.internal_error"}}


def _assert_photo_requirement_field_error(
    response, path="/inspection_points/0/evidence_requirements"
) -> None:
    error = response.json()["error"]
    assert error["code"] == "request.validation_failed"
    assert {
        "path": path,
        "code": "field.too_long",
    } in error["fields"]


def _with_two_photo_rows(body: dict) -> dict:
    body["inspection_points"][0]["evidence_requirements"] = [
        {"min_count": 1},
        {"min_count": 2},
    ]
    return body


def test_template_writes_reject_two_photo_requirements_per_point(
    clients, db_session
):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    created = manager.post(
        "/api/v1/templates", json=_template(system_id, "One photo row")
    )
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]
    # Positive controls: the same bodies with one row are accepted.
    one_row_put = manager.put(
        f"/api/v1/templates/{template_id}",
        json=_template(system_id, "One photo row"),
    )
    assert one_row_put.status_code == 200, one_row_put.text
    one_row_system = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={
            "items": [
                {
                    **_template(system_id, "One photo row"),
                    "id": template_id,
                }
            ]
        },
    )
    assert one_row_system.status_code == 200, one_row_system.text
    before = db_session.scalar(
        select(func.count()).select_from(TemplateEvidenceRequirement)
    )

    posted = manager.post(
        "/api/v1/templates",
        json=_with_two_photo_rows(_template(system_id, "Two rows POST")),
    )
    assert posted.status_code == 422, posted.text
    _assert_photo_requirement_field_error(posted)

    replaced = manager.put(
        f"/api/v1/templates/{template_id}",
        json=_with_two_photo_rows(_template(system_id, "One photo row")),
    )
    assert replaced.status_code == 422, replaced.text
    _assert_photo_requirement_field_error(replaced)

    system_put = manager.put(
        f"/api/v1/template-systems/{system_id}/templates",
        json={
            "items": [
                {
                    **_with_two_photo_rows(
                        _template(system_id, "One photo row")
                    ),
                    "id": template_id,
                }
            ]
        },
    )
    assert system_put.status_code == 422, system_put.text
    _assert_photo_requirement_field_error(
        system_put, "/items/0/inspection_points/0/evidence_requirements"
    )

    db_session.expire_all()
    after = db_session.scalar(
        select(func.count()).select_from(TemplateEvidenceRequirement)
    )
    assert after == before
    fetched = manager.get(f"/api/v1/templates/{template_id}")
    assert fetched.status_code == 200, fetched.text
    assert [
        len(point["evidence_requirements"])
        for point in fetched.json()["inspection_points"]
    ] == [1, 1]


def test_structure_validation_requires_exactly_one_photo_requirement():
    from app.services.template_library import (
        InvalidTemplateError,
        validate_template_structure,
    )

    def data(requirements: list[dict]) -> dict:
        return {
            "inspection_points": [
                {
                    "sequence": 1,
                    "numeric_standard": None,
                    "measurement_fields": [],
                    "evidence_requirements": requirements,
                }
            ]
        }

    validate_template_structure(data([{"min_count": 3}]))
    for requirements in ([], [{"min_count": 1}, {"min_count": 1}]):
        with pytest.raises(InvalidTemplateError):
            validate_template_structure(data(requirements))


def test_duplicate_photo_requirement_rows_are_blocked_by_the_database(
    clients, db_session
):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    created = manager.post(
        "/api/v1/templates", json=_template(system_id, "Unique photo row")
    )
    assert created.status_code == 201, created.text
    existing = db_session.scalars(select(TemplateEvidenceRequirement)).first()
    assert existing is not None
    db_session.add(
        TemplateEvidenceRequirement(
            inspection_point_id=existing.inspection_point_id,
            evidence_type="photo",
            required=True,
            min_count=5,
            created_by=existing.created_by,
            updated_by=existing.updated_by,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_category_and_system_lists_carry_child_counts(clients):
    manager = clients["manager"]
    category_id, system_id = _tree(manager)
    empty_system = manager.post(
        f"/api/v1/template-categories/{category_id}/systems",
        json={"name": "Drainage"},
    )
    assert empty_system.status_code == 201, empty_system.text
    assert empty_system.json()["item_count"] == 0
    other_category = manager.post(
        "/api/v1/template-categories", json={"name": "Empty"}
    )
    assert other_category.json()["system_count"] == 0
    for index in range(2):
        body = _template(system_id, title=f"Template {index}")
        body["sequence"] = index + 1
        assert manager.post("/api/v1/templates", json=body).status_code == 201

    categories = {
        row["name"]: row
        for row in manager.get("/api/v1/template-categories").json()["items"]
    }
    assert categories["Civil"]["system_count"] == 2
    assert categories["Empty"]["system_count"] == 0
    systems = {
        row["name"]: row
        for row in manager.get(
            f"/api/v1/template-categories/{category_id}/systems"
        ).json()["items"]
    }
    assert systems["Walls"]["item_count"] == 2
    assert systems["Drainage"]["item_count"] == 0
    renamed = manager.patch(
        f"/api/v1/template-systems/{system_id}", json={"name": "Walls 2"}
    )
    assert renamed.json()["item_count"] == 2
    renamed = manager.patch(
        f"/api/v1/template-categories/{category_id}", json={"name": "Civil 2"}
    )
    assert renamed.json()["system_count"] == 2
