"""IP-R23：專案查核項目可停用，既有資料一律啟用。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d717a4c9e201"
down_revision: str | None = "a515c0f9e2d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """附加欄位與預設值，保留來源項目、快照及外鍵。"""
    op.add_column(
        "project_inspection_items",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    """移除選用旗標，不刪除項目或任務資料。"""
    op.drop_column("project_inspection_items", "is_active")
