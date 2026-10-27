"""範本庫及專案查核項目資料模型（template-system T1）。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin


class _TrimForIndex(FunctionElement[str]):
    """Compile TRIM using PostgreSQL's catalog-preserved syntax."""

    type = String()
    inherit_cache = True


@compiles(_TrimForIndex)
def _compile_trim_for_index(element, compiler, **kwargs):
    argument = compiler.process(list(element.clauses)[0], **kwargs)
    return f"trim({argument})"


@compiles(_TrimForIndex, "postgresql")
def _compile_postgres_trim_for_index(element, compiler, **kwargs):
    # PostgreSQL 保存的索引運算式使用此語法，避免 schema 比對誤判差異。
    argument = compiler.process(list(element.clauses)[0], **kwargs)
    return f"trim(BOTH FROM {argument})"


class TemplateCategory(AuditMixin, TimestampedBase):
    """Top-level engineering category."""

    __tablename__ = "template_categories"

    name: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        Index(
            "ix_template_categories_name",
            func.lower(_TrimForIndex(name)),
            unique=True,
        ),
    )

    @validates("name")
    def validate_name(self, key: str, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("TemplateCategory.name must not be blank")
        return normalized


class TemplateSystem(AuditMixin, TimestampedBase):
    """Second-level category containing template items."""

    __tablename__ = "template_systems"

    category_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        Index(
            "ix_template_systems_category_name",
            category_id,
            func.lower(_TrimForIndex(name)),
            unique=True,
        ),
    )

    @validates("name")
    def validate_name(self, key: str, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("TemplateSystem.name must not be blank")
        return normalized


class TemplateItem(AuditMixin, TimestampedBase):
    """One inspection item template; no separate template/version row."""

    __tablename__ = "template_items"

    system_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_systems.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        Index(
            "ix_template_items_system_title",
            system_id,
            func.lower(_TrimForIndex(title)),
            unique=True,
        ),
    )

    @validates("title")
    def validate_title(self, key: str, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("TemplateItem.title must not be blank")
        return normalized


class TemplateInspectionPoint(AuditMixin, TimestampedBase):
    """A preconfigured inspection point under one template item."""

    __tablename__ = "template_inspection_points"
    template_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (UniqueConstraint("template_item_id", "sequence"),)


class TemplateTextStandard(AuditMixin, TimestampedBase):
    """保存範本項次的文字標準，不含現場判定。"""

    __tablename__ = "template_text_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    text: Mapped[str] = mapped_column(String, nullable=False)


class TemplateNumericStandard(AuditMixin, TimestampedBase):
    """依 TPL-R11 將數值標準綁到同項次的數字欄位。"""

    __tablename__ = "template_numeric_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
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
    measurement_field_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, unique=True
    )
    # TPL-R11：冗餘型別與單位供複合外鍵驗證，避免跨項次或錯單位綁定。
    measurement_field_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="number", server_default="number"
    )
    measurement_field_unit: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        CheckConstraint(
            "condition IN ('<=', '>=', '=', 'range')",
            name="numeric_standard_condition_valid",
        ),
        ForeignKeyConstraint(
            [
                "inspection_point_id",
                "measurement_field_id",
                "measurement_field_type",
                "measurement_field_unit",
            ],
            [
                "template_measurement_fields.inspection_point_id",
                "template_measurement_fields.id",
                "template_measurement_fields.field_type",
                "template_measurement_fields.unit",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "measurement_field_type = 'number'",
            name="numeric_standard_requires_numeric_field",
        ),
        CheckConstraint(
            "unit = measurement_field_unit",
            name="numeric_standard_unit_matches_field",
        ),
    )


class TemplateMeasurementField(AuditMixin, TimestampedBase):
    """定義範本預設的實測欄位，不保存填寫值。"""

    __tablename__ = "template_measurement_fields"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    field_type: Mapped[str] = mapped_column(String(16), nullable=False)
    unit: Mapped[str | None] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint(
            "inspection_point_id",
            "id",
            name="uq_template_measurement_fields_point_id",
        ),
        UniqueConstraint(
            "inspection_point_id",
            "id",
            "field_type",
            "unit",
            name="uq_template_measurement_fields_point_id_type_unit",
        ),
        CheckConstraint(
            "field_type IN ('text', 'number')",
            name="measurement_field_type_valid",
        ),
        CheckConstraint(
            "field_type != 'number' OR unit IS NOT NULL",
            name="numeric_measurement_field_requires_unit",
        ),
    )


class TemplateEvidenceRequirement(AuditMixin, TimestampedBase):
    """定義項次所需的照片數量，不持有照片檔案。"""

    __tablename__ = "template_evidence_requirements"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
    )
    evidence_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="photo", server_default="photo"
    )
    required: Mapped[bool] = mapped_column(nullable=False, default=True)
    min_count: Mapped[int] = mapped_column(nullable=False, default=1)
    max_count: Mapped[int | None] = mapped_column()
    __table_args__ = (
        Index(
            "uq_template_evidence_point_type",
            "inspection_point_id",
            "evidence_type",
            unique=True,
        ),
        CheckConstraint(
            "evidence_type = 'photo'", name="evidence_type_photo_only"
        ),
        CheckConstraint("min_count >= 1", name="evidence_min_count_positive"),
        CheckConstraint(
            "max_count IS NULL", name="evidence_unbounded_max_count"
        ),
    )


