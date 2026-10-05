"""Project template application API (TPL-AC05/08, T4)."""

from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text

from alembic import command
from app.api.errors import ErrorCode
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import dispose_engine
from app.models import (
    AuditLog,
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
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateTextStandard,
)
from app.services import project_templates
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
    other_project = Project(
        project_code="APPLY-2",
        name="Other apply project",
        client_name="Client",
        site_location="Site",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role = Role(
        name="Project manager", created_by=admin.id, updated_by=admin.id
    )
    role.permission_codes.append(
        RolePermission(code="project_inspection_item.edit")
    )
    db_session.add_all([project, other_project, role])
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
    template_admin = create_root_user_with_company(
        db_session, "APPLY-TPL-ADMIN"
    )
    db_session.add(
        SystemRoleAssignment(
            user_id=template_admin.id,
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
        "template_admin": create_session(db_session, template_admin)[1],
    }
    db_session.commit()
    return {
        "project": project,
        "other_project": other_project,
        "admin": _client_for(make_client, tokens["admin"]),
        "editor": _client_for(make_client, tokens["editor"]),
        "outsider": _client_for(make_client, tokens["outsider"]),
        "template_admin": _client_for(make_client, tokens["template_admin"]),
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
                            "tolerance": "0.5",
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


def test_duplicate_apply_rejects_single_and_system_atomically(
    db_session, make_client
):
    world = _world(db_session, make_client)
    system_id, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    first = world["editor"].post(url, json={"template_id": template_ids[0]})
    assert first.status_code == 201, first.text
    item = db_session.get(ProjectInspectionItem, UUID(first.json()[0]["id"]))
    assert item is not None
    item.title = " FIRST ITEM "
    db_session.commit()
    for source in (
        {"template_id": template_ids[0]},
        {"system_id": system_id},
    ):
        response = world["editor"].post(url, json=source)
        assert response.status_code == 409, response.text
        assert response.json() == {
            "error": {
                "code": ErrorCode.PROJECT_INSPECTION_ITEM_DUPLICATE_NAME.value,
                "details": ["First item"],
            }
        }
        rows = db_session.scalars(
            select(ProjectInspectionItem).where(
                ProjectInspectionItem.project_id == world["project"].id
            )
        ).all()
        assert [row.id for row in rows] == [item.id]


def test_interval_survives_apply_and_save_as_template(db_session, make_client):
    world = _world(db_session, make_client)
    system_id, template_ids = _create_templates(world["admin"])
    numeric = db_session.scalar(
        select(TemplateNumericStandard)
        .join(TemplateInspectionPoint)
        .where(
            TemplateInspectionPoint.template_item_id == UUID(template_ids[0])
        )
    )
    assert numeric is not None
    numeric.condition = "range"
    numeric.range_form = "interval"
    numeric.value = None
    numeric.tolerance = None
    numeric.lower_bound = "3.0"
    numeric.upper_bound = "3.6"
    db_session.commit()
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(url, json={"template_id": template_ids[0]})
    assert applied.status_code == 201, applied.text
    listed = world["template_admin"].get(
        f"/api/v1/projects/{world['project'].id}/inspection-items"
    )
    standard = listed.json()["items"][0]["inspection_points"][0][
        "numeric_standard"
    ]
    assert (
        standard["range_form"],
        standard["lower_bound"],
        standard["upper_bound"],
    ) == ("interval", "3.0", "3.6")
    category = world["template_admin"].post(
        "/api/v1/template-categories", json={"name": "Saved category"}
    )
    target = world["template_admin"].post(
        f"/api/v1/template-categories/{category.json()['id']}/systems",
        json={"name": "Saved system"},
    )
    saved = world["template_admin"].post(
        f"/api/v1/projects/{world['project'].id}/templates",
        json={
            "project_inspection_item_id": applied.json()[0]["id"],
            "system_id": target.json()["id"],
        },
    )
    assert saved.status_code == 201, saved.text
    assert (
        saved.json()["inspection_points"][0]["numeric_standard"]["range_form"]
        == "interval"
    )


def test_measurement_field_order_survives_apply_and_save_as_template(
    db_session, make_client
):
    world = _world(db_session, make_client)
    category = world["admin"].post(
        "/api/v1/template-categories", json={"name": "Ordered category"}
    )
    system = world["admin"].post(
        f"/api/v1/template-categories/{category.json()['id']}/systems",
        json={"name": "Ordered system"},
    )
    field_ids = [str(uuid4()) for _ in range(3)]
    body = {
        "system_id": system.json()["id"],
        "sequence": 1,
        "title": "Ordered item",
        "instruction": "Check in displayed order",
        "inspection_points": [
            {
                "sequence": 1,
                "title": "Ordered point",
                "instruction": "Record values",
                "numeric_standard": {
                    "value": "10",
                    "condition": ">=",
                    "unit": "mm",
                    "tolerance": "1",
                    "measurement_field_client_id": field_ids[0],
                },
                "measurement_fields": [
                    {
                        "client_id": field_ids[0],
                        "name": "First",
                        "field_type": "number",
                    },
                    {
                        "client_id": field_ids[1],
                        "name": "Second",
                        "field_type": "text",
                    },
                    {
                        "client_id": field_ids[2],
                        "name": "Third",
                        "field_type": "number",
                        "unit": "cm",
                    },
                ],
                "evidence_requirements": [{"min_count": 1}],
            }
        ],
    }
    created = world["admin"].post("/api/v1/templates", json=body)
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]
    expected = [("First", "mm"), ("Second", None), ("Third", "cm")]

    read = world["admin"].get(f"/api/v1/templates/{template_id}")
    assert read.status_code == 200, read.text
    point = read.json()["inspection_points"][0]
    assert [
        (field["name"], field["unit"]) for field in point["measurement_fields"]
    ] == expected

    applied = world["editor"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-items:apply-template",
        json={"template_id": template_id},
    )
    assert applied.status_code == 201, applied.text
    project_list = world["editor"].get(
        f"/api/v1/projects/{world['project'].id}/inspection-items"
    )
    project_point = project_list.json()["items"][0]["inspection_points"][0]
    assert [
        (field["name"], field["unit"])
        for field in project_point["measurement_fields"]
    ] == expected

    saved_category = world["admin"].post(
        "/api/v1/template-categories", json={"name": "Saved ordered category"}
    )
    saved_system = world["admin"].post(
        f"/api/v1/template-categories/{saved_category.json()['id']}/systems",
        json={"name": "Saved ordered system"},
    )
    saved = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/templates",
        json={
            "project_inspection_item_id": applied.json()[0]["id"],
            "system_id": saved_system.json()["id"],
        },
    )
    assert saved.status_code == 201, saved.text
    assert [
        (field["name"], field["unit"])
        for field in saved.json()["inspection_points"][0]["measurement_fields"]
    ] == expected


def test_migration_marks_existing_ranges_as_tolerance(
    db_session, engine, migrated_url, make_client
):
    world = _world(db_session, make_client)
    _, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(url, json={"template_id": template_ids[0]})
    assert applied.status_code == 201, applied.text
    template_standard = db_session.scalar(
        select(TemplateNumericStandard)
        .join(TemplateInspectionPoint)
        .where(
            TemplateInspectionPoint.template_item_id == UUID(template_ids[0])
        )
    )
    project_standard = db_session.scalar(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.project_inspection_item_id
            == UUID(applied.json()[0]["id"])
        )
    )
    assert template_standard is not None
    assert project_standard is not None
    other_standard = db_session.scalar(
        select(TemplateNumericStandard)
        .join(TemplateInspectionPoint)
        .where(
            TemplateInspectionPoint.template_item_id == UUID(template_ids[1])
        )
    )
    assert other_standard is not None
    for standard in (template_standard, project_standard):
        standard.condition = "range"
        standard.range_form = "tolerance"
    template_standard.tolerance = None
    project_standard.tolerance = ""
    other_standard.condition = "range"
    other_standard.range_form = "tolerance"
    db_session.commit()
    db_session.close()
    engine.dispose()
    dispose_engine()
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    probe = create_engine(migrated_url)
    try:
        with probe.begin() as connection:
            for table in (
                "template_numeric_standards",
                "project_numeric_standards",
            ):
                connection.execute(
                    text(f"ALTER TABLE {table} DROP COLUMN range_form")
                )
                connection.execute(
                    text(f"ALTER TABLE {table} DROP COLUMN lower_bound")
                )
                connection.execute(
                    text(f"ALTER TABLE {table} DROP COLUMN upper_bound")
                )
            connection.execute(
                text("UPDATE alembic_version SET version_num = '325e0f21a831'")
            )
    finally:
        probe.dispose()
    command.upgrade(config, "a8356e4c12b0")
    probe = create_engine(migrated_url)
    try:
        with probe.connect() as connection:
            for table in (
                "template_numeric_standards",
                "project_numeric_standards",
            ):
                rows = connection.execute(
                    text(
                        "SELECT value, tolerance, range_form, lower_bound, "
                        f"upper_bound FROM {table} WHERE condition='range' "
                        "ORDER BY tolerance"
                    )
                ).all()
                expected = [("10", "0", "tolerance", None, None)]
                if table == "template_numeric_standards":
                    expected.append(("10", "0.5", "tolerance", None, None))
                assert rows == expected
    finally:
        probe.dispose()


