"""Add interval and tolerance forms to numeric standards."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a8356e4c12b0"
down_revision: str | Sequence[str] | None = "325e0f21a831"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("template_numeric_standards", "project_numeric_standards")


def upgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch:
            batch.alter_column(
                "value", existing_type=sa.String(), nullable=True
            )
            batch.add_column(sa.Column("range_form", sa.String(16)))
            batch.add_column(sa.Column("lower_bound", sa.String()))
            batch.add_column(sa.Column("upper_bound", sa.String()))
        op.execute(
            sa.text(
                f"UPDATE {table} SET range_form = 'tolerance' "
                "WHERE condition = 'range'"
            )
        )


def downgrade() -> None:
    for table in _TABLES:
        connection = op.get_bind()
        interval_count = connection.execute(
            sa.text(
                f"SELECT count(*) FROM {table} "
                "WHERE condition = 'range' AND range_form = 'interval'"
            )
        ).scalar_one()
        if interval_count:
            raise RuntimeError("interval standards cannot be downgraded")
        with op.batch_alter_table(table) as batch:
            batch.drop_column("upper_bound")
            batch.drop_column("lower_bound")
            batch.drop_column("range_form")
            batch.alter_column(
                "value", existing_type=sa.String(), nullable=False
            )
