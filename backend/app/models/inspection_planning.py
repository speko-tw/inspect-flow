"""以資料約束守住 IP-R03、KD-55 與 Task 地點的領域邊界。"""

import uuid
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

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString


def _check_zone_name(value: str) -> None:
    if len(value) > 128:
        raise ValueError("ProjectZone.name must be at most 128 characters")


def _check_plan_name(value: str) -> None:
    if len(value) > 128:
        raise ValueError("InspectionPlan.name must be at most 128 characters")


def _check_location_text(value: str) -> None:
    if len(value) > 256:
        raise ValueError("InspectionTask.location_text is too long")


class ProjectZone(AuditMixin, TimestampedBase):
    """依 IP-R10 表示專案分區，名稱於同專案內不重複。"""

    __tablename__ = "project_zones"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(
        BoundedString(128, _check_zone_name), nullable=False
    )
    name_key: Mapped[str] = mapped_column(String(512), nullable=False)
    __table_args__ = (
        UniqueConstraint(
            "project_id", "id", name="uq_project_zones_project_id_id"
        ),
        UniqueConstraint(
            "project_id", "name_key", name="uq_project_zones_project_name"
        ),
        CheckConstraint("name <> ''", name="project_zone_name_nonempty"),
    )

    @validates("name")
    def validate_name(self, key: str, value: str) -> str:
        """拒絕空白或過長分區名稱，並維持同專案名稱鍵一致。"""
        normalized = value.strip()
        if not normalized or len(normalized) > 128:
            raise ValueError("ProjectZone.name must contain 1-128 characters")
        self.name_key = normalized.casefold()
        return normalized


class InspectionPlan(AuditMixin, TimestampedBase):
    """表示依 KD-56 由 Task 衍生有效狀態的查核計畫。"""

    __tablename__ = "inspection_plans"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(
        BoundedString(128, _check_plan_name), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="DRAFT", server_default="DRAFT"
    )
    is_archived: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="0"
    )
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        Index(
            "ix_inspection_plans_project_created_id",
            "project_id",
            "created_at",
            "id",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')",
            name="inspection_plan_status_valid",
        ),
        CheckConstraint(
            "length(trim(name)) BETWEEN 1 AND 128",
            name="inspection_plan_name_valid",
        ),
    )

    @validates("name")
    def validate_name(self, key: str, value: str) -> str:
        """拒絕空白或過長 Plan 名稱，避免繞過 API 驗證。"""
        normalized = value.strip()
        if not normalized or len(normalized) > 128:
            raise ValueError(
                "InspectionPlan.name must contain 1-128 characters"
            )
        return normalized


class InspectionTask(AuditMixin, TimestampedBase):
    """表示含建議指派與地點的任務；派出前依 IP-R09 不可見。"""

    __tablename__ = "inspection_tasks"

    plan_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    location_text: Mapped[str | None] = mapped_column(
        BoundedString(256, _check_location_text)
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="DRAFT", server_default="DRAFT"
    )
    dispatched_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cancelled_from_status: Mapped[str | None] = mapped_column(String(16))
    cancellation_reason: Mapped[str | None] = mapped_column(String)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id")
    )
    started_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id")
    )
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id")
    )
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __table_args__ = (
        UniqueConstraint("id", "project_id"),
        Index(
            "ix_inspection_tasks_project_created_id",
            "project_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_inspection_tasks_plan_created_id",
            "plan_id",
            "created_at",
            "id",
        ),
        Index("ix_inspection_tasks_assignee_id", "assignee_id"),
        ForeignKeyConstraint(
            ["plan_id", "project_id"],
            ["inspection_plans.id", "inspection_plans.project_id"],
            ondelete="CASCADE",
        ),
        # 依 IP-R10，以複合外鍵阻止 Task 指向其他專案的分區。
        ForeignKeyConstraint(
            ["project_id", "zone_id"],
            ["project_zones.project_id", "project_zones.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "status IN ('DRAFT', 'PENDING', 'IN_PROGRESS', "
            "'COMPLETED', 'CANCELLED')",
            name="inspection_task_status_valid",
        ),
        CheckConstraint(
            "cancelled_from_status IS NULL OR cancelled_from_status "
            "IN ('PENDING', 'IN_PROGRESS')",
            name="inspection_task_cancelled_from_valid",
        ),
        CheckConstraint(
            "(status = 'CANCELLED' AND cancelled_from_status IS NOT NULL "
            "AND cancellation_reason IS NOT NULL "
            "AND length(trim(cancellation_reason)) > 0) OR "
            "(status != 'CANCELLED' AND cancelled_from_status IS NULL "
            "AND cancellation_reason IS NULL)",
            name="inspection_task_cancellation_consistent",
        ),
    )


class TaskInspectionItem(AuditMixin, TimestampedBase):
    """連結 Task 與專案項目，隔離 KD-55 的項目級重查狀態。"""

    __tablename__ = "task_inspection_items"

    task_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    item_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="PENDING", server_default="PENDING"
    )
    needs_reinspection: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="0"
    )
    __table_args__ = (
        UniqueConstraint("task_id", "project_inspection_item_id"),
        ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["inspection_tasks.id", "inspection_tasks.project_id"],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["project_inspection_item_id", "project_id"],
            [
                "project_inspection_items.id",
                "project_inspection_items.project_id",
            ],
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "item_status IN ('PENDING', 'COMPLETED')",
            name="task_inspection_item_status_valid",
        ),
    )


