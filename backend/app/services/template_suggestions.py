"""TPL-R29～R36：提議人的建議、不可變修訂與狀態交易。"""

import base64
import binascii
import hashlib
import json
from copy import deepcopy
from typing import Any
from uuid import UUID

from pydantic import ValidationError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.errors import APIError, ErrorCode, FieldErrorCode
from app.api.pagination import encode_page_cursor, page_cursor_key
from app.api.time_format import format_utc
from app.db.base import uuid7
from app.models import (
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
    TemplateSuggestion,
    TemplateSuggestionReview,
    TemplateSuggestionRevision,
    TemplateSuggestionTransition,
)
from app.services.audit import record_audit_event
from app.services.batch_load import load_grouped
from app.services.inspection_planning import project_permissions_for
from app.services.operator import get_current_operator
from app.services.template_library import (
    InvalidTemplateError,
    validate_template_structure,
)
from app.template_structure import TemplateBody


def _invalid(path: str = "/content") -> APIError:
    return APIError(
        ErrorCode.REQUEST_VALIDATION_FAILED,
        422,
        fields=[{"path": path, "code": FieldErrorCode.INVALID.value}],
    )


def validate_content(content: dict, *, complete: bool) -> dict:
    """沿用 T15 的快照白名單；送審另重用 TPL-R11 完整結構驗證。"""
    try:
        result = TemplateSuggestionRevision(content=content).content
        # JSON 的 NaN 不是可攜的快照，兩種資料庫使用相同雜湊輸入。
        content_hash(result)
    except (ValueError, TypeError, OverflowError) as exc:
        raise _invalid() from exc
    if not complete:
        return result
    try:
        legacy = deepcopy(result)
        for point in legacy.get("inspection_points", []):
            point.pop("logical_id")
            for field in point.get("measurement_fields", []):
                field["client_id"] = field.pop("logical_id")
                order = field.pop("sort_order", 0)
                if type(order) is not int or order < 0:
                    raise ValueError("invalid field order")
            numeric = point.get("numeric_standard")
            if numeric is not None:
                numeric["measurement_field_client_id"] = numeric.pop(
                    "measurement_field_logical_id"
                )
            for requirement in point.get("evidence_requirements", []):
                if (
                    requirement.pop("evidence_type", "photo") != "photo"
                    or requirement.pop("required", True) is not True
                    or requirement.pop("max_count", None) is not None
                ):
                    raise ValueError("invalid photo requirement")
        parsed = TemplateBody.model_validate(
            {"system_id": UUID(int=0), "sequence": 1, **legacy}
        )
        data = parsed.model_dump(mode="json")
        validate_template_structure(data, path_prefix="/content")
    except ValidationError as exc:
        fields = []
        for error in exc.errors():
            parts = [str(part) for part in error["loc"]]
            parts = [
                "logical_id"
                if part == "client_id"
                else "measurement_field_logical_id"
                if part == "measurement_field_client_id"
                else part
                for part in parts
            ]
            fields.append(
                {
                    "path": "/content/" + "/".join(parts),
                    "code": FieldErrorCode.INVALID.value,
                }
            )
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED, 422, fields=fields
        ) from exc
    except InvalidTemplateError as exc:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            fields=[
                {
                    "path": error.path.replace(
                        "measurement_field_client_id",
                        "measurement_field_logical_id",
                    ).replace("/client_id", "/logical_id"),
                    "code": error.code,
                }
                for error in exc.fields
            ],
        ) from exc
    except (ValueError, KeyError, TypeError) as exc:
        raise _invalid() from exc
    # TPL-R32：完整驗證不改寫已保存版本；只用於驗證、初次正規化。
    result["title"] = data["title"]
    result["instruction"] = data["instruction"]
    for source, normalized in zip(
        result.get("inspection_points", []),
        data["inspection_points"],
        strict=True,
    ):
        source.update(
            {
                key: normalized[key]
                for key in (
                    "sequence",
                    "title",
                    "instruction",
                    "text_standard",
                )
            }
        )
        numeric = normalized["numeric_standard"]
        if numeric is not None:
            numeric["measurement_field_logical_id"] = numeric.pop(
                "measurement_field_client_id"
            )
        source["numeric_standard"] = numeric
        for index, (field, normalized_field) in enumerate(
            zip(
                source.get("measurement_fields", []),
                normalized["measurement_fields"],
                strict=True,
            )
        ):
            normalized_field.pop("client_id")
            field.update(normalized_field)
            field.setdefault("sort_order", index)
        source.setdefault("measurement_fields", [])
        for requirement, normalized_requirement in zip(
            source["evidence_requirements"],
            normalized["evidence_requirements"],
            strict=True,
        ):
            requirement.update(normalized_requirement)
            requirement.update(
                evidence_type="photo", required=True, max_count=None
            )
    result.setdefault("inspection_points", [])
    return result


