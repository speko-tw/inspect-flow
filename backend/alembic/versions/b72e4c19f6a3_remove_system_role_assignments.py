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
    admin_legacy_ids = (
        connection.execute(
            sa.select(legacy_assignments.c.user_id)
            .join(users, users.c.id == legacy_assignments.c.user_id)
            .where(legacy_assignments.c.role_code == "template_admin")
            .where(users.c.is_admin.is_(True))
            .where(users.c.is_external_collaborator.is_(False))
            .distinct()
        )
        .scalars()
        .all()
    )
    for user_id in admin_legacy_ids:
        # 保存 Admin 降權後仍需的讀寫權限與降版線索。
        for code in ("template.manage", "template.use"):
            has_permission = connection.execute(
                sa.select(permissions.c.id)
                .where(permissions.c.user_id == user_id)
                .where(permissions.c.permission_code == code)
                .limit(1)
            ).first()
            if has_permission is None:
                connection.execute(
                    permissions.insert().values(
                        id=uuid4(),
                        user_id=user_id,
                        permission_code=code,
                        source="backfill",
                        created_at=now,
                        updated_at=now,
                    )
                )
    op.drop_table("system_role_assignments")


def downgrade() -> None:
    """僅當沒有範本權限資料時重建空的舊指派表。

    依 database-foundation 規格 §165，migration 不保證能降版；PR-13
    以資料庫備份作為主要回滾方式。升級會移除舊指派列，無法完整
    保留 ID 與稽核 metadata，也無法從兩種模組權限推回原角色與來源。
    因此只要還有任一範本權限列，就拒絕降版。
    """
    connection = op.get_bind()
    permissions = sa.table(
        "user_module_permissions",
        sa.column("user_id", sa.Uuid()),
        sa.column("permission_code", sa.String(64)),
    )
    affected_ids = list(
        connection.execute(
            sa.select(permissions.c.user_id)
            .where(
                permissions.c.permission_code.in_(
                    {"template.manage", "template.use"}
                )
            )
            .distinct()
            .order_by(permissions.c.user_id)
        )
        .scalars()
        .all()
    )
    if affected_ids:
        raise RuntimeError(_downgrade_block_message(affected_ids))

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
    # 不重建指派列，避免製造無法還原的 ID 與稽核 metadata。


def _downgrade_block_message(
    affected_ids: list[object],
) -> str:
    """提供不支援降版的原因、帳號清單與備份處置方式。"""
    shown = ", ".join(str(user_id) for user_id in affected_ids[:20])
    return (
        "此 migration 不支援含範本權限資料的降版；受影響使用者："
        f"{shown}；共 {len(affected_ids)} 人。"
        "請以升級前的資料庫備份還原（PR-13）。"
    )
