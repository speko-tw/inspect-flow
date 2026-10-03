"""Project template application API (TPL-AC05/08, T4)."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectMember,
    ProjectMemberRole,
    ProjectNumericStandard,
    ProjectTextStandard,
    Role,
    RolePermission,
    SystemRoleAssignment,
)
from tests.db.conftest import create_root_user_with_company


def _client_for(make_client, token):
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


def _world(db_session, make_client):
    admin = create_root_user_with_company(db_session, "APPLY-ADMIN")
    admin.is_admin = True
    editor = create_root_user_with_company(db_session, "APPLY-EDITOR")
    outsider = create_root_user_with_company(db_session, "APPLY-OUTSIDER")
    project = Project(
        project_code="APPLY-1",
        name="Apply project",
        client_name="Client",
        site_location="Site",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role = Role(name="Apply editor", created_by=admin.id, updated_by=admin.id)
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
    db_session.add(
        SystemRoleAssignment(
            user_id=admin.id,
            role_code="template_admin",
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    db_session.commit()
    tokens = {
        "admin": create_session(db_session, admin)[1],
        "editor": create_session(db_session, editor)[1],
        "outsider": create_session(db_session, outsider)[1],
    }
    db_session.commit()
    return {
        "project": project,
        "admin": _client_for(make_client, tokens["admin"]),
        "editor": _client_for(make_client, tokens["editor"]),
        "outsider": _client_for(make_client, tokens["outsider"]),
    }


def _create_templates(manager: TestClient) -> tuple[str, list[str]]:
    category = manager.post(
        "/api/v1/template-categories", json={"name": "Apply category"}
    )
    assert category.status_code == 201, category.text
    system = manager.post(
        f"/api/v1/template-categories/{category.json()['id']}/systems",
        json={"name": "Apply system"},
    )
    assert system.status_code == 201, system.text
    system_id = system.json()["id"]
    template_ids = []
    for title in ("First item", "Second item"):
        field_client_id = str(uuid4())
        template = manager.post(
            "/api/v1/templates",
            json={
                "system_id": system_id,
                "sequence": len(template_ids) + 1,
                "title": title,
                "instruction": f"Check {title}",
                "inspection_points": [
                    {
                        "sequence": 1,
                        "title": "Thickness",
                        "instruction": "Measure thickness",
                        "numeric_standard": {
                            "value": "10",
                            "condition": ">=",
                            "unit": "mm",
                            "measurement_field_client_id": field_client_id,
                        },
                        "measurement_fields": [
                            {
                                "client_id": field_client_id,
                                "name": "Measured thickness",
                                "field_type": "number",
                            }
                        ],
                        "evidence_requirements": [{"min_count": 2}],
                    },
                    {
                        "sequence": 2,
                        "title": "Finish",
                        "instruction": "Check finish",
                        "text_standard": {"text": "As approved"},
                        "evidence_requirements": [{"min_count": 1}],
                    },
                ],
            },
        )
        assert template.status_code == 201, template.text
        template_ids.append(template.json()["id"])
    return system_id, template_ids


def test_apply_system_copies_nested_data_and_detaches_source(
    db_session, make_client
):
    world = _world(db_session, make_client)
    system_id, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    response = world["editor"].post(url, json={"system_id": system_id})
    assert response.status_code == 201, response.text
    applied = response.json()
    assert len(applied) == 2
    assert {item["source_template_name"] for item in applied} == {
        "Apply system"
    }
    assert len({item["applied_at"] for item in applied}) == 1
    copies = db_session.scalars(
        select(ProjectInspectionItem)
        .where(ProjectInspectionItem.project_id == world["project"].id)
        .order_by(ProjectInspectionItem.sequence)
    ).all()
    assert [item.title for item in copies] == ["First item", "Second item"]
    assert all(
        item.id != source_id
        for item, source_id in zip(copies, template_ids, strict=True)
    )
    points = db_session.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id.in_(
                [item.id for item in copies]
            )
        )
    ).all()
    assert len(points) == 4
    fields = db_session.scalars(
        select(ProjectMeasurementField).where(
            ProjectMeasurementField.project_inspection_item_id.in_(
                [item.id for item in copies]
            )
        )
    ).all()
    standards = db_session.scalars(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.project_inspection_item_id.in_(
                [item.id for item in copies]
            )
        )
    ).all()
    text_standards = db_session.scalars(
        select(ProjectTextStandard).where(
            ProjectTextStandard.project_inspection_item_id.in_(
                [item.id for item in copies]
            )
        )
    ).all()
    evidence = db_session.scalars(
        select(ProjectEvidenceRequirement).where(
            ProjectEvidenceRequirement.project_inspection_item_id.in_(
                [item.id for item in copies]
            )
        )
    ).all()
    assert len(fields) == len(standards) == len(text_standards) == 2
    assert len(evidence) == 4
    assert {row.text for row in text_standards} == {"As approved"}
    assert {field.unit for field in fields} == {"mm"}
    assert all(
        standard.measurement_field_id in {field.id for field in fields}
        for standard in standards
    )
    assert sorted(row.min_count for row in evidence) == [1, 1, 2, 2]

    replaced = world["admin"].put(
        f"/api/v1/templates/{template_ids[0]}",
        json={
            "system_id": system_id,
            "sequence": 1,
            "title": "Replaced source",
            "instruction": "Changed after application",
            "inspection_points": [],
        },
    )
    assert replaced.status_code == 200, replaced.text
    db_session.expire_all()
    unchanged = db_session.get(ProjectInspectionItem, copies[0].id)
    assert unchanged is not None
    assert unchanged.title == "First item"
    assert unchanged.instruction == "Check First item"
    assert {
        row.text
        for row in db_session.scalars(
            select(ProjectTextStandard).where(
                ProjectTextStandard.project_inspection_item_id == unchanged.id
            )
        )
    } == {"As approved"}

    # Deleting each source template leaves the project-owned copy intact.
    for source_id in template_ids:
        deleted_template = world["admin"].delete(
            f"/api/v1/templates/{source_id}"
        )
        assert deleted_template.status_code == 204, deleted_template.text
    deleted = world["admin"].delete(f"/api/v1/template-systems/{system_id}")
    assert deleted.status_code == 204, deleted.text
    db_session.expire_all()
    retained = db_session.scalars(
        select(ProjectInspectionItem)
        .where(ProjectInspectionItem.project_id == world["project"].id)
        .order_by(ProjectInspectionItem.sequence)
    ).all()
    assert [(item.title, item.source_template_name) for item in retained] == [
        ("First item", "Apply system"),
        ("Second item", "Apply system"),
    ]
    assert (
        db_session.scalar(
            select(ProjectNumericStandard).where(
                ProjectNumericStandard.project_inspection_item_id
                == retained[0].id
            )
        )
        is not None
    )
    assert (
        db_session.scalars(
            select(ProjectTextStandard).where(
                ProjectTextStandard.project_inspection_item_id
                == retained[0].id
            )
        )
        .one()
        .text
        == "As approved"
    )


def test_apply_single_uses_title_and_requires_exactly_one_source(
    db_session, make_client
):
    world = _world(db_session, make_client)
    _, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(url, json={"template_id": template_ids[0]})
    assert applied.status_code == 201, applied.text
    assert applied.json()[0]["source_template_name"] == "First item"
    assert world["editor"].post(url, json={}).status_code == 422
    assert (
        world["editor"]
        .post(
            url,
            json={"template_id": template_ids[0], "system_id": str(uuid4())},
        )
        .status_code
        == 422
    )
    missing = world["editor"].post(url, json={"template_id": str(uuid4())})
    assert missing.status_code == 404
    assert missing.json() == {"error": {"code": "resource.not_found"}}


def test_apply_empty_system_returns_successful_empty_list(
    db_session, make_client
):
    world = _world(db_session, make_client)
    category = world["admin"].post(
        "/api/v1/template-categories", json={"name": "Empty category"}
    )
    assert category.status_code == 201, category.text
    system = world["admin"].post(
        f"/api/v1/template-categories/{category.json()['id']}/systems",
        json={"name": "Empty system"},
    )
    assert system.status_code == 201, system.text
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    response = world["editor"].post(
        url, json={"system_id": system.json()["id"]}
    )
    assert response.status_code == 200
    assert response.json() == []
    assert (
        db_session.scalar(
            select(ProjectInspectionItem).where(
                ProjectInspectionItem.project_id == world["project"].id
            )
        )
        is None
    )


def test_apply_requires_project_edit_permission(db_session, make_client):
    world = _world(db_session, make_client)
    _, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    response = world["outsider"].post(
        url, json={"template_id": template_ids[0]}
    )
    assert response.status_code == 403
    assert response.json() == {"error": {"code": "permission.denied"}}
