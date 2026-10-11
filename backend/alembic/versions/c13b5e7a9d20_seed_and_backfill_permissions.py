"""建立預設角色並回填模組權限。

Revision ID: c13b5e7a9d20
Revises: 6eaaafbe0ef2
Create Date: 2026-10-11

此資料 migration 不匯入應用程式程式碼。權限碼清單固定為當時的 registry
快照，避免 runtime registry 變動後影響歷史 migration（DOM-R68）。
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

revision: str = "c13b5e7a9d20"
down_revision: str | Sequence[str] | None = "6eaaafbe0ef2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PROJECT_CODES = (
    "project_member.manage",
    "project.update",
    "project.read",
    "project_inspection_item.edit",
    "project_inspection_item.read",
    "project_zone.read",
    "project_zone.manage",
    "inspection_plan.read",
    "inspection_plan.create",
    "inspection_plan.manage",
    "inspection_plan.archive",
    "inspection_plan.unarchive",
    "inspection_task.read",
    "inspection_task.manage",
    "inspection_task.create",
    "inspection_task.dispatch",
    "inspection_task.assign",
    "inspection_task.inspect",
    "inspection_task.delete_draft",
    "inspection_task.cancel",
)
_PROJECT_READ_CODES = (
    "project.read",
    "project_inspection_item.read",
    "project_zone.read",
    "inspection_plan.read",
    "inspection_task.read",
)
_ROLE_PRESETS = (
    # DOM-R68：專案工程師不含舊有的查核執行權限，其餘專案範圍權限照常保留。
    (
        "專案工程師",
        tuple(
            code
            for code in _PROJECT_CODES
            if code != "inspection_task.inspect"
        ),
        False,
        False,
    ),
    (
        "現場工程師",
        (*_PROJECT_READ_CODES, "inspection_task.inspect"),
        True,
        False,
    ),
    ("專案查閱人員", _PROJECT_READ_CODES, True, True),
)
_BUNDLE_PRESETS = (
    # 固定 migration 快照，與 DOM-R68 預設權限組合一致。
    ("公司主管", ("project.use", "all_project_progress.read")),
    (
        "專案工程師常用",
        ("project.use", "project.create", "inspection.use", "template.use"),
    ),
    ("現場工程師常用", ("project.use", "inspection.use")),
)

users = sa.table(
    "users",
    sa.column("id", sa.Uuid()),
    sa.column("is_system", sa.Boolean()),
)
roles = sa.table(
    "roles",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String(64)),
    sa.column("is_assignable", sa.Boolean()),
    sa.column("is_external_allowed", sa.Boolean()),
    sa.column("created_by", sa.Uuid()),
    sa.column("updated_by", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
role_permissions = sa.table(
    "role_permissions",
    sa.column("id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
    sa.column("code", sa.String(64)),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
creator_role_settings = sa.table(
    "creator_role_settings",
    sa.column("id", sa.Uuid()),
    sa.column("setting_key", sa.String(32)),
    sa.column("role_id", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
permission_bundles = sa.table(
    "permission_bundles",
    sa.column("id", sa.Uuid()),
    sa.column("name", sa.String(64)),
    sa.column("created_by", sa.Uuid()),
    sa.column("updated_by", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
permission_bundle_permissions = sa.table(
    "permission_bundle_permissions",
    sa.column("id", sa.Uuid()),
    sa.column("bundle_id", sa.Uuid()),
    sa.column("permission_code", sa.String(64)),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
user_module_permissions = sa.table(
    "user_module_permissions",
    sa.column("id", sa.Uuid()),
    sa.column("user_id", sa.Uuid()),
    sa.column("permission_code", sa.String(64)),
    sa.column("source", sa.String(16)),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
)
project_members = sa.table(
    "project_members",
    sa.column("user_id", sa.Uuid()),
    sa.column("id", sa.Uuid()),
)
project_member_roles = sa.table(
    "project_member_roles",
    sa.column("project_member_id", sa.Uuid()),
    sa.column("role_id", sa.Uuid()),
)
system_role_assignments = sa.table(
    "system_role_assignments",
    sa.column("user_id", sa.Uuid()),
    sa.column("role_code", sa.String(64)),
)


def _timestamp() -> datetime:
    return datetime.now(UTC)


def _find_named_id(connection, table, name: str):
    return connection.execute(
        sa.select(table.c.id).where(
            sa.func.lower(table.c.name) == name.lower()
        )
    ).scalar_one_or_none()


def _seed_presets(connection, actor_id) -> None:
    """只建立不存在的名稱，保留管理員已設定的內容。

    依 DOM-AC63 以名稱冪等建立，重跑時不覆寫已設定的角色或權限組合。
    """
    role_ids: dict[str, uuid.UUID] = {}
    now = _timestamp()
    for name, codes, assignable, external_allowed in _ROLE_PRESETS:
        role_id = _find_named_id(connection, roles, name)
        if role_id is None:
            role_id = uuid.uuid4()
            connection.execute(
                roles.insert().values(
                    id=role_id,
                    name=name,
                    is_assignable=assignable,
                    is_external_allowed=external_allowed,
                    created_by=actor_id,
                    updated_by=actor_id,
                    created_at=now,
                    updated_at=now,
                )
            )
            connection.execute(
                role_permissions.insert(),
                [
                    {
                        "id": uuid.uuid4(),
                        "role_id": role_id,
                        "code": code,
                        "created_at": now,
                        "updated_at": now,
                    }
                    for code in codes
                ],
            )
        role_ids[name] = role_id

    setting_id = connection.execute(
        sa.select(creator_role_settings.c.id).where(
            creator_role_settings.c.setting_key == "creator_role"
        )
    ).scalar_one_or_none()
    if setting_id is None:
        connection.execute(
            creator_role_settings.insert().values(
                id=uuid.uuid4(),
                setting_key="creator_role",
                role_id=role_ids["專案工程師"],
                created_at=now,
                updated_at=now,
            )
        )

    for name, codes in _BUNDLE_PRESETS:
        bundle_id = _find_named_id(connection, permission_bundles, name)
        if bundle_id is not None:
            continue
        bundle_id = uuid.uuid4()
        connection.execute(
            permission_bundles.insert().values(
                id=bundle_id,
                name=name,
                created_by=actor_id,
                updated_by=actor_id,
                created_at=now,
                updated_at=now,
            )
        )
        connection.execute(
            permission_bundle_permissions.insert(),
            [
                {
                    "id": uuid.uuid4(),
                    "bundle_id": bundle_id,
                    "permission_code": code,
                    "created_at": now,
                    "updated_at": now,
                }
                for code in codes
            ],
        )


def _insert_backfill_permission(connection, user_id, code: str, now) -> None:
    """新增 migration 回填的模組權限，且不變更既有資料列。

    `backfill` 來源只用於 UserModulePermission（DOM-R59）；既有手動或權限組合
    授權保留原始來源。
    """
    existing = connection.execute(
        sa.select(user_module_permissions.c.id).where(
            user_module_permissions.c.user_id == user_id,
            user_module_permissions.c.permission_code == code,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return
    connection.execute(
        user_module_permissions.insert().values(
            id=uuid.uuid4(),
            user_id=user_id,
            permission_code=code,
            source="backfill",
            created_at=now,
            updated_at=now,
        )
    )


def upgrade() -> None:
    """建立預設資料，並將舊權限轉換為等效的新授權。

    DOM-AC56/AC63 要求冪等建立；AUT-AC74 限制有效權限差異為符合條件角色新增
    `project.read`。此 revision 只執行 DML，避免 PostgreSQL 同一交易對同表先
    DML 再 ALTER 所造成的 pending trigger events。
    """
    connection = op.get_bind()
    actor_id = connection.execute(
        sa.select(users.c.id)
        .order_by(users.c.is_system.desc(), users.c.id)
        .limit(1)
    ).scalar_one_or_none()
    if actor_id is not None:
        _seed_presets(connection, actor_id)

    now = _timestamp()
    member_user_ids = (
        connection.execute(sa.select(project_members.c.user_id).distinct())
        .scalars()
        .all()
    )
    for user_id in member_user_ids:
        # 舊專案成員可使用兩個模組；依 AUT-AC74，新增模組檢查後仍須保留此權限。
        _insert_backfill_permission(connection, user_id, "project.use", now)
        _insert_backfill_permission(connection, user_id, "inspection.use", now)

    template_admin_ids = (
        connection.execute(
            sa.select(system_role_assignments.c.user_id)
            .where(system_role_assignments.c.role_code == "template_admin")
            .distinct()
        )
        .scalars()
        .all()
    )
    for user_id in template_admin_ids:
        # 保留範本管理者原有的管理與使用權限。
        _insert_backfill_permission(
            connection, user_id, "template.manage", now
        )
        _insert_backfill_permission(connection, user_id, "template.use", now)

    template_applicator_ids = (
        connection.execute(
            sa.select(project_members.c.user_id)
            .join(
                project_member_roles,
                project_member_roles.c.project_member_id
                == project_members.c.id,
            )
            .join(
                role_permissions,
                role_permissions.c.role_id == project_member_roles.c.role_id,
            )
            .where(role_permissions.c.code == "project_inspection_item.edit")
            .distinct()
        )
        .scalars()
        .all()
    )
    for user_id in template_applicator_ids:
        # 舊制以查核項目編輯權限代表可套用範本。
        _insert_backfill_permission(connection, user_id, "template.use", now)

    roles_with_project_permissions = (
        connection.execute(
            sa.select(role_permissions.c.role_id)
            .where(role_permissions.c.code.in_(_PROJECT_CODES))
            .distinct()
        )
        .scalars()
        .all()
    )
    for role_id in roles_with_project_permissions:
        # DOM-R68 要求專案範圍角色具備 project.read；只補缺少的這項，保留其餘
        # 角色權限（AUT-AC74）。
        has_project_read = connection.execute(
            sa.select(role_permissions.c.id).where(
                role_permissions.c.role_id == role_id,
                role_permissions.c.code == "project.read",
            )
        ).scalar_one_or_none()
        if has_project_read is None:
            now = _timestamp()
            connection.execute(
                role_permissions.insert().values(
                    id=uuid.uuid4(),
                    role_id=role_id,
                    code="project.read",
                    created_at=now,
                    updated_at=now,
                )
            )


def downgrade() -> None:
    """保留 upgrade 後可能已變更的授權與預設資料。"""
    # 回復資料回填可能撤銷合理權限（AUT-AC74），因此不刪除回填資料。
    pass
