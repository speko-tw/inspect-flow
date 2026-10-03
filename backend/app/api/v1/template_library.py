"""Category, system and inspection template endpoints (TPL T3)."""

import base64
import binascii
import json
from datetime import UTC, datetime
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
from app.auth.access import require_login_access, require_system_role
from app.auth.dependencies import get_db
from app.models import (
    ProjectMember,
    ProjectMemberRole,
    RolePermission,
    SystemRoleAssignment,
    SystemRoleCode,
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
from app.services.template_library import (
    InvalidTemplateError,
    create_category,
    create_system,
    create_template,
    delete_category,
    delete_system,
    delete_template,
    rename_category,
    rename_system,
    replace_template,
)

category_router = APIRouter(
    prefix="/template-categories", tags=["template-library"]
)
system_router = APIRouter(
    prefix="/template-systems", tags=["template-library"]
)
template_router = APIRouter(prefix="/templates", tags=["template-library"])
_write = Depends(require_system_role(SystemRoleCode.TEMPLATE_ADMIN))
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
    value: str
    condition: Literal["<=", ">=", "=", "range"]
    unit: str = Field(min_length=1)
    tolerance: str | None = None
    measurement_field_id: UUID


class MeasurementFieldBody(StrictBody):
    id: UUID
    name: str = Field(min_length=1)
    field_type: Literal["text", "number"]
    unit: str | None = None


class EvidenceRequirementBody(StrictBody):
    min_count: int = Field(default=1, ge=1)


class PointBody(StrictBody):
    sequence: int
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
    sequence: int
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


def _read_access(
    db: Session = _db_dependency,  # noqa: B008
    user: User = Depends(require_login_access),  # noqa: B008
) -> User:
    if user.is_admin:
        return user
    assigned = db.scalar(
        select(SystemRoleAssignment.id).where(
            SystemRoleAssignment.user_id == user.id,
            SystemRoleAssignment.role_code
            == SystemRoleCode.TEMPLATE_ADMIN.value,
        )
    )
    if assigned is not None:
        return user
    allowed = db.scalar(
        select(ProjectMember.id)
        .join(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .join(
            RolePermission, RolePermission.role_id == ProjectMemberRole.role_id
        )
        .where(
            ProjectMember.user_id == user.id,
            RolePermission.code == "project_inspection_item.edit",
        )
        .limit(1)
    )
    if allowed is None:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    return user


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


def _write_call(call, *args):
    try:
        return call(*args)
    except InvalidTemplateError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except IntegrityError as exc:
        if _name_conflict(exc):
            raise APIError(ErrorCode.TEMPLATE_NAME_CONFLICT, 409) from exc
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
    db: Session, model, *, cursor: str | None, limit: int, filters=()
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
        "items": [_summary(row) for row in page],
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


def _detail(db: Session, item: TemplateItem) -> dict:
    data = _summary(item)
    points = db.scalars(
        select(TemplateInspectionPoint)
        .where(TemplateInspectionPoint.template_item_id == item.id)
        .order_by(TemplateInspectionPoint.sequence)
    ).all()
    result = []
    for point in points:
        fields = db.scalars(
            select(TemplateMeasurementField)
            .where(TemplateMeasurementField.inspection_point_id == point.id)
            .order_by(
                TemplateMeasurementField.created_at,
                TemplateMeasurementField.id,
            )
        ).all()
        text = db.scalar(
            select(TemplateTextStandard).where(
                TemplateTextStandard.inspection_point_id == point.id
            )
        )
        numeric = db.scalar(
            select(TemplateNumericStandard).where(
                TemplateNumericStandard.inspection_point_id == point.id
            )
        )
        requirements = db.scalars(
            select(TemplateEvidenceRequirement)
            .where(TemplateEvidenceRequirement.inspection_point_id == point.id)
            .order_by(
                TemplateEvidenceRequirement.created_at,
                TemplateEvidenceRequirement.id,
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
                        "id": requirement.id,
                        "evidence_type": "photo",
                        "required": True,
                        "min_count": requirement.min_count,
                        "max_count": None,
                    }
                    for requirement in requirements
                ],
            }
        )
    data["inspection_points"] = result
    return data


@category_router.get(
    "", dependencies=[Depends(require_login_access), Depends(_read_access)]
)
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
    dependencies=[Depends(require_login_access), Depends(_read_access)],
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


@template_router.get(
    "", dependencies=[Depends(require_login_access), Depends(_read_access)]
)
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
    return _detail(db, item)


@template_router.get(
    "/{template_id}",
    dependencies=[Depends(require_login_access), Depends(_read_access)],
)
def get_template(template_id: UUID, db: Session = _db_dependency) -> dict:
    return _detail(db, _item(db, template_id))


@template_router.put("/{template_id}", dependencies=[_write])
def put_template(
    template_id: UUID, body: TemplateBody, db: Session = _db_dependency
) -> dict:
    item = _item(db, template_id)
    _system(db, body.system_id)
    updated = _write_call(replace_template, db, item, body.model_dump())
    return _detail(db, updated)


@template_router.delete(
    "/{template_id}", status_code=204, dependencies=[_write]
)
def remove_template(template_id: UUID, db: Session = _db_dependency) -> None:
    delete_template(db, _item(db, template_id))


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
    existing = db.scalars(
        select(TemplateItem).where(TemplateItem.system_id == system_id)
    ).all()
    by_id = {item.id: item for item in existing}
    if any(identifier not in by_id for identifier in ids):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    for item in existing:
        if item.id not in ids:
            delete_template(db, item)
    result = []
    for entry in entries:
        data = entry.model_dump(exclude={"id"})
        if entry.id is None:
            item = _write_call(create_template, db, data)
        else:
            item = _write_call(replace_template, db, by_id[entry.id], data)
        result.append(_detail(db, item))
    return {"items": result}
