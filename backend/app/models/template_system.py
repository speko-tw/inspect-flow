"""Template library and system role models (template-system T1)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    UniqueConstraint,
    func,
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
    argument = compiler.process(list(element.clauses)[0], **kwargs)
    return f"trim(BOTH FROM {argument})"


class SystemRoleCode(StrEnum):
    """Fixed MVP-wide roles; intentionally not a persisted role table."""

    TEMPLATE_ADMIN = "template_admin"


class SystemRoleAssignment(AuditMixin, TimestampedBase):
    """A fixed system role assigned to a user."""

    __tablename__ = "system_role_assignments"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_code: Mapped[str] = mapped_column(String(64), nullable=False)
    __table_args__ = (
        UniqueConstraint("user_id", "role_code"),
        CheckConstraint(
            "role_code IN ('template_admin')",
            name="system_role_code_is_fixed",
        ),
    )


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
    __tablename__ = "template_text_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    text: Mapped[str] = mapped_column(String, nullable=False)


class TemplateNumericStandard(AuditMixin, TimestampedBase):
    __tablename__ = "template_numeric_standards"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    value: Mapped[str] = mapped_column(String, nullable=False)
    condition: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    tolerance: Mapped[str | None] = mapped_column(String)
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
    __tablename__ = "template_measurement_fields"
    inspection_point_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("template_inspection_points.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    field_type: Mapped[str] = mapped_column(String(16), nullable=False)
    unit: Mapped[str | None] = mapped_column(String)
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
        CheckConstraint(
            "evidence_type = 'photo'", name="evidence_type_photo_only"
        ),
        CheckConstraint(
            "min_count >= 0", name="evidence_min_count_nonnegative"
        ),
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
    source_template_name: Mapped[str] = mapped_column(String, nullable=False)
    applied_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)


class ProjectInspectionPoint(AuditMixin, TimestampedBase):
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
    value: Mapped[str] = mapped_column(String, nullable=False)
    condition: Mapped[str] = mapped_column(String, nullable=False)
    unit: Mapped[str] = mapped_column(String, nullable=False)
    tolerance: Mapped[str | None] = mapped_column(String)
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
            "min_count >= 0", name="project_evidence_min_nonnegative"
        ),
        CheckConstraint(
            "max_count IS NULL", name="project_evidence_unbounded"
        ),
    )
