"""Admin user management endpoints (DOM-R04, DOM-R45, AUT-R46)."""

import secrets
from collections.abc import Sequence
from datetime import date
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.batch import require_batch_size
from app.api.errors import APIError, ErrorCode
from app.api.pagination import (
    encode_page_cursor,
    ilike_contains,
    page_by_text_key,
    page_cursor_key,
    write_call,
)
from app.api.time_format import format_utc
from app.api.v1._management_errors import (
    management_api_error,
)
from app.auth.access import (
    calculate_effective_access,
    permission_gaps,
    require_admin,
    require_module_delegation,
)
from app.auth.dependencies import get_db
from app.auth.password_service import PasswordLengthError, set_password
from app.models import (
    Company,
    PermissionBundle,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from app.permission_codes import (
    MODULES,
    permission_code_descriptions,
    permission_code_module,
    permission_code_scope,
)
from app.services.account_status import effectively_active_user_clause
from app.services.audit import record_audit_event
from app.services.module_permissions import (
    CreatorRolePermissionsError,
    ExternalCollaboratorPermissionError,
    ImpliedPermissionError,
    InvalidModulePermissionError,
    ModulePermissionDeniedError,
    apply_permission_bundle,
    create_permission_bundle,
    delete_permission_bundle,
    grant_module_delegation,
    grant_module_permission,
    list_permission_bundles,
    list_user_module_delegations,
    list_user_module_permissions,
    permission_revoke_impact,
    revoke_module_delegation,
    revoke_module_permission,
    update_permission_bundle,
)
from app.services.operator import get_current_operator
from app.services.user_lifecycle import (
    AccountExpiredError,
    InvalidRestoreSelectionError,
    deactivation_check,
    expire_due_external_accounts,
    reactivate_user,
    reactivation_preview,
    unmanaged_project_ids,
)
from app.services.users import (
    BuiltInAccountModificationError,
    CompanyNotActiveError,
    ExternalBasicFieldModificationError,
    ExternalFlagChangeError,
    ExternalFlagConfirmationRequiredError,
    InvalidUserFieldError,
    LastActiveAdminRemovalError,
    UsernameChangePermissionError,
    create_user,
    set_external_collaborator,
    set_is_active,
    set_is_admin,
    update_user_manual,
)

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_admin, scope="function")],
)
participating_projects_router = APIRouter(
    prefix="/users",
    tags=["users"],
)
admin_router = APIRouter(
    prefix="/admin",
    tags=["users"],
    dependencies=[Depends(require_admin, scope="function")],
)
module_delegate_router = APIRouter(
    prefix="/module-delegate/users",
    tags=["users"],
)
module_permission_router = APIRouter(tags=["module permissions"])
_module_delegate_access = require_module_delegation()

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    email: str | None
    name_zh: str | None
    name_en: str | None
    company_id: UUID | None
    department: str | None
    location: str | None
    employee_no: str | None
    extension_1: str | None
    extension_2: str | None
    mobile: str | None
    line_id: str | None
    wechat_id: str | None
    responsibilities: str | None
    auth_source: str
    is_active: bool
    is_admin: bool
    is_system: bool
    is_external_collaborator: bool
    account_expires_on: date | None


class UserListItemResponse(UserResponse):
    """Paged account row including company display data for ADM-R13."""

    company_name: str | None


class UserListResponse(BaseModel):
    items: list[UserListItemResponse]
    next_cursor: str | None


class ModuleDelegateUserResponse(BaseModel):
    """委派者選人查詢回傳的人員最小欄位（AUT-R49）。"""

    id: UUID
    username: str
    name_zh: str | None
    is_external_collaborator: bool


class ModuleDelegateUserListResponse(BaseModel):
    items: list[ModuleDelegateUserResponse]
    next_cursor: str | None


class CreateUserRequest(BaseModel):
    username: str
    email: str
    name_zh: str
    name_en: str | None = None
    company_id: UUID | None = None
    department: str | None = None
    location: str | None = None
    employee_no: str | None = None
    extension_1: str | None = None
    extension_2: str | None = None
    mobile: str | None = None
    line_id: str | None = None
    wechat_id: str | None = None
    responsibilities: str | None = None
    is_admin: bool = False
    is_external_collaborator: bool
    account_expires_on: date | None = None


class CreatedUserResponse(UserResponse):
    temporary_password: str


class TemporaryPasswordResetResponse(BaseModel):
    user_id: UUID
    username: str
    temporary_password: str
    must_change_password: bool


class UpdateUserRequest(BaseModel):
    username: str | None = None
    email: str | None = None
    name_zh: str | None = None
    name_en: str | None = None
    department: str | None = None
    location: str | None = None
    employee_no: str | None = None
    extension_1: str | None = None
    extension_2: str | None = None
    mobile: str | None = None
    line_id: str | None = None
    wechat_id: str | None = None
    responsibilities: str | None = None
    is_external_collaborator: bool | None = None
    account_expires_on: date | None = None
    confirm_external_transition: bool = False


class CompanyLinkRequest(BaseModel):
    company_id: UUID | None
    department: str | None = None
    location: str | None = None
    employee_no: str | None = None


class AdminStatusRequest(BaseModel):
    is_admin: bool


class ActiveStatusRequest(BaseModel):
    is_active: bool


