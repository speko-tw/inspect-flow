"""計算 AUT-R08 使用者的專案與模組存取摘要。

前端依摘要決定工作台入口，
不得只依 ``is_admin`` 推測權限。
專案權限碼分類為內業、現場與唯讀；模組權限另外回傳。
唯讀碼不代表內業或現場權限；`inspection_task.read` 不能代替
現場清單需要的 `inspection_task.inspect`（ADM-R18）。

有效權限經 DOM-R69 的單一入口計算，不逐專案查詢。
"""

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models import User
from app.permission_codes import (
    PermissionCode,
    permission_code_module,
    permission_code_scope,
)
from app.services.permissions import calculate_effective_access

FIELD_PERMISSION_CODES: frozenset[str] = frozenset({"inspection_task.inspect"})
OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    {
        "project_member.manage",
        "project.update",
        "project_inspection_item.edit",
        "project_zone.manage",
        "inspection_plan.create",
        "inspection_plan.manage",
        "inspection_plan.archive",
        "inspection_plan.unarchive",
        "inspection_task.manage",
        "inspection_task.create",
        "inspection_task.dispatch",
        "inspection_task.assign",
        "inspection_task.delete_draft",
        "inspection_task.cancel",
    }
)
READ_ONLY_PERMISSION_CODES: frozenset[str] = frozenset(
    code.value
    for code in PermissionCode
    if permission_code_scope(code.value) == "project"
    and code.value.endswith(".read")
)
PROJECT_OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    code
    for code in OFFICE_PERMISSION_CODES
    if permission_code_module(code) == "project"
)
INSPECTION_OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    code
    for code in OFFICE_PERMISSION_CODES
    if permission_code_module(code) == "inspection"
)
PROJECT_PLANNING_OR_MEMBERS_PERMISSION_CODES: frozenset[str] = frozenset(
    {
        "project_member.manage",
        "inspection_plan.create",
        "inspection_plan.manage",
        "inspection_plan.archive",
        "inspection_plan.unarchive",
        "inspection_task.manage",
        "inspection_task.create",
        "inspection_task.dispatch",
        "inspection_task.assign",
        "inspection_task.delete_draft",
        "inspection_task.cancel",
    }
)


@dataclass(frozen=True)
class AccessSummary:
    has_office_access: bool
    has_field_access: bool
    # 現場入口須同時符合查核模組與專案任務權限。
    can_inspect_tasks: bool
    can_manage_project_planning_or_members: bool
    has_template_access: bool
    can_browse_templates: bool
    can_manage_template_library: bool
    module_permissions: frozenset[str]
    delegated_modules: frozenset[str]
    can_create_project: bool
    has_project_access: bool


def summarize_access(session: Session, user: User) -> AccessSummary:
    """依 AUT-R08 計算目前使用者的正式存取摘要。"""
    access = calculate_effective_access(session, user_id=user.id)
    if access.is_admin:
        return AccessSummary(
            has_office_access=True,
            has_field_access=True,
            can_inspect_tasks=True,
            can_manage_project_planning_or_members=True,
            has_template_access=True,
            can_browse_templates=True,
            can_manage_template_library=True,
            module_permissions=access.module_permissions,
            delegated_modules=access.delegated_modules,
            can_create_project=True,
            has_project_access=True,
        )
    module_permissions = access.module_permissions
    project_access_codes = set()
    has_project_access = "project.use" in module_permissions and any(
        "project.read" in permissions
        for permissions in access.project_permissions_by_project.values()
    )
    for project_codes in access.project_permissions_by_project.values():
        project_access_codes.update(project_codes)

    def has_module_for_code(code: str) -> bool:
        module = permission_code_module(code)
        return module is not None and f"{module}.use" in module_permissions

    has_template_access = "template.manage" in module_permissions
    can_browse_templates = "template.use" in module_permissions
    office_access = any(
        code in OFFICE_PERMISSION_CODES and has_module_for_code(code)
        for code in project_access_codes
    )
    field_access = (
        "inspection_task.inspect" in project_access_codes
        and "inspection.use" in module_permissions
    )
    can_inspect_tasks = (
        "inspection_task.inspect" in project_access_codes
        and "inspection.use" in module_permissions
    )
    can_manage_project_planning_or_members = any(
        code in PROJECT_PLANNING_OR_MEMBERS_PERMISSION_CODES
        and has_module_for_code(code)
        for code in project_access_codes
    )
    return AccessSummary(
        has_office_access=office_access,
        has_field_access=field_access,
        can_inspect_tasks=can_inspect_tasks,
        can_manage_project_planning_or_members=(
            can_manage_project_planning_or_members
        ),
        has_template_access=has_template_access,
        can_browse_templates=can_browse_templates,
        can_manage_template_library=has_template_access,
        module_permissions=module_permissions,
        delegated_modules=access.delegated_modules,
        can_create_project="project.create" in module_permissions,
        has_project_access=has_project_access,
    )
