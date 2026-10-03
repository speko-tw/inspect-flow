"""Database acceptance for template-system T1 and DBF-AC12/13."""

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import JSON, Engine, inspect, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
    SystemRoleAssignment,
    SystemRoleCode,
    TemplateCategory,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    TemplateTextStandard,
    User,
)
from app.services import system_roles
from app.services.audit import AuditLog
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def _audit(actor: User) -> dict[str, object]:
    return {"created_by": actor.id, "updated_by": actor.id}


@pytest.fixture(autouse=True)
def _dispose_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    return db_url


@pytest.fixture
def engine(migrated_url: str) -> Generator[Engine, None, None]:
    result = create_engine_from_settings(migrated_url)
    try:
        yield result
    finally:
        result.dispose()


@pytest.fixture
def session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as result:
        yield result


@pytest.fixture
def creator(session: Session) -> User:
    user = create_root_user_with_company(session, "TMP325")
    session.commit()
    return user


@pytest.fixture
def project(session: Session, creator: User) -> Project:
    result = Project(
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
        project_code="TMP325",
        created_by=creator.id,
        updated_by=creator.id,
    )
    session.add(result)
    session.commit()
    return result


def _category(session: Session, actor: User, name: str) -> TemplateCategory:
    result = TemplateCategory(name=name, **_audit(actor))
    session.add(result)
    session.flush()
    return result


def _system(
    session: Session, actor: User, category: TemplateCategory, name: str
) -> TemplateSystem:
    result = TemplateSystem(
        category_id=category.id, name=name, **_audit(actor)
    )
    session.add(result)
    session.flush()
    return result


def _item(
    session: Session, actor: User, system: TemplateSystem, title: str
) -> TemplateItem:
    result = TemplateItem(
        system_id=system.id,
        sequence=1,
        title=title,
        instruction="檢查接合狀況",
        **_audit(actor),
    )
    session.add(result)
    session.flush()
    return result


def _point(session: Session, actor: User, item: TemplateItem):
    result = TemplateInspectionPoint(
        template_item_id=item.id,
        sequence=1,
        title="檢查接點",
        instruction="確認符合要求",
        **_audit(actor),
    )
    session.add(result)
    session.flush()
    return result


