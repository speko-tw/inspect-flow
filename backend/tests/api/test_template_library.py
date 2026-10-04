"""Template library HTTP contract (TPL-AC01/02/03/04/07/08/09)."""

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
        name="Template editor",
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
                "evidence_requirements": [{"min_count": 1}, {"min_count": 2}],
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
    assert (
        created.json()["inspection_points"][0]["numeric_standard"][
            "range_form"
        ]
        == standard["range_form"]
    )
    changed = manager.put(
        f"/api/v1/templates/{created.json()['id']}", json=body
    )
    assert changed.status_code == 200, changed.text
    numeric["range_form"] = None
    invalid = manager.put(
        f"/api/v1/templates/{created.json()['id']}", json=body
    )
    assert invalid.status_code == 422


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
        .post("/api/v1/template-categories", json={"name": "Admin denied"})
        .status_code
        == 403
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
    assert [field["unit"] for field in point["measurement_fields"]] == [
        "mm",
        None,
        "cm",
    ]
    assert len(point["evidence_requirements"]) == 2
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

    def reject(change):
        body = _template(system_id, "Rejected")
        change(body)
        response = manager.post("/api/v1/templates", json=body)
        assert response.status_code == 422, response.text
        assert response.json() == {
            "error": {"code": "request.validation_failed"}
        }
        db_session.expire_all()
        assert (
            db_session.scalar(select(func.count()).select_from(TemplateItem))
            == 1
        )

    reject(lambda body: body["inspection_points"][1].update(sequence=1))
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
        )
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            1
        ].update(
            client_id=body["inspection_points"][0]["measurement_fields"][0][
                "client_id"
            ]
        )
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            0
        ].update(id=stored_field_id)
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][2].pop(
            "unit"
        )
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            2
        ].update(unit="   ")
    )
    reject(
        lambda body: body["inspection_points"][0]["measurement_fields"][
            1
        ].update(unit="cm")
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
    assert invalid.json() == {"error": {"code": "request.validation_failed"}}
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
