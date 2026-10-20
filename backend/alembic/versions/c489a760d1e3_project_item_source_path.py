"""保存專案查核項目套用時的來源分類與系統名稱。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c489a760d1e3"
down_revision: str | None = "b72e4c19f6a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增可空快照欄位，舊資料不依不唯一名稱推測來源路徑。"""
    op.add_column(
        "project_inspection_items",
        sa.Column("source_category_name", sa.String(), nullable=True),
    )
    op.add_column(
        "project_inspection_items",
        sa.Column("source_system_name", sa.String(), nullable=True),
    )


def downgrade() -> None:
    """移除新增欄位。"""
    op.drop_column("project_inspection_items", "source_system_name")
    op.drop_column("project_inspection_items", "source_category_name")
