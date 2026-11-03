"""FEV-R03／R12：驗權後才解析完整內業編修，不開放 OFFICE 公開網址。"""

import json
from typing import Any
from uuid import UUID

from anyio import to_thread
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.errors import APIError, ErrorCode
from app.api.v1.evidence import _upload_limiter
from app.auth.access import permission_gaps, require_login_access
from app.auth.dependencies import get_db
from app.models import InspectionTask, User
from app.services.evidence_office import (
    edit_office,
    lock_photo,
    photo_response,
)
from app.services.permissions import calculate_effective_access
from app.storage import get_storage_settings

router = APIRouter(tags=["evidence"])
_db_dependency: Any = Depends(get_db, scope="function")
_login_dependency: Any = Depends(require_login_access, scope="function")


def _authorize(
    session: Session,
    task_id: UUID,
    photo_id: UUID,
    user: User,
) -> bool:
    task = session.get(InspectionTask, task_id)
    if task is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    access = calculate_effective_access(
        session,
        user_id=user.id,
        project_id=task.project_id,
    )
    module, project = permission_gaps(
        access,
        module_codes=("inspection.use",),
        project_codes=("evidence.manage",),
    )
    if module or project:
        if task.status == "DRAFT":
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    lock_photo(session, task_id, photo_id)
    missing_module, missing_read = permission_gaps(
        access,
        module_codes=("inspection.use",),
        project_codes=("evidence.read",),
    )
    # 登入活動寫入已完成；排隊期間不占 DB 交易／鎖。
    session.commit()
    return not missing_module and not missing_read


def _apply(
    session: Session,
    task_id: UUID,
    photo_id: UUID,
    user: User,
    raw: object,
) -> dict:
    can_read = _authorize(session, task_id, photo_id, user)
    photo = edit_office(
        session,
        task_id=task_id,
        photo_id=photo_id,
        operator_id=user.id,
        raw=raw,
    )
    body = photo_response(session, photo, can_read=can_read)
    body["uploaded_by"]["is_me"] = photo.created_by == user.id
    return body


@router.put("/inspection-tasks/{task_id}/photos/{photo_id}/office-version")
async def update_office_version(
    task_id: UUID,
    photo_id: UUID,
    request: Request,
    session: Session = _db_dependency,
    user: User = _login_dependency,
) -> dict:
    """FEV-D18：狀態優先於本文驗證，重用 T2 限流避免解碼併發失控。"""
    await run_in_threadpool(_authorize, session, task_id, photo_id, user)
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        # 完整圖層三欄各 1000 字，加上 JSON escaping 仍低於此界線。
        if len(chunks) > 64 * 1024:
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        raw = json.loads(chunks)
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    settings = get_storage_settings()
    return await to_thread.run_sync(
        _apply,
        session,
        task_id,
        photo_id,
        user,
        raw,
        limiter=_upload_limiter(settings.max_concurrent_uploads),
    )