class TaskRequirementSnapshot(AuditMixin, TimestampedBase):
    """依 IP-R03 保存當時需求及 KD-55 更新後可追溯的修訂。"""

    __tablename__ = "task_requirement_snapshots"

    task_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision: Mapped[int] = mapped_column(nullable=False)
    source_standard_revision: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    source_template_name: Mapped[str] = mapped_column(String, nullable=False)
    is_current: Mapped[bool] = mapped_column(nullable=False, default=True)
    superseded_reason: Mapped[str | None] = mapped_column(String(32))
    superseded_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    __table_args__ = (
        UniqueConstraint("task_inspection_item_id", "revision"),
        # SQLite 與 PostgreSQL 的布林語法不同，兩者都只限制
        # 同一 Task 項目同時最多一筆目前快照（IP-R03）。
        Index(
            "uq_task_requirement_snapshots_current",
            "task_inspection_item_id",
            unique=True,
            sqlite_where=text("is_current = 1"),
            postgresql_where=text("is_current = true"),
        ),
        CheckConstraint(
            "revision >= 1", name="task_snapshot_revision_positive"
        ),
        CheckConstraint(
            "source_standard_revision >= 1",
            name="task_snapshot_source_revision_positive",
        ),
        CheckConstraint(
            "superseded_reason IS NULL OR superseded_reason IN "
            "('STANDARD_CHANGED', 'TEXT_CORRECTED')",
            name="task_snapshot_superseded_reason_valid",
        ),
        CheckConstraint(
            "(is_current AND superseded_reason IS NULL "
            "AND superseded_at IS NULL) OR "
            "(NOT is_current AND superseded_reason IS NOT NULL "
            "AND superseded_at IS NOT NULL)",
            name="task_snapshot_current_consistent",
        ),
    )


class TaskSnapshotPoint(AuditMixin, TimestampedBase):
    """保存項次來源 id，讓 IP-R13 的結構身分可追溯。"""

    __tablename__ = "task_snapshot_points"

    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_requirement_snapshots.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_point_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    sequence: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        UniqueConstraint(
            "snapshot_id", "source_point_id", name="uq_snapshot_point_source"
        ),
        UniqueConstraint(
            "snapshot_id", "sequence", name="uq_snapshot_point_sequence"
        ),
    )


class TaskSnapshotTextStandard(AuditMixin, TimestampedBase):
    """保存 Task 建立時的文字標準，避免來源修改回寫歷史。"""

    __tablename__ = "task_snapshot_text_standards"

    point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_snapshot_points.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    text: Mapped[str] = mapped_column(String, nullable=False)


