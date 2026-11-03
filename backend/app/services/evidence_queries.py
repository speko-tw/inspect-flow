"""FEV-R04、R13：共用覆蓋計算與分批照片查詢，不含呼叫者權限。"""

from __future__ import annotations

import base64
import binascii
import json
from collections import defaultdict
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import encode_page_cursor, page_cursor_key
from app.api.time_format import format_utc
from app.models import (
    AuditLog,
    Evidence,
    EvidencePointLink,
    EvidenceVariant,
    InspectionTask,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotPoint,
)


def calculate_photo_coverage(db: Session, task_id: UUID) -> dict:
    """FEV-R04：依目前快照及穩定項次識別計數，供完成驗證沿用。"""
    rows = db.execute(
        select(TaskInspectionItem, TaskRequirementSnapshot)
        .join(
            TaskRequirementSnapshot,
            TaskRequirementSnapshot.task_inspection_item_id
            == TaskInspectionItem.id,
        )
        .where(
            TaskInspectionItem.task_id == task_id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
        .order_by(TaskInspectionItem.created_at, TaskInspectionItem.id)
    ).all()
    snapshot_ids = [snapshot.id for _, snapshot in rows]
    points = db.execute(
        select(TaskSnapshotPoint, TaskSnapshotEvidenceRequirement.min_count)
        .outerjoin(
            TaskSnapshotEvidenceRequirement,
            and_(
                TaskSnapshotEvidenceRequirement.point_id
                == TaskSnapshotPoint.id,
                TaskSnapshotEvidenceRequirement.evidence_type == "photo",
            ),
        )
        .where(TaskSnapshotPoint.snapshot_id.in_(snapshot_ids))
        .order_by(TaskSnapshotPoint.sequence, TaskSnapshotPoint.id)
    ).all()
    active = (
        Evidence.task_id == task_id,
        Evidence.deleted_at.is_(None),
        Evidence.voided_at.is_(None),
    )
    # 文字更正仍可沿用舊修訂照片，不能以 snapshot_revision 限縮（R04）。
    counts = {
        (item_id, point_id): count
        for item_id, point_id, count in db.execute(
            select(
                Evidence.task_inspection_item_id,
                EvidencePointLink.source_point_id,
                func.count(),
            )
            .join(
                EvidencePointLink, EvidencePointLink.evidence_id == Evidence.id
            )
            .where(*active, Evidence.is_overview.is_(False))
            .group_by(
                Evidence.task_inspection_item_id,
                EvidencePointLink.source_point_id,
            )
        )
    }
    overviews = dict(
        db.execute(
            select(Evidence.task_inspection_item_id, func.count())
            .where(*active, Evidence.is_overview.is_(True))
            .group_by(Evidence.task_inspection_item_id)
        ).all()
    )
    by_snapshot = defaultdict(list)
    for point, minimum in points:
        by_snapshot[point.snapshot_id].append((point, minimum or 1))
    items = []
    all_satisfied = True
    for item, snapshot in rows:
        rendered_points = []
        for point, minimum in by_snapshot[snapshot.id]:
            count = counts.get((item.id, point.source_point_id), 0)
            satisfied = count >= minimum
            all_satisfied = all_satisfied and satisfied
            rendered_points.append(
                {
                    "id": str(point.source_point_id),
                    "sequence": point.sequence,
                    "title": point.title,
                    "min_count": minimum,
                    "photo_count": count,
                    "missing_count": max(0, minimum - count),
                    "satisfied": satisfied,
                }
            )
        items.append(
            {
                "item_id": str(item.id),
                "title": snapshot.title,
                "overview_count": overviews.get(item.id, 0),
                "points": rendered_points,
            }
        )
    return {"items": items, "all_points_satisfied": all_satisfied}


def _encode_cursor(scope: dict, keys: list) -> str:
    payload = {"scope": scope, "keys": keys}
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str | None, scope: dict) -> list | None:
    if cursor is None:
        return None
    try:
        if len(cursor) > 4096:
            raise ValueError("cursor too long")
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw)
        if (
            not isinstance(payload, dict)
            or set(payload) != {"scope", "keys"}
            or payload["scope"] != scope
            or not isinstance(payload["keys"], list)
            or _encode_cursor(scope, payload["keys"]) != cursor
        ):
            raise ValueError("invalid cursor scope")
        return payload["keys"]
    except (ValueError, TypeError, binascii.Error, RecursionError) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


