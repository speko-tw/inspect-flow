"""Shared serialization for inspection-point structures."""

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.time_format import format_utc
from app.models import (
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
)


def inspection_points_detail(
    db: Session,
    points: Sequence[Any],
    *,
    measurement_field_model: type[Any],
    text_standard_model: type[Any],
    numeric_standard_model: type[Any],
    evidence_requirement_model: type[Any],
) -> list[dict[str, Any]]:
    """Serialize template or project inspection-point structure."""
    result = []
    for point in points:
        fields = db.scalars(
            select(measurement_field_model)
            .where(measurement_field_model.inspection_point_id == point.id)
            .order_by(
                measurement_field_model.created_at,
                measurement_field_model.id,
            )
        ).all()
        text = db.scalar(
            select(text_standard_model).where(
                text_standard_model.inspection_point_id == point.id
            )
        )
        numeric = db.scalar(
            select(numeric_standard_model).where(
                numeric_standard_model.inspection_point_id == point.id
            )
        )
        evidence = db.scalars(
            select(evidence_requirement_model)
            .where(evidence_requirement_model.inspection_point_id == point.id)
            .order_by(
                evidence_requirement_model.created_at,
                evidence_requirement_model.id,
            )
        ).all()
        result.append(
            {
                "id": point.id,
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
                    "measurement_field_id": numeric.measurement_field_id,
                }
                if numeric
                else None,
                "measurement_fields": [
                    {
                        "id": field.id,
                        "name": field.name,
                        "field_type": field.field_type,
                        "unit": field.unit,
                    }
                    for field in fields
                ],
                "evidence_requirements": [
                    {
                        "id": row.id,
                        "evidence_type": row.evidence_type,
                        "required": row.required,
                        "min_count": row.min_count,
                        "max_count": row.max_count,
                    }
                    for row in evidence
                ],
            }
        )
    return result


def project_inspection_item_detail(
    db: Session, item: ProjectInspectionItem
) -> dict[str, Any]:
    """Serialize a project item for APIs that return its details."""
    points = db.scalars(
        select(ProjectInspectionPoint)
        .where(ProjectInspectionPoint.project_inspection_item_id == item.id)
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    return {
        "id": item.id,
        "project_id": item.project_id,
        "sequence": item.sequence,
        "title": item.title,
        "instruction": item.instruction,
        "source_template_name": item.source_template_name,
        "applied_at": format_utc(item.applied_at),
        "inspection_points": inspection_points_detail(
            db,
            points,
            measurement_field_model=ProjectMeasurementField,
            text_standard_model=ProjectTextStandard,
            numeric_standard_model=ProjectNumericStandard,
            evidence_requirement_model=ProjectEvidenceRequirement,
        ),
    }
