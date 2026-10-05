"""Allow one photo requirement per inspection point (#464).

Merges any duplicated requirement rows (keeping the largest
``min_count``) and then adds a unique index. Only rows are deleted and
indexes created; no table is rebuilt, so foreign keys stay untouched.

Revision ID: d5a2c8e7b194
Revises: b3f9a6d27c41
Create Date: 2026-10-06
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d5a2c8e7b194"
down_revision: str | Sequence[str] | None = "b3f9a6d27c41"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (table, unique index name)
_TABLES: tuple[tuple[str, str], ...] = (
    ("template_evidence_requirements", "uq_template_evidence_point_type"),
    ("project_evidence_requirements", "uq_project_evidence_point_type"),
)


def _merge_duplicates(table: str) -> None:
    # Keep, per (point, type), the row with the largest min_count; ties
    # keep the earliest created row (then the smallest id).
    op.execute(
        sa.text(
            f"DELETE FROM {table} WHERE EXISTS ("
            f"SELECT 1 FROM {table} AS other "
            f"WHERE other.inspection_point_id = "
            f"{table}.inspection_point_id "
            f"AND other.evidence_type = {table}.evidence_type "
            f"AND (other.min_count > {table}.min_count "
            f"OR (other.min_count = {table}.min_count "
            f"AND (other.created_at < {table}.created_at "
            f"OR (other.created_at = {table}.created_at "
            f"AND other.id < {table}.id)))))"
        )
    )


def upgrade() -> None:
    for table, index_name in _TABLES:
        _merge_duplicates(table)
        op.create_index(
            index_name,
            table,
            ["inspection_point_id", "evidence_type"],
            unique=True,
        )


def downgrade() -> None:
    for table, index_name in reversed(_TABLES):
        op.drop_index(index_name, table_name=table)
