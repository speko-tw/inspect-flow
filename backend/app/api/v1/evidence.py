"""FEV-R03、R06、R07：接收現場照片並原子產生內業版。"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from anyio import CapacityLimiter, to_thread
from anyio.lowlevel import RunVar
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from app.api import limits
from app.api.errors import APIError, ErrorCode
from app.auth.access import permission_gaps, require_login_access
from app.auth.dependencies import (
    get_db,
    get_request_effective_access_cache,
)
from app.models import InspectionTask, User
from app.services.evidence import (
    _request_fingerprint,
    check_invalid_replay,
    replay_upload,
    upload_evidence,
    validate_upload_state,
)
from app.services.evidence_images import normalize_field_layer
from app.services.permissions import calculate_effective_access
from app.storage import get_storage_settings

router = APIRouter(tags=["evidence"])
_db_dependency: Any = Depends(get_db, scope="function")
_login_dependency: Any = Depends(require_login_access, scope="function")


def _invalid_request() -> APIError:
    return APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)


def _json_object(value: str | None, *, default: dict | list) -> object:
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except (json.JSONDecodeError, TypeError, RecursionError) as exc:
        raise _invalid_request() from exc


def _parse_captured_at(value: str | None) -> datetime | None:
    if value is None or value == "":
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise _invalid_request()
        return parsed.astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise _invalid_request() from exc


def _check_upload_access(
    session: Session, task: InspectionTask, user: User
) -> None:
    access = calculate_effective_access(
        session, user_id=user.id, project_id=task.project_id
    )
    missing_module, missing_project = permission_gaps(
        access,
        module_codes=("inspection.use",),
        project_codes=("inspection_task.inspect",),
    )
    if missing_module or missing_project:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)


class _EvidenceBodyTooLarge(MultiPartException):
    """FEV-R06：串流中的檔案或整體 multipart 超過限制。"""


class _EvidenceMultiPartParser(MultiPartParser):
    """FEV-R06：解析前限制檔案、欄位、part 數與整體 body。"""

    def __init__(self, request: Request, file_limit: int) -> None:
        self._file_limit = file_limit
        self._file_bytes = 0
        self._body_bytes = 0
        super().__init__(
            request.headers,
            request.stream(),
            max_files=1,
            max_fields=limits.EVIDENCE_MULTIPART_FIELDS_MAX,
            max_part_size=limits.EVIDENCE_MULTIPART_FIELD_MAX,
        )

    def on_part_begin(self) -> None:
        super().on_part_begin()
        self._file_bytes = 0

    def on_part_data(self, data: bytes, start: int, end: int) -> None:
        part_size = end - start
        if self._current_part.file is not None:
            self._file_bytes += part_size
            if self._file_bytes > self._file_limit:
                raise _EvidenceBodyTooLarge("Evidence file too large")
        super().on_part_data(data, start, end)

    async def parse(self) -> FormData:
        original_stream = self.stream

        async def bounded_stream() -> AsyncGenerator[bytes, None]:
            async for chunk in original_stream:
                self._body_bytes += len(chunk)
                if self._body_bytes > (
                    self._file_limit + limits.EVIDENCE_MULTIPART_OVERHEAD_MAX
                ):
                    raise _EvidenceBodyTooLarge("Multipart body too large")
                yield chunk

        self.stream = bounded_stream()
        return await super().parse()


async def _parse_evidence_form(request: Request, file_limit: int) -> FormData:
    """FEV-R06：在 multipart parser 寫入 spool 前限制 body 大小。"""
    media_type = request.headers.get("content-type", "").split(";", 1)[0]
    if media_type.strip().lower() != "multipart/form-data":
        raise _invalid_request()
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdecimal():
        if int(content_length) > (
            file_limit + limits.EVIDENCE_MULTIPART_OVERHEAD_MAX
        ):
            raise APIError(ErrorCode.EVIDENCE_FILE_TOO_LARGE, 413)
    parser = _EvidenceMultiPartParser(request, file_limit)
    try:
        return await parser.parse()
    except _EvidenceBodyTooLarge as exc:
        raise APIError(ErrorCode.EVIDENCE_FILE_TOO_LARGE, 413) from exc
    except MultiPartException as exc:
        raise _invalid_request() from exc


def _single_fields(form: FormData) -> dict[str, str | UploadFile]:
    """只有 point_ids 可重複，其他名稱重複時拒絕歧義。"""
    pairs = form.multi_items()
    singles = [name for name, _ in pairs if name != "point_ids"]
    if len(set(singles)) != len(singles):
        raise _invalid_request()
    allowed = limits.EVIDENCE_MULTIPART_FIXED_FIELDS | {"file", "point_ids"}
    values: dict[str, str | UploadFile] = {}
    for name, value in pairs:
        if name not in allowed or not isinstance(value, (str, UploadFile)):
            raise _invalid_request()
        values[name] = value
    if not isinstance(values.get("file"), UploadFile):
        raise _invalid_request()
    return values


_upload_limiters: RunVar[dict[int, CapacityLimiter]] = RunVar(
    "evidence_upload_limiters"
)


def _upload_limiter(limit: int) -> CapacityLimiter:
    """worker 的單一事件迴圈共用名額；延遲建立，不占預設 worker 等候。"""
    # RunVar 隔離 TestClient／不同事件迴圈，避免跨迴圈喚醒等待者。
    try:
        limiters = _upload_limiters.get()
    except LookupError:
        limiters = {}
        _upload_limiters.set(limiters)
    if limit not in limiters:
        limiters[limit] = CapacityLimiter(limit)
    return limiters[limit]


@dataclass(frozen=True)
class _PreparedUpload:
    """只攜帶已驗證表單值；排隊時不保留 ORM 讀交易或資料庫連線。"""

    upload_key: UUID
    item_id: UUID
    sha256: str
    is_overview: bool
    point_ids: list[UUID]
    caption: str | None
    captured_at: datetime | None
    field_edit: dict | None
    layer: dict
    capture_source: str
    file: UploadFile


def _authorize_upload(session: Session, task_id: UUID, user: User) -> UUID:
    task = session.get(InspectionTask, task_id)
    if task is None:
        raise APIError(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    _check_upload_access(session, task, user)
    if task.status == "DRAFT":
        raise APIError(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    user_id = user.id
    # 登入驗證已 touch auth_sessions；串流前提交，避免持有寫鎖與連線。
    session.commit()
    return user_id


def _prepare_upload(
    session: Session,
    task_id: UUID,
    user_id: UUID,
    idempotency_key: str,
    form: FormData,
) -> JSONResponse | _PreparedUpload:
    """便宜的驗證與重放先處理，不需要影像名額。"""
    key_error: APIError | None = None
    upload_key: UUID | None = None
    try:
        upload_key = UUID(idempotency_key)
    except ValueError:
        key_error = _invalid_request()
    try:
        fields = _single_fields(form)
    except APIError as exc:
        if upload_key is not None:
            check_invalid_replay(session, task_id, upload_key, user_id)
        validate_upload_state(session, task_id, None, None)
        raise exc

    validation_error = key_error
    item_uuid: UUID | None = None
    points: list[UUID] = []
    file = fields["file"]
    assert isinstance(file, UploadFile)
    try:
        item_uuid = UUID(str(fields.get("item_id", "")))
        sha256 = str(fields.get("sha256", ""))
        overview_text = str(fields.get("is_overview", "false"))
        caption_value = fields.get("caption")
        captured_value = fields.get("captured_at")
        edit_value_raw = fields.get("field_edit")
        layer_value_raw = fields.get("layer")
        capture_source = str(fields.get("capture_source", ""))
        if caption_value is not None and not isinstance(caption_value, str):
            raise _invalid_request()
        caption = caption_value if isinstance(caption_value, str) else None
        captured_text = (
            captured_value if isinstance(captured_value, str) else None
        )
        edit_text = edit_value_raw if isinstance(edit_value_raw, str) else None
        layer_text = (
            layer_value_raw if isinstance(layer_value_raw, str) else None
        )
        if captured_value is not None and not isinstance(captured_value, str):
            raise _invalid_request()
        if edit_value_raw is not None and not isinstance(edit_value_raw, str):
            raise _invalid_request()
        if layer_value_raw is not None and not isinstance(
            layer_value_raw, str
        ):
            raise _invalid_request()
        if len(sha256) != 64:
            raise _invalid_request()
        if overview_text not in {"true", "false"}:
            raise _invalid_request()
        point_values = form.getlist("point_ids")
        if len(point_values) > limits.POINTS_MAX:
            raise _invalid_request()
        if any(not isinstance(value, str) for value in point_values):
            raise _invalid_request()
        points = [UUID(str(value)) for value in point_values]
        if len(set(points)) != len(points):
            raise _invalid_request()
        edit_value = _json_object(edit_text, default={})
        if edit_value == {} and not edit_text:
            edit_value = None
        if edit_value is not None:
            if not isinstance(edit_value, dict):
                raise _invalid_request()
            if set(edit_value) - {"rotation", "brightness"}:
                raise _invalid_request()
            rotation = edit_value.get("rotation", 0)
            brightness = edit_value.get("brightness", 0)
            if (
                type(rotation) is not int
                or rotation not in {0, 90, 180, 270}
                or type(brightness) is not int
                or not -100 <= brightness <= 100
            ):
                raise _invalid_request()
        layer_value = _json_object(layer_text, default={})
        normalized_layer = normalize_field_layer(layer_value)
        captured = _parse_captured_at(captured_text)
        if caption is not None and len(caption) > 500:
            raise _invalid_request()
        if capture_source not in {"camera", "library"}:
            raise _invalid_request()
    except (APIError, ValueError, TypeError, AttributeError) as exc:
        validation_error = (
            exc if isinstance(exc, APIError) else _invalid_request()
        )
        sha256 = str(fields.get("sha256", ""))
        overview_text = str(fields.get("is_overview", "false"))
        caption = None
        edit_value = None
        normalized_layer = normalize_field_layer({})
        captured = None
        capture_source = str(fields.get("capture_source", ""))

    fingerprint = None
    if (
        validation_error is None
        and upload_key is not None
        and item_uuid is not None
    ):
        fingerprint = _request_fingerprint(
            sha256=sha256.lower(),
            item_id=item_uuid,
            is_overview=overview_text == "true",
            point_ids=points,
            caption=caption,
            captured_at=captured,
            field_edit=edit_value,
            layer=normalized_layer,
            capture_source=capture_source,
        )

    if upload_key is not None:
        replay = (
            replay_upload(session, task_id, upload_key, fingerprint, user_id)
            if fingerprint is not None
            else check_invalid_replay(session, task_id, upload_key, user_id)
        )
        if replay is not None:
            return JSONResponse(replay, status_code=200)

    if validation_error is not None:
        validate_upload_state(
            session, task_id, item_uuid, points if item_uuid else None
        )
        raise validation_error

    assert upload_key is not None and item_uuid is not None
    prepared = _PreparedUpload(
        upload_key=upload_key,
        item_id=item_uuid,
        sha256=sha256.lower(),
        is_overview=overview_text == "true",
        point_ids=points,
        caption=caption,
        captured_at=captured,
        field_edit=edit_value,
        layer=normalized_layer,
        capture_source=capture_source,
        file=file,
    )
    # 授權 touch 已先 commit；這裡只有讀取，等影像名額前釋放連線。
    session.rollback()
    return prepared


def _process_upload(
    session: Session,
    task_id: UUID,
    user_id: UUID,
    prepared: _PreparedUpload,
) -> JSONResponse:
    """只有持有專用名額的 worker 才讀圖片、解碼、產圖與存檔。"""
    user = session.get(User, user_id)
    assert user is not None
    settings = get_storage_settings()
    content = prepared.file.file.read(settings.max_file_bytes + 1)
    if len(content) > settings.max_file_bytes:
        raise APIError(ErrorCode.EVIDENCE_FILE_TOO_LARGE, 413)
    result, replayed = upload_evidence(
        session,
        task_id=task_id,
        upload_key=prepared.upload_key,
        sha256=prepared.sha256,
        item_id=prepared.item_id,
        is_overview=prepared.is_overview,
        point_ids=prepared.point_ids,
        caption=prepared.caption,
        captured_at=prepared.captured_at,
        field_edit=prepared.field_edit,
        layer=prepared.layer,
        capture_source=prepared.capture_source,
        content=content,
        uploader=user,
    )
    return JSONResponse(result, status_code=200 if replayed else 201)


@router.post("/inspection-tasks/{task_id}/photos")
async def upload_photo(
    task_id: UUID,
    request: Request,
    session: Session = _db_dependency,
    user: User = _login_dependency,
) -> JSONResponse:
    """FEV-R06：先授權並釋放登入交易，再讀串流並在線程處理照片。"""
    user_id = await run_in_threadpool(
        _authorize_upload, session, task_id, user
    )
    settings = get_storage_settings()
    form = await _parse_evidence_form(request, settings.max_file_bytes)
    try:
        prepared = await run_in_threadpool(
            _prepare_upload,
            session,
            task_id,
            user_id,
            request.headers.get("Idempotency-Key", ""),
            form,
        )
        if isinstance(prepared, JSONResponse):
            return prepared
        # 專用 limiter 在事件迴圈等候，排隊不借用任何 worker thread。
        return await to_thread.run_sync(
            _process_upload,
            session,
            task_id,
            user_id,
            prepared,
            limiter=_upload_limiter(settings.max_concurrent_uploads),
        )
    finally:
        await form.close()


def _prepare_mutation(
    session: Session, task_id: UUID, photo_id: UUID, user: User
) -> None:
    from app.services.evidence import authorize_photo_mutation

    authorize_photo_mutation(session, task_id, photo_id, user)
    # D18：驗權／狀態先於本文；等候本文時釋放登入 touch 與照片鎖。
    session.commit()
    # FEV-R12：commit 不清請求快取；跨本文等待後同一 Session 須重查。
    # 僅在照片 PATCH 的交易邊界清除，避免沿用等待期間撤回的權限。
    cache = get_request_effective_access_cache()
    if cache is not None:
        cache.clear()


@router.patch("/inspection-tasks/{task_id}/photos/{photo_id}")
async def patch_photo(
    task_id: UUID,
    photo_id: UUID,
    request: Request,
    session: Session = _db_dependency,
    user: User = _login_dependency,
) -> dict:
    """FEV-AC29：只改註記與對應，省略不變；拒絕狀態優先於本文。"""
    from app.services.evidence import mutate_photo

    await run_in_threadpool(
        _prepare_mutation, session, task_id, photo_id, user
    )
    chunks = bytearray()
    async for chunk in request.stream():
        chunks.extend(chunk)
        if len(chunks) > 64 * 1024:
            raise _invalid_request()
    try:
        raw = json.loads(chunks)
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise _invalid_request() from exc
    result = await run_in_threadpool(
        mutate_photo, session, task_id, photo_id, user, raw=raw
    )
    assert result is not None
    return result


@router.delete(
    "/inspection-tasks/{task_id}/photos/{photo_id}", status_code=204
)
def delete_photo(
    task_id: UUID,
    photo_id: UUID,
    session: Session = _db_dependency,
    user: User = _login_dependency,
):
    """FEV-R10：只軟刪除有效照片；完成、作廢與報告引用時拒絕。"""
    from fastapi import Response

    from app.services.evidence import mutate_photo

    mutate_photo(session, task_id, photo_id, user, delete_photo=True)
    return Response(status_code=204)
