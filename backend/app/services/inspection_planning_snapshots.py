"""Create and revise immutable task requirement snapshots."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.clock import utc_now
from app.models import (
    InspectionTask,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotMeasurementField,
    TaskSnapshotNumericStandard,
    TaskSnapshotPoint,
    TaskSnapshotTextStandard,
)


def _current_snapshot(session: Session, task_item_id: uuid.UUID):
    return session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item_id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )


def _copy_standard(
    session: Session,
    *,
    task_item: TaskInspectionItem,
    source: ProjectInspectionItem,
    operator_id: uuid.UUID,
    revision: int,
) -> TaskRequirementSnapshot:
    snapshot = TaskRequirementSnapshot(
        task_inspection_item_id=task_item.id,
        revision=revision,
        source_standard_revision=source.standard_revision,
        title=source.title,
        instruction=source.instruction,
        source_template_name=source.source_template_name,
        is_current=True,
        created_by=operator_id,
        updated_by=operator_id,
    )
    session.add(snapshot)
    session.flush()
    points = session.scalars(
        select(ProjectInspectionPoint)
        .where(ProjectInspectionPoint.project_inspection_item_id == source.id)
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    for source_point in points:
        point = TaskSnapshotPoint(
            snapshot_id=snapshot.id,
            source_point_id=source_point.id,
            sequence=source_point.sequence,
            title=source_point.title,
            instruction=source_point.instruction,
            created_by=operator_id,
            updated_by=operator_id,
        )
        session.add(point)
        session.flush()
        fields = session.scalars(
            select(ProjectMeasurementField)
            .where(
                ProjectMeasurementField.inspection_point_id == source_point.id
            )
            .order_by(
                ProjectMeasurementField.created_at, ProjectMeasurementField.id
            )
        ).all()
        for field in fields:
            session.add(
                TaskSnapshotMeasurementField(
                    point_id=point.id,
                    source_field_id=field.id,
                    name=field.name,
                    field_type=field.field_type,
                    unit=field.unit,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        text_standard = session.scalar(
            select(ProjectTextStandard).where(
                ProjectTextStandard.inspection_point_id == source_point.id
            )
        )
        if text_standard is not None:
            session.add(
                TaskSnapshotTextStandard(
                    point_id=point.id,
                    text=text_standard.text,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        numeric = session.scalar(
            select(ProjectNumericStandard).where(
                ProjectNumericStandard.inspection_point_id == source_point.id
            )
        )
        if numeric is not None:
            session.add(
                TaskSnapshotNumericStandard(
                    point_id=point.id,
                    value=numeric.value,
                    condition=numeric.condition,
                    unit=numeric.unit,
                    tolerance=numeric.tolerance,
                    range_form=numeric.range_form,
                    lower_bound=numeric.lower_bound,
                    upper_bound=numeric.upper_bound,
                    source_measurement_field_id=numeric.measurement_field_id,
                    measurement_field_type=numeric.measurement_field_type,
                    measurement_field_unit=numeric.measurement_field_unit,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        requirements = session.scalars(
            select(ProjectEvidenceRequirement)
            .where(
                ProjectEvidenceRequirement.inspection_point_id
                == source_point.id
            )
            .order_by(
                ProjectEvidenceRequirement.created_at,
                ProjectEvidenceRequirement.id,
            )
        ).all()
        for requirement in requirements:
            session.add(
                TaskSnapshotEvidenceRequirement(
                    point_id=point.id,
                    evidence_type=requirement.evidence_type,
                    required=requirement.required,
                    min_count=requirement.min_count,
                    max_count=requirement.max_count,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
    session.flush()
    return snapshot


def create_task_items(
    session: Session,
    *,
    task: InspectionTask,
    project_inspection_item_ids: list[uuid.UUID],
    operator_id: uuid.UUID,
) -> list[TaskInspectionItem]:
    items: list[TaskInspectionItem] = []
    seen: set[uuid.UUID] = set()
    for item_id in project_inspection_item_ids:
        if item_id in seen:
            continue
        seen.add(item_id)
        source = session.scalar(
            select(ProjectInspectionItem).where(
                ProjectInspectionItem.id == item_id,
                ProjectInspectionItem.project_id == task.project_id,
            )
        )
        if source is None:
            raise ValueError("inspection_task.invalid_project_item")
        task_item = TaskInspectionItem(
            task_id=task.id,
            project_id=task.project_id,
            project_inspection_item_id=item_id,
            created_by=operator_id,
            updated_by=operator_id,
        )
        session.add(task_item)
        session.flush()
        _copy_standard(
            session,
            task_item=task_item,
            source=source,
            operator_id=operator_id,
            revision=1,
        )
        items.append(task_item)
    if not items:
        raise ValueError("inspection_task.items_required")
    return items


def refresh_task_item(
    session: Session,
    *,
    task_item: TaskInspectionItem,
    source_item: ProjectInspectionItem,
    operator_id: uuid.UUID,
    superseded_reason: str,
    retain_history: bool = True,
) -> TaskRequirementSnapshot:
    current = _current_snapshot(session, task_item.id)
    revision = 1
    if current is not None:
        if retain_history:
            revision = current.revision + 1
            current.is_current = False
            current.superseded_reason = superseded_reason
            current.superseded_at = utc_now()
            current.updated_by = operator_id
        else:
            session.delete(current)
        session.flush()
    return _copy_standard(
        session,
        task_item=task_item,
        source=source_item,
        operator_id=operator_id,
        revision=revision,
    )
