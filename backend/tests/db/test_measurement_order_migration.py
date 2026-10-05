"""Data preservation coverage for migration 4f7a1c93d2e6 (TPL-AC17)."""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotMeasurementField,
    TaskSnapshotNumericStandard,
    TaskSnapshotPoint,
    TemplateCategory,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    User,
)
from tests.db.conftest import create_root_user_with_company

_ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
_REVISION = "4f7a1c93d2e6"


@pytest.fixture
def session(db_url: str) -> Generator[Session, None, None]:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as result:
            yield result
    finally:
        engine.dispose()
        dispose_engine()


def _audit(actor: User) -> dict[str, object]:
    return {"created_by": actor.id, "updated_by": actor.id}


def _ordered_fields(session: Session, model, parent_column, parent_id):
    return list(
        session.scalars(
            select(model)
            .where(parent_column == parent_id)
            .order_by(model.sort_order)
        )
    )


def test_tpl_ac17_migration_preserves_related_data_and_backfills_order(
    session: Session, db_url: str
) -> None:
    actor = create_root_user_with_company(session, "TPL427")
    project = Project(
        project_code="TPL427",
        name="範例工程",
        client_name="範例業主",
        site_location="範例工地",
        **_audit(actor),
    )
    category = TemplateCategory(name="範例類別", **_audit(actor))
    session.add_all([project, category])
    session.flush()
    system = TemplateSystem(
        category_id=category.id, name="範例系統", **_audit(actor)
    )
    session.add(system)
    session.flush()
    template = TemplateItem(
        system_id=system.id,
        sequence=1,
        title="範例範本",
        instruction="範本說明",
        **_audit(actor),
    )
    session.add(template)
    session.flush()
    template_point = TemplateInspectionPoint(
        template_item_id=template.id,
        sequence=1,
        title="範本項次",
        instruction="範本項次說明",
        **_audit(actor),
    )
    session.add(template_point)
    session.flush()

    project_item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="專案副本",
        instruction="副本說明",
        source_template_name="範例範本",
        applied_at=datetime.now(UTC),
        **_audit(actor),
    )
    session.add(project_item)
    session.flush()
    project_point = ProjectInspectionPoint(
        project_inspection_item_id=project_item.id,
        sequence=1,
        title="副本項次",
        instruction="副本項次說明",
        **_audit(actor),
    )
    session.add(project_point)
    session.flush()

    plan = InspectionPlan(
        project_id=project.id, name="週查核", **_audit(actor)
    )
    session.add(plan)
    session.flush()
    task = InspectionTask(
        plan_id=plan.id,
        project_id=project.id,
        location_text="北側",
        **_audit(actor),
    )
    session.add(task)
    session.flush()
    task_item = TaskInspectionItem(
        task_id=task.id,
        project_id=project.id,
        project_inspection_item_id=project_item.id,
        **_audit(actor),
    )
    session.add(task_item)
    session.flush()
    snapshot = TaskRequirementSnapshot(
        task_inspection_item_id=task_item.id,
        revision=1,
        source_standard_revision=1,
        title="快照項目",
        instruction="快照說明",
        source_template_name="範例範本",
        **_audit(actor),
    )
    session.add(snapshot)
    session.flush()
    snapshot_point = TaskSnapshotPoint(
        snapshot_id=snapshot.id,
        source_point_id=template_point.id,
        sequence=1,
        title="快照項次",
        instruction="快照項次說明",
        **_audit(actor),
    )
    session.add(snapshot_point)
    session.flush()

    earlier = datetime(2025, 1, 1, tzinfo=UTC)
    expected = ["第一欄", "第二欄"]
    template_fields = []
    project_fields = []
    snapshot_fields = []
    for index, name in enumerate(expected):
        created = earlier + timedelta(days=index)
        template_field = TemplateMeasurementField(
            inspection_point_id=template_point.id,
            name=name,
            field_type="number",
            unit="mm",
            sort_order=1 - index,
            created_at=created,
            **_audit(actor),
        )
        project_field = ProjectMeasurementField(
            inspection_point_id=project_point.id,
            project_inspection_item_id=project_item.id,
            name=name,
            field_type="number",
            unit="mm",
            sort_order=1 - index,
            created_at=created,
            **_audit(actor),
        )
        session.add_all([template_field, project_field])
        session.flush()
        snapshot_field = TaskSnapshotMeasurementField(
            point_id=snapshot_point.id,
            source_field_id=template_field.id,
            name=name,
            field_type="number",
            unit="mm",
            sort_order=1 - index,
            created_at=created,
            **_audit(actor),
        )
        session.add(snapshot_field)
        template_fields.append(template_field)
        project_fields.append(project_field)
        snapshot_fields.append(snapshot_field)
    session.flush()
    template_standard = TemplateNumericStandard(
        inspection_point_id=template_point.id,
        value="12",
        condition=">=",
        unit="mm",
        tolerance=None,
        measurement_field_id=template_fields[0].id,
        measurement_field_type="number",
        measurement_field_unit="mm",
        **_audit(actor),
    )
    project_standard = ProjectNumericStandard(
        inspection_point_id=project_point.id,
        project_inspection_item_id=project_item.id,
        value="15",
        condition="<=",
        unit="mm",
        tolerance=None,
        measurement_field_id=project_fields[0].id,
        measurement_field_type="number",
        measurement_field_unit="mm",
        **_audit(actor),
    )
    snapshot_standard = TaskSnapshotNumericStandard(
        point_id=snapshot_point.id,
        value="18",
        condition="=",
        unit="mm",
        tolerance=None,
        source_measurement_field_id=snapshot_fields[0].source_field_id,
        measurement_field_type="number",
        measurement_field_unit="mm",
        **_audit(actor),
    )
    session.add_all([template_standard, project_standard, snapshot_standard])
    session.commit()

    before = {
        "template_point_id": template_point.id,
        "project_point_id": project_point.id,
        "snapshot_point_id": snapshot_point.id,
        "template_standard_id": template_standard.id,
        "project_standard_id": project_standard.id,
        "snapshot_standard_id": snapshot_standard.id,
        "template": [
            (row.name, row.field_type, row.unit) for row in template_fields
        ],
        "project": [
            (row.name, row.field_type, row.unit) for row in project_fields
        ],
        "snapshot": [
            (row.name, row.field_type, row.unit) for row in snapshot_fields
        ],
        "template_standard": (
            template_standard.id,
            template_standard.value,
            template_standard.condition,
            template_standard.unit,
            template_standard.tolerance,
        ),
        "project_standard": (
            project_standard.id,
            project_standard.value,
            project_standard.condition,
            project_standard.unit,
            project_standard.tolerance,
        ),
        "snapshot_standard": (
            snapshot_standard.id,
            snapshot_standard.value,
            snapshot_standard.condition,
            snapshot_standard.unit,
            snapshot_standard.tolerance,
        ),
    }
    session.close()
    dispose_engine()

    cfg = Config(str(_ALEMBIC_INI))
    command.downgrade(cfg, "6d2e4f8a91b0")
    command.upgrade(cfg, _REVISION)

    def assert_preserved(migrated: Session) -> None:
        standards = (
            (TemplateNumericStandard, before["template_standard"]),
            (ProjectNumericStandard, before["project_standard"]),
            (
                TaskSnapshotNumericStandard,
                before["snapshot_standard"],
            ),
        )
        for model, expected in standards:
            rows = list(migrated.scalars(select(model)))
            assert len(rows) == 1
            row = rows[0]
            assert (
                row.id,
                row.value,
                row.condition,
                row.unit,
                row.tolerance,
            ) == expected

        fields = (
            (
                TemplateMeasurementField,
                TemplateMeasurementField.inspection_point_id,
                before["template_point_id"],
                before["template"],
            ),
            (
                ProjectMeasurementField,
                ProjectMeasurementField.inspection_point_id,
                before["project_point_id"],
                before["project"],
            ),
            (
                TaskSnapshotMeasurementField,
                TaskSnapshotMeasurementField.point_id,
                before["snapshot_point_id"],
                before["snapshot"],
            ),
        )
        for model, column, parent_id, expected in fields:
            rows = _ordered_fields(migrated, model, column, parent_id)
            assert [
                (row.name, row.field_type, row.unit) for row in rows
            ] == expected
            assert [row.sort_order for row in rows] == [0, 1]

    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as migrated:
            assert_preserved(migrated)
    finally:
        engine.dispose()
        dispose_engine()

    command.downgrade(cfg, "6d2e4f8a91b0")
    command.upgrade(cfg, _REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as migrated:
            assert_preserved(migrated)
    finally:
        engine.dispose()
        dispose_engine()
