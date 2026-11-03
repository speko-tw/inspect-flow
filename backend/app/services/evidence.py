"""FEV-R01、R03、R06、R07：驗證並原子保存照片的兩個版本。"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from io import BytesIO
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.db.base import uuid7
from app.db.clock import utc_now
from app.models import (
    Company,
    Evidence,
    EvidencePointLink,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectZone,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
    User,
)
from app.services.evidence_images import (
    InvalidEvidenceImageError,
    inspect_jpeg,
    render_office,
)
from app.services.evidence_labels import build_label_source
from app.storage import LocalStorage, get_storage_settings

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def _api_error(
    code: ErrorCode, status: int, reason: str | None = None
) -> APIError:
    return APIError(
        code,
        status,
        details=[reason] if reason else None,
    )


def _request_fingerprint(
    *,
    sha256: str,
    item_id: UUID,
    is_overview: bool,
    point_ids: list[UUID],
    caption: str | None,
    captured_at: datetime | None,
    field_edit: dict | None,
    layer: dict,
    capture_source: str,
) -> str:
    payload = {
        "sha256": sha256,
        "item_id": str(item_id),
        "is_overview": is_overview,
        "point_ids": sorted(str(value) for value in point_ids),
        "caption": caption,
        "captured_at": captured_at.isoformat() if captured_at else None,
        "field_edit": field_edit,
        "layer": layer,
        "capture_source": capture_source,
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _response(session: Session, evidence: Evidence) -> dict:
    variants = list(
        session.scalars(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == evidence.id
            )
        )
    )
    links = list(
        session.scalars(
            select(EvidencePointLink).where(
                EvidencePointLink.evidence_id == evidence.id
            )
        )
    )
    field_variant = next(
        variant for variant in variants if variant.variant_type == "FIELD"
    )
    office_variant = next(
        variant for variant in variants if variant.variant_type == "OFFICE"
    )
    rule = office_variant.label_rule or {}
    return {
        "id": str(evidence.id),
        "task_id": str(evidence.task_id),
        "item_id": str(evidence.task_inspection_item_id),
        "is_overview": evidence.is_overview,
        "point_ids": [str(link.source_point_id) for link in links],
        "caption": evidence.caption,
        "captured_at": (
            evidence.captured_at.isoformat().replace("+00:00", "Z")
            if evidence.captured_at
            else None
        ),
        "uploaded_at": evidence.created_at.isoformat().replace("+00:00", "Z"),
        "capture_source": evidence.capture_source,
        "layer": evidence.label_layer,
        "labels": evidence.label_source,
        "layer_render": {
            key: rule.get(key) for key in ("render_state", "effective_size")
        },
        "variants": {
            "field": {
                "sha256": field_variant.sha256,
                "byte_size": field_variant.byte_size,
                "width": field_variant.width,
                "height": field_variant.height,
            },
            "office": {
                "sha256": office_variant.sha256,
                "byte_size": office_variant.byte_size,
                "width": office_variant.width,
                "height": office_variant.height,
            },
        },
    }


def check_invalid_replay(
    session: Session, task_id: UUID, upload_key: UUID, uploader_id: UUID
) -> dict | None:
    """FEV-R07：無法產生 canonical 指紋時，仍拒絕重用既有鍵。"""
    existing = session.scalar(
        select(Evidence).where(
            Evidence.task_id == task_id,
            Evidence.upload_key == upload_key,
        )
    )
    if existing is None:
        return None
    if existing.created_by != uploader_id:
        raise _api_error(ErrorCode.EVIDENCE_IDEMPOTENCY_CONFLICT, 409)
    if existing.deleted_at is not None:
        raise _api_error(ErrorCode.EVIDENCE_PHOTO_DELETED, 409)
    raise _api_error(ErrorCode.EVIDENCE_IDEMPOTENCY_CONFLICT, 409)


def validate_upload_state(
    session: Session,
    task_id: UUID,
    item_id: UUID | None,
    point_ids: list[UUID] | None,
) -> None:
    """FEV-R03/R21：重放後依序鎖定並檢查計畫、任務與快照。"""
    task = session.scalar(
        select(InspectionTask)
        .where(InspectionTask.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if task is None:
        raise _api_error(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    plan = session.scalar(
        select(InspectionPlan)
        .where(InspectionPlan.id == task.plan_id)
        .execution_options(populate_existing=True)
    )
    if plan is None:
        raise _api_error(ErrorCode.INSPECTION_PLAN_NOT_FOUND, 404)
    if plan.is_archived:
        raise _api_error(ErrorCode.INSPECTION_PLAN_ARCHIVED, 409)
    if task.status != "IN_PROGRESS":
        raise _api_error(ErrorCode.EVIDENCE_TASK_LOCKED, 409)
    if item_id is None:
        return
    item = session.scalar(
        select(TaskInspectionItem)
        .where(
            TaskInspectionItem.id == item_id,
            TaskInspectionItem.task_id == task_id,
            TaskInspectionItem.project_id == task.project_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise _api_error(ErrorCode.EVIDENCE_INVALID_TARGET, 422)
    snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    if snapshot is None:
        raise _api_error(ErrorCode.EVIDENCE_REQUIREMENT_CHANGED, 409)
    if not point_ids:
        return
    found = set(
        session.scalars(
            select(TaskSnapshotPoint.source_point_id).where(
                TaskSnapshotPoint.snapshot_id == snapshot.id,
                TaskSnapshotPoint.source_point_id.in_(point_ids),
            )
        )
    )
    if found == set(point_ids):
        return
    stale_ids = set(point_ids) - found
    was_in_prior_snapshot = session.scalar(
        select(TaskSnapshotPoint.source_point_id)
        .join(
            TaskRequirementSnapshot,
            TaskRequirementSnapshot.id == TaskSnapshotPoint.snapshot_id,
        )
        .where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(False),
            TaskSnapshotPoint.source_point_id.in_(stale_ids),
        )
        .limit(1)
    )
    if was_in_prior_snapshot is not None:
        raise _api_error(ErrorCode.EVIDENCE_REQUIREMENT_CHANGED, 409)
    raise _api_error(ErrorCode.EVIDENCE_INVALID_TARGET, 422)


def replay_upload(
    session: Session,
    task_id: UUID,
    upload_key: UUID,
    fingerprint: str,
    uploader_id: UUID,
) -> dict | None:
    """FEV-R07：權限已確認後，依完整指紋處理冪等重放。"""
    existing = session.scalar(
        select(Evidence).where(
            Evidence.task_id == task_id,
            Evidence.upload_key == upload_key,
        )
    )
    if existing is None:
        return None
    if existing.created_by != uploader_id:
        raise _api_error(ErrorCode.EVIDENCE_IDEMPOTENCY_CONFLICT, 409)
    if existing.deleted_at is not None:
        raise _api_error(ErrorCode.EVIDENCE_PHOTO_DELETED, 409)
    if existing.request_fingerprint != fingerprint:
        raise _api_error(ErrorCode.EVIDENCE_IDEMPOTENCY_CONFLICT, 409)
    return _response(session, existing)


def upload_evidence(
    session: Session,
    *,
    task_id: UUID,
    upload_key: UUID,
    sha256: str,
    item_id: UUID,
    is_overview: bool,
    point_ids: list[UUID],
    caption: str | None,
    captured_at: datetime | None,
    field_edit: dict | None,
    layer: dict,
    capture_source: str,
    content: bytes,
    uploader: User,
) -> tuple[dict, bool]:
    """FEV-R03：驗證快照後寫兩版影像，任一失敗就清理所有檔案。"""
    fingerprint = _request_fingerprint(
        sha256=sha256,
        item_id=item_id,
        is_overview=is_overview,
        point_ids=point_ids,
        caption=caption,
        captured_at=captured_at,
        field_edit=field_edit,
        layer=layer,
        capture_source=capture_source,
    )
    replay = replay_upload(
        session, task_id, upload_key, fingerprint, uploader.id
    )
    if replay is not None:
        return replay, True

    validate_upload_state(session, task_id, item_id, point_ids)
    if (is_overview and point_ids) or (not is_overview and not point_ids):
        raise _api_error(ErrorCode.EVIDENCE_INVALID_TARGET, 422)
    if not _SHA256_RE.fullmatch(sha256):
        raise _api_error(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if capture_source not in {"camera", "library"}:
        raise _api_error(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if caption is not None and len(caption) > 500:
        raise _api_error(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    settings = get_storage_settings()
    if len(content) > settings.max_file_bytes:
        raise _api_error(ErrorCode.EVIDENCE_FILE_TOO_LARGE, 413)
    try:
        image_info = inspect_jpeg(content, settings.max_decode_pixels)
    except InvalidEvidenceImageError as exc:
        raise _api_error(
            ErrorCode.EVIDENCE_INVALID_IMAGE, 422, str(exc)
        ) from exc
    if image_info.sha256 != sha256:
        raise _api_error(ErrorCode.EVIDENCE_SHA256_MISMATCH, 422)

    task = session.get(InspectionTask, task_id)
    item = session.get(TaskInspectionItem, item_id)
    snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item_id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert task is not None and item is not None and snapshot is not None

    project = session.get(Project, task.project_id)
    if project is None:
        raise _api_error(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    uploaded_at = utc_now()
    zone = session.get(ProjectZone, task.zone_id) if task.zone_id else None
    uploader_company = (
        session.get(Company, uploader.company_id)
        if uploader.company_id
        else None
    )
    source = build_label_source(
        source_kind="normal",
        project_name=project.name,
        item_title=snapshot.title,
        zone_name=zone.name if zone else None,
        location_text=task.location_text,
        uploader_name=uploader.name_zh,
        uploaded_at=uploaded_at,
    )
    uploader_snapshot = {
        "name_zh": uploader.name_zh,
        "company_name": uploader_company.name if uploader_company else None,
        "department": uploader.department,
        "is_external_collaborator": uploader.is_external_collaborator,
    }
    evidence_id = uuid7()
    office_bytes, label_rule = render_office(
        content, source, layer, str(evidence_id)
    )
    storage = LocalStorage(settings.root)
    saved_keys: list[UUID] = []
    committed = False
    try:
        field_key = storage.save(BytesIO(content))
        saved_keys.append(field_key)
        office_key = storage.save(BytesIO(office_bytes))
        saved_keys.append(office_key)

        evidence = Evidence(
            id=evidence_id,
            created_at=uploaded_at,
            project_id=task.project_id,
            task_id=task.id,
            task_inspection_item_id=item.id,
            snapshot_revision=snapshot.revision,
            upload_key=upload_key,
            request_fingerprint=fingerprint,
            is_overview=is_overview,
            caption=caption,
            captured_at=captured_at,
            capture_source=capture_source,
            created_by=uploader.id,
            updated_by=uploader.id,
            uploader_snapshot=uploader_snapshot,
            label_source=source,
            label_layer=layer,
        )
        session.add(evidence)
        for variant_type, key, image_bytes, width, height, rule in (
            (
                "FIELD",
                field_key,
                content,
                image_info.width,
                image_info.height,
                None,
            ),
            (
                "OFFICE",
                office_key,
                office_bytes,
                image_info.width,
                image_info.height,
                label_rule,
            ),
        ):
            session.add(
                EvidenceVariant(
                    evidence_id=evidence.id,
                    variant_type=variant_type,
                    storage_key=key,
                    content_type="image/jpeg",
                    byte_size=len(image_bytes),
                    sha256=hashlib.sha256(image_bytes).hexdigest(),
                    width=width,
                    height=height,
                    edit_params=field_edit if variant_type == "FIELD" else {},
                    label_rule=rule,
                    created_by=uploader.id,
                    updated_by=uploader.id,
                )
            )
        session.add_all(
            [
                EvidencePointLink(
                    evidence_id=evidence.id,
                    source_point_id=point_id,
                    created_by=uploader.id,
                    updated_by=uploader.id,
                )
                for point_id in point_ids
            ]
        )
        session.flush()
        # SQLite 的 SELECT FOR UPDATE 不加鎖；先取得寫鎖，再讀純量值，
        # 避免 identity map 留著渲染前的 is_current，提交舊快照照片。
        status, archived, current_id, current_revision = session.execute(
            select(
                InspectionTask.status,
                InspectionPlan.is_archived,
                TaskRequirementSnapshot.id,
                TaskRequirementSnapshot.revision,
            )
            .select_from(InspectionTask)
            .join(InspectionPlan, InspectionPlan.id == InspectionTask.plan_id)
            .outerjoin(
                TaskRequirementSnapshot,
                and_(
                    TaskRequirementSnapshot.task_inspection_item_id == item_id,
                    TaskRequirementSnapshot.is_current.is_(True),
                ),
            )
            .where(InspectionTask.id == task_id)
        ).one()
        # 與入口相同的優先序：封存、任務狀態，最後才是需求修訂。
        if archived:
            raise _api_error(ErrorCode.INSPECTION_PLAN_ARCHIVED, 409)
        if status != "IN_PROGRESS":
            raise _api_error(ErrorCode.EVIDENCE_TASK_LOCKED, 409)
        if (current_id, current_revision) != (snapshot.id, snapshot.revision):
            raise _api_error(ErrorCode.EVIDENCE_REQUIREMENT_CHANGED, 409)
        session.commit()
        committed = True
        session.refresh(evidence)
        return _response(session, evidence), False
    except IntegrityError:
        session.rollback()
        if not committed:
            for key in saved_keys:
                storage.delete(key)
        replay = replay_upload(
            session, task_id, upload_key, fingerprint, uploader.id
        )
        if replay is not None:
            return replay, True
        raise
    except Exception:
        session.rollback()
        if not committed:
            for key in saved_keys:
                storage.delete(key)
        raise
