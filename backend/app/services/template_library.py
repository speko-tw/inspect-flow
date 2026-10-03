"""Template library writes and complete item replacement (TPL T3)."""

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    TemplateCategory,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    TemplateTextStandard,
)
from app.services.operator import get_current_operator


class InvalidTemplateError(ValueError):
    """The supplied nested structure violates template rules."""


def create_category(db: Session, name: str) -> TemplateCategory:
    operator = get_current_operator(db)
    category = TemplateCategory(
        name=name,
        created_by=operator.id,
        updated_by=operator.id,
    )
    db.add(category)
    db.flush()
    return category


def rename_category(
    db: Session, category: TemplateCategory, name: str
) -> TemplateCategory:
    category.name = name
    category.updated_by = get_current_operator(db).id
    db.flush()
    return category


def delete_category(db: Session, category: TemplateCategory) -> None:
    db.delete(category)
    db.flush()


def create_system(
    db: Session, category: TemplateCategory, name: str
) -> TemplateSystem:
    operator = get_current_operator(db)
    system = TemplateSystem(
        category_id=category.id,
        name=name,
        created_by=operator.id,
        updated_by=operator.id,
    )
    db.add(system)
    db.flush()
    return system


def rename_system(
    db: Session, system: TemplateSystem, name: str
) -> TemplateSystem:
    system.name = name
    system.updated_by = get_current_operator(db).id
    db.flush()
    return system


def delete_system(db: Session, system: TemplateSystem) -> None:
    db.delete(system)
    db.flush()


def _add_points(
    db: Session,
    item: TemplateItem,
    points: Iterable[dict],
    operator_id: UUID,
) -> None:
    for point_data in points:
        point = TemplateInspectionPoint(
            template_item_id=item.id,
            sequence=point_data["sequence"],
            title=point_data["title"],
            instruction=point_data["instruction"],
            created_by=operator_id,
            updated_by=operator_id,
        )
        db.add(point)
        db.flush()
        fields = point_data["measurement_fields"]
        numeric = point_data["numeric_standard"]
        bound_id = (
            numeric["measurement_field_id"] if numeric is not None else None
        )
        bound = [field for field in fields if field["id"] == bound_id]
        if numeric is not None and (
            len(bound) != 1 or bound[0]["field_type"] != "number"
        ):
            raise InvalidTemplateError(
                "numeric standard needs one numeric field"
            )
        if len({field["id"] for field in fields}) != len(fields):
            raise InvalidTemplateError("measurement field ids must be unique")
        for field in fields:
            unit = field["unit"]
            if field["id"] == bound_id:
                if unit is not None:
                    raise InvalidTemplateError(
                        "bound field unit must be omitted"
                    )
                assert numeric is not None
                unit = numeric["unit"]
            elif field["field_type"] == "number" and not unit:
                raise InvalidTemplateError("numeric fields require a unit")
            elif field["field_type"] == "text" and unit is not None:
                raise InvalidTemplateError("text fields cannot have a unit")
            db.add(
                TemplateMeasurementField(
                    id=field["id"],
                    inspection_point_id=point.id,
                    name=field["name"],
                    field_type=field["field_type"],
                    unit=unit,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        db.flush()
        text = point_data["text_standard"]
        if text is not None:
            db.add(
                TemplateTextStandard(
                    inspection_point_id=point.id,
                    text=text["text"],
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        if numeric is not None:
            db.add(
                TemplateNumericStandard(
                    inspection_point_id=point.id,
                    value=numeric["value"],
                    condition=numeric["condition"],
                    unit=numeric["unit"],
                    tolerance=numeric["tolerance"],
                    measurement_field_id=bound_id,
                    measurement_field_type="number",
                    measurement_field_unit=numeric["unit"],
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        for requirement in point_data["evidence_requirements"]:
            db.add(
                TemplateEvidenceRequirement(
                    inspection_point_id=point.id,
                    evidence_type="photo",
                    required=True,
                    min_count=requirement["min_count"],
                    max_count=None,
                    created_by=operator_id,
                    updated_by=operator_id,
                )
            )
        db.flush()


def create_template(db: Session, data: dict) -> TemplateItem:
    operator_id = get_current_operator(db).id
    item = TemplateItem(
        system_id=data["system_id"],
        sequence=data["sequence"],
        title=data["title"],
        instruction=data["instruction"],
        created_by=operator_id,
        updated_by=operator_id,
    )
    db.add(item)
    db.flush()
    _add_points(db, item, data["inspection_points"], operator_id)
    return item


def replace_template(
    db: Session, item: TemplateItem, data: dict
) -> TemplateItem:
    operator_id = get_current_operator(db).id
    old_points = db.scalars(
        select(TemplateInspectionPoint).where(
            TemplateInspectionPoint.template_item_id == item.id
        )
    ).all()
    for point in old_points:
        db.delete(point)
    db.flush()
    item.system_id = data["system_id"]
    item.sequence = data["sequence"]
    item.title = data["title"]
    item.instruction = data["instruction"]
    item.updated_by = operator_id
    db.flush()
    _add_points(db, item, data["inspection_points"], operator_id)
    return item


def delete_template(db: Session, item: TemplateItem) -> None:
    db.delete(item)
    db.flush()
