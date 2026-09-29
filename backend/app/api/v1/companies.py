"""Admin company management endpoints (DOM-R32, DOM-R33)."""

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.v1._management_errors import (
    integrity_error_code,
    management_error_status,
)
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.models import Company, User
from app.services.companies import (
    InvalidCompanyFieldError,
    create_company,
    list_active_users,
    update_company,
)
from app.services.users import (
    BuiltInAccountModificationError,
    LastActiveAdminRemovalError,
    set_is_active,
)

router = APIRouter(
    prefix="/companies",
    tags=["companies"],
    dependencies=[Depends(require_admin)],
)


class CompanyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    is_active: bool


class CreateCompanyRequest(BaseModel):
    name: str


class RenameCompanyRequest(BaseModel):
    name: str


class CompanyStatusRequest(BaseModel):
    is_active: bool
    disable_user_ids: list[UUID] = []


class ActiveCompanyUserResponse(BaseModel):
    id: UUID
    username: str
    name_zh: str | None


class ActiveCompanyUsersResponse(BaseModel):
    count: int
    users: list[ActiveCompanyUserResponse]


def _get_company(db: Session, company_id: UUID) -> Company:
    company = db.get(Company, company_id)
    if company is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return company


@router.get("", response_model=list[CompanyResponse])
def list_companies(
    db: Session = Depends(get_db),  # noqa: B008
) -> list[Company]:
    return list(db.scalars(select(Company).order_by(Company.name)))


@router.get("/{company_id}", response_model=CompanyResponse)
def get_company(
    company_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> Company:
    return _get_company(db, company_id)


@router.get(
    "/{company_id}/active-users",
    response_model=ActiveCompanyUsersResponse,
)
def get_active_users(
    company_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> ActiveCompanyUsersResponse:
    _get_company(db, company_id)
    users = list_active_users(db, company_id)
    return ActiveCompanyUsersResponse(
        count=len(users),
        users=[
            ActiveCompanyUserResponse(
                id=user.id,
                username=user.username,
                name_zh=user.name_zh,
            )
            for user in users
        ],
    )


@router.post("", response_model=CompanyResponse, status_code=201)
def add_company(
    body: CreateCompanyRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> Company:
    try:
        return create_company(db, name=body.name)
    except InvalidCompanyFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, management_error_status(code)) from exc


@router.patch("/{company_id}", response_model=CompanyResponse)
def rename_company(
    company_id: UUID,
    body: RenameCompanyRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> Company:
    company = _get_company(db, company_id)
    try:
        return update_company(db, company, name=body.name)
    except InvalidCompanyFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, management_error_status(code)) from exc


@router.put("/{company_id}/active", response_model=CompanyResponse)
def change_company_status(
    company_id: UUID,
    body: CompanyStatusRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> Company:
    company = _get_company(db, company_id)
    if body.is_active and body.disable_user_ids:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    active_users = list_active_users(db, company_id)
    by_id: dict[UUID, User] = {user.id: user for user in active_users}
    chosen = set(body.disable_user_ids)
    if len(chosen) != len(body.disable_user_ids) or chosen - by_id.keys():
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        for user_id in chosen:
            set_is_active(db, by_id[user_id], False)
        return update_company(db, company, is_active=body.is_active)
    except BuiltInAccountModificationError as exc:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422) from exc
    except LastActiveAdminRemovalError as exc:
        raise APIError(ErrorCode.USER_LAST_ADMIN, 422) from exc
    except InvalidCompanyFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except IntegrityError as exc:
        code = integrity_error_code(exc)
        if code is None:
            raise
        raise APIError(code, management_error_status(code)) from exc