def _invalid_cursor() -> APIError:
    return APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)


def _resolved_labels(evidence: Evidence) -> dict:
    labels = dict(evidence.label_source)
    overrides = evidence.label_layer.get("overrides", {})
    for source, target in (
        ("project_name", "project_name"),
        ("item_name", "item_title"),
        ("inspection_location", "location"),
    ):
        if source in overrides:
            labels[target] = overrides[source]
    return labels


def serialize_photos(
    db: Session,
    photos: list[Evidence],
    *,
    user_id: UUID,
    office: bool,
    task: InspectionTask,
) -> list[dict]:
    """FEV-R13、R24：分批取兩版與對應，明列現場可見欄位。"""
    if not photos:
        return []
    identifiers = [photo.id for photo in photos]
    variants: dict[UUID, dict[str, EvidenceVariant]] = defaultdict(dict)
    for variant in db.scalars(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id.in_(identifiers)
        )
    ):
        variants[variant.evidence_id][variant.variant_type] = variant
    links: dict[UUID, list[str]] = defaultdict(list)
    for photo_id, point_id in db.execute(
        select(
            EvidencePointLink.evidence_id, EvidencePointLink.source_point_id
        )
        .where(EvidencePointLink.evidence_id.in_(identifiers))
        .order_by(EvidencePointLink.source_point_id)
    ):
        links[photo_id].append(str(point_id))
    result = []
    for photo in photos:
        versions = variants[photo.id]
        field = versions["FIELD"]
        rule = versions["OFFICE"].label_rule or {}
        data = {
            "id": str(photo.id),
            "item_id": str(photo.task_inspection_item_id),
            "is_overview": photo.is_overview,
            "point_ids": links[photo.id],
            "caption": photo.caption,
            "captured_at": (
                format_utc(photo.captured_at) if photo.captured_at else None
            ),
            "uploaded_at": format_utc(photo.created_at),
            "uploaded_by": {
                "name_zh": photo.uploader_snapshot["name_zh"],
                "is_me": photo.created_by == user_id,
            },
            "capture_source": photo.capture_source,
            "layer": photo.label_layer,
            "labels": _resolved_labels(photo),
            "layer_render": {
                key: rule.get(key)
                for key in ("render_state", "effective_size")
            },
            "width": field.width,
            "height": field.height,
            "byte_size": field.byte_size,
        }
        if office:
            data.update(
                {
                    "task_id": str(task.id),
                    "plan_id": str(task.plan_id),
                    "project_id": str(task.project_id),
                    "snapshot_revision": photo.snapshot_revision,
                    "uploader_snapshot": photo.uploader_snapshot,
                    "deleted_at": (
                        format_utc(photo.deleted_at)
                        if photo.deleted_at
                        else None
                    ),
                    "voided_at": (
                        format_utc(photo.voided_at)
                        if photo.voided_at
                        else None
                    ),
                    "void_reason": photo.void_reason,
                    "has_layer_overrides": bool(
                        photo.label_layer.get("overrides")
                    ),
                    "is_non_realtime_capture": (
                        photo.capture_source == "library"
                        or photo.captured_at is None
                        or abs(
                            (
                                photo.created_at - photo.captured_at
                            ).total_seconds()
                        )
                        > 600
                    ),
                    "variants": {
                        name.lower(): {
                            "width": variant.width,
                            "height": variant.height,
                            "byte_size": variant.byte_size,
                            "sha256": variant.sha256,
                            "edit_params": variant.edit_params,
                        }
                        for name, variant in versions.items()
                    },
                }
            )
        result.append(data)
    return result