def test_tpl_ac02_and_dbf_ac13_names_are_unique_per_parent(
    session: Session, creator: User
) -> None:
    left = _category(session, creator, " 電氣工程 ")
    right = _category(session, creator, "給排水工程")
    assert left.name == "電氣工程"
    _category(session, creator, "機電工程")
    session.commit()
    session.add(TemplateCategory(name="電氣工程", **_audit(creator)))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    left = session.scalar(
        select(TemplateCategory).where(TemplateCategory.name == "電氣工程")
    )
    right = session.scalar(
        select(TemplateCategory).where(TemplateCategory.name == "給排水工程")
    )
    assert left is not None and right is not None
    _system(session, creator, left, "空調系統")
    _system(session, creator, right, "空調系統")
    session.commit()
    session.add(
        TemplateSystem(
            category_id=left.id, name=" 空調系統 ", **_audit(creator)
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    left = session.scalar(
        select(TemplateCategory).where(TemplateCategory.name == "電氣工程")
    )
    assert left is not None
    sys_a = session.scalar(
        select(TemplateSystem).where(TemplateSystem.category_id == left.id)
    )
    assert sys_a is not None
    _item(session, creator, sys_a, "接地檢查")
    _item(session, creator, sys_a, "絕緣檢查")
    session.commit()
    session.add(
        TemplateItem(
            system_id=sys_a.id,
            sequence=2,
            title=" 接地檢查 ",
            instruction="檢查",
            **_audit(creator),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    assert not hasattr(TemplateCategory, "code")


def test_tpl_ac03_ac04_and_ac07_template_is_structural_and_unversioned(
    session: Session, creator: User
) -> None:
    category = _category(session, creator, "機電")
    system = _system(session, creator, category, "消防")
    item = _item(session, creator, system, "泵浦")
    point = _point(session, creator, item)
    text_standard = TemplateTextStandard(
        inspection_point_id=point.id,
        text="依圖說施工",
        **_audit(creator),
    )
    field = TemplateMeasurementField(
        inspection_point_id=point.id,
        name="壓力",
        field_type="number",
        unit="kPa",
        **_audit(creator),
    )
    session.add_all([text_standard, field])
    session.flush()
    numeric_standard = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="200",
        condition=">=",
        unit="kPa",
        tolerance="5",
        measurement_field_id=field.id,
        measurement_field_unit="kPa",
        **_audit(creator),
    )
    evidence = TemplateEvidenceRequirement(
        inspection_point_id=point.id,
        required=True,
        min_count=1,
        max_count=None,
        **_audit(creator),
    )
    session.add_all([numeric_standard, evidence])
    session.commit()

    table_names = set(inspect(session.get_bind()).get_table_names())
    assert "template_versions" not in table_names
    columns = {
        table: {
            column["name"]
            for column in inspect(session.get_bind()).get_columns(table)
        }
        for table in table_names
    }
    forbidden = {"interval", "result", "measured_value", "photo_data"}
    assert not any(
        forbidden & table_columns for table_columns in columns.values()
    )
    template_tables = {
        table for table in table_names if table.startswith("template_")
    }
    assert not any(
        isinstance(column["type"], JSON)
        for table in template_tables
        for column in inspect(session.get_bind()).get_columns(table)
    )
    assert "code" not in columns["template_categories"]

    item.title = "泵浦修訂"
    session.commit()
    fetched_item = session.get(TemplateItem, item.id)
    assert fetched_item is not None
    assert fetched_item.title == "泵浦修訂"
    assert (
        session.scalar(
            select(TemplateItem.id).where(TemplateItem.id == item.id)
        )
        == item.id
    )
    assert evidence.evidence_type == "photo"
    assert evidence.min_count == 1 and evidence.max_count is None
    assert numeric_standard.condition == ">="
    fetched_text = session.get(TemplateTextStandard, text_standard.id)
    assert fetched_text is not None
    assert fetched_text.text == "依圖說施工"
    fetched_field = session.get(TemplateMeasurementField, field.id)
    assert fetched_field is not None
    assert fetched_field.unit == "kPa"


def test_tpl_ac09_numeric_standard_binding_constraints(
    session: Session, creator: User
) -> None:
    category = _category(session, creator, "機電")
    system = _system(session, creator, category, "空調")
    item = _item(session, creator, system, "風管")
    point = _point(session, creator, item)
    numeric = TemplateMeasurementField(
        inspection_point_id=point.id,
        name="厚度",
        field_type="number",
        unit="mm",
        **_audit(creator),
    )
    text = TemplateMeasurementField(
        inspection_point_id=point.id,
        name="狀況",
        field_type="text",
        unit=None,
        **_audit(creator),
    )
    session.add_all([numeric, text])
    session.flush()
    valid = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="1.2",
        condition=">=",
        unit="mm",
        measurement_field_id=numeric.id,
        measurement_field_unit="mm",
        **_audit(creator),
    )
    session.add(valid)
    session.commit()

    unbound = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="1.2",
        condition=">=",
        unit="mm",
        measurement_field_id=None,
        measurement_field_unit="mm",
        **_audit(creator),
    )
    session.add(unbound)
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    invalid = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="1.2",
        condition=">=",
        unit="mm",
        measurement_field_id=text.id,
        measurement_field_unit="mm",
        **_audit(creator),
    )
    session.add(invalid)
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    duplicate = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="2",
        condition=">=",
        unit="mm",
        measurement_field_id=numeric.id,
        measurement_field_unit="mm",
        **_audit(creator),
    )
    session.add(duplicate)
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    mismatch = TemplateNumericStandard(
        inspection_point_id=point.id,
        value="2",
        condition=">=",
        unit="cm",
        measurement_field_id=numeric.id,
        measurement_field_unit="mm",
        **_audit(creator),
    )
    session.add(mismatch)
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_tpl_ac08_system_role_assignment_is_audited_atomically(
    session: Session, creator: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        system_roles, "get_current_operator", lambda _: creator
    )
    monkeypatch.setattr(
        "app.services.audit.get_current_operator", lambda _: creator
    )
    assignment = system_roles.assign_system_role(
        session, creator.id, SystemRoleCode.TEMPLATE_ADMIN
    )
    assert assignment.role_code == "template_admin"
    assert (
        session.scalar(
            select(AuditLog).where(
                AuditLog.event_type == "system_role_assignment.created"
            )
        )
        is not None
    )
    session.commit()

    with pytest.raises(system_roles.SystemRoleAlreadyAssignedError):
        system_roles.assign_system_role(
            session, creator.id, SystemRoleCode.TEMPLATE_ADMIN
        )

    deleted = system_roles.revoke_system_role(
        session, creator.id, SystemRoleCode.TEMPLATE_ADMIN
    )
    assert deleted.id == assignment.id
    assert session.get(SystemRoleAssignment, assignment.id) is None
    assert (
        session.scalar(
            select(AuditLog).where(
                AuditLog.event_type == "system_role_assignment.deleted"
            )
        )
        is not None
    )
    session.commit()