class ProjectInspectionItem(AuditMixin, TimestampedBase):
    """Minimum project-owned snapshot of one applied template item."""

    __tablename__ = "project_inspection_items"
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    sequence: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    # TPL-R08：保留套用當下名稱，不能用來源外鍵即時查名取代快照。
    source_template_name: Mapped[str] = mapped_column(String, nullable=False)
    source_category_name: Mapped[str | None] = mapped_column(String)
    source_system_name: Mapped[str | None] = mapped_column(String)
    applied_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    # IP-R23：停用僅影響新任務選用，不更動任何既有快照。
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    standard_revision: Mapped[int] = mapped_column(
        nullable=False, default=1, server_default="1"
    )
    __table_args__ = (
        Index(
            "uq_project_inspection_items_id_project_id",
            "id",
            "project_id",
            unique=True,
        ),
        Index(
            "ix_project_inspection_items_project_created_id",
            "project_id",
            "created_at",
            "id",
        ),
    )


class ProjectInspectionPoint(AuditMixin, TimestampedBase):
    """保存專案自己的項次，隔離後續範本變更（TPL-R08）。"""

    __tablename__ = "project_inspection_points"
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    sequence: Mapped[int] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    instruction: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        UniqueConstraint("project_inspection_item_id", "sequence"),
        UniqueConstraint("id", "project_inspection_item_id"),
    )


class ProjectTextStandard(AuditMixin, TimestampedBase):
    """保存專案項次的文字標準副本。"""

    __tablename__ = "project_text_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        nullable=False,
        unique=True,
    )
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    text: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
    )


class ProjectNumericStandard(AuditMixin, TimestampedBase):
    """在專案副本內保留標準與實測欄位的綁定（TPL-R11）。"""

    __tablename__ = "project_numeric_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        nullable=False,
        unique=True,
    )
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    value: Mapped[str | None] = mapped_column(String)
    condition: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    tolerance: Mapped[str | None] = mapped_column(String)
    range_form: Mapped[str | None] = mapped_column(String(16))
    lower_bound: Mapped[str | None] = mapped_column(String)
    upper_bound: Mapped[str | None] = mapped_column(String)
    measurement_field_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, nullable=False, unique=True
    )
    measurement_field_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="number", server_default="number"
    )
    measurement_field_unit: Mapped[str] = mapped_column(String, nullable=False)
    __table_args__ = (
        CheckConstraint(
            "condition IN ('<=', '>=', '=', 'range')",
            name="project_numeric_condition_valid",
        ),
        ForeignKeyConstraint(
            [
                "inspection_point_id",
                "measurement_field_id",
                "measurement_field_type",
                "measurement_field_unit",
            ],
            [
                "project_measurement_fields.inspection_point_id",
                "project_measurement_fields.id",
                "project_measurement_fields.field_type",
                "project_measurement_fields.unit",
            ],
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "measurement_field_type = 'number'",
            name="project_numeric_requires_numeric_field",
        ),
        CheckConstraint(
            "unit = measurement_field_unit",
            name="project_numeric_unit_matches_field",
        ),
    )


class ProjectMeasurementField(AuditMixin, TimestampedBase):
    """保存專案項次可填寫欄位的定義。"""

    __tablename__ = "project_measurement_fields"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        nullable=False,
    )
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    field_type: Mapped[str] = mapped_column(String(16), nullable=False)
    unit: Mapped[str | None] = mapped_column(String)
    sort_order: Mapped[int] = mapped_column(nullable=False, default=0)
    __table_args__ = (
        UniqueConstraint(
            "inspection_point_id",
            "id",
            name="uq_project_measurement_fields_point_id",
        ),
        UniqueConstraint(
            "inspection_point_id",
            "id",
            "field_type",
            "unit",
            name="uq_project_measurement_fields_point_id_type_unit",
        ),
        ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "field_type IN ('text', 'number')",
            name="project_measurement_type_valid",
        ),
        CheckConstraint(
            "field_type != 'number' OR unit IS NOT NULL",
            name="project_numeric_field_requires_unit",
        ),
    )


class ProjectEvidenceRequirement(AuditMixin, TimestampedBase):
    """保存專案項次的照片需求副本，與範本庫獨立。"""

    __tablename__ = "project_evidence_requirements"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        nullable=False,
    )
    project_inspection_item_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_inspection_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    evidence_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="photo", server_default="photo"
    )
    required: Mapped[bool] = mapped_column(nullable=False, default=True)
    min_count: Mapped[int] = mapped_column(nullable=False, default=1)
    max_count: Mapped[int | None] = mapped_column()
    __table_args__ = (
        Index(
            "uq_project_evidence_point_type",
            "inspection_point_id",
            "evidence_type",
            unique=True,
        ),
        ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        CheckConstraint(
            "evidence_type = 'photo'",
            name="project_evidence_photo_only",
        ),
        CheckConstraint(
            "min_count >= 1", name="project_evidence_min_positive"
        ),
        CheckConstraint(
            "max_count IS NULL", name="project_evidence_unbounded"
        ),
    )