def list_photos(
    db: Session,
    task: InspectionTask,
    *,
    user_id: UUID,
    office: bool,
    cursor: str | None,
    limit: int,
    item_id: UUID | None,
    voided: bool | None = None,
    deleted: bool | None = None,
) -> dict:
    """FEV-AC20：按項目、總覽優先、上傳時間與 UUID 穩定分頁。"""
    scope = {
        "kind": "office" if office else "field",
        "task": str(task.id),
        "item": str(item_id) if item_id else None,
        "voided": voided,
        "deleted": deleted,
    }
    overview_order = case((Evidence.is_overview.is_(True), 0), else_=1)
    columns = (
        TaskInspectionItem.created_at,
        TaskInspectionItem.id,
        overview_order,
        Evidence.created_at,
        Evidence.id,
    )
    statement = (
        select(Evidence, TaskInspectionItem.created_at)
        .join(
            TaskInspectionItem,
            TaskInspectionItem.id == Evidence.task_inspection_item_id,
        )
        .where(
            Evidence.task_id == task.id,
            Evidence.project_id == task.project_id,
            TaskInspectionItem.task_id == task.id,
            TaskInspectionItem.project_id == task.project_id,
        )
    )
    if item_id is not None:
        statement = statement.where(
            Evidence.task_inspection_item_id == item_id
        )
    for column, value in (
        (Evidence.voided_at, voided if office else False),
        (Evidence.deleted_at, deleted if office else False),
    ):
        if value is not None:
            statement = statement.where(
                column.is_not(None) if value else column.is_(None)
            )
    keys = _decode_cursor(cursor, scope)
    if keys is not None:
        if (
            len(keys) != 3
            or not isinstance(keys[0], str)
            or type(keys[1]) is not int
            or keys[1] not in (0, 1)
            or not isinstance(keys[2], str)
        ):
            raise _invalid_cursor()
        item_key = page_cursor_key(keys[0])
        photo_key = page_cursor_key(keys[2])
        assert item_key is not None and photo_key is not None
        values = (*item_key, keys[1], *photo_key)
        statement = statement.where(
            or_(
                *(
                    and_(
                        *(columns[j] == values[j] for j in range(i)),
                        columns[i] > values[i],
                    )
                    for i in range(len(columns))
                )
            )
        )
    rows = db.execute(statement.order_by(*columns).limit(limit + 1)).all()
    next_cursor = None
    if len(rows) > limit:
        last, item_created_at = rows[limit - 1]
        next_cursor = _encode_cursor(
            scope,
            [
                encode_page_cursor(
                    item_created_at, last.task_inspection_item_id
                ),
                0 if last.is_overview else 1,
                encode_page_cursor(last.created_at, last.id),
            ],
        )
    return {
        "items": serialize_photos(
            db,
            [row[0] for row in rows[:limit]],
            user_id=user_id,
            office=office,
            task=task,
        ),
        "next_cursor": next_cursor,
    }


def layer_history(
    db: Session,
    task: InspectionTask,
    photo: Evidence,
    *,
    cursor: str | None,
    limit: int,
) -> dict:
    """FEV-R24：只讀本照片的圖層事件，不擴張全域稽核入口。"""
    scope = {
        "kind": "layer_history",
        "task": str(task.id),
        "photo": str(photo.id),
        "project": str(task.project_id),
    }
    statement = select(AuditLog).where(
        AuditLog.project_id == task.project_id,
        AuditLog.entity_type == "evidence",
        AuditLog.entity_id == photo.id,
        AuditLog.event_type == "evidence.layer_updated",
    )
    keys = _decode_cursor(cursor, scope)
    if keys is not None:
        if len(keys) != 1 or not isinstance(keys[0], str):
            raise _invalid_cursor()
        key = page_cursor_key(keys[0])
        assert key is not None
        statement = statement.where(
            or_(
                AuditLog.created_at < key[0],
                and_(AuditLog.created_at == key[0], AuditLog.id < key[1]),
            )
        )
    rows = list(
        db.scalars(
            statement.order_by(
                AuditLog.created_at.desc(), AuditLog.id.desc()
            ).limit(limit + 1)
        )
    )
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = _encode_cursor(
            scope, [encode_page_cursor(last.created_at, last.id)]
        )
    return {
        "items": [
            {
                "id": str(row.id),
                "actor": {
                    "id": str(row.created_by) if row.created_by else None,
                    "snapshot": row.actor_snapshot,
                },
                "occurred_at": format_utc(row.created_at),
                "before": row.before,
                "after": row.after,
            }
            for row in rows[:limit]
        ],
        "next_cursor": next_cursor,
    }
