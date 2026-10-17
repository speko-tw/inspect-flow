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
    """僅在權限可忠實還原時重建舊範本管理者指派。

    #575 回填非 Admin 舊管理者；此處為 Admin 舊角色加標記。
    外部使用者只有在仍有舊制專案讀取權限時才可降版；否則拒絕，
    因舊制範本讀取不認得 template.use。其他來源可能是手動授權，
    無法判斷是否曾有舊角色，也拒絕猜測。外部指派依 #612 不還原。
    拒絕時先提供受影響 ID 與 PR-13 備份還原或調整授權的指引。
    """
    connection = op.get_bind()
    users = sa.table(
        "users",
        sa.column("id", sa.Uuid()),
        sa.column("is_admin", sa.Boolean()),
        sa.column("is_external_collaborator", sa.Boolean()),
    )
    permissions = sa.table(
        "user_module_permissions",
        sa.column("user_id", sa.Uuid()),
        sa.column("permission_code", sa.String(64)),
        sa.column("source", sa.String(16)),
    )
    project_members = sa.table(
        "project_members",
        sa.column("id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
    )
    project_member_roles = sa.table(
        "project_member_roles",
        sa.column("project_member_id", sa.Uuid()),
        sa.column("role_id", sa.Uuid()),
    )
    roles = sa.table("roles", sa.column("id", sa.Uuid()))
    role_permissions = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid()),
        sa.column("code", sa.String(64)),
    )
    external_readers = (
        sa.select(users.c.id)
        .join(permissions, permissions.c.user_id == users.c.id)
        .where(users.c.is_external_collaborator.is_(True))
        .where(permissions.c.permission_code == "template.use")
        .where(permissions.c.source == "backfill")
        .where(
            ~sa.exists(
                sa.select(1)
                .select_from(
                    project_members.join(
                        project_member_roles,
                        project_member_roles.c.project_member_id
                        == project_members.c.id,
                    )
                    .join(
                        roles,
                        roles.c.id == project_member_roles.c.role_id,
                    )
                    .join(
                        role_permissions,
                        role_permissions.c.role_id == roles.c.id,
                    )
                )
                .where(project_members.c.user_id == users.c.id)
                .where(
                    role_permissions.c.code == "project_inspection_item.edit"
                )
            )
        )
        .distinct()
    )
    external_ids = list(connection.execute(external_readers).scalars().all())
    ambiguous_ids = list(
        connection.execute(
            sa.select(permissions.c.user_id)
            .join(users, users.c.id == permissions.c.user_id)
            .where(permissions.c.permission_code == "template.manage")
            .where(permissions.c.source != "backfill")
            .where(users.c.is_external_collaborator.is_(False))
            .distinct()
        )
        .scalars()
        .all()
    )
    if external_ids or ambiguous_ids:
        raise RuntimeError(
            _downgrade_block_message(external_ids, ambiguous_ids)
        )

    legacy_assignments = sa.table(
        "system_role_assignments",
        sa.column("id", sa.Uuid()),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("updated_at", sa.DateTime(timezone=True)),
        sa.column("created_by", sa.Uuid()),
        sa.column("updated_by", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
        sa.column("role_code", sa.String(64)),
    )

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
    internal_manager_ids = (
        connection.execute(
            sa.select(permissions.c.user_id)
            .join(users, users.c.id == permissions.c.user_id)
            .where(permissions.c.permission_code == "template.manage")
            .where(permissions.c.source == "backfill")
            .where(users.c.is_external_collaborator.is_(False))
            .distinct()
        )
        .scalars()
        .all()
    )
    now = datetime.now(UTC)
    for user_id in internal_manager_ids:
        connection.execute(
            legacy_assignments.insert().values(
                id=uuid4(),
                created_at=now,
                updated_at=now,
                created_by=user_id,
                updated_by=user_id,
                user_id=user_id,
                role_code="template_admin",
            )
        )


def _downgrade_block_message(
    external_ids: list[object], ambiguous_ids: list[object]
) -> str:
    """提供無法安全降版的資料分類、帳號 ID 與處置方式。"""
    details: list[str] = []
    for label, user_ids in (
        ("外部唯讀權限會失效", external_ids),
        ("內部非 backfill 管理權限", ambiguous_ids),
    ):
        if not user_ids:
            continue
        shown = ", ".join(str(user_id) for user_id in user_ids[:20])
        details.append(f"{label}：{shown}；共 {len(user_ids)} 人")
    return (
        "無法安全降版；"
        + "；".join(details)
        + "。請以升級前的資料庫備份還原（PR-13），或先移除／調整"
        "上述授權後再降版。"
    )
