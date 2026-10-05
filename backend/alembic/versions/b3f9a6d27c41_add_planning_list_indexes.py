"""Add composite indexes for inspection planning list queries (#462).

Only creates indexes; no table is rebuilt and no data changes.

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

# (index name, table, columns). The (parent id, created_at, id) shape
# matches the keyset pagination in ``app.api.pagination.page``.
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
    for name, table, columns in _INDEXES:
        op.create_index(name, table, list(columns))


def downgrade() -> None:
    for name, table, _ in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
