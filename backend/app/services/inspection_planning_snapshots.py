"""依 IP-R03 固定 Task 需求，並保留 KD-55 的更正歷史。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

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


@dataclass(frozen=True)
class _SourcePoint:
    point: ProjectInspectionPoint
    fields: list[ProjectMeasurementField]
    text_standard: ProjectTextStandard | None
    numeric_standard: ProjectNumericStandard | None
    requirements: list[ProjectEvidenceRequirement]


@dataclass(frozen=True)
class TaskItemRefreshContext:
    """供同一來源項目的多個 Task 共用快照與標準資料。"""

    snapshots_by_item_id: dict[uuid.UUID, TaskRequirementSnapshot]
    source_points: list[_SourcePoint]


def _load_source_points(
    session: Session, source_item_id: uuid.UUID
) -> list[_SourcePoint]:
    points = session.scalars(
        select(ProjectInspectionPoint)
        .where(
            ProjectInspectionPoint.project_inspection_item_id == source_item_id
        )
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    point_ids = [point.id for point in points]
    if not point_ids:
        return []
    fields = session.scalars(
        select(ProjectMeasurementField)
        .where(ProjectMeasurementField.inspection_point_id.in_(point_ids))
        .order_by(
            ProjectMeasurementField.inspection_point_id,
            ProjectMeasurementField.sort_order,
            ProjectMeasurementField.id,
        )
    ).all()
    texts = session.scalars(
        select(ProjectTextStandard).where(
            ProjectTextStandard.inspection_point_id.in_(point_ids)
        )
    ).all()
    numerics = session.scalars(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.inspection_point_id.in_(point_ids)
        )
    ).all()
    requirements = session.scalars(
        select(ProjectEvidenceRequirement)
        .where(ProjectEvidenceRequirement.inspection_point_id.in_(point_ids))
        .order_by(
            ProjectEvidenceRequirement.inspection_point_id,
            ProjectEvidenceRequirement.created_at,
            ProjectEvidenceRequirement.id,
        )
    ).all()
    fields_by_point: dict[uuid.UUID, list[ProjectMeasurementField]] = {}
    for field in fields:
        fields_by_point.setdefault(field.inspection_point_id, []).append(field)
    texts_by_point = {text.inspection_point_id: text for text in texts}
    numerics_by_point = {
        numeric.inspection_point_id: numeric for numeric in numerics
    }
    requirements_by_point: dict[
        uuid.UUID, list[ProjectEvidenceRequirement]
    ] = {}
    for requirement in requirements:
        requirements_by_point.setdefault(
            requirement.inspection_point_id, []
        ).append(requirement)
    return [
        _SourcePoint(
            point=point,
            fields=fields_by_point.get(point.id, []),
            text_standard=texts_by_point.get(point.id),
            numeric_standard=numerics_by_point.get(point.id),
            requirements=requirements_by_point.get(point.id, []),
        )
        for point in points
    ]


def load_task_item_refresh_context(
    session: Session,
    *,
    task_items: Sequence[TaskInspectionItem],
    source_item: ProjectInspectionItem,
) -> TaskItemRefreshContext:
    """批次載入同一來源項目關聯 Task 的目前快照與標準。"""
    item_ids = [item.id for item in task_items]
    snapshots = (
        session.scalars(
            select(TaskRequirementSnapshot).where(
                TaskRequirementSnapshot.task_inspection_item_id.in_(item_ids),
                TaskRequirementSnapshot.is_current.is_(True),
            )
        ).all()
        if item_ids
        else []
    )
    return TaskItemRefreshContext(
        snapshots_by_item_id={
            snapshot.task_inspection_item_id: snapshot
            for snapshot in snapshots
        },
        source_points=_load_source_points(session, source_item.id),
    )


def _copy_standard(
    session: Session,
    *,
    task_item: TaskInspectionItem,
    source: ProjectInspectionItem,
    operator_id: uuid.UUID,
    revision: int,
    source_points: list[_SourcePoint] | None = None,
) -> TaskRequirementSnapshot:
    # 來源 id 與型別一併複製，避免後續專案標準變更使舊需求失真。
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
    points = (
        source_points
        if source_points is not None
        else _load_source_points(session, source.id)
    )
    for source_data in points:
        source_point = source_data.point
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
        for field in source_data.fields:
            session.add(
                TaskSnapshotMeasurementField(
                    point_id=point.id,
                    source_field_id=field.id,
                    name=field.name,
                    field_type=field.field_type,
                    unit=field.unit,
                    sort_order=field.sort_order,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        text_standard = source_data.text_standard
        if text_standard is not None:
            session.add(
                TaskSnapshotTextStandard(
                    point_id=point.id,
                    text=text_standard.text,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        numeric = source_data.numeric_standard
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
        for requirement in source_data.requirements:
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
    """依 IP-R02 建立 Task 項目並固定需求；來源為空或跨專案時拒絕。"""
    from app.services.inspection_planning import PlanningError

    items: list[TaskInspectionItem] = []
    unique_ids = list(dict.fromkeys(project_inspection_item_ids))
    if not unique_ids:
        raise PlanningError("inspection_task.items_required")
    sources = session.scalars(
        select(ProjectInspectionItem).where(
            ProjectInspectionItem.id.in_(unique_ids),
            ProjectInspectionItem.project_id == task.project_id,
        )
    ).all()
    sources_by_id = {source.id: source for source in sources}
    if set(sources_by_id) != set(unique_ids):
        raise PlanningError("inspection_task.invalid_project_item")

    for item_id in unique_ids:
        source = sources_by_id[item_id]
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
    return items


def refresh_task_item(
    session: Session,
    *,
    task_item: TaskInspectionItem,
    source_item: ProjectInspectionItem,
    operator_id: uuid.UUID,
    superseded_reason: str,
    retain_history: bool = True,
    context: TaskItemRefreshContext | None = None,
) -> TaskRequirementSnapshot:
    """依 KD-55 更新受影響項目快照；非草稿保留舊版供追查。"""
    # 依 KD-55，草稿尚未派出可原位取代；已派 Task 必須保留舊版。
    current = (
        context.snapshots_by_item_id.get(task_item.id)
        if context is not None
        else _current_snapshot(session, task_item.id)
    )
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
        source_points=context.source_points if context is not None else None,
    )
