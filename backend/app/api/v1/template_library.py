"""Category, system and inspection template endpoints (TPL T3)."""

import base64
import binascii
import json
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import (
    require_system_role,
    require_system_role_or_any_project_permission,
)
from app.auth.dependencies import get_db
from app.models import (
    SystemRoleCode,
    TemplateCategory,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    TemplateTextStandard,
)
from app.services.inspection_details import inspection_points_detail
from app.services.template_library import (
    InvalidTemplateError,
    create_category,
    create_system,
    create_template,
    delete_category,
    delete_system,
    delete_template,
    park_template_names,
    rename_category,
    rename_system,
    replace_template,
    validate_system_structures,
)

category_router = APIRouter(
    prefix="/template-categories", tags=["template-library"]
)
system_router = APIRouter(
    prefix="/template-systems", tags=["template-library"]
)
template_router = APIRouter(prefix="/templates", tags=["template-library"])
_write = Depends(require_system_role(SystemRoleCode.TEMPLATE_ADMIN))
_read = Depends(
    require_system_role_or_any_project_permission(
        SystemRoleCode.TEMPLATE_ADMIN,
        "project_inspection_item.edit",
    )
)
_db_dependency: Any = Depends(get_db)
_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NameBody(StrictBody):
    name: str = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def nonblank(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("name cannot be blank")
        return name


class TextStandardBody(StrictBody):
    text: str


class NumericStandardBody(StrictBody):
    value: str | None = None
    condition: Literal["<=", ">=", "=", "range"]
    unit: str = Field(min_length=1)
    tolerance: str | None = None
    range_form: Literal["interval", "tolerance"] | None = None
    lower_bound: str | None = None
    upper_bound: str | None = None
    measurement_field_client_id: UUID

    @field_validator("value", "tolerance", "lower_bound", "upper_bound")
    @classmethod
    def numeric_value(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        try:
            number = Decimal(normalized)
        except InvalidOperation as exc:
            raise ValueError("value must be numeric") from exc
        if not number.is_finite():
            raise ValueError("value must be finite")
        return normalized

    @model_validator(mode="after")
    def matching_fields(self):
        if (
            self.condition == "range"
            and "range_form" not in self.model_fields_set
        ):
            self.range_form = "tolerance"
        bounds = (self.lower_bound, self.upper_bound)
        if self.condition != "range":
            if (
                self.value is None
                or self.range_form is not None
                or any(bound is not None for bound in bounds)
            ):
                raise ValueError("non-range standards need value only")
        elif self.range_form == "interval":
            if (
                self.value is not None
                or self.tolerance is not None
                or self.lower_bound is None
                or self.upper_bound is None
            ):
                raise ValueError("interval needs ordered bounds only")
            if Decimal(self.lower_bound) > Decimal(self.upper_bound):
                raise ValueError("lower_bound exceeds upper_bound")
        elif self.range_form == "tolerance":
            if (
                self.value is None
                or self.tolerance is None
                or Decimal(self.tolerance) < 0
                or any(bound is not None for bound in bounds)
            ):
                raise ValueError("tolerance needs value and nonnegative error")
        else:
            raise ValueError("range_form is required for range")
        return self

    @field_validator("unit")
    @classmethod
    def nonblank_unit(cls, unit: str) -> str:
        normalized = unit.strip()
        if not normalized:
            raise ValueError("unit cannot be blank")
        return normalized


class MeasurementFieldBody(StrictBody):
    client_id: UUID
    name: str = Field(min_length=1)
    field_type: Literal["text", "number"]
    unit: str | None = None

    @field_validator("unit")
    @classmethod
    def nonblank_unit(cls, unit: str | None) -> str | None:
        if unit is None:
            return None
        normalized = unit.strip()
        if not normalized:
            raise ValueError("unit cannot be blank")
        return normalized


class EvidenceRequirementBody(StrictBody):
    min_count: int = Field(default=1, ge=1)


class PointBody(StrictBody):
    sequence: int = Field(ge=1, le=32767)
    title: str
    instruction: str
    text_standard: TextStandardBody | None = None
    numeric_standard: NumericStandardBody | None = None
    measurement_fields: list[MeasurementFieldBody] = Field(
        default_factory=list
    )
    evidence_requirements: list[EvidenceRequirementBody] = Field(min_length=1)

    @model_validator(mode="after")
    def one_standard(self):
        if (
            self.text_standard is not None
            and self.numeric_standard is not None
        ):
            raise ValueError("choose either a text or numeric standard")
        return self


class TemplateBody(StrictBody):
    system_id: UUID
    sequence: int = Field(ge=1, le=32767)
    title: str = Field(min_length=1)
    instruction: str
    inspection_points: list[PointBody] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, title: str) -> str:
        if not title.strip():
            raise ValueError("title cannot be blank")
        return title


class SystemTemplateBody(TemplateBody):
    id: UUID | None = None


class SystemTemplatesBody(StrictBody):
    items: list[SystemTemplateBody]


def _category(db: Session, category_id: UUID) -> TemplateCategory:
    category = db.get(TemplateCategory, category_id)
    if category is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return category


def _system(db: Session, system_id: UUID) -> TemplateSystem:
    system = db.get(TemplateSystem, system_id)
    if system is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return system


def _item(db: Session, template_id: UUID) -> TemplateItem:
    item = db.get(TemplateItem, template_id)
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return item


def _name_conflict(exc: IntegrityError) -> bool:
    constraint = getattr(
        getattr(exc.orig, "diag", None), "constraint_name", None
    )
    indexes = (
        "ix_template_categories_name",
        "ix_template_systems_category_name",
        "ix_template_items_system_title",
    )
    detail = str(exc.orig).lower()
    return constraint in indexes or any(name in detail for name in indexes)


def _invalid_structure_constraint(exc: IntegrityError) -> bool:
    constraint = getattr(
        getattr(exc.orig, "diag", None), "constraint_name", None
    )
    names = (
        "uq_template_inspection_points_template_item_id",
        "pk_template_measurement_fields",
        "uq_template_measurement_fields_point_id",
        "uq_template_measurement_fields_point_id_type_unit",
        "uq_template_numeric_standards_measurement_field_id",
        "ck_template_measurement_fields_"
        "numeric_measurement_field_requires_unit",
    )
    detail = str(exc.orig).lower()
    sqlite_columns = (
        "template_inspection_points.template_item_id, "
        "template_inspection_points.sequence",
        "template_measurement_fields.id",
        "template_numeric_standards.measurement_field_id",
    )
    return constraint in names or any(
        name in detail for name in (*names, *sqlite_columns)
    )


def _write_call(call, *args):
    try:
        return call(*args)
    except InvalidTemplateError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except IntegrityError as exc:
        if _name_conflict(exc):
            raise APIError(ErrorCode.TEMPLATE_NAME_CONFLICT, 409) from exc
        if _invalid_structure_constraint(exc):
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
        raise


def _cursor_key(cursor: str | None) -> tuple[datetime, UUID] | None:
    if cursor is None:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"t", "id"}:
            raise ValueError("invalid cursor")
        timestamp = datetime.fromisoformat(payload["t"])
        identifier = UUID(payload["id"])
        if timestamp.tzinfo is None:
            raise ValueError("cursor has no timezone")
        key = (timestamp.astimezone(UTC), identifier)
        if _encode_cursor(*key) != cursor:
            raise ValueError("noncanonical cursor")
        return key
    except (
        ValueError,
        TypeError,
        AttributeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


def _encode_cursor(created_at: datetime, identifier: UUID) -> str:
    payload = {
        "t": created_at.astimezone(UTC).isoformat(timespec="microseconds"),
        "id": str(identifier),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _page(
    db: Session,
    model,
    *,
    cursor: str | None,
    limit: int,
    filters=(),
    full: bool = False,
) -> dict:
    statement = select(model).where(*filters)
    key = _cursor_key(cursor)
    if key is not None:
        statement = statement.where(
            or_(
                model.created_at > key[0],
                and_(model.created_at == key[0], model.id > key[1]),
            )
        )
    rows = db.scalars(
        statement.order_by(model.created_at, model.id).limit(limit + 1)
    ).all()
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = page[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return {
        "items": [
            template_item_detail(db, row) if full else _summary(row)
            for row in page
        ],
        "next_cursor": next_cursor,
    }


def _summary(row) -> dict:
    data = {"id": row.id}
    for field in (
        "name",
        "category_id",
        "system_id",
        "sequence",
        "title",
        "instruction",
    ):
        if hasattr(row, field):
            data[field] = getattr(row, field)
    return data


def template_item_detail(db: Session, item: TemplateItem) -> dict:
    data = _summary(item)
    points = db.scalars(
        select(TemplateInspectionPoint)
        .where(TemplateInspectionPoint.template_item_id == item.id)
        .order_by(TemplateInspectionPoint.sequence)
    ).all()
    data["inspection_points"] = inspection_points_detail(
        db,
        points,
        measurement_field_model=TemplateMeasurementField,
        text_standard_model=TemplateTextStandard,
        numeric_standard_model=TemplateNumericStandard,
        evidence_requirement_model=TemplateEvidenceRequirement,
    )
    return data


@category_router.get("", dependencies=[_read])
def list_categories(
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,  # noqa: B008
) -> dict:
    return _page(db, TemplateCategory, cursor=cursor, limit=limit)


@category_router.post("", status_code=201, dependencies=[_write])
def add_category(body: NameBody, db: Session = _db_dependency) -> dict:
    return _summary(_write_call(create_category, db, body.name))


@category_router.patch("/{category_id}", dependencies=[_write])
def patch_category(
    category_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    category = _category(db, category_id)
    return _summary(_write_call(rename_category, db, category, body.name))


@category_router.delete(
    "/{category_id}", status_code=204, dependencies=[_write]
)
def remove_category(category_id: UUID, db: Session = _db_dependency) -> None:
    category = _category(db, category_id)
    occupied = db.scalar(
        select(TemplateSystem.id)
        .where(TemplateSystem.category_id == category_id)
        .limit(1)
    )
    if occupied is not None:
        raise APIError(ErrorCode.TEMPLATE_CATEGORY_NOT_EMPTY, 409)
    delete_category(db, category)


@category_router.get(
    "/{category_id}/systems",
    dependencies=[_read],
)
def list_systems(
    category_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    _category(db, category_id)
    return _page(
        db,
        TemplateSystem,
        cursor=cursor,
        limit=limit,
        filters=(TemplateSystem.category_id == category_id,),
    )


@category_router.post(
    "/{category_id}/systems", status_code=201, dependencies=[_write]
)
def add_system(
    category_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    category = _category(db, category_id)
    return _summary(_write_call(create_system, db, category, body.name))


@system_router.patch("/{system_id}", dependencies=[_write])
def patch_system(
    system_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    system = _system(db, system_id)
    return _summary(_write_call(rename_system, db, system, body.name))


@system_router.delete("/{system_id}", status_code=204, dependencies=[_write])
def remove_system(system_id: UUID, db: Session = _db_dependency) -> None:
    system = _system(db, system_id)
    occupied = db.scalar(
        select(TemplateItem.id)
        .where(TemplateItem.system_id == system_id)
        .limit(1)
    )
    if occupied is not None:
        raise APIError(ErrorCode.TEMPLATE_SYSTEM_NOT_EMPTY, 409)
    delete_system(db, system)


@template_router.get("", dependencies=[_read])
def list_templates(
    system_id: UUID | None = None,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    filters = ()
    if system_id is not None:
        _system(db, system_id)
        filters = (TemplateItem.system_id == system_id,)
    return _page(db, TemplateItem, cursor=cursor, limit=limit, filters=filters)


@template_router.post("", status_code=201, dependencies=[_write])
def add_template(body: TemplateBody, db: Session = _db_dependency) -> dict:
    _system(db, body.system_id)
    item = _write_call(create_template, db, body.model_dump())
    return template_item_detail(db, item)


@template_router.get("/{template_id}", dependencies=[_read])
def get_template(template_id: UUID, db: Session = _db_dependency) -> dict:
    return template_item_detail(db, _item(db, template_id))


@template_router.put("/{template_id}", dependencies=[_write])
def put_template(
    template_id: UUID, body: TemplateBody, db: Session = _db_dependency
) -> dict:
    item = _item(db, template_id)
    _system(db, body.system_id)
    updated = _write_call(replace_template, db, item, body.model_dump())
    return template_item_detail(db, updated)


@template_router.delete(
    "/{template_id}", status_code=204, dependencies=[_write]
)
def remove_template(template_id: UUID, db: Session = _db_dependency) -> None:
    delete_template(db, _item(db, template_id))


@system_router.get("/{system_id}/templates", dependencies=[_read])
def get_system_templates(
    system_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    _system(db, system_id)
    return _page(
        db,
        TemplateItem,
        cursor=cursor,
        limit=limit,
        filters=(TemplateItem.system_id == system_id,),
        full=True,
    )


@system_router.put("/{system_id}/templates", dependencies=[_write])
def put_system_templates(
    system_id: UUID, body: SystemTemplatesBody, db: Session = _db_dependency
) -> dict:
    _system(db, system_id)
    entries = body.items
    if any(entry.system_id != system_id for entry in entries):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    ids = [entry.id for entry in entries if entry.id is not None]
    names = [entry.title.strip().casefold() for entry in entries]
    if len(set(ids)) != len(ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if len(set(names)) != len(names):
        raise APIError(ErrorCode.TEMPLATE_NAME_CONFLICT, 409)
    payloads = [entry.model_dump(exclude={"id"}) for entry in entries]
    _write_call(validate_system_structures, payloads)
    existing = db.scalars(
        select(TemplateItem).where(TemplateItem.system_id == system_id)
    ).all()
    by_id = {item.id: item for item in existing}
    if any(identifier not in by_id for identifier in ids):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    _write_call(park_template_names, db, existing)
    for item in existing:
        if item.id not in ids:
            delete_template(db, item)
    result = []
    for entry, data in zip(entries, payloads, strict=True):
        if entry.id is None:
            item = _write_call(create_template, db, data)
        else:
            item = _write_call(replace_template, db, by_id[entry.id], data)
        result.append(template_item_detail(db, item))
    return {"items": result}
