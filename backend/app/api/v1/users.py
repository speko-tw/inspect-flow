"""Admin user management endpoints (DOM-R04, DOM-R45, AUT-R46)."""

import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.v1._management_errors import integrity_error_code
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.auth.password_service import PasswordLengthError, set_password
from app.models import Company, User
from app.services.users import (
    BuiltInAccountModificationError,
    CompanyNotActiveError,
    ExternalBasicFieldModificationError,
    InvalidUserFieldError,
    LastActiveAdminRemovalError,
    UsernameChangePermissionError,
    create_user,
    set_is_active,
    set_is_admin,
    update_user_manual,
)

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_admin)],
)


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


class CompanyLinkRequest(BaseModel):
    company_id: UUID | None
    department: str | None = None
    location: str | None = None
    employee_no: str | None = None


class AdminStatusRequest(BaseModel):
    is_admin: bool


class ActiveStatusRequest(BaseModel):
    is_active: bool


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
    elif isinstance(exc, PasswordLengthError):
        code = ErrorCode.AUTH_PASSWORD_INVALID
    else:
        code = ErrorCode.REQUEST_VALIDATION_FAILED
    return APIError(code, 422)


_USER_BUSINESS_ERRORS = (
    BuiltInAccountModificationError,
    LastActiveAdminRemovalError,
    ExternalBasicFieldModificationError,
    CompanyNotActiveError,
    UsernameChangePermissionError,
    InvalidUserFieldError,
    PasswordLengthError,
)


def _check_company_exists(db: Session, company_id: UUID | None) -> None:
    if company_id is not None and db.get(Company, company_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)


@router.get("", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)) -> list[User]:  # noqa: B008
    return list(db.scalars(select(User).order_by(User.username)))


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> User:
    return _get_user(db, user_id)


@router.post("", response_model=CreatedUserResponse, status_code=201)
def add_user(
    body: CreateUserRequest,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008
) -> CreatedUserResponse:
    _check_company_exists(db, body.company_id)
    try:
        user = create_user(db, **body.model_dump(exclude={"is_admin"}))
        if body.is_admin:
            set_is_admin(db, user, True)
        password = secrets.token_urlsafe(24)
        set_password(db, user, password, is_temporary=True)
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, 422) from exc
    response.headers["Cache-Control"] = "no-store"
    return CreatedUserResponse(
        **UserResponse.model_validate(user).model_dump(),
        temporary_password=password,
    )


@router.patch("/{user_id}", response_model=UserResponse)
def edit_user(
    user_id: UUID,
    body: UpdateUserRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> User:
    user = _get_user(db, user_id)
    fields = body.model_dump(exclude_unset=True)
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
    try:
        return update_user_manual(db, user, **fields)
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, 422) from exc


@router.put("/{user_id}/company", response_model=UserResponse)
def link_company(
    user_id: UUID,
    body: CompanyLinkRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> User:
    user = _get_user(db, user_id)
    fields = body.model_dump(exclude_unset=True)
    _check_company_exists(db, body.company_id)
    if user.is_system and body.company_id != user.company_id:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422)
    try:
        return update_user_manual(db, user, **fields)
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, 422) from exc


@router.put("/{user_id}/admin", response_model=UserResponse)
def change_admin_status(
    user_id: UUID,
    body: AdminStatusRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> User:
    user = _get_user(db, user_id)
    if user.is_admin == body.is_admin:
        return user
    try:
        return set_is_admin(db, user, body.is_admin)
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, 422) from exc


@router.put("/{user_id}/active", response_model=UserResponse)
def change_active_status(
    user_id: UUID,
    body: ActiveStatusRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> User:
    user = _get_user(db, user_id)
    try:
        return set_is_active(db, user, body.is_active)
    except _USER_BUSINESS_ERRORS as exc:
        raise _user_error(exc) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, 422) from exc
