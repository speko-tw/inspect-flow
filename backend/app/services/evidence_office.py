"""FEV-R03／R22：由不可變 FIELD 編修 OFFICE，保留來源與尺寸基準。"""

from __future__ import annotations

import hashlib
import logging
import math
from collections.abc import Callable
from contextlib import suppress
from copy import deepcopy
from datetime import datetime
from io import BytesIO
from uuid import UUID

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.db.clock import utc_now
from app.models import (
    Evidence,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
)
from app.services.evidence import _response
from app.services.evidence_images import (
    InvalidEvidenceImageError,
    fit_office_layer,
    inspect_jpeg,
    render_office,
)
from app.storage import LocalStorage, get_storage_settings
from app.storage.base import Storage

logger = logging.getLogger(__name__)

# FEV-AC15：報告模組尚未落地；以註冊介面接入引用檢查，不依賴報告表。
ReportChecker = Callable[[Session, Evidence], bool]
_report_checker: ReportChecker | None = None


def register_report_reference_checker(checker: ReportChecker | None) -> None:
    """FEV-AC15：報告模組啟動時登記；未登記視為尚未引用。"""
    global _report_checker
    _report_checker = checker


def _error(
    code: ErrorCode, status: int, reason: str | None = None
) -> APIError:
    return APIError(code, status, details=[reason] if reason else None)


def _invalid() -> APIError:
    return _error(ErrorCode.REQUEST_VALIDATION_FAILED, 422)


def _number(value: object) -> bool:
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        or isinstance(value, float)
        and math.isfinite(value)
    )


def normalize_layer(raw: object) -> dict:
    """FEV-R22：完整取代設定；null 覆寫等同移除，空字串仍是覆寫。"""
    keys = {
        "enabled",
        "corner",
        "offset_x",
        "offset_y",
        "size",
        "style",
        "overrides",
    }
    if not isinstance(raw, dict) or set(raw) != keys:
        raise _invalid()
    layer = dict(raw)
    if not isinstance(layer["enabled"], bool):
        raise _invalid()
    for key, allowed in {
        "corner": ("bottom_left", "bottom_right", "top_left", "top_right"),
        "size": ("small", "medium", "large"),
        "style": ("dark", "outline", "paper"),
    }.items():
        if not isinstance(layer[key], str) or layer[key] not in allowed:
            raise _invalid()
    for key in ("offset_x", "offset_y"):
        if not _number(layer[key]) or not -1 <= layer[key] <= 1:
            raise _invalid()
    overrides = layer["overrides"]
    if not isinstance(overrides, dict) or set(overrides) - {
        "project_name",
        "item_name",
        "inspection_location",
    }:
        raise _invalid()
    for value in overrides.values():
        if value is not None and (
            not isinstance(value, str) or len(value) > 1000
        ):
            raise _invalid()
    layer["overrides"] = {
        key: value for key, value in overrides.items() if value is not None
    }
    return layer


def normalize_edit(raw: object) -> tuple[dict, dict | None]:
    """FEV-D5／AC37：型別與未知鍵是欄位錯誤，影像範圍另行回報。"""
    if not isinstance(raw, dict) or set(raw) - {
        "rotation",
        "straighten",
        "crop",
        "brightness",
        "layer",
    }:
        raise _invalid()
    edit = {"rotation": 0, "straighten": 0, "crop": None, "brightness": 0}
    edit.update({key: value for key, value in raw.items() if key != "layer"})
    for key in ("rotation", "straighten", "brightness"):
        if not _number(edit[key]):
            raise _invalid()
    if (
        edit["rotation"] not in (0, 90, 180, 270)
        or not -15 <= edit["straighten"] <= 15
        or not -100 <= edit["brightness"] <= 100
    ):
        raise _error(ErrorCode.EVIDENCE_INVALID_EDIT, 422)
    crop = edit["crop"]
    if crop is not None:
        if (
            not isinstance(crop, dict)
            or set(crop)
            != {
                "x",
                "y",
                "width",
                "height",
            }
            or any(not _number(value) for value in crop.values())
        ):
            raise _invalid()
        if (
            not 0 <= crop["x"] <= 1
            or not 0 <= crop["y"] <= 1
            or not 0 < crop["width"] <= 1
            or not 0 < crop["height"] <= 1
            or crop["x"] + crop["width"] > 1
            or crop["y"] + crop["height"] > 1
        ):
            raise _error(ErrorCode.EVIDENCE_INVALID_EDIT, 422)
    layer = normalize_layer(raw["layer"]) if "layer" in raw else None
    return edit, layer


