"""add companies table

Revision ID: 88da78b69aa7
Revises: 78a4ba191ab5
Create Date: 2026-09-26 18:21:53.516372

``Company`` (DOM-R15, DOM-R16, DOM-R17, DOM-Q7's issue #127
decision): the common structure (UUID primary key, created/updated
timestamps and audit columns) plus its own business columns --
``code`` (unique), ``name``, an optional but unique ``tax_id``,
``kind`` (checked to be ``internal``/``customer``), a
self-referential ``parent_id`` (checked to never equal the row's
own ``id``), and ``is_active`` (defaults to enabled both at the
database level, via ``server_default``, and in
``app/models/company.py``).

``code``/``name``/``tax_id``'s length limits (DOM-Q1/DOM-R29) are
enforced here through the column types, which PostgreSQL checks;
SQLite does not enforce ``String`` length, and neither backend's
column type checks the format restrictions (letters/digits/``-``/
``_`` for ``code``, 8 digits for ``tax_id``), so
``app/models/company.py``'s ``@validates`` methods check both
length and format in Python before a value reaches the database.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.base import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "88da78b69aa7"
down_revision: str | Sequence[str] | None = "78a4ba191ab5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "companies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("tax_id", sa.String(length=8), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('internal', 'customer')",
            name=op.f("ck_companies_kind"),
        ),
        sa.CheckConstraint(
            "parent_id <> id",
            name=op.f("ck_companies_parent_id_not_self"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_companies")),
        sa.UniqueConstraint("code", name=op.f("uq_companies_code")),
        sa.UniqueConstraint("tax_id", name=op.f("uq_companies_tax_id")),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["companies.id"],
            name=op.f("fk_companies_parent_id_companies"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_companies_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_companies_updated_by_users"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("companies")
