"""Add template library, project snapshots and system role assignments."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "325e0f21a831"
down_revision: str | Sequence[str] | None = "e4b7a1c95d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
    ]


def _audit_foreign_keys(table: str) -> list[sa.ForeignKeyConstraint]:
    return [
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f(f"fk_{table}_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f(f"fk_{table}_updated_by_users"),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "template_categories",
        *_audit_columns(),
        sa.Column("name", sa.String(), nullable=False),
        *_audit_foreign_keys("template_categories"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_template_categories_name",
        "template_categories",
        [sa.text("lower(trim(name))")],
        unique=True,
    )
    op.create_table(
        "template_systems",
        *_audit_columns(),
        sa.Column("category_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        *_audit_foreign_keys("template_systems"),
        sa.ForeignKeyConstraint(
            ["category_id"], ["template_categories.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_template_systems_category_name",
        "template_systems",
        ["category_id", sa.text("lower(trim(name))")],
        unique=True,
    )
    op.create_table(
        "template_items",
        *_audit_columns(),
        sa.Column("system_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("instruction", sa.String(), nullable=False),
        *_audit_foreign_keys("template_items"),
        sa.ForeignKeyConstraint(
            ["system_id"], ["template_systems.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_template_items_system_title",
        "template_items",
        ["system_id", sa.text("lower(trim(title))")],
        unique=True,
    )
    op.create_table(
        "template_inspection_points",
        *_audit_columns(),
        sa.Column("template_item_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("instruction", sa.String(), nullable=False),
        *_audit_foreign_keys("template_inspection_points"),
        sa.ForeignKeyConstraint(
            ["template_item_id"], ["template_items.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_item_id", "sequence"),
    )
    op.create_table(
        "template_measurement_fields",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("field_type", sa.String(16), nullable=False),
        sa.Column("unit", sa.String(), nullable=True),
        *_audit_foreign_keys("template_measurement_fields"),
        sa.ForeignKeyConstraint(
            ["inspection_point_id"],
            ["template_inspection_points.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "inspection_point_id",
            "id",
            name=op.f("uq_template_measurement_fields_point_id"),
        ),
        sa.UniqueConstraint(
            "inspection_point_id",
            "id",
            "field_type",
            "unit",
            name=op.f("uq_template_measurement_fields_point_id_type_unit"),
        ),
        sa.CheckConstraint(
            "field_type IN ('text', 'number')",
            name="measurement_field_type_valid",
        ),
        sa.CheckConstraint(
            "field_type != 'number' OR unit IS NOT NULL",
            name="numeric_measurement_field_requires_unit",
        ),
    )
    op.create_table(
        "template_text_standards",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        *_audit_foreign_keys("template_text_standards"),
        sa.ForeignKeyConstraint(
            ["inspection_point_id"],
            ["template_inspection_points.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inspection_point_id"),
    )
    op.create_table(
        "template_numeric_standards",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("condition", sa.String(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("tolerance", sa.String(), nullable=True),
        sa.Column("measurement_field_id", sa.Uuid(), nullable=False),
        sa.Column(
            "measurement_field_type",
            sa.String(16),
            nullable=False,
            server_default="number",
        ),
        sa.Column("measurement_field_unit", sa.String(), nullable=False),
        *_audit_foreign_keys("template_numeric_standards"),
        sa.ForeignKeyConstraint(
            ["inspection_point_id"],
            ["template_inspection_points.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inspection_point_id"),
        sa.UniqueConstraint("measurement_field_id"),
        sa.CheckConstraint(
            "condition IN ('<=', '>=', '=', 'range')",
            name="numeric_standard_condition_valid",
        ),
        sa.CheckConstraint(
            "measurement_field_type = 'number'",
            name="numeric_standard_requires_numeric_field",
        ),
        sa.CheckConstraint(
            "unit = measurement_field_unit",
            name="numeric_standard_unit_matches_field",
        ),
    )
    op.create_table(
        "template_evidence_requirements",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column(
            "evidence_type",
            sa.String(16),
            nullable=False,
            server_default="photo",
        ),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("min_count", sa.Integer(), nullable=False),
        sa.Column("max_count", sa.Integer(), nullable=True),
        *_audit_foreign_keys("template_evidence_requirements"),
        sa.ForeignKeyConstraint(
            ["inspection_point_id"],
            ["template_inspection_points.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "evidence_type = 'photo'", name="evidence_type_photo_only"
        ),
        sa.CheckConstraint(
            "min_count >= 0", name="evidence_min_count_nonnegative"
        ),
        sa.CheckConstraint(
            "max_count IS NULL", name="evidence_unbounded_max_count"
        ),
    )
    op.create_table(
        "system_role_assignments",
        *_audit_columns(),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role_code", sa.String(64), nullable=False),
        *_audit_foreign_keys("system_role_assignments"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "role_code"),
        sa.CheckConstraint(
            "role_code IN ('template_admin')",
            name="system_role_code_is_fixed",
        ),
    )
    op.create_table(
        "project_inspection_items",
        *_audit_columns(),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("instruction", sa.String(), nullable=False),
        sa.Column("source_template_name", sa.String(), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=False),
        *_audit_foreign_keys("project_inspection_items"),
        sa.ForeignKeyConstraint(
            ["project_id"], ["projects.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "project_inspection_points",
        *_audit_columns(),
        sa.Column("project_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("instruction", sa.String(), nullable=False),
        *_audit_foreign_keys("project_inspection_points"),
        sa.ForeignKeyConstraint(
            ["project_inspection_item_id"],
            ["project_inspection_items.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("project_inspection_item_id", "sequence"),
        sa.UniqueConstraint("id", "project_inspection_item_id"),
    )
    op.create_table(
        "project_measurement_fields",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("project_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("field_type", sa.String(16), nullable=False),
        sa.Column("unit", sa.String(), nullable=True),
        *_audit_foreign_keys("project_measurement_fields"),
        sa.ForeignKeyConstraint(
            ["project_inspection_item_id"],
            ["project_inspection_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "inspection_point_id",
            "id",
            name=op.f("uq_project_measurement_fields_point_id"),
        ),
        sa.UniqueConstraint(
            "inspection_point_id",
            "id",
            "field_type",
            "unit",
            name=op.f("uq_project_measurement_fields_point_id_type_unit"),
        ),
        sa.CheckConstraint(
            "field_type IN ('text', 'number')",
            name="project_measurement_type_valid",
        ),
        sa.CheckConstraint(
            "field_type != 'number' OR unit IS NOT NULL",
            name="project_numeric_field_requires_unit",
        ),
    )
    op.create_table(
        "project_text_standards",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("project_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column("text", sa.String(), nullable=False),
        *_audit_foreign_keys("project_text_standards"),
        sa.ForeignKeyConstraint(
            ["project_inspection_item_id"],
            ["project_inspection_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inspection_point_id"),
    )
    op.create_table(
        "project_numeric_standards",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("project_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
        sa.Column("condition", sa.String(), nullable=False),
        sa.Column("unit", sa.String(), nullable=False),
        sa.Column("tolerance", sa.String(), nullable=True),
        sa.Column("measurement_field_id", sa.Uuid(), nullable=False),
        sa.Column(
            "measurement_field_type",
            sa.String(16),
            nullable=False,
            server_default="number",
        ),
        sa.Column("measurement_field_unit", sa.String(), nullable=False),
        *_audit_foreign_keys("project_numeric_standards"),
        sa.ForeignKeyConstraint(
            ["project_inspection_item_id"],
            ["project_inspection_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("inspection_point_id"),
        sa.UniqueConstraint("measurement_field_id"),
        sa.CheckConstraint(
            "condition IN ('<=', '>=', '=', 'range')",
            name="project_numeric_condition_valid",
        ),
        sa.CheckConstraint(
            "measurement_field_type = 'number'",
            name="project_numeric_requires_numeric_field",
        ),
        sa.CheckConstraint(
            "unit = measurement_field_unit",
            name="project_numeric_unit_matches_field",
        ),
    )
    op.create_table(
        "project_evidence_requirements",
        *_audit_columns(),
        sa.Column("inspection_point_id", sa.Uuid(), nullable=False),
        sa.Column("project_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column(
            "evidence_type",
            sa.String(16),
            nullable=False,
            server_default="photo",
        ),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("min_count", sa.Integer(), nullable=False),
        sa.Column("max_count", sa.Integer(), nullable=True),
        *_audit_foreign_keys("project_evidence_requirements"),
        sa.ForeignKeyConstraint(
            ["project_inspection_item_id"],
            ["project_inspection_items.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["inspection_point_id", "project_inspection_item_id"],
            [
                "project_inspection_points.id",
                "project_inspection_points.project_inspection_item_id",
            ],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "evidence_type = 'photo'", name="project_evidence_photo_only"
        ),
        sa.CheckConstraint(
            "min_count >= 0", name="project_evidence_min_nonnegative"
        ),
        sa.CheckConstraint(
            "max_count IS NULL", name="project_evidence_unbounded"
        ),
    )


def downgrade() -> None:
    op.drop_table("project_evidence_requirements")
    op.drop_table("project_numeric_standards")
    op.drop_table("project_text_standards")
    op.drop_table("project_measurement_fields")
    op.drop_table("project_inspection_points")
    op.drop_table("project_inspection_items")
    op.drop_table("system_role_assignments")
    op.drop_table("template_evidence_requirements")
    op.drop_table("template_numeric_standards")
    op.drop_table("template_text_standards")
    op.drop_table("template_measurement_fields")
    op.drop_table("template_inspection_points")
    op.drop_index(
        "ix_template_items_system_title", table_name="template_items"
    )
    op.drop_table("template_items")
    op.drop_index(
        "ix_template_systems_category_name", table_name="template_systems"
    )
    op.drop_table("template_systems")
    op.drop_index(
        "ix_template_categories_name", table_name="template_categories"
    )
    op.drop_table("template_categories")
