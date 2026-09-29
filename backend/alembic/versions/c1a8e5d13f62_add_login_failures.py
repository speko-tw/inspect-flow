"""Add failed password checks and lockout deadline (AUT-R28).

Revision ID: c1a8e5d13f62
Revises: 9d2b7c6e4a10
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c1a8e5d13f62"
down_revision: str | Sequence[str] | None = "9d2b7c6e4a10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "login_counters",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("locked_until", sa.DateTime(timezone=True)),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_table(
        "login_failures",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_login_failures_user_time",
        "login_failures",
        ["user_id", "failed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_login_failures_user_time", "login_failures")
    op.drop_table("login_failures")
    op.drop_table("login_counters")
