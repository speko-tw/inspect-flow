"""narrow employee_no and project_code lengths

Revision ID: 22bfdd8a72a4
Revises: 78a4ba191ab5
Create Date: 2026-09-26 18:08:15.875303

Narrows ``users.employee_no`` to ``VARCHAR(16)`` and
``projects.project_code`` to ``VARCHAR(32)``, per DOM-Q1's ruling
(#121): ``employee_no`` is a settled limit, while ``project_code``
is a provisional value carried over from ``employee_no`` pending
``Project``'s own business columns (OQ-01) -- see the PR description
for that caveat.

T4 (#59, PR #120) created both columns as an unbounded ``String()``
because the limit was undecided at the time; see
``app/models/user.py``/``app/models/project.py`` for the matching
model change.

Uses ``op.batch_alter_table`` for both tables: SQLite has no native
``ALTER COLUMN ... TYPE`` support, so a plain ``op.alter_column``
would fail against it (unlike PostgreSQL, where batch mode is a
no-op wrapper and this runs as a direct ``ALTER COLUMN``). Batch
mode reflects each table's current definition -- including its
unique constraint and self-referential foreign keys -- before
rebuilding it, so those are preserved rather than dropped.

On SQLite, batch mode rebuilds ``users`` by copying its rows into a
new table and dropping the old one; with
``PRAGMA foreign_keys=ON`` (the app's own connection setup, see
``app/db/engine.py``'s ``configure_sqlite_connection``), that
implicit ``DROP TABLE users`` is rejected once any ``projects`` row
exists, since it still references the about-to-be-dropped table by
name. ``PRAGMA foreign_keys`` is toggled off for the duration of
both alters and restored before returning, on SQLite only --
PostgreSQL has no such pragma and does not hit this in the first
place (batch mode is a direct ``ALTER COLUMN`` there, not a table
rebuild).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "22bfdd8a72a4"
down_revision: str | Sequence[str] | None = "78a4ba191ab5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    is_sqlite = op.get_bind().dialect.name == "sqlite"
    if is_sqlite:
        op.execute("PRAGMA foreign_keys=OFF")
    try:
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "employee_no",
                existing_type=sa.String(),
                type_=sa.String(16),
                existing_nullable=False,
            )
        with op.batch_alter_table("projects") as batch_op:
            batch_op.alter_column(
                "project_code",
                existing_type=sa.String(),
                type_=sa.String(32),
                existing_nullable=False,
            )
    finally:
        if is_sqlite:
            op.execute("PRAGMA foreign_keys=ON")


def downgrade() -> None:
    """Downgrade schema."""
    is_sqlite = op.get_bind().dialect.name == "sqlite"
    if is_sqlite:
        op.execute("PRAGMA foreign_keys=OFF")
    try:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.alter_column(
                "project_code",
                existing_type=sa.String(32),
                type_=sa.String(),
                existing_nullable=False,
            )
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "employee_no",
                existing_type=sa.String(16),
                type_=sa.String(),
                existing_nullable=False,
            )
    finally:
        if is_sqlite:
            op.execute("PRAGMA foreign_keys=ON")
