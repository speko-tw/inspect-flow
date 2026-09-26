"""negative probe (temporary, DBF-AC08 evidence only)

Revision ID: f0000000neg1
Revises: e75aa09d633e

SQLite accepts AUTOINCREMENT; PostgreSQL rejects it. The table is
dropped again so the SQLite drift check stays clean.
"""

from alembic import op

revision = "f0000000neg1"
down_revision = "e75aa09d633e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TABLE neg_probe (id INTEGER PRIMARY KEY AUTOINCREMENT)")
    op.execute("DROP TABLE neg_probe")


def downgrade() -> None:
    pass
