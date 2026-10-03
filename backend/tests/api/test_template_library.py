"""Template library HTTP contract (TPL-AC01/02/03/04/07/08/09)."""

from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    SystemRoleAssignment,
    TemplateItem,
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
                    "measurement_field_id": field_id,
                },
                "measurement_fields": [
                    {
                        "id": field_id,
                        "name": "Thickness",
                        "field_type": "number",
                    },
                    {
                        "id": str(uuid4()),
                        "name": "Comment",
                        "field_type": "text",
                    },
                    {
                        "id": str(uuid4()),
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
        == (body["inspection_points"][0]["measurement_fields"][0]["id"])
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

    body["title"] = "Replacement"
    body["inspection_points"][0]["title"] = "New point"
    replaced = manager.put(f"/api/v1/templates/{template_id}", json=body)
    assert replaced.status_code == 200, replaced.text
    fetched = manager.get(f"/api/v1/templates/{template_id}")
    assert fetched.json() == replaced.json()
    assert fetched.json()["inspection_points"][0]["title"] == "New point"
    assert (
        db_session.scalar(select(func.count()).select_from(TemplateItem)) == 1
    )

    invalid = _template(system_id, "Invalid")
    point_input = invalid["inspection_points"][0]
    point_input["measurement_fields"][0]["unit"] = "mm"
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["measurement_fields"][0].pop("unit")
    point_input["numeric_standard"]["measurement_field_id"] = point_input[
        "measurement_fields"
    ][1]["id"]
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["numeric_standard"]["measurement_field_id"] = str(uuid4())
    assert manager.post("/api/v1/templates", json=invalid).status_code == 422
    point_input["numeric_standard"]["measurement_field_id"] = point_input[
        "measurement_fields"
    ][0]["id"]
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
