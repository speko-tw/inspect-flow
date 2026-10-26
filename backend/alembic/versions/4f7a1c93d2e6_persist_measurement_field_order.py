"""Persist the order of measurement fields."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "4f7a1c93d2e6"
down_revision: str | Sequence[str] | None = "6d2e4f8a91b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 三張量測欄位表：範本、專案、任務快照。前兩張的父層欄位叫
# inspection_point_id，快照表叫 point_id，所以連同欄位名一起列出。
_TABLES = (
    ("template_measurement_fields", "inspection_point_id"),
    ("project_measurement_fields", "inspection_point_id"),
    ("task_snapshot_measurement_fields", "point_id"),
)


def _sqlite_foreign_keys(enabled: bool) -> None:
    if op.get_bind().dialect.name == "sqlite":
        # db-dependency: sqlite; batch mode rebuilds referenced tables.
        op.execute("PRAGMA foreign_keys=" + ("ON" if enabled else "OFF"))


def upgrade() -> None:
    _sqlite_foreign_keys(False)
    try:
        for table, parent_column in _TABLES:
            # 先加可空欄位、回填後再改 NOT NULL，既有資料列才不會在
            # 加欄位當下違反約束。
            op.add_column(table, sa.Column("sort_order", sa.Integer()))
            # TPL-R19：既有資料依原有的 created_at、id 排序，在同一個
            # 查核點內從 0 起編號，保留遷移前的顯示順序。
            op.execute(
                sa.text(
                    f"WITH ranked AS ("
                    f"SELECT id, ROW_NUMBER() OVER ("
                    f"PARTITION BY {parent_column} "
                    "ORDER BY created_at, id) - 1 AS position "
                    f"FROM {table}) "
                    f"UPDATE {table} SET sort_order = ranked.position "
                    f"FROM ranked WHERE {table}.id = ranked.id"
                )
            )
            # SQLite 不能就地改欄位可否為空，需走 batch 重建。
            with op.batch_alter_table(table) as batch:
                batch.alter_column(
                    "sort_order",
                    existing_type=sa.Integer(),
                    nullable=False,
                )
    finally:
        _sqlite_foreign_keys(True)


def downgrade() -> None:
    _sqlite_foreign_keys(False)
    try:
        for table, _ in reversed(_TABLES):
            op.drop_column(table, "sort_order")
    finally:
        _sqlite_foreign_keys(True)
