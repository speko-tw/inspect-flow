"""baseline

Revision ID: e75aa09d633e
Revises:
Create Date: 2026-09-26 15:28:21.100351

Empty baseline migration (DBF-R02): the first entry in this
project's migration chain, and it creates no tables. It exists so
that later migrations have a single, well-defined starting point
(``down_revision = None``) to chain from, rather than each of them
racing to be the chain's root.
"""

from collections.abc import Sequence

# sa and op are unused in an empty migration (e.g. the baseline);
# the template keeps them so every migration starts with both.
import sqlalchemy as sa  # noqa: F401

from alembic import op  # noqa: F401

# revision identifiers, used by Alembic.
revision: str = "e75aa09d633e"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