def test_dbf_ac12_schema_shape(
    session: Session,
    creator: User,
    project: Project,
) -> None:
    snapshot = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="排煙風管",
        instruction="依核定圖說檢查",
        source_template_name="排煙系統",
        applied_at=datetime.now(UTC),
        **_audit(creator),
    )
    session.add(snapshot)
    session.flush()
    point = ProjectInspectionPoint(
        project_inspection_item_id=snapshot.id,
        sequence=1,
        title="風管厚度",
        instruction="量測厚度",
        **_audit(creator),
    )
    session.add(point)
    session.flush()
    field = ProjectMeasurementField(
        inspection_point_id=point.id,
        project_inspection_item_id=snapshot.id,
        name="厚度",
        field_type="number",
        unit="mm",
        **_audit(creator),
    )
    session.add(field)
    session.flush()
    session.add_all(
        [
            ProjectTextStandard(
                inspection_point_id=point.id,
                project_inspection_item_id=snapshot.id,
                text="依圖說施工",
                **_audit(creator),
            ),
            ProjectNumericStandard(
                inspection_point_id=point.id,
                project_inspection_item_id=snapshot.id,
                value="1.2",
                condition=">=",
                unit="mm",
                measurement_field_id=field.id,
                measurement_field_unit="mm",
                **_audit(creator),
            ),
            ProjectEvidenceRequirement(
                inspection_point_id=point.id,
                project_inspection_item_id=snapshot.id,
                **_audit(creator),
            ),
        ]
    )
    session.commit()

    inspector = inspect(session.get_bind())
    tables = set(inspector.get_table_names())
    expected = {
        "template_categories",
        "template_systems",
        "template_items",
        "template_inspection_points",
        "template_text_standards",
        "template_numeric_standards",
        "template_measurement_fields",
        "template_evidence_requirements",
        "project_inspection_items",
        "project_inspection_points",
        "project_text_standards",
        "project_numeric_standards",
        "project_measurement_fields",
        "project_evidence_requirements",
        "system_role_assignments",
    }
    assert expected <= tables
    for table in expected:
        columns = {item["name"] for item in inspector.get_columns(table)}
        assert {
            "id",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        } <= columns
        primary_key = inspector.get_pk_constraint(table)["constrained_columns"]
        assert primary_key == ["id"]
        assert "interval" not in columns
        assert not {"result", "measured_value", "photo_data"} & columns
    for table in (
        "project_inspection_points",
        "project_text_standards",
        "project_numeric_standards",
        "project_measurement_fields",
        "project_evidence_requirements",
    ):
        columns = {item["name"] for item in inspector.get_columns(table)}
        assert "project_inspection_item_id" in columns
        assert any(
            fk["referred_table"] == "project_inspection_items"
            for fk in inspector.get_foreign_keys(table)
        )
    assert "template_versions" not in tables
    assert "system_roles" not in tables
    assert any(
        fk["referred_table"] == "users"
        for fk in inspector.get_foreign_keys("system_role_assignments")
    )
    unique_columns = {
        tuple(constraint["column_names"])
        for constraint in inspector.get_unique_constraints(
            "system_role_assignments"
        )
    }
    assert ("user_id", "role_code") in unique_columns
    assert project.id is not None
    assert session.get(ProjectInspectionItem, snapshot.id) is not None