class RestoreSelection(BaseModel):
    permission_codes: list[str] = Field(default_factory=list)
    delegated_modules: list[str] = Field(default_factory=list)
    project_ids: list[UUID] = Field(default_factory=list)
    task_ids: list[UUID] = Field(default_factory=list)


class ReactivateRequest(BaseModel):
    restore: RestoreSelection


class BatchUserRestoreItem(BaseModel):
    user_id: UUID
    restore: RestoreSelection


class BatchActiveStatusRequest(BaseModel):
    user_ids: list[UUID]
    is_active: bool
    restore: list[BatchUserRestoreItem] = Field(default_factory=list)


class BatchUserStatusResponse(BaseModel):
    items: list[UserResponse]


class LifecycleListResponse(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None


class ModulePermissionOption(BaseModel):
    code: str
    module: str
    description: str


class ModulePermissionOptionListResponse(BaseModel):
    items: list[ModulePermissionOption]


class UserModulePermissionResponse(BaseModel):
    permission_codes: list[str]
    delegated_modules: list[str]


class EffectiveAccessUser(BaseModel):
    """有效權限查詢的目標帳號狀態。"""

    id: UUID
    is_active: bool
    is_admin: bool


class EffectiveModulePermission(BaseModel):
    """一項有效模組權限與授權來源。"""

    code: str
    module: str
    source: str


class EffectiveProjectRole(BaseModel):
    """目標在指定專案持有的角色與專案權限代碼。"""

    id: UUID
    name: str
    permission_codes: list[str]


class EffectiveAccessDiagnostic(BaseModel):
    """一個固定操作依兩層權限計算後的判定。"""

    action: str
    module: str
    required_module_codes: list[str]
    required_project_codes: list[str]
    allowed: bool
    missing_layers: list[str]
    missing_codes: list[str]


class UserEffectiveAccessResponse(BaseModel):
    """管理端查詢他人於一個專案的有效權限。"""

    user: EffectiveAccessUser
    module_permissions: list[EffectiveModulePermission]
    project_roles: list[EffectiveProjectRole] | None = None
    diagnostics: list[EffectiveAccessDiagnostic]


class ParticipatingProjectRole(BaseModel):
    """帳號在一個專案持有的角色。"""

    id: UUID
    name: str


class ParticipatingProject(BaseModel):
    """帳號參與的專案與角色摘要。"""

    id: UUID
    project_code: str
    name: str
    roles: list[ParticipatingProjectRole]


class UserParticipatingProjectsResponse(BaseModel):
    """一次回傳帳號參與專案，避免逐專案查成員。"""

    items: list[ParticipatingProject]


# 四種診斷沿用既有 guard 的代碼與兩層規則，不建立第二套授權資料。
_EFFECTIVE_ACCESS_ACTIONS = (
    (
        "task_list",
        "inspection",
        ("inspection.use",),
        ("inspection_task.read",),
    ),
    ("create_project", "project", ("project.create",), ()),
    ("manage_template_library", "template", ("template.manage",), ()),
    (
        "manage_project_members",
        "project",
        ("project.use",),
        ("project_member.manage",),
    ),
)


class PermissionBundleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    permission_codes: list[str] = Field(default_factory=list)


class PermissionBundlePatchRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    permission_codes: list[str] | None = None


class PermissionBundleResponse(BaseModel):
    id: UUID
    name: str
    permission_codes: list[str]
    created_at: str
    updated_at: str


class PermissionBundleListResponse(BaseModel):
    items: list[PermissionBundleResponse]
    next_cursor: str | None


class PermissionBundleApplyResponse(BaseModel):
    user_id: UUID
    granted_codes: list[str]


class RevokeImpactResponse(BaseModel):
    membership_count: int
    projects: list[dict[str, UUID | str]]
    projects_becoming_unmanaged: list[dict[str, UUID | str]]


def _get_user(db: Session, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return user


def _get_module_permission_target(
    db: Session, user_id: UUID, actor: User
) -> User:
    """拒絕委派者讀取或修改 Admin 帳號的模組權限。"""
    target = _get_user(db, user_id)
    if not actor.is_admin and target.is_admin:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    return target


def _module_error(exc: ValueError, *, bundle: bool = False) -> APIError:
    if isinstance(exc, ModulePermissionDeniedError):
        return APIError(
            ErrorCode.PERMISSION_DENIED,
            403,
            details=getattr(exc, "details", None),
        )
    if isinstance(exc, ExternalCollaboratorPermissionError):
        return APIError(
            ErrorCode.MODULE_PERMISSION_EXTERNAL_NOT_ALLOWED,
            422,
            details=getattr(exc, "details", None),
        )
    if isinstance(exc, ImpliedPermissionError):
        return APIError(ErrorCode.MODULE_PERMISSION_REQUIRED_BY_OTHER, 422)
    if isinstance(exc, InvalidModulePermissionError):
        code = (
            ErrorCode.PERMISSION_BUNDLE_CODE_INVALID
            if bundle
            else ErrorCode.MODULE_PERMISSION_CODE_INVALID
        )
        return APIError(code, 422, details=getattr(exc, "details", None))
    if isinstance(exc, CreatorRolePermissionsError):
        return APIError(ErrorCode.ROLE_CREATOR_ROLE_REQUIRES_PERMISSIONS, 422)
    return APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)


def _bundle_response(bundle: PermissionBundle) -> PermissionBundleResponse:
    return PermissionBundleResponse(
        id=bundle.id,
        name=bundle.name,
        permission_codes=sorted(
            item.permission_code for item in bundle.permission_codes
        ),
        created_at=format_utc(bundle.created_at),
        updated_at=format_utc(bundle.updated_at),
    )


def _user_error(exc: ValueError) -> APIError:
    if isinstance(exc, BuiltInAccountModificationError):
        code = ErrorCode.USER_BUILTIN_PROTECTED
    elif isinstance(exc, LastActiveAdminRemovalError):
        code = ErrorCode.USER_LAST_ADMIN
    elif isinstance(exc, ExternalBasicFieldModificationError):
        code = ErrorCode.USER_EXTERNAL_MANAGED
    elif isinstance(exc, CompanyNotActiveError):
        code = ErrorCode.COMPANY_INACTIVE
    elif isinstance(exc, UsernameChangePermissionError):
        return APIError(ErrorCode.PERMISSION_DENIED, 403)
    elif isinstance(exc, ExternalFlagChangeError):
        code = ErrorCode.USER_EXTERNAL_NOT_QUALIFIED
    elif isinstance(exc, PasswordLengthError):
        code = ErrorCode.AUTH_PASSWORD_INVALID
    else:
        code = ErrorCode.REQUEST_VALIDATION_FAILED
    return APIError(
        code,
        422,
        details=getattr(exc, "details", None),
    )


_USER_BUSINESS_ERRORS = (
    BuiltInAccountModificationError,
    LastActiveAdminRemovalError,
    ExternalBasicFieldModificationError,
    CompanyNotActiveError,
    UsernameChangePermissionError,
    InvalidUserFieldError,
    ExternalFlagChangeError,
    PasswordLengthError,
)


def _check_company_exists(db: Session, company_id: UUID | None) -> None:
    if company_id is not None and db.get(Company, company_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)


def _serialize_user_page(
    db: Session, users: Sequence[User]
) -> list[UserListItemResponse]:
    """Load page company labels in one query so list size adds no queries."""
    company_ids = {user.company_id for user in users if user.company_id}
    company_names = (
        dict(
            db.execute(
                select(Company.id, Company.name).where(
                    Company.id.in_(company_ids)
                )
            ).all()
        )
        if company_ids
        else {}
    )
    return [
        UserListItemResponse(
            **UserResponse.model_validate(user).model_dump(),
            company_name=(
                company_names.get(user.company_id)
                if user.company_id is not None
                else None
            ),
        )
        for user in users
    ]


@router.get("", response_model=UserListResponse)
def list_users(
    q: str | None = Query(default=None, max_length=256),
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> UserListResponse:
    filters = []
    query = (q or "").strip()
    if query:
        filters.append(
            or_(
                ilike_contains(User.username, query),
                ilike_contains(User.name_zh, query),
                ilike_contains(User.name_en, query),
                ilike_contains(User.email, query),
                ilike_contains(User.employee_no, query),
            )
        )
    result = page_by_text_key(
        db,
        User,
        sort_key=User.username,
        key_name="username",
        cursor=cursor,
        limit=limit,
        serialize_batch=partial(_serialize_user_page, db),
        filters=filters,
    )
    return UserListResponse(**result)


@module_delegate_router.get("", response_model=ModuleDelegateUserListResponse)
def list_module_delegate_users(
    q: str | None = Query(default=None, max_length=256),
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
    _caller: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> ModuleDelegateUserListResponse:
    """列出委派者可選的人員，不開放全域使用者資料。"""
    filters: list[Any] = [
        User.is_active.is_(True),
        User.is_system.is_(False),
        User.is_admin.is_(False),
    ]
    query = (q or "").strip()
    if query:
        filters.append(
            or_(
                ilike_contains(User.username, query),
                ilike_contains(User.name_zh, query),
            )
        )
    result = page_by_text_key(
        db,
        User,
        sort_key=User.username,
        key_name="username",
        cursor=cursor,
        limit=limit,
        serialize=lambda user: ModuleDelegateUserResponse(
            id=user.id,
            username=user.username,
            name_zh=user.name_zh,
            is_external_collaborator=user.is_external_collaborator,
        ),
        filters=filters,
    )
    return ModuleDelegateUserListResponse(**result)


@module_delegate_router.get(
    "/{user_id}", response_model=ModuleDelegateUserResponse
)
def get_module_delegate_user(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> ModuleDelegateUserResponse:
    """回傳委派者帳號詳情標題所需欄位，並拒絕 Admin 對象。"""
    target = _get_module_permission_target(db, user_id, actor)
    return ModuleDelegateUserResponse(
        id=target.id,
        username=target.username,
        name_zh=target.name_zh,
        is_external_collaborator=target.is_external_collaborator,
    )


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    return _get_user(db, user_id)


@router.post("", response_model=CreatedUserResponse, status_code=201)
def add_user(
    body: CreateUserRequest,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> CreatedUserResponse:
    _check_company_exists(db, body.company_id)

    def create_user_and_password() -> tuple[User, str]:
        user = create_user(db, **body.model_dump(exclude={"is_admin"}))
        # ALG-R31：與帳號、角色及臨時密碼同交易寫入，且不含密碼資料。
        record_audit_event(
            db,
            "user.created",
            entity_id=user.id,
            before=None,
            after={
                "username": user.username,
                "name_zh": user.name_zh,
                "email": user.email,
                "is_external_collaborator": user.is_external_collaborator,
                "auth_source": user.auth_source,
            },
        )
        if body.is_admin:
            set_is_admin(db, user, True)
        password = secrets.token_urlsafe(24)
        set_password(db, user, password, is_temporary=True)
        return user, password

    try:
        user, password = write_call(
            create_user_and_password,
            error_mapper=management_api_error,
        )
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    response.headers["Cache-Control"] = "no-store"
    return CreatedUserResponse(
        **UserResponse.model_validate(user).model_dump(),
        temporary_password=password,
    )


@router.post(
    "/{user_id}/temporary-password",
    response_model=TemporaryPasswordResetResponse,
)
def reset_temporary_password(
    user_id: UUID,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> TemporaryPasswordResetResponse:
    """Reset one local account password through AUT-R36 exactly once."""
    user = _get_user(db, user_id)
    # ADM-R13、#414：沿用 router 已驗證的操作者，避免重複授權宣告。
    if user.id == get_current_operator(db).id:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=["請到設定變更自己的密碼。"],
        )
    if user.is_system or user.auth_source != "local":
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    password = secrets.token_urlsafe(24)
    write_call(
        lambda: set_password(db, user, password, is_temporary=True),
        error_mapper=management_api_error,
    )
    response.headers["Cache-Control"] = "no-store"
    return TemporaryPasswordResetResponse(
        user_id=user.id,
        username=user.username,
        temporary_password=password,
        must_change_password=True,
    )


@router.patch("/{user_id}", response_model=UserResponse)
def edit_user(
    user_id: UUID,
    body: UpdateUserRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    user = _get_user(db, user_id)
    fields = body.model_dump(exclude_unset=True)
    desired_external = fields.pop("is_external_collaborator", None)
    confirm_external = fields.pop("confirm_external_transition", False)
    if "is_external_collaborator" in body.model_fields_set and (
        desired_external is None
    ):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if (
        user.is_system
        and {
            "username",
            "name_zh",
            "name_en",
            "department",
            "location",
            "employee_no",
        }
        & fields.keys()
    ):
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422)

    def update_user() -> User:
        if desired_external is not None:
            set_external_collaborator(
                db,
                user,
                desired_external,
                confirmed=confirm_external,
            )
        return update_user_manual(db, user, **fields)

    try:
        return write_call(update_user, error_mapper=management_api_error)
    except _USER_BUSINESS_ERRORS as exc:
        if isinstance(exc, ExternalFlagConfirmationRequiredError):
            raise APIError(
                ErrorCode.USER_EXTERNAL_CONFIRMATION_REQUIRED,
                422,
                details=exc.details,
            ) from exc
        if isinstance(exc, ExternalFlagChangeError):
            raise APIError(
                ErrorCode.USER_EXTERNAL_NOT_QUALIFIED,
                422,
                details=exc.details,
            ) from exc
        raise _user_error(exc) from exc


@router.put("/{user_id}/company", response_model=UserResponse)
def link_company(
    user_id: UUID,
    body: CompanyLinkRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    user = _get_user(db, user_id)
    fields = body.model_dump(exclude_unset=True)
    _check_company_exists(db, body.company_id)
    if user.is_system and body.company_id != user.company_id:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422)
    try:
        return write_call(
            lambda: update_user_manual(db, user, **fields),
            error_mapper=management_api_error,
        )
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc


@router.put("/{user_id}/admin", response_model=UserResponse)
def change_admin_status(
    user_id: UUID,
    body: AdminStatusRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    user = _get_user(db, user_id)
    if user.is_admin == body.is_admin:
        return user

    def update_admin_status() -> User:
        updated_user = set_is_admin(db, user, body.is_admin)
        return updated_user

    try:
        return write_call(
            update_admin_status,
            error_mapper=management_api_error,
        )
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc


@router.put("/{user_id}/active", response_model=UserResponse)
def change_active_status(
    user_id: UUID,
    body: ActiveStatusRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    user = _get_user(db, user_id)

    def update_active_status() -> User:
        updated_user = set_is_active(db, user, body.is_active)
        return updated_user

    try:
        if not body.is_active and user.is_active:
            pass
        elif body.is_active and not user.is_active:
            raise APIError(ErrorCode.USER_REACTIVATION_REQUIRED, 422)
        return write_call(
            update_active_status,
            error_mapper=management_api_error,
        )
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc


@router.post(":batch-active-status", response_model=BatchUserStatusResponse)
def batch_change_active_status(
    body: BatchActiveStatusRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> BatchUserStatusResponse:
    """Apply one account status to a batch in one transaction (ADM-R13)."""
    ids = body.user_ids
    require_batch_size(len(ids))
    # ADM-R13、#414：整批預檢，不能先停用其他人再發現選到了自己。
    if not body.is_active and get_current_operator(db).id in ids:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=["不能批次停用自己的帳號。"],
        )
    if not ids or len(set(ids)) != len(ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if not body.is_active and body.restore:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    targets = list(
        db.scalars(
            select(User)
            .where(User.id.in_(ids))
            .order_by(User.id)
            .with_for_update()
        )
    )
    if {user.id for user in targets} != set(ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    restore_by_user = {item.user_id: item.restore for item in body.restore}
    if body.is_active and (
        len(restore_by_user) != len(body.restore)
        or set(restore_by_user) != set(ids)
        or any(user.is_active for user in targets)
    ):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    try:
        if body.is_active:
            changed = [
                reactivate_user(
                    db,
                    user_id=user.id,
                    **restore_by_user[user.id].model_dump(),
                )
                for user in targets
            ]
        else:
            changed = [set_is_active(db, user, False) for user in targets]
        return BatchUserStatusResponse(
            items=[UserResponse.model_validate(user) for user in changed]
        )
    except BuiltInAccountModificationError as exc:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422) from exc
    except LastActiveAdminRemovalError as exc:
        raise APIError(ErrorCode.USER_LAST_ADMIN, 422) from exc
    except AccountExpiredError as exc:
        raise APIError(ErrorCode.USER_ACCOUNT_EXPIRY_PASSED, 422) from exc
    except InvalidRestoreSelectionError as exc:
        raise APIError(
            ErrorCode.USER_RESTORE_SELECTION_INVALID,
            422,
            details=exc.details,
        ) from exc


@router.get("/{user_id}/deactivation-check")
def get_deactivation_check(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> dict[str, Any]:
    """列出停用此帳號後會失去啟用管理者的專案（DOM-R67）。

    僅 Admin 可呼叫；帳號不存在時回傳 404。停用帳號不會列出警示專案。
    """
    user = _get_user(db, user_id)
    projects = deactivation_check(db, user)
    return {
        "user_id": user.id,
        "last_manager_projects": [
            {
                "id": project.id,
                "project_code": project.project_code,
                "name": project.name,
            }
            for project in projects
        ],
    }


@router.get("/{user_id}/reactivation-preview")
def get_reactivation_preview(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> dict[str, Any]:
    """預覽停用帳號現有且可由 Admin 選擇恢復的項目（DOM-R67）。

    僅 Admin 可呼叫；帳號不存在或仍啟用時分別回傳 404、422。
    """
    user = _get_user(db, user_id)
    if user.is_active:
        raise APIError(ErrorCode.USER_REACTIVATION_REQUIRED, 422)
    return reactivation_preview(db, user)


@router.post("/{user_id}:reactivate", response_model=UserResponse)
def restore_user(
    user_id: UUID,
    body: ReactivateRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> User:
    """依 Admin 選取的預覽項目重新啟用帳號（DOM-R67）。

    僅 Admin 可呼叫；不存在的帳號回傳 404，到期帳號或無效選項回傳 422。
    """
    _get_user(db, user_id)
    try:
        return write_call(
            lambda: reactivate_user(
                db,
                user_id=user_id,
                **body.restore.model_dump(),
            ),
            error_mapper=management_api_error,
        )
    except AccountExpiredError as exc:
        raise APIError(ErrorCode.USER_ACCOUNT_EXPIRY_PASSED, 422) from exc
    except InvalidRestoreSelectionError as exc:
        raise APIError(
            ErrorCode.USER_RESTORE_SELECTION_INVALID,
            422,
            details=exc.details,
        ) from exc


@admin_router.get("/users/external-without-project")
def list_external_users_without_project(
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> LifecycleListResponse:
    """分頁列出尚未加入專案的啟用外部協作者（DOM-R75）。

    僅 Admin 可呼叫；讀取時先停用已到期帳號，因此過期或已有專案的
    帳號不會出現在結果中。
    """

    def list_users_and_expire() -> LifecycleListResponse:
        expire_due_external_accounts(db)
        result = page_by_text_key(
            db,
            User,
            sort_key=User.username,
            key_name="username",
            cursor=cursor,
            limit=limit,
            serialize_batch=partial(_serialize_external_users, db),
            filters=(
                User.is_active.is_(True),
                User.is_external_collaborator.is_(True),
                ~select(ProjectMember.id)
                .where(ProjectMember.user_id == User.id)
                .exists(),
            ),
        )
        return LifecycleListResponse(**result)

    return write_call(
        list_users_and_expire,
        error_mapper=management_api_error,
    )


def _serialize_external_users(
    db: Session, users: Sequence[User]
) -> list[dict[str, Any]]:
    company_names = dict(
        db.execute(
            select(User.id, Company.name)
            .outerjoin(Company, Company.id == User.company_id)
            .where(User.id.in_([user.id for user in users]))
        ).all()
    )
    return [
        {
            "id": user.id,
            "username": user.username,
            "name_zh": user.name_zh,
            "company_name": company_names[user.id],
            "account_expires_on": user.account_expires_on,
        }
        for user in users
    ]


@module_permission_router.get(
    "/module-permissions", response_model=ModulePermissionOptionListResponse
)
def list_module_permission_options(
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> ModulePermissionOptionListResponse:
    """依 DOM-R35 回傳呼叫者可管理的模組權限目錄。"""
    descriptions = permission_code_descriptions()
    access = calculate_effective_access(db, user_id=actor.id)
    allowed_modules = MODULES if actor.is_admin else access.delegated_modules
    items = [
        ModulePermissionOption(
            code=code,
            module=permission_code_module(code) or "",
            description=description,
        )
        for code, description in descriptions.items()
        if permission_code_scope(code) == "module"
        and permission_code_module(code) in allowed_modules
    ]
    items.sort(key=lambda item: (item.module, item.code))
    return ModulePermissionOptionListResponse(items=items)


@module_permission_router.get(
    "/users/{user_id}/module-permissions",
    response_model=UserModulePermissionResponse,
)
def get_user_module_permissions(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> UserModulePermissionResponse:
    """讀取人員的模組授權，委派者只能看到受委派模組。"""
    target = _get_module_permission_target(db, user_id, actor)
    access = calculate_effective_access(db, user_id=actor.id)
    allowed_modules = MODULES if actor.is_admin else access.delegated_modules
    permission_codes = sorted(
        row.permission_code
        for row in list_user_module_permissions(db, user_id=target.id)
        if permission_code_module(row.permission_code) in allowed_modules
    )
    delegated_modules = sorted(
        row.module
        for row in list_user_module_delegations(db, user_id=target.id)
        if row.module in allowed_modules
    )
    return UserModulePermissionResponse(
        permission_codes=permission_codes,
        delegated_modules=delegated_modules,
    )


@module_permission_router.get(
    "/users/{user_id}/effective-access",
    response_model=UserEffectiveAccessResponse,
    response_model_exclude_none=True,
)
def get_user_effective_access(
    user_id: UUID,
    project_id: UUID | None = None,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> UserEffectiveAccessResponse:
    """依 ADM-R45 回傳目標在指定專案的唯讀有效權限診斷。"""
    target = _get_module_permission_target(db, user_id, actor)
    target_access = calculate_effective_access(
        db, user_id=target.id, project_id=project_id
    )
    if project_id is not None:
        membership_id = db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.user_id == target.id,
                ProjectMember.project_id == project_id,
            )
        )
        if membership_id is None:
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)

    actor_access = calculate_effective_access(db, user_id=actor.id)
    visible_modules = (
        MODULES if actor.is_admin else actor_access.delegated_modules
    )
    source_names = {
        "manual": "direct",
        "bundle": "combination",
        "implied": "implied",
        "backfill": "backfill",
    }
    source_by_code = {
        row.permission_code: row.source
        for row in list_user_module_permissions(db, user_id=target.id)
    }
    module_permissions = []
    for code in sorted(target_access.module_permissions):
        module = permission_code_module(code)
        if module not in visible_modules:
            continue
        source = (
            "admin_implicit"
            if target_access.is_admin
            else source_names[source_by_code[code]]
        )
        module_permissions.append(
            EffectiveModulePermission(
                code=code,
                module=module or "",
                source=source,
            )
        )

    project_roles: list[EffectiveProjectRole] | None = None
    if actor.is_admin and project_id is not None:
        role_rows = db.execute(
            select(Role.id, Role.name, RolePermission.code)
            .select_from(ProjectMemberRole)
            .join(
                ProjectMember,
                ProjectMember.id == ProjectMemberRole.project_member_id,
            )
            .join(Role, Role.id == ProjectMemberRole.role_id)
            .outerjoin(RolePermission, RolePermission.role_id == Role.id)
            .where(
                ProjectMember.user_id == target.id,
                ProjectMember.project_id == project_id,
            )
            .order_by(Role.name, Role.id, RolePermission.code)
        ).all()
        roles_by_id: dict[UUID, EffectiveProjectRole] = {}
        for role_id, name, code in role_rows:
            role = roles_by_id.setdefault(
                role_id,
                EffectiveProjectRole(
                    id=role_id,
                    name=name,
                    permission_codes=[],
                ),
            )
            if code is not None:
                role.permission_codes.append(code)
        project_roles = list(roles_by_id.values())

    diagnostics = []
    for (
        action,
        module,
        module_codes,
        project_codes,
    ) in _EFFECTIVE_ACCESS_ACTIONS:
        if module not in visible_modules:
            continue
        if project_codes and project_id is None:
            continue
        missing_module, missing_project = permission_gaps(
            target_access,
            module_codes=module_codes,
            project_codes=project_codes,
        )
        missing_layers = []
        if missing_module:
            missing_layers.append("module")
        if missing_project:
            missing_layers.append("project_role")
        diagnostics.append(
            EffectiveAccessDiagnostic(
                action=action,
                module=module,
                required_module_codes=list(module_codes),
                required_project_codes=list(project_codes),
                allowed=not missing_layers,
                missing_layers=missing_layers,
                missing_codes=missing_module + missing_project,
            )
        )

    return UserEffectiveAccessResponse(
        user=EffectiveAccessUser(
            id=target.id,
            is_active=target.is_active,
            is_admin=target_access.is_admin,
        ),
        module_permissions=module_permissions,
        project_roles=project_roles,
        diagnostics=diagnostics,
    )


@participating_projects_router.get(
    "/{user_id}/participating-projects",
    response_model=UserParticipatingProjectsResponse,
)
def list_user_participating_projects(
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    _actor: User = Depends(require_admin, scope="function"),  # noqa
) -> UserParticipatingProjectsResponse:
    """Admin 以單一查詢讀取帳號參與專案與角色。"""
    target = db.get(User, user_id)
    if target is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)

    rows = db.execute(
        select(
            Project.id,
            Project.project_code,
            Project.name,
            Role.id,
            Role.name,
        )
        .select_from(ProjectMember)
        .join(Project, Project.id == ProjectMember.project_id)
        .outerjoin(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .outerjoin(Role, Role.id == ProjectMemberRole.role_id)
        .where(ProjectMember.user_id == target.id)
        .order_by(Project.project_code, Project.id, Role.name, Role.id)
    ).all()
    projects: dict[UUID, ParticipatingProject] = {}
    for project_id, code, name, role_id, role_name in rows:
        project = projects.setdefault(
            project_id,
            ParticipatingProject(
                id=project_id,
                project_code=code,
                name=name,
                roles=[],
            ),
        )
        if role_id is not None:
            project.roles.append(
                ParticipatingProjectRole(id=role_id, name=role_name)
            )
    return UserParticipatingProjectsResponse(items=list(projects.values()))


@module_permission_router.put(
    "/users/{user_id}/module-permissions/{code}", status_code=204
)
def grant_user_module_permission(
    user_id: UUID,
    code: str,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> Response:
    """授予單一模組權限；拒絕事件由 Service 獨立交易保留。

    DOM-R62 要求安全事件不隨 API 主交易回滾。
    """
    target = _get_module_permission_target(db, user_id, actor)
    try:
        grant_module_permission(
            db, actor=actor, user=target, permission_code=code
        )
    except ValueError as exc:
        raise _module_error(exc) from exc
    response.status_code = 204
    return response


@module_permission_router.delete(
    "/users/{user_id}/module-permissions/{code}", status_code=204
)
def revoke_user_module_permission(
    user_id: UUID,
    code: str,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> Response:
    """冪等收回單一模組權限。"""
    target = _get_module_permission_target(db, user_id, actor)
    try:
        revoke_module_permission(
            db, actor=actor, user=target, permission_code=code
        )
    except ValueError as exc:
        raise _module_error(exc) from exc
    response.status_code = 204
    return response


@module_permission_router.get(
    "/users/{user_id}/module-permissions/{code}/revoke-impact",
    response_model=RevokeImpactResponse,
)
def get_module_permission_revoke_impact(
    user_id: UUID,
    code: str,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> RevokeImpactResponse:
    """回傳撤回可使用權限可能失去管理權的專案。

    此預覽依 ADM-R10 僅讀取資料，不改變任何授權或專案狀態。
    """
    target = _get_module_permission_target(db, user_id, actor)
    if permission_code_scope(code) != "module":
        raise APIError(ErrorCode.MODULE_PERMISSION_CODE_INVALID, 422)
    access = calculate_effective_access(db, user_id=actor.id)
    module = permission_code_module(code)
    if not actor.is_admin and module not in access.delegated_modules:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    impact = permission_revoke_impact(
        db, user_id=target.id, permission_code=code
    )
    project_ids = set(impact.project_ids)
    projects = (
        list(db.scalars(select(Project).where(Project.id.in_(project_ids))))
        if project_ids
        else []
    )
    by_id = {project.id: project for project in projects}
    return RevokeImpactResponse(
        membership_count=impact.member_count,
        projects=[
            {"id": project_id, "name": by_id[project_id].name}
            for project_id in impact.project_ids
            if project_id in by_id
        ],
        projects_becoming_unmanaged=[
            {"id": project_id, "name": by_id[project_id].name}
            for project_id in impact.projects_without_manager
            if project_id in by_id
        ],
    )


@module_permission_router.put(
    "/users/{user_id}/module-delegations/{module}", status_code=204
)
def grant_user_module_delegation(
    user_id: UUID,
    module: str,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(require_admin, scope="function"),  # noqa
) -> Response:
    """只有 Admin 能指派模組委派者（DOM-R61）。"""
    target = _get_user(db, user_id)
    try:
        grant_module_delegation(db, actor=actor, user=target, module=module)
    except ValueError as exc:
        if isinstance(exc, InvalidModulePermissionError):
            raise APIError(
                ErrorCode.MODULE_DELEGATION_MODULE_INVALID, 422
            ) from exc
        raise _module_error(exc) from exc
    response.status_code = 204
    return response


@module_permission_router.delete(
    "/users/{user_id}/module-delegations/{module}", status_code=204
)
def revoke_user_module_delegation(
    user_id: UUID,
    module: str,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(require_admin, scope="function"),  # noqa
) -> Response:
    """只有 Admin 能收回模組委派者（DOM-R61）。"""
    target = _get_user(db, user_id)
    if module not in MODULES:
        raise APIError(ErrorCode.MODULE_DELEGATION_MODULE_INVALID, 422)
    revoke_module_delegation(db, actor=actor, user=target, module=module)
    response.status_code = 204
    return response


@module_permission_router.get(
    "/permission-bundles", response_model=PermissionBundleListResponse
)
def list_permission_bundle_options(
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> PermissionBundleListResponse:
    """列出呼叫者可完整套用的權限組合。"""
    cursor_key = page_cursor_key(cursor)
    bundles = sorted(
        list_permission_bundles(db, actor=actor),
        key=lambda bundle: (bundle.created_at, bundle.id),
    )
    if cursor_key is not None:
        bundles = [
            bundle
            for bundle in bundles
            if (bundle.created_at, bundle.id) > cursor_key
        ]
    page = bundles[: limit + 1]
    has_more = len(page) > limit
    page = page[:limit]
    next_cursor = None
    if has_more and page:
        last = page[-1]
        next_cursor = encode_page_cursor(last.created_at, last.id)
    return PermissionBundleListResponse(
        items=[_bundle_response(bundle) for bundle in page],
        next_cursor=next_cursor,
    )


@module_permission_router.post(
    "/permission-bundles",
    response_model=PermissionBundleResponse,
    status_code=201,
)
def add_permission_bundle(
    body: PermissionBundleRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(require_admin, scope="function"),  # noqa
) -> PermissionBundleResponse:
    """建立權限組合；名稱衝突轉為穩定的 409 契約。"""
    try:
        bundle = create_permission_bundle(
            db,
            actor=actor,
            name=body.name,
            permission_codes=body.permission_codes,
        )
    except IntegrityError as exc:
        raise APIError(ErrorCode.PERMISSION_BUNDLE_NAME_CONFLICT, 409) from exc
    except ValueError as exc:
        raise _module_error(exc, bundle=True) from exc
    return _bundle_response(bundle)


@module_permission_router.patch(
    "/permission-bundles/{bundle_id}",
    response_model=PermissionBundleResponse,
)
def edit_permission_bundle(
    bundle_id: UUID,
    body: PermissionBundlePatchRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(require_admin, scope="function"),  # noqa
) -> PermissionBundleResponse:
    """完整替換權限組合欄位，不回頭改動已套用的人員。"""
    fields = body.model_dump(exclude_unset=True)
    if not fields or any(value is None for value in fields.values()):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    bundle = db.scalar(
        select(PermissionBundle)
        .options(selectinload(PermissionBundle.permission_codes))
        .where(PermissionBundle.id == bundle_id)
    )
    if bundle is None:
        raise APIError(ErrorCode.PERMISSION_BUNDLE_NOT_FOUND, 404)
    try:
        update_permission_bundle(
            db,
            actor=actor,
            bundle=bundle,
            name=fields.get("name", bundle.name),
            permission_codes=fields.get(
                "permission_codes",
                [item.permission_code for item in bundle.permission_codes],
            ),
        )
    except IntegrityError as exc:
        raise APIError(ErrorCode.PERMISSION_BUNDLE_NAME_CONFLICT, 409) from exc
    except ValueError as exc:
        raise _module_error(exc, bundle=True) from exc
    return _bundle_response(bundle)


@module_permission_router.delete(
    "/permission-bundles/{bundle_id}", status_code=204
)
def remove_permission_bundle(
    bundle_id: UUID,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(require_admin, scope="function"),  # noqa
) -> Response:
    """刪除組合定義但保留既有使用者權限。"""
    bundle = db.scalar(
        select(PermissionBundle)
        .options(selectinload(PermissionBundle.permission_codes))
        .where(PermissionBundle.id == bundle_id)
    )
    if bundle is None:
        raise APIError(ErrorCode.PERMISSION_BUNDLE_NOT_FOUND, 404)
    delete_permission_bundle(db, actor=actor, bundle=bundle)
    response.status_code = 204
    return response


@module_permission_router.post(
    "/users/{user_id}/permission-bundles/{bundle_id}:apply",
    response_model=PermissionBundleApplyResponse,
)
def apply_user_permission_bundle(
    user_id: UUID,
    bundle_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    actor: User = Depends(_module_delegate_access, scope="function"),  # noqa
) -> PermissionBundleApplyResponse:
    """完整檢查授權範圍後套用組合，避免部分寫入。"""
    target = _get_module_permission_target(db, user_id, actor)
    bundle = db.scalar(
        select(PermissionBundle)
        .options(selectinload(PermissionBundle.permission_codes))
        .where(PermissionBundle.id == bundle_id)
    )
    if bundle is None:
        raise APIError(ErrorCode.PERMISSION_BUNDLE_NOT_FOUND, 404)
    before = {
        item.permission_code
        for item in list_user_module_permissions(db, user_id=target.id)
    }
    try:
        apply_permission_bundle(db, actor=actor, user=target, bundle=bundle)
    except ValueError as exc:
        raise _module_error(exc, bundle=True) from exc
    after = {
        item.permission_code
        for item in list_user_module_permissions(db, user_id=target.id)
    }
    return PermissionBundleApplyResponse(
        user_id=target.id, granted_codes=sorted(after - before)
    )


@admin_router.get("/projects/unmanaged")
def list_unmanaged_projects(
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> LifecycleListResponse:
    """分頁列出沒有啟用專案管理成員的專案（DOM-R75）。

    僅 Admin 可呼叫；管理者資格依有效的 `project_member.manage` 權限判定。
    """
    project_ids = unmanaged_project_ids(db)
    member_counts = (
        dict(
            db.execute(
                select(ProjectMember.project_id, func.count(ProjectMember.id))
                .join(User, User.id == ProjectMember.user_id)
                .where(
                    ProjectMember.project_id.in_(project_ids),
                    effectively_active_user_clause(),
                )
                .group_by(ProjectMember.project_id)
            ).all()
        )
        if project_ids
        else {}
    )
    result = page_by_text_key(
        db,
        Project,
        sort_key=Project.name,
        key_name="name",
        cursor=cursor,
        limit=limit,
        serialize=lambda project: {
            "id": project.id,
            "project_code": project.project_code,
            "name": project.name,
            "member_count": member_counts.get(project.id, 0),
        },
        filters=(Project.id.in_(project_ids),),
    )
    return LifecycleListResponse(**result)
