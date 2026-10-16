"""Index audit-log actor and event queries (#624).

Revision ID: 8c624a9d70f1
Revises: a497f3d2b601
"""

from collections.abc import Sequence

from alembic import op

revision: str = "8c624a9d70f1"
down_revision: str | Sequence[str] | None = "a497f3d2b601"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 查詢以 created_at、id 降冪分頁，複合索引可支援兩種篩選。
    op.create_index(
        "ix_audit_logs_created_by_created_at_id",
        "audit_logs",
        ["created_by", "created_at", "id"],
    )
    op.create_index(
        "ix_audit_logs_event_type_created_at_id",
        "audit_logs",
        ["event_type", "created_at", "id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_audit_logs_event_type_created_at_id", table_name="audit_logs"
    )
    op.drop_index(
        "ix_audit_logs_created_by_created_at_id", table_name="audit_logs"
    )
