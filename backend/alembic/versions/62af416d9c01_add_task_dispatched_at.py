"""依 IP-R11（dispatched_at）保存首次派送時間，避免改寫排序基準。

Revision ID: 62af416d9c01
Revises: 4f7a1c93d2e6
Create Date: 2026-10-05
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "62af416d9c01"
down_revision: str | Sequence[str] | None = "4f7a1c93d2e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增派送時間；既有非草稿以建立時間近似回填。"""
    # 只增欄、不重建 Task 表（IP-R11（dispatched_at））。
    op.add_column(
        "inspection_tasks",
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        sa.text(
            "UPDATE inspection_tasks SET dispatched_at = created_at "
            "WHERE status != 'DRAFT'"
        )
    )


def downgrade() -> None:
    """移除派送時間欄位，還原舊版 Task 結構。"""
    op.drop_column("inspection_tasks", "dispatched_at")
