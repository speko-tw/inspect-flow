"""Shared serialization for inspection-point structures."""

from collections.abc import Sequence
from typing import Any
from uuid import UUID

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
from app.services.batch_load import load_grouped


def inspection_points_detail(
    db: Session,
    points: Sequence[Any],
    *,
    measurement_field_model: type[Any],
    text_standard_model: type[Any],
    numeric_standard_model: type[Any],
    evidence_requirement_model: type[Any],
) -> list[dict[str, Any]]:
    """Serialize template or project inspection-point structure.

    Child rows of every point load in one batched query per table, so the
    query count does not grow with the number of points.
    """
    point_ids = [point.id for point in points]
    fields = load_grouped(
        db,
        measurement_field_model.inspection_point_id,
        point_ids,
        measurement_field_model.sort_order,
        measurement_field_model.id,
    )
    texts = load_grouped(
        db, text_standard_model.inspection_point_id, point_ids
    )
    numerics = load_grouped(
        db, numeric_standard_model.inspection_point_id, point_ids
    )
    evidences = load_grouped(
        db,
        evidence_requirement_model.inspection_point_id,
        point_ids,
        evidence_requirement_model.created_at,
        evidence_requirement_model.id,
    )
    result = []
    for point in points:
        text = next(iter(texts.get(point.id, ())), None)
        numeric = next(iter(numerics.get(point.id, ())), None)
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
                    for field in fields.get(point.id, ())
                ],
                "evidence_requirements": [
                    {
                        "id": row.id,
                        "evidence_type": row.evidence_type,
                        "required": row.required,
                        "min_count": row.min_count,
                        "max_count": row.max_count,
                    }
                    for row in evidences.get(point.id, ())
                ],
            }
        )
    return result


def inspection_points_by_item(
    db: Session,
    item_ids: Sequence[UUID],
    *,
    point_item_column: Any,
    point_order_by: Sequence[Any],
    measurement_field_model: type[Any],
    text_standard_model: type[Any],
    numeric_standard_model: type[Any],
    evidence_requirement_model: type[Any],
) -> dict[UUID, list[dict[str, Any]]]:
    """Serialize the points of many items with batched queries.

    Works for template and project items alike; the caller supplies the
    point table's item column and its ordering.
    """
    grouped = load_grouped(db, point_item_column, item_ids, *point_order_by)
    flat = [point for points in grouped.values() for point in points]
    rendered = inspection_points_detail(
        db,
        flat,
        measurement_field_model=measurement_field_model,
        text_standard_model=text_standard_model,
        numeric_standard_model=numeric_standard_model,
        evidence_requirement_model=evidence_requirement_model,
    )
    by_point = {
        point.id: detail for point, detail in zip(flat, rendered, strict=True)
    }
    return {
        item_id: [by_point[point.id] for point in points]
        for item_id, points in grouped.items()
    }


def project_inspection_item_details(
    db: Session, items: Sequence[ProjectInspectionItem]
) -> list[dict[str, Any]]:
    """Serialize project items for APIs that return their details."""
    points = inspection_points_by_item(
        db,
        [item.id for item in items],
        point_item_column=ProjectInspectionPoint.project_inspection_item_id,
        point_order_by=(
            ProjectInspectionPoint.sequence,
            ProjectInspectionPoint.id,
        ),
        measurement_field_model=ProjectMeasurementField,
        text_standard_model=ProjectTextStandard,
        numeric_standard_model=ProjectNumericStandard,
        evidence_requirement_model=ProjectEvidenceRequirement,
    )
    return [
        {
            "id": item.id,
            "project_id": item.project_id,
            "sequence": item.sequence,
            "title": item.title,
            "instruction": item.instruction,
            "source_template_name": item.source_template_name,
            "applied_at": format_utc(item.applied_at),
            "inspection_points": points.get(item.id, []),
        }
        for item in items
    ]


def project_inspection_item_detail(
    db: Session, item: ProjectInspectionItem
) -> dict[str, Any]:
    """Serialize one project item for APIs that return its details."""
    return project_inspection_item_details(db, [item])[0]
