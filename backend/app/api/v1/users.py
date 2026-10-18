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
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import ilike_contains, page_by_text_key, write_call
from app.api.v1._management_errors import (
    management_api_error,
)
from app.auth.access import require_admin, require_module_delegation
from app.auth.dependencies import get_db
from app.auth.password_service import PasswordLengthError, set_password
from app.models import Company, Project, ProjectMember, User
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
admin_router = APIRouter(
    prefix="/admin",
    tags=["users"],
    dependencies=[Depends(require_admin, scope="function")],
)
module_delegate_router = APIRouter(
    prefix="/module-delegate/users",
    tags=["users"],
)
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


class UserListResponse(BaseModel):
    items: list[UserResponse]
    next_cursor: str | None


class ModuleDelegateUserResponse(BaseModel):
    """委派者選人查詢回傳的人員最小欄位（AUT-R49）。"""

    id: UUID
    username: str
    name_zh: str | None


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


class LifecycleListResponse(BaseModel):
    items: list[dict[str, Any]]
    next_cursor: str | None


def _get_user(db: Session, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return user


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
        serialize=lambda user: UserResponse.model_validate(user),
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
        ),
        filters=filters,
    )
    return ModuleDelegateUserListResponse(**result)


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
                .where(ProjectMember.project_id.in_(project_ids))
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