def test_interval_downgrade_keeps_both_tables_intact(
    db_session, engine, migrated_url, make_client
):
    world = _world(db_session, make_client)
    _, template_ids = _create_templates(world["admin"])
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(url, json={"template_id": template_ids[0]})
    assert applied.status_code == 201, applied.text
    standard = db_session.scalar(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.project_inspection_item_id
            == UUID(applied.json()[0]["id"])
        )
    )
    assert standard is not None
    standard.condition = "range"
    standard.range_form = "interval"
    standard.value = None
    standard.tolerance = None
    standard.lower_bound = "3.0"
    standard.upper_bound = "3.6"
    db_session.commit()
    db_session.close()
    engine.dispose()
    dispose_engine()
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    probe = create_engine(migrated_url)
    try:
        with probe.begin() as connection:
            connection.execute(
                text("UPDATE alembic_version SET version_num = 'a8356e4c12b0'")
            )
    finally:
        probe.dispose()
    with pytest.raises(RuntimeError, match="interval standards"):
        command.downgrade(config, "325e0f21a831")
    probe = create_engine(migrated_url)
    try:
        with probe.connect() as connection:
            version = connection.scalar(
                text("SELECT version_num FROM alembic_version")
            )
            assert version == "a8356e4c12b0"
            for table in (
                "template_numeric_standards",
                "project_numeric_standards",
            ):
                fields = {
                    column["name"]
                    for column in inspect(connection).get_columns(table)
                }
                assert {"range_form", "lower_bound", "upper_bound"} <= fields
    finally:
        probe.dispose()


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
    fields_by_id = {field.id: field for field in fields}
    for standard in standards:
        field = fields_by_id[standard.measurement_field_id]
        assert standard.value == "10"
        assert standard.condition == ">="
        assert standard.tolerance == "0.5"
        assert field.field_type == "number"
        assert field.unit == "mm"
        assert standard.unit == "mm"
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
    existing_ids = set(
        db_session.scalars(
            select(ProjectInspectionItem.id).where(
                ProjectInspectionItem.project_id == world["project"].id
            )
        )
    )
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
    missing_system = world["editor"].post(
        url, json={"system_id": str(uuid4())}
    )
    assert missing_system.status_code == 404
    assert missing_system.json() == {"error": {"code": "resource.not_found"}}
    assert (
        set(
            db_session.scalars(
                select(ProjectInspectionItem.id).where(
                    ProjectInspectionItem.project_id == world["project"].id
                )
            )
        )
        == existing_ids
    )
    missing_project = world["admin"].post(
        f"/api/v1/projects/{uuid4()}/inspection-items:apply-template",
        json={"template_id": template_ids[0]},
    )
    assert missing_project.status_code == 404
    assert missing_project.json() == {"error": {"code": "resource.not_found"}}
    assert (
        set(
            db_session.scalars(
                select(ProjectInspectionItem.id).where(
                    ProjectInspectionItem.project_id == world["project"].id
                )
            )
        )
        == existing_ids
    )


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
    cross_project = world["editor"].post(
        f"/api/v1/projects/{world['other_project'].id}"
        "/inspection-items:apply-template",
        json={"template_id": template_ids[0]},
    )
    assert cross_project.status_code == 403
    template_admin_only = world["template_admin"].post(
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template",
        json={"template_id": template_ids[0]},
    )
    assert template_admin_only.status_code == 403
    admin_apply = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template",
        json={"template_id": template_ids[0]},
    )
    assert admin_apply.status_code == 201, admin_apply.text


