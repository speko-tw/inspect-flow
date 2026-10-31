"""TPL-R30～R33：建議快照與歷程，不建立正式範本版本。"""

import uuid
from copy import deepcopy
from datetime import datetime

from sqlalchemy import (
    JSON,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import Uuid

from app.db import clock
from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin


def _snapshot_content(value: dict) -> dict:
    # TPL-R30：只接受結構定義；不可把來源子表主鍵、照片或現場值帶入。
    # 不檢查完整業務必填值，因 TPL-R32 允許退回件保存未完成內容；
    # T16 送審／T17 核准仍須重用既有完整結構驗證。
    allowed = {
        "item": {"title", "instruction", "inspection_points"},
        "point": {
            "logical_id",
            "sequence",
            "title",
            "instruction",
            "text_standard",
            "numeric_standard",
            "measurement_fields",
            "evidence_requirements",
        },
        "text": {"text"},
        "numeric": {
            "value",
            "condition",
            "unit",
            "tolerance",
            "range_form",
            "lower_bound",
            "upper_bound",
            "measurement_field_logical_id",
        },
        "field": {"logical_id", "name", "field_type", "unit", "sort_order"},
        "evidence": {"evidence_type", "required", "min_count", "max_count"},
    }
    identifiers: set[str] = set()

    def node(data: object, kind: str) -> dict:
        if not isinstance(data, dict) or set(data) - allowed[kind]:
            raise ValueError(f"invalid suggestion {kind} snapshot")
        containers = {
            "inspection_points",
            "text_standard",
            "numeric_standard",
            "measurement_fields",
            "evidence_requirements",
        }
        if any(
            key not in containers and isinstance(value, (dict, list))
            for key, value in data.items()
        ):
            raise ValueError("snapshot definition values must be scalar")
        if kind in {"point", "field"}:
            logical_id = data.get("logical_id")
            if not isinstance(logical_id, str):
                raise ValueError("logical_id must be a UUID string")
            if str(uuid.UUID(logical_id)) != logical_id:
                raise ValueError("logical_id must be a canonical UUID")
            if logical_id in identifiers:
                raise ValueError("logical_id must be unique in a revision")
            identifiers.add(logical_id)
        return data

    def children(data: dict, key: str, kind: str) -> list[dict]:
        values = data.get(key, [])
        if not isinstance(values, list):
            raise ValueError(f"{key} must be a list")
        return [node(child, kind) for child in values]

    item = node(value, "item")
    for point in children(item, "inspection_points", "point"):
        for key, kind in (
            ("text_standard", "text"),
            ("numeric_standard", "numeric"),
        ):
            if point.get(key) is not None:
                node(point[key], kind)
        fields = children(point, "measurement_fields", "field")
        reference = (point.get("numeric_standard") or {}).get(
            "measurement_field_logical_id"
        )
        if reference is not None and reference not in {
            field["logical_id"] for field in fields
        }:
            raise ValueError("numeric standard must reference a local field")
        children(point, "evidence_requirements", "evidence")
    # 避免呼叫端稍後修改同一個 dict，意外改動尚未 flush 的版本。
    return deepcopy(value)


class TemplateSuggestion(AuditMixin, TimestampedBase):
    """TPL-R30：可變狀態投影搭配不可變來源快照；歷程由各分表保存。"""

    __tablename__ = "template_suggestions"

    proposer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    source_project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="SET NULL")
    )
    source_item_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("project_inspection_items.id", ondelete="SET NULL")
    )
    # TPL-R30：查詢歷史與授權脈絡使用原 ID，不依賴可被 SET NULL 的連結。
    source_project_original_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    source_item_original_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    source_project_name: Mapped[str] = mapped_column(String, nullable=False)
    source_item_title: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="PENDING", server_default="PENDING"
    )
    current_revision_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    first_submitted_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=clock.utc_now
    )
    approved_template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("template_items.id", ondelete="SET NULL"), unique=True
    )
    __table_args__ = (
        # 同件指標與版本相互參照：延後檢查讓首次提出可在同一交易完成。
        ForeignKeyConstraint(
            ["id", "current_revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_current_revision",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
        ),
        ForeignKeyConstraint(
            ["source_item_id", "source_project_id"],
            [
                "project_inspection_items.id",
                "project_inspection_items.project_id",
            ],
            name="fk_suggestion_source_item_project",
            ondelete="SET NULL",
        ),
        CheckConstraint(
            "status IN ('PENDING', 'RETURNED', 'APPROVED', 'WITHDRAWN')",
            name="status_valid",
        ),
        CheckConstraint(
            "source_project_id IS NULL OR "
            "source_project_id = source_project_original_id",
            name="project_identity_matches",
        ),
        CheckConstraint(
            "source_item_id IS NULL OR "
            "source_item_id = source_item_original_id",
            name="item_identity_matches",
        ),
        CheckConstraint(
            "approved_template_id IS NULL OR status = 'APPROVED'",
            name="approved_link_status",
        ),
        Index(
            "ix_suggestions_proposer_created",
            "proposer_id",
            "created_at",
            "id",
        ),
        Index("ix_suggestions_status_created", "status", "created_at", "id"),
        Index("ix_suggestions_source_project", "source_project_original_id"),
    )


class TemplateSuggestionRevision(AuditMixin, TimestampedBase):
    """TPL-R32：建議內的不可變 JSON 版本；資料庫 trigger 禁止更新／刪除。"""

    __tablename__ = "template_suggestion_revisions"

    suggestion_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("template_suggestions.id"), nullable=False
    )
    revision_no: Mapped[int] = mapped_column(nullable=False)
    based_on_revision_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    content: Mapped[dict] = mapped_column(
        JSON(none_as_null=True), nullable=False
    )
    content_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    __table_args__ = (
        UniqueConstraint("suggestion_id", "revision_no"),
        UniqueConstraint(
            "suggestion_id", "id", name="uq_suggestion_revision_owner"
        ),
        ForeignKeyConstraint(
            ["suggestion_id", "based_on_revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_revision_parent",
            deferrable=True,
            initially="DEFERRED",
        ),
        CheckConstraint("revision_no >= 1", name="revision_positive"),
        CheckConstraint(
            "(revision_no = 1 AND based_on_revision_id IS NULL) OR "
            "(revision_no > 1 AND based_on_revision_id IS NOT NULL "
            "AND based_on_revision_id <> id)",
            name="parent_consistent",
        ),
        CheckConstraint("length(content_sha256) = 64", name="hash_length"),
    )

    @validates("content")
    def validate_content(self, key: str, value: dict) -> dict:
        """限制 TPL-R30 的結構快照形狀與邏輯識別；完整送審驗證留 T16。"""
        return _snapshot_content(value)


class TemplateSuggestionReview(AuditMixin, TimestampedBase):
    """TPL-R32、R33：審核人／時間沿 created_by／created_at，目的地只存快照。"""

    __tablename__ = "template_suggestion_reviews"

    suggestion_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    revision_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    decision: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str | None] = mapped_column(String)
    # TPL-R33：不可變原 ID 不設外鍵，正式範本／目的地刪除不能改寫歷史。
    approved_template_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, unique=True
    )
    approved_template_title: Mapped[str | None] = mapped_column(String)
    target_category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    target_category_name: Mapped[str | None] = mapped_column(String)
    target_system_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    target_system_name: Mapped[str | None] = mapped_column(String)
    __table_args__ = (
        ForeignKeyConstraint(
            ["suggestion_id", "revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_review_revision",
        ),
        UniqueConstraint(
            "suggestion_id",
            "revision_id",
            "id",
            "decision",
            name="uq_suggestion_review_context",
        ),
        # TPL-AC39：即使範本刪除使主表連結清空，同件也不能再次核准。
        Index(
            "uq_suggestion_one_approval",
            "suggestion_id",
            unique=True,
            sqlite_where=text("decision = 'APPROVED'"),
            postgresql_where=text("decision = 'APPROVED'"),
        ),
        CheckConstraint(
            "decision IN ('APPROVED', 'RETURNED')", name="decision_valid"
        ),
        CheckConstraint(
            "(decision = 'RETURNED' AND reason IS NOT NULL "
            "AND length(trim(reason)) BETWEEN 1 AND 1000 "
            "AND approved_template_id IS NULL "
            "AND approved_template_title IS NULL "
            "AND target_category_id IS NULL AND target_category_name IS NULL "
            "AND target_system_id IS NULL AND target_system_name IS NULL) OR "
            "(decision = 'APPROVED' AND reason IS NULL "
            "AND approved_template_id IS NOT NULL "
            "AND approved_template_title IS NOT NULL "
            "AND target_category_id IS NOT NULL "
            "AND target_category_name IS NOT NULL "
            "AND target_system_id IS NOT NULL "
            "AND target_system_name IS NOT NULL)",
            name="decision_snapshot_consistent",
        ),
    )


class TemplateSuggestionTransition(AuditMixin, TimestampedBase):
    """TPL-R31、R32：合法邊、受審版本與稽核一一對應的追加歷程。"""

    __tablename__ = "template_suggestion_transitions"

    suggestion_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    revision_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(16))
    to_status: Mapped[str] = mapped_column(String(16), nullable=False)
    review_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, unique=True)
    audit_log_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("audit_logs.id"), nullable=False, unique=True
    )
    __table_args__ = (
        ForeignKeyConstraint(
            ["suggestion_id", "revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_transition_revision",
        ),
        ForeignKeyConstraint(
            ["suggestion_id", "revision_id", "review_id", "to_status"],
            [
                "template_suggestion_reviews.suggestion_id",
                "template_suggestion_reviews.revision_id",
                "template_suggestion_reviews.id",
                "template_suggestion_reviews.decision",
            ],
            name="fk_suggestion_transition_review",
        ),
        Index(
            "uq_suggestion_first_submission",
            "suggestion_id",
            unique=True,
            sqlite_where=text("from_status IS NULL"),
            postgresql_where=text("from_status IS NULL"),
        ),
        Index(
            "ix_suggestion_transitions_history",
            "suggestion_id",
            "created_at",
            "id",
        ),
        CheckConstraint(
            "(from_status IS NULL AND to_status = 'PENDING') OR "
            "(from_status IS NOT NULL AND ((from_status = 'PENDING' "
            "AND to_status IN "
            "('RETURNED', 'APPROVED', 'WITHDRAWN')) OR "
            "(from_status = 'RETURNED' AND "
            "to_status IN ('PENDING', 'WITHDRAWN'))))",
            name="edge_valid",
        ),
        CheckConstraint(
            "(to_status IN ('RETURNED', 'APPROVED') "
            "AND review_id IS NOT NULL) OR "
            "(to_status IN ('PENDING', 'WITHDRAWN') AND review_id IS NULL)",
            name="review_required",
        ),
    )
