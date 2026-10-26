"""Admin company management endpoints (DOM-R32, DOM-R33)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.batch import (
    MAX_BATCH_ITEMS,
    BatchLimitedRequest,
    require_batch_size,
)
from app.api.errors import APIError, ErrorCode, FieldErrorCode
from app.api.pagination import ilike_contains, page_by_text_key, write_call
from app.api.v1._management_errors import (
    management_api_error,
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
from app.services.operator import get_current_operator
from app.services.users import (
    BuiltInAccountModificationError,
    LastActiveAdminRemovalError,
    set_is_active,
)

router = APIRouter(
    prefix="/companies",
    tags=["companies"],
    dependencies=[Depends(require_admin, scope="function")],
)

_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100


class CompanyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    is_active: bool


class CompanyListResponse(BaseModel):
    items: list[CompanyResponse]
    next_cursor: str | None


class CreateCompanyRequest(BaseModel):
    name: str


class RenameCompanyRequest(BaseModel):
    name: str


class CompanyStatusRequest(BatchLimitedRequest):
    """啟用或停用一家公司；停用時可勾選一併停用的人員（DOM-R33）。

    ``disable_user_ids`` 只在停用公司時有意義，由操作者決定實際
    停用哪些人，沒被勾選的人員維持啟用。
    """

    is_active: bool
    disable_user_ids: list[UUID] = Field(
        default_factory=list, max_length=MAX_BATCH_ITEMS
    )


class BatchCompanyStatusItem(BaseModel):
    """批次中一家公司的目標狀態與其一併停用的人員（ADM-R13）。"""

    company_id: UUID
    is_active: bool
    disable_user_ids: list[UUID] = Field(
        default_factory=list, max_length=MAX_BATCH_ITEMS
    )


class BatchCompanyStatusRequest(BatchLimitedRequest):
    items: list[BatchCompanyStatusItem] = Field(max_length=MAX_BATCH_ITEMS)


class BatchCompanyStatusResponse(BaseModel):
    items: list[CompanyResponse]


class ActiveCompanyUserResponse(BaseModel):
    id: UUID
    username: str
    name_zh: str | None


class ActiveCompanyUsersResponse(BaseModel):
    count: int
    users: list[ActiveCompanyUserResponse]


def _get_company(db: Session, company_id: UUID) -> Company:
    """取得公司；不存在回 404，所有以公司 id 定址的端點共用。"""
    company = db.get(Company, company_id)
    if company is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return company


@router.get("", response_model=CompanyListResponse)
def list_companies(
    q: str | None = Query(default=None, max_length=256),
    cursor: str | None = None,
    limit: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> CompanyListResponse:
    """依名稱排序、cursor 分頁列出公司，``q`` 做不分大小寫的包含搜尋。

    搜尋與分頁屬 ADM-R13（AC：ADM-AC10）：跨頁不重複、不遺漏。
    """
    filters = []
    query = (q or "").strip()
    if query:
        filters.append(ilike_contains(Company.name, query))
    result = page_by_text_key(
        db,
        Company,
        sort_key=Company.name,
        key_name="name",
        cursor=cursor,
        limit=limit,
        serialize=lambda company: CompanyResponse.model_validate(company),
        filters=filters,
    )
    return CompanyListResponse(**result)


@router.get("/{company_id}", response_model=CompanyResponse)
def get_company(
    company_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> Company:
    return _get_company(db, company_id)


@router.get(
    "/{company_id}/active-users",
    response_model=ActiveCompanyUsersResponse,
)
def get_active_users(
    company_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> ActiveCompanyUsersResponse:
    """回傳公司目前啟用中的人員與人數（DOM-R33）。

    停用公司前畫面要先顯示「還有 N 位啟用中的人員」，供操作者
    決定一併停用誰；這個端點只讀，不改動任何人員。
    """
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
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> Company:
    try:
        return write_call(
            lambda: create_company(db, name=body.name),
            error_mapper=management_api_error,
        )
    except InvalidCompanyFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


@router.patch("/{company_id}", response_model=CompanyResponse)
def rename_company(
    company_id: UUID,
    body: RenameCompanyRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> Company:
    company = _get_company(db, company_id)
    try:
        return write_call(
            lambda: update_company(db, company, name=body.name),
            error_mapper=management_api_error,
        )
    except InvalidCompanyFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


@router.put("/{company_id}/active", response_model=CompanyResponse)
def change_company_status(
    company_id: UUID,
    body: CompanyStatusRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> Company:
    """啟用或停用公司，停用時可同交易一併停用勾選的人員。

    依 DOM-R32，停用公司本身不改動旗下人員；依 DOM-R33，只有操作
    者明確勾選的人員才會被停用。
    """
    company = _get_company(db, company_id)
    # 一併停用是停用公司時的選項（DOM-R33），啟用公司不得帶名單。
    if body.is_active and body.disable_user_ids:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    active_users = list_active_users(db, company_id)
    by_id: dict[UUID, User] = {user.id: user for user in active_users}
    chosen = set(body.disable_user_ids)
    # 名單只能是這家公司目前啟用中的人員且不得重複（DOM-R33）。
    if len(chosen) != len(body.disable_user_ids) or chosen - by_id.keys():
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    def update_company_status() -> Company:
        # 逐一走 set_is_active，內建帳號與最後一位 Admin 仍受
        # DOM-R06、DOM-R07 保護；任一失敗則整筆不生效。
        for user_id in chosen:
            set_is_active(db, by_id[user_id], False)
        return update_company(db, company, is_active=body.is_active)

    try:
        return write_call(
            update_company_status,
            error_mapper=management_api_error,
        )
    except BuiltInAccountModificationError as exc:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422) from exc
    except LastActiveAdminRemovalError as exc:
        raise APIError(ErrorCode.USER_LAST_ADMIN, 422) from exc


@router.post(":batch-status", response_model=BatchCompanyStatusResponse)
def batch_change_company_status(
    body: BatchCompanyStatusRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> BatchCompanyStatusResponse:
    """Apply selected company statuses atomically (ADM-R13).

    任一公司或人員驗證失敗時整批資料不變（ADM-AC10），因此所有
    檢查與加鎖都在寫入前完成。
    """
    items = body.items
    require_batch_size(len(items))
    # ADM-R13、#731：停用人員合計沿用帳號批次的 200 人上限，
    # 避免跨公司累積後超過 SQLite 綁定參數限制，維持雙資料庫一致。
    if sum(len(item.disable_user_ids) for item in items) > MAX_BATCH_ITEMS:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=[
                f"每批最多選取 {MAX_BATCH_ITEMS} 位停用人員，"
                "請減少數量後再試。"
            ],
            fields=[{"path": "/items", "code": FieldErrorCode.TOO_LONG.value}],
        )
    company_ids = [item.company_id for item in items]
    # 同一家公司不得在一批中出現兩次，否則最終狀態取決於順序。
    if not items or len(set(company_ids)) != len(company_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if any(item.is_active and item.disable_user_ids for item in items):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    # 先鎖公司再鎖人員，且各自依 id 排序，讓同時送出的批次以相同
    # 順序取得列鎖；鎖定後才比對存在性，避免檢查與寫入之間被改動。
    companies = list(
        db.scalars(
            select(Company)
            .where(Company.id.in_(company_ids))
            .order_by(Company.id)
            .with_for_update()
        )
    )
    if {company.id for company in companies} != set(company_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    selected_user_ids = [
        user_id for item in items for user_id in item.disable_user_ids
    ]
    # ADM-R13、#414：公司入口也不能繞過批次帳號的自我保護。
    if get_current_operator(db).id in selected_user_ids:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=["不能批次停用自己的帳號。"],
        )
    if len(set(selected_user_ids)) != len(selected_user_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    # 只鎖仍啟用的人員：已停用者不在 DOM-R33 的可勾選名單內，
    # 出現在名單中就視為無效請求。
    selected_users = (
        list(
            db.scalars(
                select(User)
                .where(
                    User.id.in_(selected_user_ids),
                    User.is_active.is_(True),
                )
                .order_by(User.id)
                .with_for_update()
            )
        )
        if selected_user_ids
        else []
    )
    users_by_id = {user.id: user for user in selected_users}
    if set(users_by_id) != set(selected_user_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    companies_by_id = {company.id: company for company in companies}
    # 勾選的人員必須屬於同一筆項目的公司，不能借公司入口停用他人。
    for item in items:
        if any(
            users_by_id[user_id].company_id != item.company_id
            for user_id in item.disable_user_ids
        ):
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    def update_statuses() -> list[Company]:
        for item in items:
            for user_id in item.disable_user_ids:
                set_is_active(db, users_by_id[user_id], False)
            update_company(
                db,
                companies_by_id[item.company_id],
                is_active=item.is_active,
            )
        return [companies_by_id[company_id] for company_id in company_ids]

    try:
        changed = write_call(
            update_statuses,
            error_mapper=management_api_error,
        )
    except BuiltInAccountModificationError as exc:
        raise APIError(ErrorCode.USER_BUILTIN_PROTECTED, 422) from exc
    except LastActiveAdminRemovalError as exc:
        raise APIError(ErrorCode.USER_LAST_ADMIN, 422) from exc
    return BatchCompanyStatusResponse(
        items=[CompanyResponse.model_validate(company) for company in changed]
    )
