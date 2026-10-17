"""轉換外部範本管理員讀取權限並移除舊指派表。"""

from collections.abc import Sequence
from datetime import UTC, datetime
from uuid import uuid4

import sqlalchemy as sa

from alembic import op

revision: str = "b72e4c19f6a3"
down_revision: str | None = "9b7a6c2d1e45"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """依 #538 與 #612 保留外部歷史管理員的唯讀範本權限。"""
    connection = op.get_bind()
    legacy_assignments = sa.table(
        "system_role_assignments",
        sa.column("user_id", sa.Uuid()),
        sa.column("role_code", sa.String(64)),
    )
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("is_admin", sa.Boolean()),
        sa.column("is_external_collaborator", sa.Boolean()),
    )
    permissions = sa.table(
        "user_module_permissions",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("permission_code", sa.String(64)),
        sa.column("source", sa.String(16)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
    )
    external_ids = (
        connection.execute(
            sa.select(legacy_assignments.c.user_id)
            .join(users, users.c.id == legacy_assignments.c.user_id)
            .where(legacy_assignments.c.role_code == "template_admin")
            .where(users.c.is_admin.is_(False))
            .where(users.c.is_external_collaborator.is_(True))
            .distinct()
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for user_id in external_ids:
        # #538 規則 25.3 與 PR #612 限制外部協作者的範本權限。
        connection.execute(
            permissions.delete()
            .where(permissions.c.user_id == user_id)
            .where(permissions.c.permission_code == "template.manage")
        )
        has_read_permission = connection.execute(
            sa.select(permissions.c.id)
            .where(permissions.c.user_id == user_id)
            .where(permissions.c.permission_code == "template.use")
            .limit(1)
        ).first()
        if has_read_permission is None:
            connection.execute(
                permissions.insert().values(
                    id=uuid4(),
                    user_id=user_id,
                    permission_code="template.use",
                    source="backfill",
                    created_at=now,
                    updated_at=now,
                )
            )
    op.drop_table("system_role_assignments")


def downgrade() -> None:
    """還原舊表結構；已轉換的權限仍由模組權限表保存。"""
    op.create_table(
        "system_role_assignments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role_code", sa.String(64), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_system_role_assignments_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_system_role_assignments_updated_by_users"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "role_code"),
        sa.CheckConstraint(
            "role_code IN ('template_admin')",
            name="system_role_code_is_fixed",
        ),
    )
