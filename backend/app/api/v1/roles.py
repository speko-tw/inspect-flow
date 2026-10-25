"""Admin role-management endpoints (DOM-R55, AUT-R20)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.errors import APIError, ErrorCode
from app.api.pagination import (
    encode_page_cursor,
    page_cursor_key,
)
from app.api.time_format import format_utc
from app.auth.access import require_admin
from app.auth.dependencies import get_db, require_login
from app.models import CreatorRoleSetting, Role, User
from app.models.role import PermissionCodeValidationError
from app.permission_codes import (
    permission_code_descriptions,
    permission_code_scope,
)
from app.services.module_permissions import (
    CreatorRoleInUseError,
    CreatorRolePermissionsError,
    ExternalRoleInUseError,
    InvalidExternalRoleError,
    InvalidModulePermissionError,
    ModulePermissionDeniedError,
    change_creator_role,
    get_creator_role_setting,
)
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
    dependencies=[Depends(require_admin, scope="function")],
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
    is_assignable: bool | None = None
    is_external_allowed: bool | None = None


class RoleResponse(BaseModel):
    """角色回應：總人數保留停用者，另附已停用人數。"""

    id: UUID
    name: str
    permission_codes: list[str]
    is_assignable: bool
    is_external_allowed: bool
    user_count: int
    inactive_user_count: int
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


class CreatorRoleUpdateRequest(BaseModel):
    """指定建立專案時自動加入成員所取得的角色。"""

    role_id: UUID


class CreatorRoleResponse(BaseModel):
    """回傳目前設定的建立者角色 ID。"""

    role_id: UUID


def _role_response(role: Role, usage: RoleUsage) -> RoleResponse:
    return RoleResponse(
        id=role.id,
        name=role.name,
        permission_codes=sorted(item.code for item in role.permission_codes),
        is_assignable=role.is_assignable,
        is_external_allowed=role.is_external_allowed,
        user_count=usage.user_count,
        inactive_user_count=usage.inactive_user_count,
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


def _get_creator_setting(db: Session) -> CreatorRoleSetting:
    setting = get_creator_role_setting(db)
    if setting is None:
        raise APIError(ErrorCode.SERVER_INTERNAL_ERROR, 500)
    return setting


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
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> RoleListResponse:
    """依 API-R08 按建立時間與 UUID 穩定排序並回傳角色分頁。"""
    cursor_key = page_cursor_key(cursor)
    statement = select(Role).options(selectinload(Role.permission_codes))
    if cursor_key is not None:
        statement = statement.where(
            or_(
                Role.created_at > cursor_key[0],
                and_(
                    Role.created_at == cursor_key[0],
                    Role.id > cursor_key[1],
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
        next_cursor = encode_page_cursor(last.created_at, last.id)
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
            if permission_code_scope(code) == "project"
        ]
    )


@router.get("/creator-role", response_model=CreatorRoleResponse)
def get_creator_role(
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> CreatorRoleResponse:
    """依 DOM-R64 讀取目前設定的建立者角色。"""
    setting = _get_creator_setting(db)
    return CreatorRoleResponse(role_id=setting.role_id)


@router.patch("/creator-role", response_model=CreatorRoleResponse)
def update_creator_role(
    body: CreatorRoleUpdateRequest,
    actor: User = Depends(require_login, scope="function"),  # noqa
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> CreatorRoleResponse:
    """依 DOM-R64 驗證並更新建立者角色，並由 Service 寫入稽核。"""
    _get_creator_setting(db)
    role = db.scalar(
        select(Role)
        .options(selectinload(Role.permission_codes))
        .where(Role.id == body.role_id)
    )
    if role is None:
        raise APIError(ErrorCode.CREATOR_ROLE_INVALID, 422)
    try:
        change_creator_role(db, actor=actor, role=role)
    except CreatorRolePermissionsError as exc:
        raise APIError(
            ErrorCode.ROLE_CREATOR_ROLE_REQUIRES_PERMISSIONS,
            422,
            details=[str(exc)],
        ) from exc
    except InvalidExternalRoleError as exc:
        raise APIError(ErrorCode.ROLE_EXTERNAL_ALLOWED_INVALID, 422) from exc
    except InvalidModulePermissionError as exc:
        raise APIError(ErrorCode.CREATOR_ROLE_INVALID, 422) from exc
    except ModulePermissionDeniedError as exc:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403) from exc
    return CreatorRoleResponse(role_id=body.role_id)


@router.get("/{role_id}", response_model=RoleResponse)
def get_role(
    role_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> RoleResponse:
    return _single_role_response(db, _get_role(db, role_id))


@router.post("", response_model=RoleResponse, status_code=201)
def add_role(
    body: RoleRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
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
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> RoleResponse:
    role = _get_role(db, role_id)
    changes = body.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is None:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if "permission_codes" in changes and changes["permission_codes"] is None:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if any(
        field in changes and changes[field] is None
        for field in ("is_assignable", "is_external_allowed")
    ):
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
    except InvalidExternalRoleError as exc:
        raise APIError(ErrorCode.ROLE_EXTERNAL_ALLOWED_INVALID, 422) from exc
    except ExternalRoleInUseError as exc:
        raise APIError(
            ErrorCode.ROLE_EXTERNAL_IN_USE, 422, details=exc.details
        ) from exc
    except CreatorRolePermissionsError as exc:
        raise APIError(
            ErrorCode.ROLE_CREATOR_ROLE_REQUIRES_PERMISSIONS,
            422,
            details=[str(exc)],
        ) from exc
    except ModulePermissionDeniedError as exc:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403) from exc
    except PermissionCodeValidationError as exc:
        raise _translate_permission_error() from exc
    return _single_role_response(db, role)


@router.delete("/{role_id}", status_code=204)
def remove_role(
    role_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> None:
    """Delete a role and its assignments as DOM-R21 requires."""
    role = _get_role(db, role_id)
    try:
        delete_role(db, role)
    except CreatorRoleInUseError as exc:
        raise APIError(ErrorCode.ROLE_CREATOR_ROLE_IN_USE, 422) from exc


__all__ = ["router"]
