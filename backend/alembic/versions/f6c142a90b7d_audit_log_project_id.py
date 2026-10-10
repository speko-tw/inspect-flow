"""Store the project context of new audit events (#412).

Revision ID: f6c142a90b7d
Revises: d5a2c8e7b194
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f6c142a90b7d"
down_revision: str | Sequence[str] | None = "d5a2c8e7b194"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "audit_logs", sa.Column("project_id", sa.Uuid(), nullable=True)
    )
    op.create_index("ix_audit_logs_project_id", "audit_logs", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_project_id", table_name="audit_logs")
    op.drop_column("audit_logs", "project_id")
