"""Allow duplicate project codes and add Project business fields.

Existing rows receive their code as the name and a visible
``未提供`` placeholder for fields that were not previously stored.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9d2b7c6e4a10"
down_revision: str | Sequence[str] | None = "4c38ff477939"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sqlite_foreign_keys(enabled: bool) -> None:
    if op.get_bind().dialect.name == "sqlite":
        # db-dependency: sqlite; batch mode rebuilds referenced projects.
        op.execute("PRAGMA foreign_keys=" + ("ON" if enabled else "OFF"))


def upgrade() -> None:
    """Add columns, backfill existing rows, then require three fields."""
    _sqlite_foreign_keys(False)
    try:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_constraint(
                "uq_projects_project_code", type_="unique"
            )
            batch_op.add_column(sa.Column("name", sa.String(128)))
            batch_op.add_column(sa.Column("client_name", sa.String(128)))
            batch_op.add_column(sa.Column("site_location", sa.String(256)))
            batch_op.add_column(
                sa.Column("planned_start_date", sa.Date(), nullable=True)
            )
            batch_op.add_column(
                sa.Column("planned_completion_date", sa.Date(), nullable=True)
            )

        op.execute(
            sa.text(
                "UPDATE projects SET name = project_code, "
                "client_name = :missing, site_location = :missing"
            ).bindparams(missing="未提供")
        )
        with op.batch_alter_table("projects") as batch_op:
            for column, length in (
                ("name", 128),
                ("client_name", 128),
                ("site_location", 256),
            ):
                batch_op.alter_column(
                    column,
                    existing_type=sa.String(length),
                    nullable=False,
                )
    finally:
        _sqlite_foreign_keys(True)


def downgrade() -> None:
    """Restore the old schema when codes remain unique."""
    _sqlite_foreign_keys(False)
    try:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.drop_column("planned_completion_date")
            batch_op.drop_column("planned_start_date")
            batch_op.drop_column("site_location")
            batch_op.drop_column("client_name")
            batch_op.drop_column("name")
            batch_op.create_unique_constraint(
                "uq_projects_project_code", ["project_code"]
            )
    finally:
        _sqlite_foreign_keys(True)
