"""帳號停用、外部帳號到期與重新啟用（DOM-R67、DOM-R75）。"""

import uuid
from datetime import date
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.db import clock
from app.models import (
    InspectionTask,
    Project,
    ProjectMember,
    ProjectMemberRole,
    RolePermission,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator
from app.services.permissions import (
    calculate_effective_access,
    project_member_ids_with_permission,
)
from app.services.users import set_is_active


class AccountExpiredError(ValueError):
    """DOM-R75：外部協作人員到期後須先延長或清除到期日。"""


class InvalidRestoreSelectionError(ValueError):
    """DOM-R67：重新啟用只接受預覽內的項目與有效權限組合。"""

    def __init__(self, details: list[str]) -> None:
        self.details = details
        super().__init__("Restore selection is outside the preview")


def expire_external_account_if_due(
    session: Session,
    user_id: uuid.UUID,
    *,
    today: date | None = None,
) -> bool:
    """在首次偵測到到期時停用外部協作人員並只寫一筆系統稽核。"""
    current_date = today or clock.utc_now().date()
    candidate = session.get(User, user_id)
    if (
        candidate is None
        or not candidate.is_active
        or not candidate.is_external_collaborator
        or candidate.account_expires_on is None
        or candidate.account_expires_on >= current_date
    ):
        return False

    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        return False
    if (
        not user.is_external_collaborator
        or user.account_expires_on is None
        or user.account_expires_on >= current_date
    ):
        return False
    set_is_active(
        session,
        user,
        False,
        reason="account_expired",
        system_event=True,
    )
    return True


def expire_due_external_accounts(
    session: Session, *, today: date | None = None
) -> int:
    """把管理清單讀取時已到期的外部協作者一併標記為停用。"""
    current_date = today or clock.utc_now().date()
    user_ids = list(
        session.scalars(
            select(User.id)
            .where(
                User.is_active.is_(True),
                User.is_external_collaborator.is_(True),
                User.account_expires_on < current_date,
            )
            .order_by(User.id)
        )
    )
    return sum(
        expire_external_account_if_due(session, user_id, today=current_date)
        for user_id in user_ids
    )


def deactivate_external_account_without_memberships(
    session: Session, user_id: uuid.UUID
) -> bool:
    """DOM-R75：外部協作者失去最後一個專案身分時自動停用。"""
    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None or not user.is_active or not user.is_external_collaborator:
        return False
    access = calculate_effective_access(session, user_id=user.id)
    if access.project_memberships:
        return False
    set_is_active(
        session,
        user,
        False,
        reason="last_membership_removed",
        system_event=True,
    )
    return True


def deactivation_check(session: Session, user: User) -> list[Project]:
    """列出停用後將沒有啟用管理成員的專案（DOM-R67、ADM-R33）。"""
    if not user.is_active:
        return []
    access = calculate_effective_access(session, user_id=user.id)
    candidate_ids = [
        project_id
        for project_id, codes in access.project_permissions_by_project.items()
        if "project_member.manage" in codes
    ]
    unique_manager_ids = [
        project_id
        for project_id in candidate_ids
        if project_member_ids_with_permission(
            session,
            project_id=project_id,
            permission_code="project_member.manage",
            active_only=True,
            module_permission_code="project.use",
        )
        == frozenset({user.id})
    ]
    if not unique_manager_ids:
        return []
    return list(
        session.scalars(
            select(Project)
            .where(Project.id.in_(unique_manager_ids))
            .order_by(Project.name, Project.id)
        )
    )


def unmanaged_project_ids(session: Session) -> frozenset[uuid.UUID]:
    """DOM-R75：以共用權限入口找出沒有啟用管理成員的專案。"""
    effective_managers = (
        select(
            ProjectMember.id.label("member_id"),
            ProjectMember.project_id.label("project_id"),
        )
        .join(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .join(
            RolePermission,
            and_(
                RolePermission.role_id == ProjectMemberRole.role_id,
                RolePermission.code == "project_member.manage",
            ),
        )
        .join(User, User.id == ProjectMember.user_id)
        .join(
            UserModulePermission,
            and_(
                UserModulePermission.user_id == User.id,
                UserModulePermission.permission_code == "project.use",
            ),
        )
        .where(User.is_active.is_(True), User.is_admin.is_(False))
        .subquery()
    )
    return frozenset(
        session.scalars(
            select(Project.id)
            .outerjoin(
                effective_managers,
                effective_managers.c.project_id == Project.id,
            )
            .group_by(Project.id)
            .having(func.count(effective_managers.c.member_id) == 0)
        ).all()
    )


def reactivation_preview(session: Session, user: User) -> dict[str, Any]:
    """回傳停用帳號中可供 Admin 勾選恢復的目前資料（DOM-R67）。"""
    permission_codes = list(
        session.scalars(
            select(UserModulePermission.permission_code)
            .where(UserModulePermission.user_id == user.id)
            .order_by(UserModulePermission.permission_code)
        )
    )
    delegated_modules = list(
        session.scalars(
            select(UserModuleDelegation.module)
            .where(UserModuleDelegation.user_id == user.id)
            .order_by(UserModuleDelegation.module)
        )
    )
    memberships = session.execute(
        select(ProjectMember, Project)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.name, Project.id)
    ).all()
    tasks = list(
        session.scalars(
            select(InspectionTask)
            .where(
                InspectionTask.assignee_id == user.id,
                InspectionTask.dispatched_at.is_not(None),
                InspectionTask.status.in_(("PENDING", "IN_PROGRESS")),
            )
            .order_by(InspectionTask.id)
        )
    )
    current_date = clock.utc_now().date()
    expired = (
        user.is_external_collaborator
        and user.account_expires_on is not None
        and user.account_expires_on < current_date
    )
    return {
        "user_id": user.id,
        "username": user.username,
        "is_external_collaborator": user.is_external_collaborator,
        "account_expires_on": user.account_expires_on,
        "account_expired": expired,
        "permission_codes": permission_codes,
        "delegated_modules": delegated_modules,
        "project_memberships": [
            {
                "project_id": project.id,
                "project_code": project.project_code,
                "project_name": project.name,
            }
            for _member, project in memberships
        ],
        "tasks": [
            {
                "task_id": task.id,
                "project_id": task.project_id,
                "name": task.name,
                "status": task.status,
            }
            for task in tasks
        ],
    }


def reactivate_user(
    session: Session,
    *,
    user_id: uuid.UUID,
    permission_codes: list[str],
    delegated_modules: list[str],
    project_ids: list[uuid.UUID],
    task_ids: list[uuid.UUID],
) -> User:
    """依 Admin 勾選結果原子恢復帳號項目並稽核（DOM-R67）。"""
    actor = get_current_operator(session)
    if not actor.is_admin:
        raise PermissionError("Only Admin may reactivate an account")
    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if user is None:
        raise LookupError("User does not exist")
    if user.is_active:
        return user
    if (
        user.is_external_collaborator
        and user.account_expires_on is not None
        and user.account_expires_on < clock.utc_now().date()
    ):
        raise AccountExpiredError(
            "Clear or extend the external collaborator expiry date first"
        )

    preview = reactivation_preview(session, user)
    available_permissions = set(preview["permission_codes"])
    available_delegations = set(preview["delegated_modules"])
    available_projects = {
        item["project_id"] for item in preview["project_memberships"]
    }
    available_tasks = {item["task_id"] for item in preview["tasks"]}
    errors = _selection_errors(
        permission_codes,
        delegated_modules,
        project_ids,
        task_ids,
        available_permissions,
        available_delegations,
        available_projects,
        available_tasks,
    )
    for primary, implied in (
        ("project.create", "project.use"),
        ("template.manage", "template.use"),
    ):
        if primary in permission_codes and implied not in permission_codes:
            errors.append(f"{primary} requires {implied}")
    if errors:
        raise InvalidRestoreSelectionError(sorted(set(errors)))

    from app.services.module_permissions import (
        revoke_module_delegation,
        revoke_module_permission,
    )
    from app.services.project_members import remove_project_member

    selected_permissions = set(permission_codes)
    removed_permissions = available_permissions - selected_permissions
    for code in sorted(
        removed_permissions,
        key=lambda item: (
            item not in {"project.create", "template.manage"},
            item,
        ),
    ):
        revoke_module_permission(
            session, actor=actor, user=user, permission_code=code
        )

    selected_delegations = set(delegated_modules)
    removed_delegations = available_delegations - selected_delegations
    for module in sorted(removed_delegations):
        revoke_module_delegation(
            session, actor=actor, user=user, module=module
        )

    selected_projects = set(project_ids)
    removed_projects = available_projects - selected_projects
    from app.services.module_permissions import validate_role_assignment

    for project_id in sorted(selected_projects, key=str):
        member = session.scalar(
            select(ProjectMember)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
            .with_for_update()
        )
        if member is None:
            raise InvalidRestoreSelectionError(
                [f"project_ids: {project_id} changed after preview"]
            )
        role_ids = {
            assignment.role_id for assignment in member.role_assignments
        }
        try:
            validate_role_assignment(
                session,
                user=user,
                project_id=project_id,
                project_member_id=member.id,
                role_ids=role_ids,
                previous_role_ids=role_ids,
                actor_user_id=actor.id,
                check_last_manager=True,
                require_active=False,
            )
        except ValueError as exc:
            raise InvalidRestoreSelectionError(
                [f"project_ids: {project_id} role conditions changed"]
            ) from exc
    for project_id in sorted(removed_projects, key=str):
        member = session.scalar(
            select(ProjectMember)
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
            .with_for_update()
        )
        if member is not None:
            remove_project_member(session, member)

    selected_tasks = set(task_ids)
    cleared_tasks = available_tasks - selected_tasks
    for task_id in sorted(cleared_tasks, key=str):
        task = session.scalar(
            select(InspectionTask)
            .where(InspectionTask.id == task_id)
            .with_for_update()
        )
        if task is not None and task.assignee_id == user.id:
            task.assignee_id = None
            task.updated_by = actor.id

    user.is_active = True
    user.updated_by = actor.id
    session.flush()
    record_audit_event(
        session,
        "user.active_changed",
        entity_id=user.id,
        before={"is_active": False},
        after={
            "is_active": True,
            "restored_permission_codes": selected_permissions,
            "removed_permission_codes": removed_permissions,
            "restored_delegated_modules": selected_delegations,
            "removed_delegated_modules": removed_delegations,
            "restored_project_ids": selected_projects,
            "removed_project_ids": removed_projects,
            "cleared_task_ids": cleared_tasks,
        },
    )
    return user


def _selection_errors(
    permission_codes: list[str],
    delegated_modules: list[str],
    project_ids: list[uuid.UUID],
    task_ids: list[uuid.UUID],
    available_permissions: set[str],
    available_delegations: set[str],
    available_projects: set[uuid.UUID],
    available_tasks: set[uuid.UUID],
) -> list[str]:
    values = (
        ("permission_codes", permission_codes, available_permissions),
        ("delegated_modules", delegated_modules, available_delegations),
        ("project_ids", project_ids, available_projects),
        ("task_ids", task_ids, available_tasks),
    )
    errors: list[str] = []
    for name, selected, available in values:
        if len(selected) != len(set(selected)):
            errors.append(f"{name} contains duplicate values")
        errors.extend(
            f"{name}: {value} is not in the preview"
            for value in set(selected) - available
        )
    return errors


__all__ = [
    "AccountExpiredError",
    "InvalidRestoreSelectionError",
    "deactivation_check",
    "deactivate_external_account_without_memberships",
    "expire_due_external_accounts",
    "expire_external_account_if_due",
    "reactivation_preview",
    "reactivate_user",
    "unmanaged_project_ids",
]
