"""Copy template structures into project-owned inspection items."""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import uuid7
from app.models import (
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    TemplateTextStandard,
    User,
)
from app.services.operator import get_current_operator


def _copy_template_item(
    db: Session,
    *,
    project_id: UUID,
    template: TemplateItem,
    source_name: str,
    applied_at: datetime,
    operator_id: UUID,
) -> ProjectInspectionItem:
    copy = ProjectInspectionItem(
        project_id=project_id,
        sequence=template.sequence,
        title=template.title,
        instruction=template.instruction,
        source_template_name=source_name,
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
        fields = db.scalars(
            select(TemplateMeasurementField).where(
                TemplateMeasurementField.inspection_point_id
                == template_point.id
            )
        ).all()
        for template_field in fields:
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
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )

        text_standard = db.scalar(
            select(TemplateTextStandard).where(
                TemplateTextStandard.inspection_point_id == template_point.id
            )
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

        numeric_standard = db.scalar(
            select(TemplateNumericStandard).where(
                TemplateNumericStandard.inspection_point_id
                == template_point.id
            )
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

        evidence = db.scalars(
            select(TemplateEvidenceRequirement).where(
                TemplateEvidenceRequirement.inspection_point_id
                == template_point.id
            )
        ).all()
        for requirement in evidence:
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
    operator: User = get_current_operator(db)
    applied_at = datetime.now(UTC)
    if template_id is not None:
        template = db.get(TemplateItem, template_id)
        if template is None:
            return None
        return [
            _copy_template_item(
                db,
                project_id=project_id,
                template=template,
                source_name=template.title,
                applied_at=applied_at,
                operator_id=operator.id,
            )
        ]

    assert system_id is not None
    system = db.get(TemplateSystem, system_id)
    if system is None:
        return None
    templates = db.scalars(
        select(TemplateItem)
        .where(TemplateItem.system_id == system_id)
        .order_by(TemplateItem.sequence, TemplateItem.id)
    ).all()
    return [
        _copy_template_item(
            db,
            project_id=project_id,
            template=template,
            source_name=system.name,
            applied_at=applied_at,
            operator_id=operator.id,
        )
        for template in templates
    ]