def test_project_item_can_be_saved_as_template_and_audited(
    db_session, make_client
):
    world = _world(db_session, make_client)
    system_id, _ = _create_templates(world["admin"])
    apply_url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(apply_url, json={"system_id": system_id})
    assert applied.status_code == 201, applied.text
    project_item_id = applied.json()[0]["id"]

    target_category = world["admin"].post(
        "/api/v1/template-categories", json={"name": "Saved category"}
    )
    assert target_category.status_code == 201, target_category.text
    target_system = world["admin"].post(
        f"/api/v1/template-categories/{target_category.json()['id']}/systems",
        json={"name": "Saved system"},
    )
    assert target_system.status_code == 201, target_system.text
    url = f"/api/v1/projects/{world['project'].id}/templates"
    body = {
        "project_inspection_item_id": project_item_id,
        "system_id": target_system.json()["id"],
    }
    saved = world["admin"].post(url, json=body)
    assert saved.status_code == 201, saved.text
    assert saved.json()["title"] == "First item"
    saved_item_id = UUID(saved.json()["id"])
    assert saved_item_id != UUID(project_item_id)
    assert len(saved.json()["inspection_points"]) == 2
    numeric = saved.json()["inspection_points"][0]
    assert numeric["numeric_standard"]["value"] == "10"
    assert numeric["measurement_fields"][0]["unit"] == "mm"
    assert numeric["evidence_requirements"][0]["min_count"] == 2
    saved_field_id = UUID(numeric["measurement_fields"][0]["id"])
    assert UUID(numeric["numeric_standard"]["measurement_field_id"]) == (
        saved_field_id
    )
    assert saved.json()["inspection_points"][1]["text_standard"] == {
        "text": "As approved"
    }
    project_points = db_session.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id
            == UUID(project_item_id)
        )
    ).all()
    project_point_ids = {point.id for point in project_points}
    saved_point_ids = {
        UUID(point["id"]) for point in saved.json()["inspection_points"]
    }
    assert saved_point_ids.isdisjoint(project_point_ids)
    project_field_ids = set(
        db_session.scalars(
            select(ProjectMeasurementField.id).where(
                ProjectMeasurementField.project_inspection_item_id
                == UUID(project_item_id)
            )
        )
    )
    assert saved_field_id not in project_field_ids
    manager_category = world["template_admin"].post(
        "/api/v1/template-categories", json={"name": "Manager category"}
    )
    assert manager_category.status_code == 201, manager_category.text
    manager_system = world["template_admin"].post(
        f"/api/v1/template-categories/{manager_category.json()['id']}/systems",
        json={"name": "Manager system"},
    )
    assert manager_system.status_code == 201, manager_system.text
    manager_saved = world["template_admin"].post(
        url,
        json={**body, "system_id": manager_system.json()["id"]},
    )
    assert manager_saved.status_code == 201, manager_saved.text
    assert world["editor"].post(url, json=body).status_code == 403
    template_point_ids = set(
        db_session.scalars(
            select(TemplateInspectionPoint.id).where(
                TemplateInspectionPoint.template_item_id == saved_item_id
            )
        )
    )
    assert template_point_ids.isdisjoint(project_point_ids)
    template_field_ids = set(
        db_session.scalars(
            select(TemplateMeasurementField.id).where(
                TemplateMeasurementField.inspection_point_id.in_(
                    template_point_ids
                )
            )
        )
    )
    assert template_field_ids.isdisjoint(project_field_ids)
    template_numeric_ids = set(
        db_session.scalars(
            select(TemplateNumericStandard.id).where(
                TemplateNumericStandard.inspection_point_id.in_(
                    template_point_ids
                )
            )
        )
    )
    project_numeric_ids = set(
        db_session.scalars(
            select(ProjectNumericStandard.id).where(
                ProjectNumericStandard.project_inspection_item_id
                == UUID(project_item_id)
            )
        )
    )
    assert template_numeric_ids.isdisjoint(project_numeric_ids)
    template_text_ids = set(
        db_session.scalars(
            select(TemplateTextStandard.id).where(
                TemplateTextStandard.inspection_point_id.in_(
                    template_point_ids
                )
            )
        )
    )
    project_text_ids = set(
        db_session.scalars(
            select(ProjectTextStandard.id).where(
                ProjectTextStandard.project_inspection_item_id
                == UUID(project_item_id)
            )
        )
    )
    assert template_text_ids.isdisjoint(project_text_ids)
    template_evidence_ids = set(
        db_session.scalars(
            select(TemplateEvidenceRequirement.id).where(
                TemplateEvidenceRequirement.inspection_point_id.in_(
                    template_point_ids
                )
            )
        )
    )
    project_evidence_ids = set(
        db_session.scalars(
            select(ProjectEvidenceRequirement.id).where(
                ProjectEvidenceRequirement.project_inspection_item_id
                == UUID(project_item_id)
            )
        )
    )
    assert template_evidence_ids.isdisjoint(project_evidence_ids)
    project_numeric = db_session.scalar(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.project_inspection_item_id
            == UUID(project_item_id)
        )
    )
    assert project_numeric is not None
    assert project_numeric.measurement_field_id in project_field_ids
    assert project_numeric.measurement_field_id != saved_field_id
    event = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "template_item.created_from_project",
            AuditLog.entity_id == UUID(saved.json()["id"]),
        )
    )
    assert event is not None
    assert event.after == {
        "project_id": str(world["project"].id),
        "project_inspection_item_id": project_item_id,
        "system_id": target_system.json()["id"],
    }

    conflict = world["template_admin"].post(url, json=body)
    assert conflict.status_code == 409
    assert conflict.json() == {"error": {"code": "template.name_conflict"}}

    normalized_system = world["template_admin"].post(
        f"/api/v1/template-categories/{target_category.json()['id']}/systems",
        json={"name": "Normalized conflict system"},
    )
    assert normalized_system.status_code == 201, normalized_system.text
    existing = world["template_admin"].post(
        "/api/v1/templates",
        json={
            "system_id": normalized_system.json()["id"],
            "sequence": 1,
            "title": "  fIrSt ItEm  ",
            "instruction": "Existing normalized name",
            "inspection_points": [],
        },
    )
    assert existing.status_code == 201, existing.text
    normalized_conflict = world["template_admin"].post(
        url,
        json={**body, "system_id": normalized_system.json()["id"]},
    )
    assert normalized_conflict.status_code == 409
    assert normalized_conflict.json() == {
        "error": {"code": "template.name_conflict"}
    }
    forbidden = world["editor"].post(url, json=body)
    assert forbidden.status_code == 403
    invalid = world["template_admin"].post(
        url, json={**body, "unexpected": "field"}
    )
    assert invalid.status_code == 422

    replaced = world["template_admin"].put(
        f"/api/v1/templates/{saved.json()['id']}",
        json={
            "system_id": target_system.json()["id"],
            "sequence": saved.json()["sequence"],
            "title": "Edited saved item",
            "instruction": "Edited saved instruction",
            "inspection_points": [],
        },
    )
    assert replaced.status_code == 200, replaced.text
    db_session.expire_all()
    unchanged = db_session.get(ProjectInspectionItem, UUID(project_item_id))
    assert unchanged is not None
    assert unchanged.title == "First item"
    assert unchanged.instruction == "Check First item"
    assert (
        db_session.scalar(
            select(ProjectNumericStandard).where(
                ProjectNumericStandard.project_inspection_item_id
                == unchanged.id
            )
        )
        is not None
    )
    removed = world["template_admin"].delete(
        f"/api/v1/templates/{saved.json()['id']}"
    )
    assert removed.status_code == 204, removed.text
    db_session.expire_all()
    unchanged = db_session.get(ProjectInspectionItem, UUID(project_item_id))
    assert unchanged is not None
    assert unchanged.title == "First item"
    project_text = db_session.scalar(
        select(ProjectTextStandard).where(
            ProjectTextStandard.project_inspection_item_id == unchanged.id
        )
    )
    assert project_text is not None
    assert project_text.text == "As approved"


