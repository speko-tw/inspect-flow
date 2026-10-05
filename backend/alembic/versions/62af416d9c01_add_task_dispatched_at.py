"""Store the first dispatch time on inspection tasks.

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
    op.drop_column("inspection_tasks", "dispatched_at")
