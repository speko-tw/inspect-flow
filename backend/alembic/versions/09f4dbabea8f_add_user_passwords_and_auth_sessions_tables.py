"""add user passwords and auth sessions tables

Revision ID: 09f4dbabea8f
Revises: 78a4ba191ab5
Create Date: 2026-09-26 18:16:02.426790

``UserPassword``, ``AuthSession``: the two entities the
`authentication` spec's "資料" section adds on top of `User`'s
common structure. Both share that common structure (a UUID primary
key and the created/updated audit columns) plus their own
spec-defined columns (see ``app/models/user_password.py``,
``app/models/auth_session.py``).
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.db.base import UTCDateTime

# revision identifiers, used by Alembic.
revision: str = "09f4dbabea8f"
down_revision: str | Sequence[str] | None = "78a4ba191ab5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "user_passwords",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_passwords")),
        sa.UniqueConstraint("user_id", name=op.f("uq_user_passwords_user_id")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_passwords_user_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_user_passwords_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_user_passwords_updated_by_users"),
        ),
    )
    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.UniqueConstraint(
            "token_hash", name=op.f("uq_auth_sessions_token_hash")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_auth_sessions_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_auth_sessions_updated_by_users"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("auth_sessions")
    op.drop_table("user_passwords")
