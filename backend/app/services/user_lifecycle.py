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
from app.services.account_status import effectively_active_user_clause
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
    """在首次偵測到到期時停用外部協作人員並只寫一筆系統稽核。

    DOM-R75：到期日當天結束後才算到期（``account_expires_on`` 小於
    今天），之後的請求看到的已是停用狀態，不會再寫稽核。回傳值表示
    這次呼叫是否真的停用了帳號。
    """
    current_date = today or clock.utc_now().date()
    # 先用不加鎖的讀取排除不必處理的帳號（絕大多數請求），確定到期
    # 才鎖列；鎖定後必須重驗，因為 DOM-R75 只准寫一筆 account_expired
    # 稽核，並行請求可能已先一步停用。
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
    # 自動停用是系統事件（ALG-R15），稽核的操作者記為內建 admin。
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
    """把管理清單讀取時已到期的外部協作者一併標記為停用。

    逐一交給 :func:`expire_external_account_if_due`，每個帳號各自鎖列
    重驗並各寫一筆稽核（DOM-R75）；回傳這次實際停用的帳號數。
    """
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
    """DOM-R75：外部協作者失去最後一個專案身分時自動停用。

    由 ``remove_project_member`` 在刪除成員並寫完稽核後呼叫。是否還有
    專案身分看有效權限入口的 ``project_memberships``，它保留沒有角色
    的成員身分（DOM-R36），所以只有完全沒有 ``ProjectMember`` 才會
    停用；內部人員與已停用帳號一律不處理。
    """
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
    # 系統事件（ALG-R15）；原因代碼讓稽核區分到期與失去專案身分。
    set_is_active(
        session,
        user,
        False,
        reason="last_membership_removed",
        system_event=True,
    )
    return True


def deactivation_check(session: Session, user: User) -> list[Project]:
    """列出停用後將沒有啟用管理成員的專案（DOM-R67、ADM-R33）。

    只供停用前提醒，不阻擋停用。「唯一的管理成員」以有效權限計算
    （DOM-R70）：帳號啟用、具專案模組「可使用」（``project.use``）、
    專案角色含 ``project_member.manage``，所以下面查其他管理成員時
    ``active_only`` 與 ``module_permission_code`` 兩個條件不可省，
    否則已停用或沒有模組權限的成員會被誤算成還有人管理。
    """
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
    """DOM-R75：以共用權限入口找出沒有啟用管理成員的專案。

    供 Admin 的「無人管理的專案」清單（ADM-R36）。有效管理成員的
    條件與 :func:`deactivation_check` 相同（DOM-R70，兩者都排除 Admin）。
    """
    # 以 outer join 加上 count == 0 找缺口，因此完全沒有成員的專案
    # 也會列入。
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
        .where(effectively_active_user_clause(), User.is_admin.is_(False))
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
    """回傳停用帳號中可供 Admin 勾選恢復的目前資料（DOM-R67）。

    唯讀，不改任何資料。停用期間權限、委派與成員身分都保留（只是
    不生效），所以直接讀目前的資料列即可。``account_expired`` 為
    true 時，前端須提示先延長或清除到期日（DOM-R75）。
    """
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
    # 只列建議指派仍指向此人、已派出且未完成的任務；停用期間已被
    # 改派的任務不還原也不列入（DOM-R67）。
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
    """依 Admin 勾選結果原子恢復帳號項目並稽核（DOM-R67）。

    只恢復勾選的項目；沒勾的模組權限與委派被收回、成員身分被移除、
    任務的建議指派被清空，各自依原事件寫稽核，最後寫一筆
    ``user.active_changed`` 記下恢復與移除的內容。勾選值必須落在
    :func:`reactivation_preview` 的範圍內，否則丟
    :class:`InvalidRestoreSelectionError`；外部協作者的到期日已過則
    丟 :class:`AccountExpiredError`（DOM-R75）。
    """
    actor = get_current_operator(session)
    # Service 層自己檢查 Admin，不只依賴路由層的 Admin 檢查。
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
        # 已啟用視為重複請求，不再恢復也不重複寫稽核。
        return user
    if (
        user.is_external_collaborator
        and user.account_expires_on is not None
        and user.account_expires_on < clock.utc_now().date()
    ):
        raise AccountExpiredError(
            "Clear or extend the external collaborator expiry date first"
        )

    # 以鎖定後重算的預覽為準：預覽到送出之間資料可能已變動，
    # 勾選值只准落在這一份範圍內（DOM-R67）。
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
    # DOM-R62：project.create 蘊含 project.use、template.manage 蘊含
    # template.use，勾選結果不得只留主權限而缺被蘊含的權限。
    for primary, implied in (
        ("project.create", "project.use"),
        ("template.manage", "template.use"),
    ):
        if primary in permission_codes and implied not in permission_codes:
            errors.append(f"{primary} requires {implied}")
    if errors:
        raise InvalidRestoreSelectionError(sorted(set(errors)))

    # project_members 與本模組互相呼叫，雙方都在函式內才匯入。
    from app.services.module_permissions import (
        revoke_module_delegation,
        revoke_module_permission,
    )
    from app.services.project_members import remove_project_member

    selected_permissions = set(permission_codes)
    removed_permissions = available_permissions - selected_permissions
    # 主權限（project.create、template.manage）要先收回：只要主權限
    # 還在，單獨收回被蘊含的權限會被拒絕（DOM-R62）。
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

    # 保留的成員身分要重驗角色條件（外部可用、最後一位管理者等，
    # DOM-R70、DOM-R72）。帳號此時仍是停用狀態，所以不檢查
    # require_active；角色集合沒有被改動，前後相同。
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
    # 鎖列後重驗建議指派仍是此人才清空，避免覆蓋預覽之後被改派的
    # 任務（DOM-R67：已被改派的不還原）。
    for task_id in sorted(cleared_tasks, key=str):
        task = session.scalar(
            select(InspectionTask)
            .where(InspectionTask.id == task_id)
            .with_for_update()
        )
        if task is not None and task.assignee_id == user.id:
            task.assignee_id = None
            task.updated_by = actor.id

    # 不經 set_is_active：它拒絕直接啟用（DOM-R67 要求帶恢復選項），
    # 也會另寫一筆事件；這裡改寫一筆含恢復內容的 user.active_changed。
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
    # DOM-R67：重新啟用只接受預覽內的項目；重複值與預覽外的值都回報，
    # 由呼叫端彙整成一次 422。
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