def content_hash(content: dict) -> str:
    """TPL-R32：鍵順序不構成修訂，結構陣列順序仍保留比較意義。"""
    return hashlib.sha256(
        json.dumps(
            content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    ).hexdigest()


def _write_lock(db: Session) -> None:
    # db-dependency: sqlite。HTTP 驗證已 flush 登入時間而持有寫鎖；
    # 非 HTTP 呼叫尚未開始實體交易時，先取得寫鎖，避免讀完來源才競寫。
    # 所有 SQL 仍經 SQLAlchemy；不修改來源欄位來模擬鎖。
    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        driver = connection.connection.driver_connection
        if not getattr(driver, "in_transaction", False):
            connection.exec_driver_sql("BEGIN IMMEDIATE")


def _require_edit(db: Session, project_id: UUID) -> None:
    # AUT-R19、TPL-R29：重用兩層授權，不以範本管理權或委派替代專案角色。
    if "project_inspection_item.edit" not in project_permissions_for(
        db, project_id
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)


def _owned(db: Session, suggestion_id: UUID, *, lock: bool = False):
    actor = get_current_operator(db)
    statement = select(TemplateSuggestion).where(
        TemplateSuggestion.id == suggestion_id
    )
    # KD-69：Admin 放行；一般人只能查自己的件，避免以 ID 探查他人內容。
    if not actor.is_admin:
        statement = statement.where(TemplateSuggestion.proposer_id == actor.id)
    if lock:
        _write_lock(db)
        statement = statement.with_for_update().execution_options(
            populate_existing=True
        )
    row = db.scalar(statement)
    if row is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return row


def _expected(row, revision_id: UUID, status: str) -> None:
    if row.current_revision_id != revision_id or row.status != status:
        raise APIError(ErrorCode.TEMPLATE_SUGGESTION_CHANGED, 409)


def _state(row, allowed: set[str]) -> None:
    if row.status not in allowed:
        raise APIError(ErrorCode.TEMPLATE_SUGGESTION_INVALID_STATE, 409)


def capture_source(db: Session, project_id: UUID, item_id: UUID):
    """TPL-AC34：持有既有來源共享鎖後才讀所有結構，不碰現場資料。"""
    source = db.scalar(
        select(ProjectInspectionItem)
        .where(
            ProjectInspectionItem.id == item_id,
            ProjectInspectionItem.project_id == project_id,
        )
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    if source is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    if not source.is_active:
        raise APIError(ErrorCode.PROJECT_INSPECTION_ITEM_INACTIVE, 409)
    project = db.get(Project, project_id)
    if project is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    points = db.scalars(
        select(ProjectInspectionPoint)
        .where(ProjectInspectionPoint.project_inspection_item_id == source.id)
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    ids = [point.id for point in points]
    fields = load_grouped(
        db,
        ProjectMeasurementField.inspection_point_id,
        ids,
        ProjectMeasurementField.sort_order,
        ProjectMeasurementField.id,
    )
    texts = load_grouped(db, ProjectTextStandard.inspection_point_id, ids)
    numerics = load_grouped(
        db, ProjectNumericStandard.inspection_point_id, ids
    )
    requirements = load_grouped(
        db,
        ProjectEvidenceRequirement.inspection_point_id,
        ids,
        ProjectEvidenceRequirement.created_at,
        ProjectEvidenceRequirement.id,
    )
    content: dict[str, Any] = {
        "title": source.title,
        "instruction": source.instruction,
        "inspection_points": [],
    }
    for point in points:
        point_fields = fields.get(point.id, [])
        field_ids = {field.id: str(uuid7()) for field in point_fields}
        text_row = next(iter(texts.get(point.id, [])), None)
        numeric = next(iter(numerics.get(point.id, [])), None)
        numeric_data = None
        if numeric is not None:
            numeric_data = {
                key: getattr(numeric, key)
                for key in (
                    "value",
                    "condition",
                    "unit",
                    "tolerance",
                    "range_form",
                    "lower_bound",
                    "upper_bound",
                )
            }
            numeric_data["measurement_field_logical_id"] = field_ids[
                numeric.measurement_field_id
            ]
        content["inspection_points"].append(
            {
                "logical_id": str(uuid7()),
                "sequence": point.sequence,
                "title": point.title,
                "instruction": point.instruction,
                "text_standard": {"text": text_row.text} if text_row else None,
                "numeric_standard": numeric_data,
                "measurement_fields": [
                    {
                        "logical_id": field_ids[field.id],
                        "name": field.name,
                        "field_type": field.field_type,
                        "sort_order": field.sort_order,
                        "unit": None
                        if numeric is not None
                        and numeric.measurement_field_id == field.id
                        else field.unit,
                    }
                    for field in point_fields
                ],
                "evidence_requirements": [
                    {
                        "evidence_type": requirement.evidence_type,
                        "required": requirement.required,
                        "min_count": requirement.min_count,
                        "max_count": requirement.max_count,
                    }
                    for requirement in requirements.get(point.id, [])
                ],
            }
        )
    return source, project, validate_content(content, complete=True)


def _transition(db: Session, row, revision, before: str | None, after: str):
    # TPL-R35：AuditLog.id 與版本的關聯由不可變狀態歷程保存。
    actor = get_current_operator(db)
    event = (
        "template_suggestion.submitted"
        if after == "PENDING"
        else ("template_suggestion.withdrawn")
    )
    payload = {"status": after}
    if before is None:
        payload.update(
            proposer_id=row.proposer_id,
            source_project_id=row.source_project_original_id,
            source_item_id=row.source_item_original_id,
            revision_id=revision.id,
            content_sha256=revision.content_sha256,
        )
    log = record_audit_event(
        db,
        event,
        entity_id=row.id,
        before={"status": before} if before is not None else None,
        after=payload,
        project_id=row.source_project_original_id,
    )
    db.add(
        TemplateSuggestionTransition(
            suggestion_id=row.id,
            revision_id=revision.id,
            from_status=before,
            to_status=after,
            audit_log_id=log.id,
            created_by=actor.id,
            updated_by=actor.id,
        )
    )
    db.flush()


def propose(db: Session, project_id: UUID, item_id: UUID):
    """TPL-R29：複製、首次修訂、送審歷程與稽核在呼叫端同一交易完成。"""
    _write_lock(db)
    _require_edit(db, project_id)
    source, project, content = capture_source(db, project_id, item_id)
    actor = get_current_operator(db)
    revision_id = uuid7()
    row = TemplateSuggestion(
        id=uuid7(),
        proposer_id=actor.id,
        source_project_id=project.id,
        source_item_id=source.id,
        source_project_original_id=project.id,
        source_item_original_id=source.id,
        source_project_name=project.name,
        source_item_title=source.title,
        current_revision_id=revision_id,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(row)
    db.flush()
    revision = TemplateSuggestionRevision(
        id=revision_id,
        suggestion_id=row.id,
        revision_no=1,
        content=content,
        content_sha256=content_hash(content),
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(revision)
    db.flush()
    _transition(db, row, revision, None, "PENDING")
    return row


def revise(
    db: Session,
    suggestion_id: UUID,
    content: dict,
    expected_revision_id: UUID,
    expected_status: str,
):
    """TPL-R31、R32：本人只編輯退回件，無變更沿用原版且不留事件。"""
    row = _owned(db, suggestion_id, lock=True)
    _require_edit(db, row.source_project_original_id)
    _expected(row, expected_revision_id, expected_status)
    _state(row, {"RETURNED"})
    current = db.get(TemplateSuggestionRevision, row.current_revision_id)
    assert current is not None
    normalized = validate_content(content, complete=False)
    digest = content_hash(normalized)
    if digest == current.content_sha256 and normalized == current.content:
        return row, False
    actor = get_current_operator(db)
    revision = TemplateSuggestionRevision(
        suggestion_id=row.id,
        revision_no=current.revision_no + 1,
        based_on_revision_id=current.id,
        content=normalized,
        content_sha256=digest,
        created_by=actor.id,
        updated_by=actor.id,
    )
    db.add(revision)
    db.flush()
    row.current_revision_id = revision.id
    row.updated_by = actor.id
    record_audit_event(
        db,
        "template_suggestion.revised",
        entity_id=row.id,
        before={
            "revision_id": current.id,
            "content_sha256": current.content_sha256,
        },
        after={"revision_id": revision.id, "content_sha256": digest},
        project_id=row.source_project_original_id,
    )
    db.flush()
    return row, True


def submit(
    db: Session,
    suggestion_id: UUID,
    expected_revision_id: UUID,
    expected_status: str,
):
    """TPL-R31：退回後必須已有新版本，送審只追加狀態而不改寫版本。"""
    row = _owned(db, suggestion_id, lock=True)
    _require_edit(db, row.source_project_original_id)
    _expected(row, expected_revision_id, expected_status)
    _state(row, {"RETURNED"})
    revision = db.get(TemplateSuggestionRevision, row.current_revision_id)
    assert revision is not None
    returned_no = db.scalar(
        select(func.max(TemplateSuggestionRevision.revision_no))
        .join(
            TemplateSuggestionReview,
            and_(
                TemplateSuggestionReview.revision_id
                == TemplateSuggestionRevision.id,
                TemplateSuggestionReview.suggestion_id == row.id,
                TemplateSuggestionReview.decision == "RETURNED",
            ),
        )
        .where(TemplateSuggestionRevision.suggestion_id == row.id)
    )
    if returned_no is None or revision.revision_no <= returned_no:
        raise APIError(ErrorCode.TEMPLATE_SUGGESTION_INVALID_STATE, 409)
    validate_content(revision.content, complete=True)
    row.status = "PENDING"
    row.updated_by = get_current_operator(db).id
    _transition(db, row, revision, "RETURNED", "PENDING")
    return row


def withdraw(
    db: Session,
    suggestion_id: UUID,
    expected_revision_id: UUID,
    expected_status: str,
):
    """TPL-R36：本人失去來源權限或來源刪除後，仍能撤回非終止件。"""
    row = _owned(db, suggestion_id, lock=True)
    _expected(row, expected_revision_id, expected_status)
    _state(row, {"PENDING", "RETURNED"})
    revision = db.get(TemplateSuggestionRevision, row.current_revision_id)
    assert revision is not None
    before = row.status
    row.status = "WITHDRAWN"
    row.updated_by = get_current_operator(db).id
    _transition(db, row, revision, before, "WITHDRAWN")
    return row


def _review_data(row) -> dict:
    return {
        key: getattr(row, key)
        for key in (
            "id",
            "revision_id",
            "decision",
            "reason",
            "approved_template_id",
            "approved_template_title",
            "target_category_id",
            "target_category_name",
            "target_system_id",
            "target_system_name",
        )
    } | {
        "reviewer_id": row.created_by,
        "reviewed_at": format_utc(row.created_at),
    }


def _summaries(
    db: Session, rows, *, include_content: bool = False
) -> list[dict]:
    revisions = (
        {
            revision.id: revision
            for revision in db.scalars(
                select(TemplateSuggestionRevision).where(
                    TemplateSuggestionRevision.id.in_(
                        [row.current_revision_id for row in rows]
                    )
                )
            )
        }
        if rows
        else {}
    )
    # TPL-R34：清單只載入最新原因與核准摘要，不隨歷史版數無限展開。
    ranked = (
        select(
            TemplateSuggestionReview.id,
            func.row_number()
            .over(
                partition_by=(
                    TemplateSuggestionReview.suggestion_id,
                    TemplateSuggestionReview.decision,
                ),
                order_by=(
                    TemplateSuggestionReview.created_at.desc(),
                    TemplateSuggestionReview.id.desc(),
                ),
            )
            .label("position"),
        )
        .where(
            TemplateSuggestionReview.suggestion_id.in_(
                [row.id for row in rows]
            )
        )
        .subquery()
    )
    reviews: dict[UUID, list] = {}
    for review in db.scalars(
        select(TemplateSuggestionReview)
        .join(ranked, ranked.c.id == TemplateSuggestionReview.id)
        .where(ranked.c.position == 1)
    ):
        reviews.setdefault(review.suggestion_id, []).append(review)
    result = []
    for row in rows:
        revision = revisions[row.current_revision_id]
        all_reviews = reviews.get(row.id, [])
        latest_return = next(
            (r for r in reversed(all_reviews) if r.decision == "RETURNED"),
            None,
        )
        approval = next(
            (r for r in all_reviews if r.decision == "APPROVED"), None
        )
        data = {
            "id": row.id,
            "proposer_id": row.proposer_id,
            "source_project_id": row.source_project_original_id,
            "source_item_id": row.source_item_original_id,
            "source_project_name": row.source_project_name,
            "source_item_title": row.source_item_title,
            "status": row.status,
            "current_revision_id": revision.id,
            "revision_no": revision.revision_no,
            "content_sha256": revision.content_sha256,
            "return_reason": latest_return.reason if latest_return else None,
            "latest_review": _review_data(
                max(all_reviews, key=lambda r: (r.created_at, r.id))
            )
            if all_reviews
            else None,
            "approval": _review_data(approval) if approval else None,
            "approved_template_id": row.approved_template_id,
            "first_submitted_at": format_utc(row.first_submitted_at),
            "created_at": format_utc(row.created_at),
            "updated_at": format_utc(row.updated_at),
        }
        if include_content:
            data["content"] = revision.content
        result.append(data)
    return result


def detail(db: Session, suggestion_id: UUID) -> dict:
    """TPL-R36：只提供本人／Admin 的歷史快照，不重讀來源項目。"""
    return _summaries(db, [_owned(db, suggestion_id)], include_content=True)[0]


def list_mine(
    db: Session,
    *,
    cursor: str | None,
    limit: int,
    status: str | None,
    source_project_id: UUID | None,
) -> dict:
    """TPL-R34：件數按篩選計算，不受 cursor 影響；Admin 亦只列自己。"""
    filters = [TemplateSuggestion.proposer_id == get_current_operator(db).id]
    if status is not None:
        filters.append(TemplateSuggestion.status == status)
    if source_project_id is not None:
        filters.append(
            TemplateSuggestion.source_project_original_id == source_project_id
        )
    total = db.scalar(
        select(func.count()).select_from(TemplateSuggestion).where(*filters)
    )
    key = page_cursor_key(cursor)
    statement = select(TemplateSuggestion).where(*filters)
    if key is not None:
        statement = statement.where(
            or_(
                TemplateSuggestion.created_at < key[0],
                and_(
                    TemplateSuggestion.created_at == key[0],
                    TemplateSuggestion.id < key[1],
                ),
            )
        )
    rows = db.scalars(
        statement.order_by(
            TemplateSuggestion.created_at.desc(), TemplateSuggestion.id.desc()
        ).limit(limit + 1)
    ).all()
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        next_cursor = encode_page_cursor(page[-1].created_at, page[-1].id)
    return {
        "items": _summaries(db, page),
        "next_cursor": next_cursor,
        "total_count": total,
    }


def _revision_cursor(
    suggestion_id: UUID, number: int, identifier: UUID
) -> str:
    data = json.dumps(
        {
            "suggestion_id": str(suggestion_id),
            "n": number,
            "id": str(identifier),
        },
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(data.encode()).decode().rstrip("=")


def revisions(
    db: Session, suggestion_id: UUID, *, cursor: str | None, limit: int
) -> dict:
    """TPL-R32：依版本遞增分頁，批次附上各版的狀態、審核與操作者。"""
    row = _owned(db, suggestion_id)
    statement = select(TemplateSuggestionRevision).where(
        TemplateSuggestionRevision.suggestion_id == row.id
    )
    if cursor is not None:
        try:
            data = json.loads(
                base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
            )
            number, identifier = data["n"], UUID(data["id"])
            if (
                type(number) is not int
                # 版本欄位沿用 PostgreSQL Integer；先擋不可能由伺服器發出的
                # 游標，避免 SQLite／PostgreSQL 在綁定巨大整數時回 500。
                or not 1 <= number <= 2**31 - 1
                or _revision_cursor(row.id, number, identifier) != cursor
            ):
                raise ValueError("invalid revision cursor")
        except (
            ValueError,
            TypeError,
            KeyError,
            AttributeError,
            UnicodeDecodeError,
            binascii.Error,
        ) as exc:
            # API-R14：游標來自 query，不把它當成 JSON 本文欄位錯誤。
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
        statement = statement.where(
            or_(
                TemplateSuggestionRevision.revision_no > number,
                and_(
                    TemplateSuggestionRevision.revision_no == number,
                    TemplateSuggestionRevision.id > identifier,
                ),
            )
        )
    rows = db.scalars(
        statement.order_by(
            TemplateSuggestionRevision.revision_no,
            TemplateSuggestionRevision.id,
        ).limit(limit + 1)
    ).all()
    page = rows[:limit]
    ids = [revision.id for revision in page]
    reviews = load_grouped(
        db,
        TemplateSuggestionReview.revision_id,
        ids,
        TemplateSuggestionReview.created_at,
        TemplateSuggestionReview.id,
    )
    transitions = load_grouped(
        db,
        TemplateSuggestionTransition.revision_id,
        ids,
        TemplateSuggestionTransition.created_at,
        TemplateSuggestionTransition.id,
    )
    prior = aliased(TemplateSuggestionRevision)
    latest_state = (
        select(TemplateSuggestionTransition.to_status)
        .join(prior, prior.id == TemplateSuggestionTransition.revision_id)
        .where(
            TemplateSuggestionTransition.suggestion_id == row.id,
            prior.revision_no <= TemplateSuggestionRevision.revision_no,
        )
        .order_by(
            prior.revision_no.desc(),
            TemplateSuggestionTransition.created_at.desc(),
            TemplateSuggestionTransition.id.desc(),
        )
        .limit(1)
        .correlate(TemplateSuggestionRevision)
        .scalar_subquery()
    )
    states = (
        dict(
            db.execute(
                select(TemplateSuggestionRevision.id, latest_state).where(
                    TemplateSuggestionRevision.id.in_(ids)
                )
            ).all()
        )
        if ids
        else {}
    )
    items = []
    for revision in page:
        items.append(
            {
                "id": revision.id,
                "suggestion_id": row.id,
                "revision_no": revision.revision_no,
                "based_on_revision_id": revision.based_on_revision_id,
                "content": revision.content,
                "content_sha256": revision.content_sha256,
                "editor_id": revision.created_by,
                "created_at": format_utc(revision.created_at),
                "status": states.get(revision.id),
                "reviews": [
                    _review_data(r) for r in reviews.get(revision.id, [])
                ],
                "transitions": [
                    {
                        "from_status": t.from_status,
                        "to_status": t.to_status,
                        "operator_id": t.created_by,
                        "created_at": format_utc(t.created_at),
                        "review_id": t.review_id,
                        "audit_log_id": t.audit_log_id,
                    }
                    for t in transitions.get(revision.id, [])
                ],
            }
        )
    next_cursor = (
        _revision_cursor(row.id, page[-1].revision_no, page[-1].id)
        if len(rows) > limit
        else None
    )
    return {"items": items, "next_cursor": next_cursor}
