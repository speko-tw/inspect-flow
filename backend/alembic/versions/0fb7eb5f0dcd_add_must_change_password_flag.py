"""add must change password flag

Revision ID: 0fb7eb5f0dcd
Revises: 600b0736442e
Create Date: 2026-09-27 01:52:41.178195

``UserPassword.must_change_password`` (AUT-R32): whether this
password is temporary and must be changed before the account can
use anything beyond AUT-R33's allowlist. Not nullable, defaulting to
``false`` for every existing row -- ``user_passwords`` may already
hold data by the time this migration runs, unlike the tables added
alongside it in ``09f4dbabea8f``.

Uses ``op.batch_alter_table`` like ``22bfdd8a72a4``/``600b0736442e``
before it: SQLite has no native ``ALTER TABLE ... ADD COLUMN ...
NOT NULL`` without a default, so batch mode rebuilds the table (a
copy-and-rename) on that backend; ``alembic/env.py`` only turns on
``render_as_batch`` for SQLite, so this still emits a plain
``ALTER TABLE ... ADD COLUMN`` on PostgreSQL.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0fb7eb5f0dcd"
down_revision: str | Sequence[str] | None = "600b0736442e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("user_passwords", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "must_change_password",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("user_passwords", schema=None) as batch_op:
        batch_op.drop_column("must_change_password")
