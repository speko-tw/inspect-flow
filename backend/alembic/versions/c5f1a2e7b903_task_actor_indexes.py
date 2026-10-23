"""為 Dashboard 工作量彙總索引實際任務負責人。

Revision ID: c5f1a2e7b903
Revises: b72e4c19f6a3
Create Date: 2026-10-20
"""

from collections.abc import Sequence

from alembic import op

revision: str = "c5f1a2e7b903"
down_revision: str | Sequence[str] | None = "b72e4c19f6a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """IP-R05：索引實際開始與完成任務的人員，支援分組查詢。"""
    op.create_index(
        "ix_inspection_tasks_started_by_id",
        "inspection_tasks",
        ["started_by"],
    )
    op.create_index(
        "ix_inspection_tasks_completed_by_id",
        "inspection_tasks",
        ["completed_by"],
    )


def downgrade() -> None:
    """移除任務人員查詢索引。"""
    op.drop_index(
        "ix_inspection_tasks_completed_by_id",
        table_name="inspection_tasks",
    )
    op.drop_index(
        "ix_inspection_tasks_started_by_id",
        table_name="inspection_tasks",
    )
