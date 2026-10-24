"""Copy template structures into project-owned inspection items."""

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.base import uuid7
from app.models import (
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
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
from app.services.audit import record_audit_event
from app.services.batch_load import load_grouped
from app.services.operator import get_current_operator
from app.services.template_library import create_template


class DuplicateProjectItemError(ValueError):
    def __init__(self, names: list[str]) -> None:
        self.names = names
        super().__init__(", ".join(names))


def lock_project_item_names(db: Session, project_id: UUID) -> None:
    """#435：序列化套用與改名的名稱檢查，避免兩個請求同時通過。

    不能先鎖專案列再鎖來源項目：Task 建立的鎖序為項目、Plan、專案。
    PostgreSQL 以獨立的交易 advisory lock 協調名稱，SQLite 沿用寫交易鎖。
    """
    if db.get_bind().dialect.name == "postgresql":
        digest = hashlib.sha256(
            f"project-item-names:{project_id}".encode()
        ).digest()
        key = int.from_bytes(digest[:8], "big", signed=True)
        db.execute(select(func.pg_advisory_xact_lock(key)))


def _reject_duplicate_names(
    db: Session, project_id: UUID, templates: Sequence[TemplateItem]
) -> None:
    lock_project_item_names(db, project_id)
    # Every path creating ProjectInspectionItem must take this same
    # project-row lock before checking names and writing copies.
    # PostgreSQL serializes applies here; SQLite does not row-lock.
    db.scalar(
        select(Project.id).where(Project.id == project_id).with_for_update()
    )
    existing = {
        title.strip().casefold()
        for title in db.scalars(
            select(ProjectInspectionItem.title).where(
                ProjectInspectionItem.project_id == project_id
            )
        )
    }
    conflicts = [
        template.title
        for template in templates
        if template.title.strip().casefold() in existing
    ]
    if conflicts:
        raise DuplicateProjectItemError(conflicts)


def _copy_template_item(
    db: Session,
    *,
    project_id: UUID,
    template: TemplateItem,
    source_name: str,
    source_category_name: str,
    source_system_name: str,
    applied_at: datetime,
    operator_id: UUID,
) -> ProjectInspectionItem:
    copy = ProjectInspectionItem(
        project_id=project_id,
        sequence=template.sequence,
        title=template.title,
        instruction=template.instruction,
        source_template_name=source_name,
        source_category_name=source_category_name,
        source_system_name=source_system_name,
        applied_at=applied_at,
        created_by=operator_id,
        updated_by=operator_id,
    )
    db.add(copy)
    db.flush()

    points = db.scalars(
        select(TemplateInspectionPoint)
        .where(TemplateInspectionPoint.template_item_id == template.id)
        .order_by(TemplateInspectionPoint.sequence, TemplateInspectionPoint.id)
    ).all()
    point_ids = [point.id for point in points]
    template_fields = load_grouped(
        db,
        TemplateMeasurementField.inspection_point_id,
        point_ids,
        TemplateMeasurementField.sort_order,
        TemplateMeasurementField.id,
    )
    template_texts = load_grouped(
        db, TemplateTextStandard.inspection_point_id, point_ids
    )
    template_numerics = load_grouped(
        db, TemplateNumericStandard.inspection_point_id, point_ids
    )
    template_evidence = load_grouped(
        db,
        TemplateEvidenceRequirement.inspection_point_id,
        point_ids,
        TemplateEvidenceRequirement.created_at,
        TemplateEvidenceRequirement.id,
    )
    for template_point in points:
        point = ProjectInspectionPoint(
            project_inspection_item_id=copy.id,
            sequence=template_point.sequence,
            title=template_point.title,
            instruction=template_point.instruction,
            created_by=operator_id,
            updated_by=operator_id,
        )
        db.add(point)
        db.flush()

        field_id_map: dict[UUID, UUID] = {}
        for template_field in template_fields.get(template_point.id, ()):
            field_id = uuid7()
            field_id_map[template_field.id] = field_id
            db.add(
                ProjectMeasurementField(
                    id=field_id,
                    inspection_point_id=point.id,
                    project_inspection_item_id=copy.id,
                    name=template_field.name,
                    field_type=template_field.field_type,
                    unit=template_field.unit,
                    sort_order=template_field.sort_order,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )

        text_standard = next(
            iter(template_texts.get(template_point.id, ())), None
        )
        if text_standard is not None:
            db.add(
                ProjectTextStandard(
                    inspection_point_id=point.id,
                    project_inspection_item_id=copy.id,
                    text=text_standard.text,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )

        numeric_standard = next(
            iter(template_numerics.get(template_point.id, ())), None
        )
        if numeric_standard is not None:
            db.add(
                ProjectNumericStandard(
                    inspection_point_id=point.id,
                    project_inspection_item_id=copy.id,
                    value=numeric_standard.value,
                    condition=numeric_standard.condition,
                    unit=numeric_standard.unit,
                    tolerance=numeric_standard.tolerance,
                    range_form=numeric_standard.range_form,
                    lower_bound=numeric_standard.lower_bound,
                    upper_bound=numeric_standard.upper_bound,
                    measurement_field_id=field_id_map[
                        numeric_standard.measurement_field_id
                    ],
                    measurement_field_type=(
                        numeric_standard.measurement_field_type
                    ),
                    measurement_field_unit=(
                        numeric_standard.measurement_field_unit
                    ),
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )

        for requirement in template_evidence.get(template_point.id, ()):
            db.add(
                ProjectEvidenceRequirement(
                    inspection_point_id=point.id,
                    project_inspection_item_id=copy.id,
                    evidence_type=requirement.evidence_type,
                    required=requirement.required,
                    min_count=requirement.min_count,
                    max_count=requirement.max_count,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
    db.flush()
    return copy


def apply_template(
    db: Session,
    *,
    project_id: UUID,
    template_id: UUID | None = None,
    system_id: UUID | None = None,
) -> list[ProjectInspectionItem] | None:
    """Copy one template or every template in a system atomically.

    The caller owns the request transaction. A missing source returns
    ``None`` so the API can expose the common 404 envelope.
    """
    if template_id is None and system_id is None:
        raise ValueError("template_id or system_id is required")
    operator: User = get_current_operator(db)
    applied_at = datetime.now(UTC)
    if template_id is not None:
        template = db.get(TemplateItem, template_id)
        if template is None:
            return None
        system = db.get(TemplateSystem, template.system_id)
        category = (
            db.get(TemplateCategory, system.category_id)
            if system is not None
            else None
        )
        if system is None or category is None:
            return None
        _reject_duplicate_names(db, project_id, [template])
        copies = [
            _copy_template_item(
                db,
                project_id=project_id,
                template=template,
                source_name=template.title,
                source_category_name=category.name,
                source_system_name=system.name,
                applied_at=applied_at,
                operator_id=operator.id,
            )
        ]
        record_audit_event(
            db,
            "project.template_applied",
            entity_id=project_id,
            project_id=project_id,
            before=None,
            after={
                "source_type": "item",
                "source_id": template.id,
                "source_name": template.title,
                "item_count": len(copies),
            },
        )
        return copies

    # TPL-AC06、#727：持有目標系統鎖後再配號，並保留來源共享鎖。
    system = db.scalar(
        select(TemplateSystem)
        .where(TemplateSystem.id == system_id)
        .with_for_update()
    )
    if system is None:
        return None
    category = db.get(TemplateCategory, system.category_id)
    if category is None:
        return None
    templates = db.scalars(
        select(TemplateItem)
        .where(TemplateItem.system_id == system_id)
        .order_by(TemplateItem.sequence, TemplateItem.id)
    ).all()
    _reject_duplicate_names(db, project_id, templates)
    copies = [
        _copy_template_item(
            db,
            project_id=project_id,
            template=template,
            source_name=system.name,
            source_category_name=category.name,
            source_system_name=system.name,
            applied_at=applied_at,
            operator_id=operator.id,
        )
        for template in templates
    ]
    if copies:
        record_audit_event(
            db,
            "project.template_applied",
            entity_id=project_id,
            project_id=project_id,
            before=None,
            after={
                "source_type": "system",
                "source_id": system.id,
                "source_name": system.name,
                "item_count": len(copies),
            },
        )
    return copies


def create_template_from_project_item(
    db: Session,
    project_id: UUID,
    project_inspection_item_id: UUID,
    system_id: UUID,
    name: str | None = None,
) -> TemplateItem | None:
    """Copy one project-owned inspection item into a template system.

    A source outside ``project_id`` is indistinguishable from a missing
    source, so callers cannot use this operation to copy across projects.
    """
    # #435：持有來源共享鎖直到複製與稽核完成，避免刪除先清掉子結構，
    # 造成存出不完整範本；與 Task 快照的來源讀取使用相同鎖語意。
    source = db.scalar(
        select(ProjectInspectionItem)
        .where(
            ProjectInspectionItem.id == project_inspection_item_id,
            ProjectInspectionItem.project_id == project_id,
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    # TPL-AC06、#727：持有目標系統鎖後再配號，並保留來源共享鎖。
    system = db.scalar(
        select(TemplateSystem)
        .where(TemplateSystem.id == system_id)
        .with_for_update()
    )
    if source is None or system is None:
        return None

    points_data: list[dict[str, object]] = []
    points = db.scalars(
        select(ProjectInspectionPoint)
        .where(ProjectInspectionPoint.project_inspection_item_id == source.id)
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    point_ids = [point.id for point in points]
    project_fields = load_grouped(
        db,
        ProjectMeasurementField.inspection_point_id,
        point_ids,
        ProjectMeasurementField.sort_order,
        ProjectMeasurementField.id,
    )
    project_texts = load_grouped(
        db, ProjectTextStandard.inspection_point_id, point_ids
    )
    project_numerics = load_grouped(
        db, ProjectNumericStandard.inspection_point_id, point_ids
    )
    project_requirements = load_grouped(
        db,
        ProjectEvidenceRequirement.inspection_point_id,
        point_ids,
        ProjectEvidenceRequirement.created_at,
        ProjectEvidenceRequirement.id,
    )
    for point in points:
        fields = project_fields.get(point.id, [])
        client_ids = {field.id: uuid7() for field in fields}
        text = next(iter(project_texts.get(point.id, ())), None)
        numeric = next(iter(project_numerics.get(point.id, ())), None)
        requirements = project_requirements.get(point.id, [])
        points_data.append(
            {
                "sequence": point.sequence,
                "title": point.title,
                "instruction": point.instruction,
                "text_standard": {"text": text.text} if text else None,
                "numeric_standard": {
                    "value": numeric.value,
                    "condition": numeric.condition,
                    "unit": numeric.unit,
                    "tolerance": numeric.tolerance,
                    "range_form": numeric.range_form,
                    "lower_bound": numeric.lower_bound,
                    "upper_bound": numeric.upper_bound,
                    "measurement_field_client_id": client_ids[
                        numeric.measurement_field_id
                    ],
                }
                if numeric
                else None,
                "measurement_fields": [
                    {
                        "client_id": client_ids[field.id],
                        "name": field.name,
                        "field_type": field.field_type,
                        "unit": (
                            None
                            if numeric is not None
                            and numeric.measurement_field_id == field.id
                            else field.unit
                        ),
                    }
                    for field in fields
                ],
                "evidence_requirements": [
                    {"min_count": requirement.min_count}
                    for requirement in requirements
                ],
            }
        )

    template = create_template(
        db,
        {
            "system_id": system_id,
            "sequence": (
                db.scalar(
                    select(func.max(TemplateItem.sequence)).where(
                        TemplateItem.system_id == system_id
                    )
                )
                or 0
            )
            + 1,
            "title": source.title if name is None else name,
            "instruction": source.instruction,
            "inspection_points": points_data,
        },
        audit_created=False,
    )
    record_audit_event(
        db,
        "template_item.created_from_project",
        entity_id=template.id,
        project_id=project_id,
        before=None,
        after={
            "project_id": project_id,
            "project_inspection_item_id": project_inspection_item_id,
            "system_id": system_id,
            "title": template.title,
        },
    )
    return template
