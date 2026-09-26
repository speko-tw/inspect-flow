"""add users and projects tables

Revision ID: 78a4ba191ab5
Revises: e75aa09d633e
Create Date: 2026-09-26 17:19:59.733201

``User``, ``Project`` common structure only (DBF-R11, DBF-R12,
DBF-R13, DBF-R14): a UUID primary key, a unique business number
(``employee_no``/``project_code``), and the created/updated audit
columns. Business columns are added by later migrations (see
``app/models/user.py``, ``app/models/project.py``).

``users`` is created before ``projects`` so its self-referential
``created_by``/``updated_by`` foreign keys, and the ones
``projects`` points at ``users.id``, always have a target table
that already exists.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.base import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "78a4ba191ab5"
down_revision: str | Sequence[str] | None = "e75aa09d633e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("employee_no", sa.String(), nullable=False),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("employee_no", name=op.f("uq_users_employee_no")),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_users_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_users_updated_by_users"),
        ),
    )
    op.create_table(
        "projects",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("project_code", sa.String(), nullable=False),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
        sa.UniqueConstraint(
            "project_code", name=op.f("uq_projects_project_code")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_projects_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_projects_updated_by_users"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("projects")
    op.drop_table("users")
