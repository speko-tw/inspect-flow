"""FEV-R01、R13：新增照片 metadata，保留既有查核與權限資料。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e790a1b2c3d4"
down_revision: str | Sequence[str] | None = "d717a4c9e201"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """只新增三張表；既有角色由管理員維護，不回填或覆寫權限。"""
    op.create_table(
        "evidence",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("task_inspection_item_id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_revision", sa.Integer(), nullable=False),
        sa.Column("upload_key", sa.Uuid(), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("is_overview", sa.Boolean(), nullable=False),
        sa.Column("caption", sa.String(length=500), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "uploader_snapshot", sa.JSON(none_as_null=True), nullable=False
        ),
        sa.Column("label_source", sa.JSON(none_as_null=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.Uuid(), nullable=True),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("void_reason", sa.String(length=32), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT "
            "NULL AND void_reason IS NOT NULL AND void_reason = "
            "'STANDARD_CHANGED')",
            name=op.f("ck_evidence_voiding_consistent"),
        ),
        sa.CheckConstraint(
            "(deleted_at IS NULL AND deleted_by IS NULL) OR "
            "(deleted_at IS NOT NULL AND deleted_by IS NOT NULL)",
            name=op.f("ck_evidence_deletion_consistent"),
        ),
        sa.CheckConstraint(
            "caption IS NULL OR length(caption) <= 500",
            name=op.f("ck_evidence_caption_length"),
        ),
        sa.CheckConstraint(
            "length(request_fingerprint) = 64",
            name=op.f("ck_evidence_fingerprint_length"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_evidence_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["deleted_by"],
            ["users.id"],
            name=op.f("fk_evidence_deleted_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["task_id", "project_id"],
            ["inspection_tasks.id", "inspection_tasks.project_id"],
            name=op.f("fk_evidence_task_id_inspection_tasks"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["task_inspection_item_id", "snapshot_revision"],
            [
                "task_requirement_snapshots.task_inspection_item_id",
                "task_requirement_snapshots.revision",
            ],
            name="fk_evidence_item_snapshot",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_evidence_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence")),
        sa.UniqueConstraint(
            "task_id", "upload_key", name=op.f("uq_evidence_task_id")
        ),
    )
    with op.batch_alter_table("evidence", schema=None) as batch_op:
        batch_op.create_index(
            "ix_evidence_item_revision",
            ["task_inspection_item_id", "snapshot_revision"],
            unique=False,
        )
        batch_op.create_index(
            "ix_evidence_project_id", ["project_id"], unique=False
        )
        batch_op.create_index(
            "ix_evidence_task_item_created_id",
            ["task_id", "task_inspection_item_id", "created_at", "id"],
            unique=False,
        )

    op.create_table(
        "evidence_point_links",
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("source_point_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_evidence_point_links_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["evidence_id"],
            ["evidence.id"],
            name=op.f("fk_evidence_point_links_evidence_id_evidence"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_evidence_point_links_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence_point_links")),
        sa.UniqueConstraint(
            "evidence_id",
            "source_point_id",
            name=op.f("uq_evidence_point_links_evidence_id"),
        ),
    )
    with op.batch_alter_table("evidence_point_links", schema=None) as batch_op:
        batch_op.create_index(
            "ix_evidence_point_links_source_point_id",
            ["source_point_id"],
            unique=False,
        )

    op.create_table(
        "evidence_variants",
        sa.Column("evidence_id", sa.Uuid(), nullable=False),
        sa.Column("variant_type", sa.String(length=6), nullable=False),
        sa.Column("storage_key", sa.Uuid(), nullable=False),
        sa.Column("content_type", sa.String(length=10), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("edit_params", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("edited_by", sa.Uuid(), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label_rule", sa.JSON(none_as_null=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "content_type = 'image/jpeg'",
            name=op.f("ck_evidence_variants_jpeg_only"),
        ),
        sa.CheckConstraint(
            "variant_type = 'OFFICE' OR "
            "(edited_at IS NULL AND edited_by IS NULL AND label_rule IS NULL)",
            name=op.f("ck_evidence_variants_office_metadata_only"),
        ),
        sa.CheckConstraint(
            "variant_type IN ('FIELD', 'OFFICE')",
            name=op.f("ck_evidence_variants_type_valid"),
        ),
        sa.CheckConstraint(
            "(edited_at IS NULL AND edited_by IS NULL) OR "
            "(edited_at IS NOT NULL AND edited_by IS NOT NULL)",
            name=op.f("ck_evidence_variants_edit_consistent"),
        ),
        sa.CheckConstraint(
            "byte_size > 0", name=op.f("ck_evidence_variants_size_positive")
        ),
        sa.CheckConstraint(
            "length(sha256) = 64",
            name=op.f("ck_evidence_variants_sha256_length"),
        ),
        sa.CheckConstraint(
            "width > 0 AND height > 0",
            name=op.f("ck_evidence_variants_dimensions_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_evidence_variants_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["edited_by"],
            ["users.id"],
            name=op.f("fk_evidence_variants_edited_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["evidence_id"],
            ["evidence.id"],
            name=op.f("fk_evidence_variants_evidence_id_evidence"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_evidence_variants_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence_variants")),
        sa.UniqueConstraint(
            "evidence_id",
            "variant_type",
            name=op.f("uq_evidence_variants_evidence_id"),
        ),
        sa.UniqueConstraint(
            "storage_key", name=op.f("uq_evidence_variants_storage_key")
        ),
    )


def downgrade() -> None:
    """反向移除照片表，不修改既有查核與人員資料。"""
    op.drop_table("evidence_variants")
    with op.batch_alter_table("evidence_point_links", schema=None) as batch_op:
        batch_op.drop_index("ix_evidence_point_links_source_point_id")

    op.drop_table("evidence_point_links")
    with op.batch_alter_table("evidence", schema=None) as batch_op:
        batch_op.drop_index("ix_evidence_task_item_created_id")
        batch_op.drop_index("ix_evidence_project_id")
        batch_op.drop_index("ix_evidence_item_revision")

    op.drop_table("evidence")
