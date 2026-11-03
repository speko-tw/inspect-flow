"""FEV-R12、R13：登入後的照片查詢與兩版本圖片串流。"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from io import BytesIO
from typing import Any, BinaryIO, Literal
from uuid import UUID

from anyio import CapacityLimiter, to_thread
from anyio.lowlevel import RunVar
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response, StreamingResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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
from app.storage.settings import StorageSettings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["evidence"])
_db: Any = Depends(get_db, scope="function")
_login: Any = Depends(require_login_access, scope="function")
_limit: Any = Query(default=50, ge=1, le=100)
# Query 會保存參數 alias；歷程使用不同名稱，不能共用同一實例。
_history_limit: Any = Query(default=50, ge=1, le=100)
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
    layer_history_limit: int = _history_limit,
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


@dataclass(frozen=True)
class _PreparedImage:
    """只保留檔案與尺寸值，排隊及縮圖不攜帶 ORM 或資料庫連線。"""

    source: BinaryIO
    width: int
    height: int
    byte_size: int


_thumbnail_limiters: RunVar[dict[int, CapacityLimiter]] = RunVar(
    "evidence_thumbnail_limiters"
)


def _thumbnail_limiter(limit: int) -> CapacityLimiter:
    """依 T3 縮圖取捨隔離名額，等待者不占用預設 worker。

    依據：docs/specs/field-evidence/plan.md#t3-thumbnail-tradeoffs。
    """
    # 與 T2 同樣延遲建立，避免跨 TestClient／事件迴圈共用喚醒狀態。
    try:
        limiters = _thumbnail_limiters.get()
    except LookupError:
        limiters = {}
        _thumbnail_limiters.set(limiters)
    if limit not in limiters:
        limiters[limit] = CapacityLimiter(limit)
    return limiters[limit]


def _prepare_image(
    db: Session,
    task_id: UUID,
    photo_id: UUID,
    user: User,
    variant: str,
    settings: StorageSettings,
) -> _PreparedImage:
    task, office = _read_access(db, task_id, user, variant=variant)
    _photo(db, task, photo_id, office=office)
    storage = LocalStorage(settings.root)
    for attempt in range(2):
        version = db.scalar(
            select(EvidenceVariant)
            .where(
                EvidenceVariant.evidence_id == photo_id,
                EvidenceVariant.variant_type == variant.upper(),
            )
            .execution_options(populate_existing=True)
        )
        if version is None:
            logger.warning(
                "Evidence image unavailable: evidence_id=%s", photo_id
            )
            raise _not_found()
        key = version.storage_key
        width, height, byte_size = (
            version.width,
            version.height,
            version.byte_size,
        )
        # 依 docs/specs/field-evidence/plan.md#t3-thumbnail-tradeoffs：
        # 先釋放登入寫鎖再讀檔／等名額，避免擋住 SQLite 寫入（FEV-R17）。
        db.commit()
        try:
            source = storage.open(key)
            return _PreparedImage(source, width, height, byte_size)
        except FileNotFoundError:
            # FEV-R17：T4 可已切換新鍵並刪舊檔，換新交易重讀一次。
            if attempt == 0:
                continue
            logger.warning(
                "Evidence image unavailable: evidence_id=%s", photo_id
            )
            raise _not_found() from None
    raise AssertionError("unreachable image retry")


def _thumbnail(image: _PreparedImage, max_edge: int, max_pixels: int) -> bytes:
    """FEV-R01、R17：解碼前覆核像素，縮圖只留記憶體且不改原檔。"""
    try:
        with Image.open(image.source) as decoded:
            if decoded.width * decoded.height > max_pixels:
                raise APIError(
                    ErrorCode.EVIDENCE_INVALID_IMAGE, 422, details=["pixels"]
                )
            if decoded.format != "JPEG":
                raise APIError(
                    ErrorCode.EVIDENCE_INVALID_IMAGE, 422, details=["format"]
                )
            decoded.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            output = BytesIO()
            decoded.convert("RGB").save(output, "JPEG", quality=90)
            return output.getvalue()
    except Image.DecompressionBombError as exc:
        raise APIError(
            ErrorCode.EVIDENCE_INVALID_IMAGE, 422, details=["pixels"]
        ) from exc
    except (OSError, UnidentifiedImageError) as exc:
        raise APIError(
            ErrorCode.EVIDENCE_INVALID_IMAGE, 422, details=["decode"]
        ) from exc


@router.get("/inspection-tasks/{task_id}/photos/{photo_id}/image")
async def get_photo_image(
    task_id: UUID,
    photo_id: UUID,
    variant: Literal["field", "office"] = "field",
    max_edge: int | None = _edge,
    db: Session = _db,
    user: User = _login,
) -> Response:
    """FEV-R01、R13、R17：授權後限流即時縮圖，原尺寸走登入串流。"""
    settings = get_storage_settings()
    image = await run_in_threadpool(
        _prepare_image, db, task_id, photo_id, user, variant, settings
    )
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if max_edge is not None and max_edge < max(image.width, image.height):
        try:
            content = await to_thread.run_sync(
                _thumbnail,
                image,
                max_edge,
                settings.max_decode_pixels,
                limiter=_thumbnail_limiter(settings.max_concurrent_uploads),
            )
            return Response(content, media_type="image/jpeg", headers=headers)
        finally:
            image.source.close()
    headers["Content-Length"] = str(image.byte_size)

    def chunks() -> Iterator[bytes]:
        # FEV-R13、R17：串流只持有檔案，登入交易已在準備階段提交。
        with image.source:
            while chunk := image.source.read(65536):
                yield chunk

    return StreamingResponse(
        chunks(), media_type="image/jpeg", headers=headers
    )