def test_project_item_list_authorization_and_cursor_pagination(
    db_session, make_client
):
    world = _world(db_session, make_client)
    system_id, _ = _create_templates(world["admin"])
    apply_url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    applied = world["editor"].post(apply_url, json={"system_id": system_id})
    assert applied.status_code == 201, applied.text
    url = f"/api/v1/projects/{world['project'].id}/inspection-items"
    first = world["editor"].get(url, params={"limit": 1})
    assert first.status_code == 200, first.text
    first_page = first.json()
    assert len(first_page["items"]) == 1
    item = first_page["items"][0]
    assert item["source_template_name"] == "Apply system"
    assert item["applied_at"]
    assert len(item["inspection_points"]) == 2
    assert first_page["next_cursor"]

    second = world["template_admin"].get(
        url, params={"limit": 1, "cursor": first_page["next_cursor"]}
    )
    assert second.status_code == 200, second.text
    assert len(second.json()["items"]) == 1
    assert second.json()["next_cursor"] is None
    assert first_page["items"][0]["id"] != second.json()["items"][0]["id"]
    assert world["outsider"].get(url).status_code == 403
    missing_project_id = uuid4()
    assert (
        world["outsider"]
        .get(f"/api/v1/projects/{missing_project_id}/inspection-items")
        .status_code
        == 403
    )
    admin_missing = world["admin"].get(
        f"/api/v1/projects/{missing_project_id}/inspection-items"
    )
    assert admin_missing.status_code == 404
    assert admin_missing.json() == {"error": {"code": "resource.not_found"}}
    missing = world["template_admin"].get(
        f"/api/v1/projects/{uuid4()}/inspection-items"
    )
    assert missing.status_code == 404

    other_project = world["other_project"]
    cross_url = f"/api/v1/projects/{other_project.id}/templates"
    cross_copy = world["template_admin"].post(
        cross_url,
        json={
            "project_inspection_item_id": first_page["items"][0]["id"],
            "system_id": system_id,
        },
    )
    assert cross_copy.status_code == 404
    cross_list_url = f"/api/v1/projects/{other_project.id}/inspection-items"
    assert world["template_admin"].get(cross_list_url).status_code == 200
    assert world["admin"].get(cross_list_url).status_code == 200
    assert world["editor"].get(cross_list_url).status_code == 403