def transform_field(data: bytes, edit: dict) -> Image.Image | None:
    """FEV-AC37：順時針旋轉、雙線性拉直填滿、Q 裁切，最後調亮度。"""
    if edit == {
        "rotation": 0,
        "straighten": 0,
        "crop": None,
        "brightness": 0,
    }:
        return None
    with Image.open(BytesIO(data)) as opened:
        image = opened.convert("RGB")
    rotations = {
        90: Image.Transpose.ROTATE_270,
        180: Image.Transpose.ROTATE_180,
        270: Image.Transpose.ROTATE_90,
    }
    if edit["rotation"]:
        image = image.transpose(rotations[edit["rotation"]])
    width, height = image.size
    if edit["straighten"]:
        angle = math.radians(edit["straighten"])
        cosine, sine = math.cos(angle), math.sin(angle)
        scale = max(
            cosine + height / width * abs(sine),
            cosine + width / height * abs(sine),
        )
        # 螢幕座標 y 向下，反向採樣矩陣才能得到正值順時針。
        a, b = cosine / scale, sine / scale
        d, e = -sine / scale, cosine / scale
        image = image.transform(
            (width, height),
            Image.Transform.AFFINE,
            (
                a,
                b,
                width / 2 - a * width / 2 - b * height / 2,
                d,
                e,
                height / 2 - d * width / 2 - e * height / 2,
            ),
            Image.Resampling.BILINEAR,
        )
    if edit["crop"] is not None:
        crop = edit["crop"]
        left = math.floor(crop["x"] * width + 0.5)
        top = math.floor(crop["y"] * height + 0.5)
        right = math.floor((crop["x"] + crop["width"]) * width + 0.5)
        bottom = math.floor((crop["y"] + crop["height"]) * height + 0.5)
        if right - left < 64 or bottom - top < 64:
            raise _error(ErrorCode.EVIDENCE_INVALID_EDIT, 422)
        image = image.crop((left, top, right, bottom))
    if edit["brightness"]:
        factor = 1 + edit["brightness"] / 200
        table = [
            min(255, math.floor(value * factor + 0.5)) for value in range(256)
        ]
        image = image.point(table * 3)
    return image


