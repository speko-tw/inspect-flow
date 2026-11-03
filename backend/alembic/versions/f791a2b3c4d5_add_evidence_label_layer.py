"""FEV-R22、R07：保存圖層及照片來源。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f791a2b3c4d5"
down_revision: str | Sequence[str] | None = "e802a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DEFAULT_LAYER = {
    "enabled": True,
    "corner": "bottom_left",
    "offset_x": 0,
    "offset_y": 0,
    "size": "medium",
    "style": "dark",
    "overrides": {},
}


def upgrade() -> None:
    """保留未記錄來源的舊照片，並回填預設圖層。"""
    op.add_column(
        "evidence",
        sa.Column("capture_source", sa.String(length=8), nullable=True),
    )
    op.add_column(
        "evidence",
        sa.Column("label_layer", sa.JSON(none_as_null=True), nullable=True),
    )
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE evidence SET label_layer = :default "
            "WHERE label_layer IS NULL"
        ).bindparams(sa.bindparam("default", type_=sa.JSON())),
        {"default": _DEFAULT_LAYER},
    )
    with op.batch_alter_table("evidence") as batch:
        batch.alter_column("label_layer", nullable=False)
        batch.create_check_constraint(
            "capture_source_valid",
            "capture_source IS NULL OR "
            "capture_source IN ('camera', 'library')",
        )


def downgrade() -> None:
    """回復 T1 schema；圖層與來源欄位隨 migration 移除。"""
    with op.batch_alter_table("evidence") as batch:
        batch.drop_constraint(
            op.f("ck_evidence_capture_source_valid"), type_="check"
        )
        batch.drop_column("label_layer")
        batch.drop_column("capture_source")
