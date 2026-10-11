"""支援 #462 的規劃清單 cursor 查詢而不重建資料表。

只建立索引，既有資料與外鍵均保留。

Revision ID: b3f9a6d27c41
Revises: 62af416d9c01
Create Date: 2026-10-05
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b3f9a6d27c41"
down_revision: str | Sequence[str] | None = "62af416d9c01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (index name, table, columns)；父 id、created_at、id 的順序
# 對應 app.api.pagination.page 的 keyset 分頁，避免掃描無關專案。
_INDEXES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    (
        "ix_inspection_tasks_project_created_id",
        "inspection_tasks",
        ("project_id", "created_at", "id"),
    ),
    (
        "ix_inspection_tasks_plan_created_id",
        "inspection_tasks",
        ("plan_id", "created_at", "id"),
    ),
    (
        "ix_inspection_tasks_assignee_id",
        "inspection_tasks",
        ("assignee_id",),
    ),
    (
        "ix_inspection_plans_project_created_id",
        "inspection_plans",
        ("project_id", "created_at", "id"),
    ),
    (
        "ix_project_inspection_items_project_created_id",
        "project_inspection_items",
        ("project_id", "created_at", "id"),
    ),
)


def upgrade() -> None:
    """新增規劃清單索引，維持 cursor 分頁的查詢成本。"""
    for name, table, columns in _INDEXES:
        op.create_index(name, table, list(columns))


def downgrade() -> None:
    """以相反順序移除本次新增的清單索引。"""
    for name, table, _ in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