def lock_photo(
    session: Session,
    task_id: UUID,
    photo_id: UUID,
    *,
    task_statuses: frozenset[str] = frozenset({"IN_PROGRESS", "COMPLETED"}),
) -> tuple[Evidence, EvidenceVariant, EvidenceVariant]:
    """FEV-D18：可見性先於封存／任務／照片鎖；與計畫轉換同序上鎖。"""
    reference = session.get(InspectionTask, task_id)
    if reference is None:
        raise _error(ErrorCode.RESOURCE_NOT_FOUND, 404)
    plan = session.scalar(
        select(InspectionPlan)
        .where(
            InspectionPlan.id == reference.plan_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    task = session.scalar(
        select(InspectionTask)
        .where(
            InspectionTask.id == task_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    photo = session.scalar(
        select(Evidence)
        .where(
            Evidence.id == photo_id,
            Evidence.task_id == task_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if task is None or photo is None or plan is None:
        raise _error(ErrorCode.RESOURCE_NOT_FOUND, 404)
    if plan.is_archived:
        raise _error(ErrorCode.INSPECTION_PLAN_ARCHIVED, 409)
    if task.status not in task_statuses:
        raise _error(ErrorCode.EVIDENCE_TASK_LOCKED, 409)
    reason = (
        "voided"
        if photo.voided_at
        else "referenced_by_report"
        if _report_checker is not None and _report_checker(session, photo)
        else "deleted"
        if photo.deleted_at
        else None
    )
    if reason:
        raise _error(ErrorCode.EVIDENCE_PHOTO_LOCKED, 409, reason)
    variants = {
        row.variant_type: row
        for row in session.scalars(
            select(EvidenceVariant)
            .where(
                EvidenceVariant.evidence_id == photo_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    }
    return photo, variants["FIELD"], variants["OFFICE"]


def resolved_labels(photo: Evidence) -> dict:
    """FEV-R22：只覆寫可更正的三欄，不變更人員與 UTC 來源時間。"""
    labels = dict(photo.label_source)
    keys = {
        "project_name": "project_name",
        "item_name": "item_title",
        "inspection_location": "location",
    }
    for key, value in (photo.label_layer.get("overrides") or {}).items():
        if key in keys and value is not None:
            labels[keys[key]] = value
    return labels


def photo_response(
    session: Session, photo: Evidence, *, can_read: bool
) -> dict:
    """FEV-R12／R27：管理不隱含讀取，現場回應不外洩 OFFICE metadata。"""
    body = _response(session, photo)
    body["labels"] = resolved_labels(photo)
    body["uploaded_by"] = {
        "name_zh": photo.uploader_snapshot.get("name_zh"),
        "is_me": False,
    }
    if not can_read:
        field = body.pop("variants")["field"]
        body.update(
            {
                key: field[key]
                for key in (
                    "width",
                    "height",
                    "byte_size",
                )
            }
        )
        return body
    captured = photo.captured_at
    uploaded = photo.created_at
    body["is_non_realtime_capture"] = (
        photo.capture_source == "library"
        or captured is None
        or abs((uploaded - captured).total_seconds()) > 600
    )
    body["has_layer_overrides"] = bool(photo.label_layer.get("overrides"))
    for key in ("voided_at", "void_reason", "deleted_at"):
        value = getattr(photo, key)
        body[key] = (
            value.isoformat().replace("+00:00", "Z")
            if isinstance(value, datetime)
            else value
        )
    for variant in session.scalars(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == photo.id,
        )
    ):
        body["variants"][variant.variant_type.lower()].update(
            {
                "edit_params": variant.edit_params,
                "edited_by": str(variant.edited_by)
                if variant.edited_by
                else None,
                "edited_at": (
                    variant.edited_at.isoformat().replace("+00:00", "Z")
                    if variant.edited_at
                    else None
                ),
            }
        )
    return body


def record_office_edit(
    session: Session,
    *,
    photo: Evidence,
    operator_id: UUID,
    before: dict,
    after: dict,
    reason: str,
    rule: dict,
) -> None:
    """FEV-R14／R24：每次套用必寫，圖層只在實際變動時寫完整快照。"""
    from app.services.audit import record_audit_event

    # ALG-R16：同參數重送也代表一次套用；維運依 D21 記系統 admin。
    record_audit_event(
        session,
        "evidence.office_version_edited",
        entity_id=photo.id,
        project_id=photo.project_id,
        before={
            "edit_params": before["edit_params"],
            "rule": before["rule"],
            "reason": None,
        },
        after={
            "edit_params": after["edit_params"],
            "rule": rule,
            "reason": reason,
        },
        system_event=reason == "label_rule_change",
    )
    if before["layer"] != after["layer"]:
        record_audit_event(
            session,
            "evidence.layer_updated",
            entity_id=photo.id,
            project_id=photo.project_id,
            before={key: before[key] for key in ("layer", "labels")},
            after={key: after[key] for key in ("layer", "labels")},
        )


def _snapshot(photo: Evidence, office: EvidenceVariant) -> dict:
    return deepcopy(
        {
            "layer": photo.label_layer,
            "labels": resolved_labels(
                photo,
            ),
            "edit_params": office.edit_params,
            "rule": office.label_rule,
        }
    )


def edit_office(
    session: Session,
    *,
    task_id: UUID,
    photo_id: UUID,
    operator_id: UUID,
    raw: object,
    maintenance: bool = False,
    storage: Storage | None = None,
) -> Evidence:
    """FEV-AC02／AC31：兩版原子切換；失敗恢復舊鍵與完整原資料。"""
    store = storage or LocalStorage(get_storage_settings().root)
    new_key = None
    old_removed = False
    committed = False
    old_key = None
    old_bytes: bytes | None = None
    try:
        # SQLite 無列鎖，必須先取得寫鎖，避免兩個取代者讀到同一舊鍵。
        # FEV-D4：否則後提交者會把先提交的新檔遺留為第三個檔案。
        if session.get_bind().dialect.name == "sqlite":
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        photo, field, office = lock_photo(session, task_id, photo_id)
        edit, supplied_layer = normalize_edit(raw)
        previous = _snapshot(photo, office)
        saved_layer = normalize_layer(photo.label_layer)
        layer = supplied_layer if supplied_layer is not None else saved_layer
        changed = layer != saved_layer
        with store.open(field.storage_key) as stream:
            field_bytes = stream.read()
        try:
            inspect_jpeg(field_bytes, get_storage_settings().max_decode_pixels)
        except InvalidEvidenceImageError as exc:
            raise _error(
                ErrorCode.EVIDENCE_INVALID_IMAGE, 422, str(exc)
            ) from exc
        image = transform_field(field_bytes, edit)
        if image is None:
            with Image.open(BytesIO(field_bytes)) as opened:
                size = opened.size
        else:
            size = image.size
        old_rule = office.label_rule or {}
        base = old_rule.get("base_size") or old_rule.get("effective_size")
        if base not in {"small", "medium", "large"}:
            with Image.open(BytesIO(field_bytes)) as opened:
                _, _, inferred = fit_office_layer(*opened.size, saved_layer)
            base = inferred or (
                saved_layer["size"] if not saved_layer["enabled"] else "small"
            )
        if changed and not maintenance:
            _, state, _ = fit_office_layer(*size, layer)
            if state not in {"applied", "disabled"}:
                raise _error(ErrorCode.EVIDENCE_INVALID_LAYER, 422)
            base = layer["size"]
        render_layer = dict(layer, size=base)
        data, rule = render_office(
            field_bytes,
            photo.label_source,
            render_layer,
            str(photo.id),
            image=image,
        )
        rule["base_size"] = base
        if rule["effective_size"] == "small" and layer["size"] != "small":
            rule["render_state"] = "fallback_small"
        old_key = office.storage_key
        # FEV-AC02／AC31：OFFICE 可由 FIELD 修復，遺失的舊檔無須備份。
        try:
            with store.open(old_key) as stream:
                old_bytes = stream.read()
        except FileNotFoundError:
            logger.warning(
                "evidence_office_missing_file evidence_id=%s", photo.id
            )
        new_key = store.save(BytesIO(data))
        photo.label_layer = layer
        photo.updated_by = operator_id
        office.storage_key = new_key
        office.sha256 = hashlib.sha256(data).hexdigest()
        office.byte_size = len(data)
        office.width, office.height = size
        office.edit_params = edit
        office.edited_by = operator_id
        office.updated_by = operator_id
        office.edited_at = utc_now()
        office.label_rule = rule
        session.flush()
        # SQLite 寫入鎖後重讀純量，避免沿用讀取期間的舊任務／照片狀態。
        fresh = session.execute(
            select(
                InspectionPlan.is_archived,
                InspectionTask.status,
                Evidence.voided_at,
                Evidence.deleted_at,
            )
            .join(InspectionTask, InspectionTask.plan_id == InspectionPlan.id)
            .join(Evidence, Evidence.task_id == InspectionTask.id)
            .where(Evidence.id == photo_id)
        ).one()
        if fresh[0]:
            raise _error(ErrorCode.INSPECTION_PLAN_ARCHIVED, 409)
        if fresh[1] not in {"IN_PROGRESS", "COMPLETED"}:
            raise _error(ErrorCode.EVIDENCE_TASK_LOCKED, 409)
        if (
            fresh[2]
            or fresh[3]
            or (_report_checker and _report_checker(session, photo))
        ):
            reason = (
                "voided"
                if fresh[2]
                else ("deleted" if fresh[3] else "referenced_by_report")
            )
            raise _error(ErrorCode.EVIDENCE_PHOTO_LOCKED, 409, reason)
        record_office_edit(
            session,
            photo=photo,
            operator_id=operator_id,
            before=previous,
            after=_snapshot(photo, office),
            rule=rule,
            reason="label_rule_change" if maintenance else "edit",
        )
        # FEV-D4：刪除失敗先回滾 DB；commit 失敗可由記憶體復原原鍵。
        with suppress(FileNotFoundError):
            store.delete(old_key)
        old_removed = True
        session.commit()
        committed = True
        return photo
    except BaseException:
        if not committed:
            session.rollback()
            try:
                if (
                    old_removed
                    and old_key is not None
                    and old_bytes is not None
                ):
                    store.restore(old_key, BytesIO(old_bytes))
            finally:
                if new_key is not None:
                    store.delete(new_key)
        raise
