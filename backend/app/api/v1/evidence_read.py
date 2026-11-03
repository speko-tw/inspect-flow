"""FEV-R12、R13：登入後的照片查詢與兩版本圖片串流。"""

from collections.abc import Iterator
from io import BytesIO
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import require_login_access
from app.auth.dependencies import get_db
from app.models import Evidence, EvidenceVariant, InspectionTask, User
from app.services.evidence_queries import (
    calculate_photo_coverage,
    layer_history,
    list_photos,
    serialize_photos,
)
from app.services.permissions import calculate_effective_access
from app.storage import LocalStorage, get_storage_settings

router = APIRouter(tags=["evidence"])
_db: Any = Depends(get_db, scope="function")
_login: Any = Depends(require_login_access, scope="function")
_limit: Any = Query(default=50, ge=1, le=100)
_edge: Any = Query(default=None, ge=64, le=4096)


def _not_found() -> APIError:
    return APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)


def _read_access(
    db: Session,
    task_id: UUID,
    user: User,
    *,
    field: bool = False,
    variant: str | None = None,
) -> tuple[InspectionTask, bool]:
    task = db.get(InspectionTask, task_id)
    if task is None:
        raise _not_found()
    access = calculate_effective_access(
        db, user_id=user.id, project_id=task.project_id
    )
    codes = access.project_permissions_by_project.get(task.project_id, ())
    office = access.is_admin or "evidence.read" in codes
    inspect = access.is_admin or "inspection_task.inspect" in codes
    allowed = inspect if field else office
    if variant == "field":
        allowed = inspect or office
    if not allowed or (
        not access.is_admin
        and task.project_id not in access.project_memberships
    ):
        if field:
            raise _not_found()
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    # FEV-AC13：未開通模組的 U7 仍回 403，與專案隱藏規則分開。
    if (
        not access.is_admin
        and "inspection.use" not in access.module_permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    # FEV-R09：DRAFT 只對現場隱藏；內業仍依 evidence.read。
    if task.status == "DRAFT" and (field or not office):
        raise _not_found()
    return task, office


def _photo(
    db: Session, task: InspectionTask, photo_id: UUID, *, office: bool
) -> Evidence:
    photo = db.scalar(
        select(Evidence).where(
            Evidence.id == photo_id,
            Evidence.task_id == task.id,
            Evidence.project_id == task.project_id,
        )
    )
    if photo is None or (
        not office
        and (photo.deleted_at is not None or photo.voided_at is not None)
    ):
        raise _not_found()
    return photo


@router.get("/field/inspection-tasks/{task_id}/evidence")
def get_coverage(
    task_id: UUID, db: Session = _db, user: User = _login
) -> dict:
    """FEV-R04：現場取得目前項次需求及未刪除、未作廢照片覆蓋。"""
    task, _ = _read_access(db, task_id, user, field=True)
    return calculate_photo_coverage(db, task.id)


@router.get("/field/inspection-tasks/{task_id}/photos")
def get_field_photos(
    task_id: UUID,
    cursor: str | None = None,
    limit: int = _limit,
    item_id: UUID | None = None,
    db: Session = _db,
    user: User = _login,
) -> dict:
    """FEV-R13：現場不回傳內業影像或非即時衍生旗標。"""
    task, _ = _read_access(db, task_id, user, field=True)
    return list_photos(
        db,
        task,
        user_id=user.id,
        office=False,
        cursor=cursor,
        limit=limit,
        item_id=item_id,
    )


@router.get("/inspection-tasks/{task_id}/photos")
def get_office_photos(
    task_id: UUID,
    cursor: str | None = None,
    limit: int = _limit,
    item_id: UUID | None = None,
    voided: bool | None = None,
    deleted: bool | None = None,
    db: Session = _db,
    user: User = _login,
) -> dict:
    """FEV-R11、R13：內業可查作廢、軟刪除與兩版追溯資料。"""
    task, _ = _read_access(db, task_id, user)
    return list_photos(
        db,
        task,
        user_id=user.id,
        office=True,
        cursor=cursor,
        limit=limit,
        item_id=item_id,
        voided=voided,
        deleted=deleted,
    )


@router.get("/inspection-tasks/{task_id}/photos/{photo_id}")
def get_photo_detail(
    task_id: UUID,
    photo_id: UUID,
    layer_history_cursor: str | None = None,
    layer_history_limit: int = _limit,
    db: Session = _db,
    user: User = _login,
) -> dict:
    """FEV-R24：一般專案讀取權即可查本照片完整圖層歷程。"""
    task, _ = _read_access(db, task_id, user)
    photo = _photo(db, task, photo_id, office=True)
    data = serialize_photos(
        db, [photo], user_id=user.id, office=True, task=task
    )[0]
    data["layer_history"] = layer_history(
        db, task, photo, cursor=layer_history_cursor, limit=layer_history_limit
    )
    return data


@router.get("/inspection-tasks/{task_id}/photos/{photo_id}/image")
def get_photo_image(
    task_id: UUID,
    photo_id: UUID,
    variant: Literal["field", "office"] = "field",
    max_edge: int | None = _edge,
    db: Session = _db,
    user: User = _login,
) -> Response:
    """FEV-R01、R13：授權後串流或即時縮圖，不新增儲存版本。"""
    task, office = _read_access(db, task_id, user, variant=variant)
    photo = _photo(db, task, photo_id, office=office)
    version = db.scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == photo.id,
            EvidenceVariant.variant_type == variant.upper(),
        )
    )
    if version is None:
        raise _not_found()
    storage = LocalStorage(get_storage_settings().root)
    try:
        source = storage.open(version.storage_key)
    except FileNotFoundError as exc:
        raise _not_found() from exc
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if max_edge is not None and max_edge < max(version.width, version.height):
        with source, Image.open(source) as image:
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            output = BytesIO()
            image.convert("RGB").save(output, "JPEG", quality=90)
        return Response(
            output.getvalue(), media_type="image/jpeg", headers=headers
        )
    headers["Content-Length"] = str(version.byte_size)
    headers["ETag"] = f'"{version.sha256}"'

    def chunks() -> Iterator[bytes]:
        # scope=function 的資料庫連線在開始串流前釋放（FEV-R21）。
        with source:
            while chunk := source.read(65536):
                yield chunk

    return StreamingResponse(
        chunks(), media_type="image/jpeg", headers=headers
    )
