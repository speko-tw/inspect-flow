"""建立缺少的預設角色、建立者設定與權限組合。

依 DOM-R68 與 DOM-AC63，以名稱冪等建立，保留初始化後管理員所做的調整。
"""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Role,
    RolePermission,
)
from app.permission_codes import PermissionCode, permission_code_scope

_BUNDLES = {
    "公司主管": ("project.use", "all_project_progress.read"),
    "專案工程師常用": (
        "project.use",
        "project.create",
        "inspection.use",
        "template.use",
    ),
    "現場工程師常用": ("project.use", "inspection.use"),
}


def _role_presets() -> tuple[tuple[str, tuple[str, ...], bool, bool], ...]:
    """依專案範圍權限碼建立預設角色。

    模組使用權限與角色權限內容分開管理。
    """
    project_codes = {
        item.value
        for item in PermissionCode
        if permission_code_scope(item.value) == "project"
    }
    read_codes = tuple(
        sorted(code for code in project_codes if code.endswith(".read"))
    )
    return (
        (
            "專案工程師",
            tuple(sorted(project_codes - {"inspection_task.inspect"})),
            False,
            False,
        ),
        (
            "現場工程師",
            tuple(sorted(set(read_codes) | {"inspection_task.inspect"})),
            True,
            False,
        ),
        ("專案查閱人員", read_codes, True, True),
    )


def _named_role(session: Session, name: str) -> Role | None:
    return session.scalar(
        select(Role).where(func.lower(Role.name) == name.lower())
    )


def _named_bundle(session: Session, name: str) -> PermissionBundle | None:
    return session.scalar(
        select(PermissionBundle).where(
            func.lower(PermissionBundle.name) == name.lower()
        )
    )


def ensure_default_permissions(
    session: Session, *, actor_id: uuid.UUID
) -> None:
    """建立缺少的 DOM-R68 預設資料，並保留已存在的同名資料。

    CLI 與 migration 共用相同的預設定義；重跑初始化時不覆寫資料，避免
    清除管理員後續調整（DOM-AC63）。
    """
    roles: dict[str, Role] = {}
    for name, codes, is_assignable, is_external_allowed in _role_presets():
        role = _named_role(session, name)
        if role is None:
            role = Role(
                name=name,
                is_assignable=is_assignable,
                is_external_allowed=is_external_allowed,
                created_by=actor_id,
                updated_by=actor_id,
                permission_codes=[RolePermission(code=code) for code in codes],
            )
            session.add(role)
            session.flush()
        roles[name] = role

    if session.scalar(select(CreatorRoleSetting.id).limit(1)) is None:
        session.add(CreatorRoleSetting(role_id=roles["專案工程師"].id))

    for name, codes in _BUNDLES.items():
        if _named_bundle(session, name) is not None:
            continue
        session.add(
            PermissionBundle(
                name=name,
                created_by=actor_id,
                updated_by=actor_id,
                permission_codes=[
                    PermissionBundlePermission(permission_code=code)
                    for code in codes
                ],
            )
        )
    session.flush()