class TaskSnapshotNumericStandard(AuditMixin, TimestampedBase):
    """保存數值標準及欄位身分，維持來源與快照一致。"""

    __tablename__ = "task_snapshot_numeric_standards"

    point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_snapshot_points.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    value: Mapped[str | None] = mapped_column(String)
    condition: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    tolerance: Mapped[str | None] = mapped_column(String)
    range_form: Mapped[str | None] = mapped_column(String(16))
    lower_bound: Mapped[str | None] = mapped_column(String)
    upper_bound: Mapped[str | None] = mapped_column(String)
    source_measurement_field_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False
    )
    measurement_field_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="number", server_default="number"
    )
    measurement_field_unit: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(
            [
                "point_id",
                "source_measurement_field_id",
                "measurement_field_type",
                "measurement_field_unit",
            ],
            [
                "task_snapshot_measurement_fields.point_id",
                "task_snapshot_measurement_fields.source_field_id",
                "task_snapshot_measurement_fields.field_type",
                "task_snapshot_measurement_fields.unit",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "condition IN ('<=', '>=', '=', 'range')",
            name="task_snapshot_numeric_condition_valid",
        ),
        CheckConstraint(
            "measurement_field_type = 'number'",
            name="task_snapshot_numeric_requires_number_field",
        ),
        CheckConstraint(
            "unit = measurement_field_unit",
            name="task_snapshot_numeric_unit_matches_field",
        ),
    )


class TaskSnapshotMeasurementField(AuditMixin, TimestampedBase):
    """保存實測欄位的來源 id 與型別供數值標準引用。"""

    __tablename__ = "task_snapshot_measurement_fields"

    point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_snapshot_points.id", ondelete="CASCADE"),
        nullable=False,
    )
    source_field_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    field_type: Mapped[str] = mapped_column(String(16), nullable=False)
    unit: Mapped[str | None] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint("point_id", "source_field_id"),
        UniqueConstraint(
            "point_id",
            "source_field_id",
            "field_type",
            "unit",
            name="uq_snapshot_field_point_source_type_unit",
        ),
        CheckConstraint(
            "field_type IN ('text', 'number')",
            name="task_snapshot_field_type_valid",
        ),
        CheckConstraint(
            "field_type != 'number' OR unit IS NOT NULL",
            name="task_snapshot_number_field_requires_unit",
        ),
    )


class TaskSnapshotEvidenceRequirement(AuditMixin, TimestampedBase):
    """保存項次照片需求，避免來源修改影響既有 Task。"""

    __tablename__ = "task_snapshot_evidence_requirements"

    point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("task_snapshot_points.id", ondelete="CASCADE"),
        nullable=False,
    )
    evidence_type: Mapped[str] = mapped_column(String(16), nullable=False)
    required: Mapped[bool] = mapped_column(nullable=False)
    min_count: Mapped[int] = mapped_column(nullable=False)
    max_count: Mapped[int | None] = mapped_column()
    __table_args__ = (
        UniqueConstraint("point_id", "evidence_type"),
        CheckConstraint(
            "evidence_type = 'photo'", name="task_snapshot_evidence_photo"
        ),
        CheckConstraint(
            "min_count >= 1", name="task_snapshot_evidence_min_positive"
        ),
        CheckConstraint(
            "max_count IS NULL", name="task_snapshot_evidence_unbounded"
        ),
    )


class ProjectInspectionItemChange(AuditMixin, TimestampedBase):
    """記錄 KD-55 修訂及重查選擇，供取消 Task 恢復時判斷。"""

    __tablename__ = "project_inspection_item_changes"

    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="RESTRICT"),
        nullable=False,
    )
    before_revision: Mapped[int] = mapped_column(nullable=False)
    after_revision: Mapped[int] = mapped_column(nullable=False)
    reinspection_required: Mapped[bool | None] = mapped_column()
    before_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    after_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    __table_args__ = (
        UniqueConstraint("project_inspection_item_id", "after_revision"),
        CheckConstraint(
            "after_revision > before_revision",
            name="project_item_change_revision_increases",
        ),
    )