def test_apply_system_rolls_back_all_copies_after_mid_request_failure(
    db_session, make_client, monkeypatch
):
    world = _world(db_session, make_client)
    system_id, _ = _create_templates(world["admin"])
    original_copy = project_templates._copy_template_item
    calls = 0

    def fail_after_first_copy(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("injected copy failure")
        return original_copy(*args, **kwargs)

    monkeypatch.setattr(
        project_templates, "_copy_template_item", fail_after_first_copy
    )
    url = (
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template"
    )
    with pytest.raises(RuntimeError, match="injected copy failure"):
        world["editor"].post(url, json={"system_id": system_id})

    assert calls == 2
    assert (
        db_session.scalar(
            select(ProjectInspectionItem).where(
                ProjectInspectionItem.project_id == world["project"].id
            )
        )
        is None
    )
    for child_model in (
        ProjectInspectionPoint,
        ProjectMeasurementField,
        ProjectNumericStandard,
        ProjectTextStandard,
        ProjectEvidenceRequirement,
    ):
        assert db_session.scalar(select(child_model)) is None


def test_save_as_template_rejects_a_source_with_two_photo_requirements(
    db_session, make_client
):
    world = _world(db_session, make_client)
    system_id, _ = _create_templates(world["admin"])
    applied = world["editor"].post(
        f"/api/v1/projects/{world['project'].id}"
        "/inspection-items:apply-template",
        json={"system_id": system_id},
    )
    assert applied.status_code == 201, applied.text
    project_item_id = UUID(applied.json()[0]["id"])
    first = db_session.scalars(
        select(ProjectEvidenceRequirement).where(
            ProjectEvidenceRequirement.project_inspection_item_id
            == project_item_id
        )
    ).first()
    assert first is not None
    # The unique index blocks a second row in a migrated database, so
    # drop it to stand in for data written before the index existed.
    db_session.execute(text("DROP INDEX uq_project_evidence_point_type"))
    db_session.add(
        ProjectEvidenceRequirement(
            inspection_point_id=first.inspection_point_id,
            project_inspection_item_id=project_item_id,
            evidence_type="photo",
            required=True,
            min_count=9,
            created_by=first.created_by,
            updated_by=first.updated_by,
        )
    )
    db_session.commit()
    target_category = world["admin"].post(
        "/api/v1/template-categories", json={"name": "Two rows category"}
    )
    target_system = world["admin"].post(
        f"/api/v1/template-categories/{target_category.json()['id']}/systems",
        json={"name": "Two rows system"},
    )
    assert target_system.status_code == 201, target_system.text

    rejected = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/templates",
        json={
            "project_inspection_item_id": str(project_item_id),
            "system_id": target_system.json()["id"],
        },
    )
    assert rejected.status_code == 422, rejected.text
    assert rejected.json() == {"error": {"code": "request.validation_failed"}}
    listed = world["admin"].get(
        f"/api/v1/templates?system_id={target_system.json()['id']}"
    )
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"] == []
