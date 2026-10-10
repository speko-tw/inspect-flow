"""Template library writes and complete item replacement (TPL T3)."""

from collections.abc import Iterable
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import FieldErrorCode
from app.db.base import uuid7
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


@dataclass(frozen=True)
class TemplateFieldError:
    path: str
    code: str


class InvalidTemplateError(ValueError):
    """The supplied nested structure violates template rules."""

    def __init__(self, fields: Iterable[TemplateFieldError]) -> None:
        self.fields = tuple(fields)
        super().__init__("The template structure is invalid.")


def _join_path(prefix: str, suffix: str) -> str:
    return f"{prefix}{suffix}"


def _template_violations(
    data: dict,
    path_prefix: str,
    *,
    client_paths: dict[UUID, list[str]],
) -> list[TemplateFieldError]:
    violations: list[TemplateFieldError] = []
    sequence_paths: dict[int, list[str]] = {}
    for point_index, point in enumerate(data["inspection_points"]):
        point_path = _join_path(
            path_prefix, f"/inspection_points/{point_index}"
        )
        sequence_paths.setdefault(point["sequence"], []).append(
            f"{point_path}/sequence"
        )
        requirements = point["evidence_requirements"]
        if len(requirements) != 1:
            violations.append(
                TemplateFieldError(
                    f"{point_path}/evidence_requirements",
                    FieldErrorCode.TEMPLATE_PHOTO_REQUIREMENT_COUNT.value,
                )
            )
        numeric = point["numeric_standard"]
        fields = point["measurement_fields"]
        bound_id = (
            numeric["measurement_field_client_id"]
            if numeric is not None
            else None
        )
        bound_fields = [
            field for field in fields if field["client_id"] == bound_id
        ]
        if numeric is not None and (
            len(bound_fields) != 1 or bound_fields[0]["field_type"] != "number"
        ):
            violations.append(
                TemplateFieldError(
                    f"{point_path}/numeric_standard/"
                    "measurement_field_client_id",
                    FieldErrorCode.TEMPLATE_NUMERIC_FIELD_UNBOUND.value,
                )
            )
        for field_index, field in enumerate(fields):
            field_path = f"{point_path}/measurement_fields/{field_index}"
            client_paths.setdefault(field["client_id"], []).append(
                f"{field_path}/client_id"
            )
            if field["client_id"] == bound_id and numeric is not None:
                if field["unit"] is not None:
                    code = (
                        FieldErrorCode.TEMPLATE_BOUND_FIELD_UNIT_FORBIDDEN
                    )
                    violations.append(
                        TemplateFieldError(
                            f"{field_path}/unit", code.value
                        )
                    )
            elif field["field_type"] == "number" and not field["unit"]:
                violations.append(
                    TemplateFieldError(
                        f"{field_path}/unit",
                        FieldErrorCode.TEMPLATE_NUMERIC_UNIT_REQUIRED.value,
                    )
                )
            elif field["field_type"] == "text" and field["unit"] is not None:
                violations.append(
                    TemplateFieldError(
                        f"{field_path}/unit",
                        FieldErrorCode.TEMPLATE_TEXT_UNIT_FORBIDDEN.value,
                    )
                )
    for paths in sequence_paths.values():
        if len(paths) > 1:
            violations.extend(
                TemplateFieldError(
                    path, FieldErrorCode.TEMPLATE_SEQUENCE_DUPLICATE.value
                )
                for path in paths
            )
    return violations


def validate_template_structure(data: dict, *, path_prefix: str = "") -> None:
    """Reject duplicate point positions and request-local field keys.

    Every point carries exactly one photo requirement (#464); the
    required count is ``min_count``, not the number of rows.
    """
    client_paths: dict[UUID, list[str]] = {}
    violations = _template_violations(
        data, path_prefix, client_paths=client_paths
    )
    for paths in client_paths.values():
        if len(paths) > 1:
            violations.extend(
                TemplateFieldError(
                    path, FieldErrorCode.TEMPLATE_CLIENT_ID_DUPLICATE.value
                )
                for path in paths
            )
    if violations:
        raise InvalidTemplateError(violations)


def validate_system_structures(items: Iterable[dict]) -> None:
    """Check every item before a system-wide replacement mutates rows."""
    violations: list[TemplateFieldError] = []
    client_paths: dict[UUID, list[str]] = {}
    for item_index, item in enumerate(items):
        prefix = f"/items/{item_index}"
        violations.extend(
            _template_violations(item, prefix, client_paths=client_paths)
        )
    for paths in client_paths.values():
        if len(paths) > 1:
            violations.extend(
                TemplateFieldError(
                    path, FieldErrorCode.TEMPLATE_CLIENT_ID_DUPLICATE.value
                )
                for path in paths
            )
    if violations:
        raise InvalidTemplateError(violations)


def park_template_names(db: Session, items: Iterable[TemplateItem]) -> None:
    """Free all old names so a single transaction can swap titles."""
    for item in items:
        item.title = f"__template_replacement_{uuid7()}"
    db.flush()


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
        bound_client_id = (
            numeric["measurement_field_client_id"]
            if numeric is not None
            else None
        )
        field_ids = {field["client_id"]: uuid7() for field in fields}
        for sort_order, field in enumerate(fields):
            unit = field["unit"]
            if field["client_id"] == bound_client_id:
                if unit is not None:
                    code = (
                        FieldErrorCode.TEMPLATE_BOUND_FIELD_UNIT_FORBIDDEN
                    )
                    raise InvalidTemplateError(
                        [
                            TemplateFieldError(
                                "", code.value
                            )
                        ]
                    )
                assert numeric is not None
                unit = numeric["unit"]
            elif field["field_type"] == "number" and not unit:
                code = FieldErrorCode.TEMPLATE_NUMERIC_UNIT_REQUIRED.value
                raise InvalidTemplateError(
                    [TemplateFieldError("", code)]
                )
            elif field["field_type"] == "text" and unit is not None:
                code = FieldErrorCode.TEMPLATE_TEXT_UNIT_FORBIDDEN
                raise InvalidTemplateError(
                    [
                        TemplateFieldError("", code.value)
                    ]
                )
            db.add(
                TemplateMeasurementField(
                    id=field_ids[field["client_id"]],
                    inspection_point_id=point.id,
                    name=field["name"],
                    field_type=field["field_type"],
                    unit=unit,
                    sort_order=sort_order,
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
            assert bound_client_id is not None
            db.add(
                TemplateNumericStandard(
                    inspection_point_id=point.id,
                    value=numeric["value"],
                    condition=numeric["condition"],
                    unit=numeric["unit"],
                    tolerance=numeric["tolerance"],
                    range_form=numeric["range_form"],
                    lower_bound=numeric["lower_bound"],
                    upper_bound=numeric["upper_bound"],
                    measurement_field_id=field_ids[bound_client_id],
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
    validate_template_structure(data)
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
    validate_template_structure(data)
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
