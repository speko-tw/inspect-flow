"""Admin role-management endpoints (DOM-R55, AUT-R20)."""

import base64
import binascii
import json
import uuid
from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.errors import APIError, ErrorCode
from app.api.pagination import CursorKey
from app.api.time_format import format_utc
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.models import Role
from app.models.role import PermissionCodeValidationError
from app.permission_codes import permission_code_descriptions
from app.services.roles import (
    RoleUnchangedError,
    RoleUsage,
    create_role,
    delete_role,
    role_usages,
    update_role,
)

router = APIRouter(
    prefix="/roles",
    tags=["roles"],
    dependencies=[Depends(require_admin)],
)

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100


class RoleRequest(BaseModel):
    """Fields accepted when creating or updating a role."""

    name: str = Field(min_length=1, max_length=64)
    permission_codes: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    """Optional fields accepted when updating a role."""

    name: str | None = Field(default=None, min_length=1, max_length=64)
    permission_codes: list[str] | None = None


class RoleResponse(BaseModel):
    """Public role representation."""

    id: UUID
    name: str
    permission_codes: list[str]
    member_count: int
    project_count: int
    created_at: str
    updated_at: str


class RoleListResponse(BaseModel):
    """One cursor-based page of roles."""

    items: list[RoleResponse]
    next_cursor: str | None


class PermissionCodeResponse(BaseModel):
    code: str
    description: str


class PermissionCodeListResponse(BaseModel):
    items: list[PermissionCodeResponse]


def _role_response(role: Role, usage: RoleUsage) -> RoleResponse:
    return RoleResponse(
        id=role.id,
        name=role.name,
        permission_codes=sorted(item.code for item in role.permission_codes),
        member_count=usage.member_count,
        project_count=usage.project_count,
        created_at=format_utc(role.created_at),
        updated_at=format_utc(role.updated_at),
    )


def _single_role_response(db: Session, role: Role) -> RoleResponse:
    return _role_response(role, role_usages(db, [role.id])[role.id])


def _get_role(db: Session, role_id: UUID) -> Role:
    role = db.scalar(
        select(Role)
        .options(selectinload(Role.permission_codes))
        .where(Role.id == role_id)
    )
    if role is None:
        raise APIError(ErrorCode.ROLE_NOT_FOUND, 404)
    return role


def _check_cursor(cursor: str | None) -> CursorKey | None:
    if cursor is None:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"t", "id"}:
            raise ValueError("invalid cursor payload")
        created_at = datetime.fromisoformat(payload["t"])
        role_id = uuid.UUID(payload["id"])
        if created_at.tzinfo is None:
            raise ValueError("cursor timestamp must include a timezone")
        key = CursorKey(created_at=created_at.astimezone(UTC), id=role_id)
        if _encode_cursor(key) != cursor:
            raise ValueError("cursor is not canonical")
        return key
    except (
        binascii.Error,
        UnicodeDecodeError,
        json.JSONDecodeError,
        AttributeError,
        TypeError,
        ValueError,
    ) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


def _encode_cursor(key: CursorKey) -> str:
    """Keep timestamp precision in the opaque cursor sort key.

    The shared pagination helper truncates timestamps to seconds, which
    can skip or repeat roles created within the same second.
    """
    payload = {
        "t": key.created_at.astimezone(UTC).isoformat(timespec="microseconds"),
        "id": str(key.id),
    }
    raw = json.dumps(payload, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8"))
    return encoded.decode("ascii").rstrip("=")


def _translate_integrity_error(exc: IntegrityError) -> APIError | None:
    """Map role uniqueness conflicts to the role-specific 409 code."""
    diagnostic = getattr(exc.orig, "diag", None)
    constraint = getattr(diagnostic, "constraint_name", None)
    details = str(exc.orig).lower()
    if constraint == "ix_roles_name_lower" or "ix_roles_name_lower" in details:
        return APIError(ErrorCode.ROLE_NAME_CONFLICT, 409)
    return None


def _translate_permission_error() -> APIError:
    return APIError(ErrorCode.ROLE_PERMISSION_CODE_INVALID, 422)


@router.get("", response_model=RoleListResponse)
def list_roles(
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> RoleListResponse:
    """List roles in stable creation-time/UUID order (API-R08)."""
    cursor_key = _check_cursor(cursor)
    statement = select(Role).options(selectinload(Role.permission_codes))
    if cursor_key is not None:
        statement = statement.where(
            or_(
                Role.created_at > cursor_key.created_at,
                and_(
                    Role.created_at == cursor_key.created_at,
                    Role.id > cursor_key.id,
                ),
            )
        )
    roles = list(
        db.scalars(
            statement.order_by(Role.created_at, Role.id).limit(limit + 1)
        ).all()
    )
    has_more = len(roles) > limit
    page = roles[:limit]
    next_cursor = None
    if has_more and page:
        last = page[-1]
        next_cursor = _encode_cursor(
            CursorKey(created_at=last.created_at, id=last.id)
        )
    usages = role_usages(db, [role.id for role in page])
    return RoleListResponse(
        items=[_role_response(role, usages[role.id]) for role in page],
        next_cursor=next_cursor,
    )


@router.get("/permission-codes", response_model=PermissionCodeListResponse)
def list_permission_codes() -> PermissionCodeListResponse:
    """Return the registered codes that can be assigned to roles."""
    descriptions = permission_code_descriptions()
    return PermissionCodeListResponse(
        items=[
            PermissionCodeResponse(code=code, description=description)
            for code, description in sorted(descriptions.items())
        ]
    )


@router.get("/{role_id}", response_model=RoleResponse)
def get_role(
    role_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> RoleResponse:
    return _single_role_response(db, _get_role(db, role_id))


@router.post("", response_model=RoleResponse, status_code=201)
def add_role(
    body: RoleRequest,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> RoleResponse:
    try:
        role = create_role(
            db,
            name=body.name,
            permission_codes=body.permission_codes,
        )
    except IntegrityError as exc:
        error = _translate_integrity_error(exc)
        if error is not None:
            raise error from exc
        raise
    except PermissionCodeValidationError as exc:
        raise _translate_permission_error() from exc
    return _single_role_response(db, role)


@router.patch("/{role_id}", response_model=RoleResponse)
def update_role_endpoint(
    role_id: UUID,
    body: RoleUpdateRequest,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> RoleResponse:
    role = _get_role(db, role_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if "permission_codes" in changes and changes["permission_codes"] is None:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        role = update_role(db, role, **changes)
    except IntegrityError as exc:
        error = _translate_integrity_error(exc)
        if error is not None:
            raise error from exc
        raise
    except RoleUnchangedError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except PermissionCodeValidationError as exc:
        raise _translate_permission_error() from exc
    return _single_role_response(db, role)


@router.delete("/{role_id}", status_code=204)
def remove_role(
    role_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> None:
    """Delete a role and its assignments as DOM-R21 requires."""
    role = _get_role(db, role_id)
    delete_role(db, role)


__all__ = ["router"]
