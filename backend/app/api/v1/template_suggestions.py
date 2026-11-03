"""TPL T16／T17：提議與管理審核的業務動作及不可變歷史查詢。"""

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.v1.template_library import template_write_call
from app.auth.access import (
    require_login_access,
    require_module_and_project_permission,
    require_module_permission,
)
from app.auth.dependencies import get_db
from app.services import template_suggestions as service
from app.template_structure import StrictBody

router = APIRouter(tags=["template-suggestions"])
_db: Any = Depends(get_db, scope="function")
_login = Depends(require_login_access, scope="function")
_review = Depends(
    require_module_permission("template.manage"), scope="function"
)
# TPL-R29：僅初次提出由路徑專案宣告兩層權限；歷史可在失權後讀取。
_create_access = Depends(
    require_module_and_project_permission(
        "inspection.use", "project_inspection_item.edit"
    ),
    scope="function",
)
# TPL-R31：expected 狀態也必須使用同一組狀態機名稱。
SuggestionStatus = Literal["PENDING", "RETURNED", "APPROVED", "WITHDRAWN"]
ReviewStatus = Literal["PENDING", "RETURNED", "APPROVED", "WITHDRAWN", "ALL"]


class ProposeBody(StrictBody):
    """TPL-R29：只接受來源項目；提議人與狀態一律由後端決定。"""

    project_inspection_item_id: UUID


class ExpectedBody(StrictBody):
    """TPL-R31：以使用者最後讀到的版本與狀態拒絕過期動作。"""

    expected_revision_id: UUID
    expected_status: SuggestionStatus


class RevisionBody(ExpectedBody):
    """TPL-R32：退回稿可不完整，完整結構在重送時驗證。"""

    content: dict[str, Any]


@router.post(
    "/projects/{project_id}/template-suggestions",
    status_code=201,
    dependencies=[_create_access],
)
def propose(project_id: UUID, body: ProposeBody, db: Session = _db) -> dict:
    """TPL-AC33／34：以當前操作者複製來源並首次送審，不改來源。"""
    row = service.propose(db, project_id, body.project_inspection_item_id)
    return service.detail(db, row.id)


@router.get("/me/template-suggestions", dependencies=[_login])
def list_mine(
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=50, ge=1, le=100),
    status: SuggestionStatus | None = None,
    source_project_id: UUID | None = None,
    db: Session = _db,
) -> dict:
    """TPL-R34：本人篩選件數不受頁次影響，不要求模組或來源權限。"""
    return service.list_mine(
        db,
        cursor=cursor,
        limit=limit,
        status=status,
        source_project_id=source_project_id,
    )


@router.get("/template-suggestions", dependencies=[_review])
def list_review(
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=50, ge=1, le=100),
    status: ReviewStatus = "PENDING",
    q: str | None = Query(default=None, max_length=256),
    db: Session = _db,
) -> dict:
    """TPL-R34：跨專案管理清單，預設只列待審件。"""
    return service.list_review(
        db,
        cursor=cursor,
        limit=limit,
        status=None if status == "ALL" else status,
        q=q,
    )


@router.get("/template-suggestions:pending-count", dependencies=[_review])
def pending_count(db: Session = _db) -> dict:
    """TPL-AC40：回全部待審主件數，不受搜尋／分頁影響。"""
    return service.pending_count(db)


@router.get("/template-suggestions/{suggestion_id}", dependencies=[_login])
def detail(suggestion_id: UUID, db: Session = _db) -> dict:
    """TPL-AC41：非本人不可用識別碼查詢內容，Admin 沿既有規則放行。"""
    return service.detail(db, suggestion_id)


@router.get(
    "/template-suggestions/{suggestion_id}/revisions", dependencies=[_login]
)
def revisions(
    suggestion_id: UUID,
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = _db,
) -> dict:
    """TPL-AC36：分頁回各版內容、編輯者、狀態、原因與審核人。"""
    return service.revisions(db, suggestion_id, cursor=cursor, limit=limit)


@router.post(
    "/template-suggestions/{suggestion_id}/revisions",
    status_code=201,
    dependencies=[_login],
)
def revise(
    suggestion_id: UUID,
    body: RevisionBody,
    response: Response,
    db: Session = _db,
) -> dict:
    """TPL-R32：不同內容新增一版；無變更回 200 原版，不留成功事件。"""
    row, changed = service.revise(
        db,
        suggestion_id,
        body.content,
        body.expected_revision_id,
        body.expected_status,
    )
    if not changed:
        response.status_code = 200
    return service.detail(db, row.id)


@router.post(
    "/template-suggestions/{suggestion_id}:submit", dependencies=[_login]
)
def submit(suggestion_id: UUID, body: ExpectedBody, db: Session = _db) -> dict:
    """TPL-AC35：退回後已有新修訂且完整合法，才能同件重送。"""
    row = service.submit(
        db, suggestion_id, body.expected_revision_id, body.expected_status
    )
    return service.detail(db, row.id)


@router.post(
    "/template-suggestions/{suggestion_id}:withdraw", dependencies=[_login]
)
def withdraw(
    suggestion_id: UUID, body: ExpectedBody, db: Session = _db
) -> dict:
    """TPL-AC41：失去來源編輯權後仍可撤回本人尚未終止的件。"""
    row = service.withdraw(
        db, suggestion_id, body.expected_revision_id, body.expected_status
    )
    return service.detail(db, row.id)


class ReturnBody(ExpectedBody):
    """TPL-R32：原因在模型正規化後才驗長度，保留合法的 1000 字。"""

    reason: str


class ApproveBody(ExpectedBody):
    """TPL-R33：明選目的地，不接受未保存內容或冒用審核人。"""

    category_id: UUID
    system_id: UUID


@router.get(
    "/template-suggestions/{suggestion_id}/revisions:compare",
    dependencies=[_review],
)
def compare_revisions(
    suggestion_id: UUID,
    from_revision_id: UUID,
    to_revision_id: UUID,
    db: Session = _db,
) -> dict:
    """TPL-AC36：限本件相鄰兩版，回完整版本與邏輯識別差異。"""
    return service.compare_revisions(
        db, suggestion_id, from_revision_id, to_revision_id
    )


@router.post(
    "/template-suggestions/{suggestion_id}:return", dependencies=[_review]
)
def return_suggestion(
    suggestion_id: UUID,
    body: ReturnBody,
    db: Session = _db,
) -> dict:
    """TPL-R33：待審件附原因退回，全部變更同交易。"""
    row = service.return_suggestion(
        db,
        suggestion_id,
        body.reason,
        body.expected_revision_id,
        body.expected_status,
    )
    return service.detail(db, row.id)


@router.post(
    "/template-suggestions/{suggestion_id}:approve", dependencies=[_review]
)
def approve(suggestion_id: UUID, body: ApproveBody, db: Session = _db) -> dict:
    """TPL-R33：沿既有範本錯誤轉譯與建庫入口核准，不覆蓋正式範本。"""
    row = template_write_call(
        service.approve,
        db,
        suggestion_id,
        body.category_id,
        body.system_id,
        body.expected_revision_id,
        body.expected_status,
    )
    result = service.detail(db, row.id)
    result["template_id"] = row.approved_template_id
    result["reviewed_revision_id"] = row.current_revision_id
    return result
