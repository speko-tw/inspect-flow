"""FEV-R01、R13：只保存照片兩版的 metadata 與可追溯來源。"""

import uuid
from datetime import datetime
from typing import TypedDict

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin


class UploaderSnapshot(TypedDict):
    """FEV-R13 的寫入當下身分；#550 落地時對齊共用格式與寫入函式。"""

    name_zh: str | None
    company_name: str | None
    department: str | None
    is_external_collaborator: bool


class LabelSource(TypedDict):
    """FEV-R22 的五欄來源；uploaded_at 保存 UTC ISO 8601 原值。"""

    project_name: str | None
    item_title: str | None
    location: str | None
    uploader_name: str | None
    uploaded_at: str | None


class Evidence(AuditMixin, TimestampedBase):
    """FEV-R07、R13：固定上傳身分、標示來源與需求修訂，保留軟刪歷史。"""

    __tablename__ = "evidence"

    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    task_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    snapshot_revision: Mapped[int] = mapped_column(nullable=False)
    upload_key: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    # FEV-R07：T2 比對完整請求指紋，不能只比照片雜湊。
    request_fingerprint: Mapped[str] = mapped_column(
        String(64), nullable=False
    )
    is_overview: Mapped[bool] = mapped_column(nullable=False, default=False)
    caption: Mapped[str | None] = mapped_column(String(500))
    captured_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    uploader_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    label_source: Mapped[dict] = mapped_column(JSON, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id")
    )
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    void_reason: Mapped[str | None] = mapped_column(String(32))

    __table_args__ = (
        UniqueConstraint("task_id", "upload_key"),
        ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["inspection_tasks.id", "inspection_tasks.project_id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["task_inspection_item_id", "snapshot_revision"],
            [
                "task_requirement_snapshots.task_inspection_item_id",
                "task_requirement_snapshots.revision",
            ],
            name="fk_evidence_item_snapshot",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "caption IS NULL OR length(caption) <= 500",
            name="caption_length",
        ),
        CheckConstraint(
            "length(request_fingerprint) = 64", name="fingerprint_length"
        ),
        CheckConstraint(
            "(deleted_at IS NULL AND deleted_by IS NULL) OR "
            "(deleted_at IS NOT NULL AND deleted_by IS NOT NULL)",
            name="deletion_consistent",
        ),
        CheckConstraint(
            "(voided_at IS NULL AND void_reason IS NULL) OR "
            "(voided_at IS NOT NULL AND void_reason IS NOT NULL "
            "AND void_reason = 'STANDARD_CHANGED')",
            name="voiding_consistent",
        ),
        Index(
            "ix_evidence_task_item_created_id",
            "task_id",
            "task_inspection_item_id",
            "created_at",
            "id",
        ),
        Index("ix_evidence_project_id", "project_id"),
        Index(
            "ix_evidence_item_revision",
            "task_inspection_item_id",
            "snapshot_revision",
        ),
    )


class EvidenceVariant(AuditMixin, TimestampedBase):
    """FEV-R01、R18：每版最多一列；兩列齊備由 T2 同一交易保證。"""

    __tablename__ = "evidence_variants"

    evidence_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("evidence.id", ondelete="RESTRICT"), nullable=False
    )
    variant_type: Mapped[str] = mapped_column(String(6), nullable=False)
    # UUID 型別讓儲存鍵不可能夾帶原檔名或路徑（FEV-R01）。
    storage_key: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, unique=True
    )
    content_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default="image/jpeg"
    )
    byte_size: Mapped[int] = mapped_column(nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    width: Mapped[int] = mapped_column(nullable=False)
    height: Mapped[int] = mapped_column(nullable=False)
    edit_params: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    edited_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id")
    )
    edited_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    label_rule: Mapped[dict | None] = mapped_column(JSON(none_as_null=True))
    __table_args__ = (
        UniqueConstraint("evidence_id", "variant_type"),
        CheckConstraint(
            "variant_type IN ('FIELD', 'OFFICE')", name="type_valid"
        ),
        CheckConstraint("content_type = 'image/jpeg'", name="jpeg_only"),
        CheckConstraint("byte_size > 0", name="size_positive"),
        CheckConstraint(
            "width > 0 AND height > 0", name="dimensions_positive"
        ),
        CheckConstraint("length(sha256) = 64", name="sha256_length"),
        CheckConstraint(
            "(edited_at IS NULL AND edited_by IS NULL) OR "
            "(edited_at IS NOT NULL AND edited_by IS NOT NULL)",
            name="edit_consistent",
        ),
        CheckConstraint(
            "variant_type = 'OFFICE' OR "
            "(edited_at IS NULL AND edited_by IS NULL AND label_rule IS NULL)",
            name="office_metadata_only",
        ),
    )


class EvidencePointLink(AuditMixin, TimestampedBase):
    """FEV-R04：保留穩定項次識別；不外鍵到會被標準變更刪除的來源列。"""

    __tablename__ = "evidence_point_links"

    evidence_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("evidence.id", ondelete="RESTRICT"), nullable=False
    )
    source_point_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    __table_args__ = (
        UniqueConstraint("evidence_id", "source_point_id"),
        Index("ix_evidence_point_links_source_point_id", "source_point_id"),
    )
