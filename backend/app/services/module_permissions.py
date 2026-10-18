"""Person-scoped module permission services (DOM-R59–DOM-R64)."""

import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, selectinload

from app.models import (
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    ProjectMember,
    ProjectMemberRole,
    Role,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.permission_codes import (
    PermissionCode,
    is_permission_code_registered,
    permission_code_external_allowed,
    permission_code_module,
    permission_code_scope,
)
from app.services import audit as audit_service

logger = logging.getLogger(__name__)

# Keep these audit reasons aligned with the corresponding API error codes.
_EXTERNAL_ROLE_NOT_ALLOWED_REASON = "project.external_role_not_allowed"
_ROLE_NOT_ASSIGNABLE_REASON = "project.role_not_assignable"
_SELF_ROLE_CHANGE_REASON = "project.member_self_role_change"


class ModulePermissionError(ValueError):
    """Base class for rejected module permission operations."""

    status_code = 422

    def __init__(
        self, message: str, *, details: list[str] | None = None
    ) -> None:
        self.details = details
        super().__init__(message)


class ModulePermissionDeniedError(ModulePermissionError):
    status_code = 403


class InvalidModulePermissionError(ModulePermissionError):
    pass


class ExternalCollaboratorPermissionError(ModulePermissionError):
    pass


class ImpliedPermissionError(ModulePermissionError):
    pass


class PermissionBundleScopeError(ModulePermissionDeniedError):
    """A delegate cannot fully apply the requested bundle."""


class ExternalRoleAssignmentError(ModulePermissionError):
    """A role is not permitted for an external collaborator."""


class RoleNotAssignableError(ModulePermissionError):
    """非 Admin 對專案指派了未核准的角色。"""


class SelfRoleChangeError(ModulePermissionError):
    """非 Admin 嘗試變更自己的專案成員角色。"""


class LastProjectManagerError(ModulePermissionError):
    """非 Admin 嘗試移除專案最後一位有效管理者。"""


class InactiveProjectMemberError(ModulePermissionError):
    """停用帳號不可被加入專案或指派角色。"""


class InvalidCreatorRoleUserError(ModulePermissionError):
    """指定的建立者角色人選不符合 DOM-R65。"""


class InvalidExternalRoleError(ModulePermissionError):
    """The role's definition cannot be marked externally allowed."""


class ExternalRoleInUseError(ModulePermissionError):
    """External collaborators currently hold a restricted role."""


class CreatorRoleInUseError(ModulePermissionError):
    """The designated creator role cannot be deleted."""


class CreatorRolePermissionsError(ModulePermissionError):
    """The designated creator role must retain three permissions."""


@dataclass(frozen=True)
class PersonDisplayInfo:
    """人員模組提供給專案模組顯示的最小人員欄位（DOM-R60）。"""

    user_id: uuid.UUID
    username: str
    name_zh: str | None
    name_en: str | None


@dataclass(frozen=True)
class PersonAccess:
    """封裝 DOM-R60 四項人員查詢，供其他模組透過 Service 取用。"""

    display: PersonDisplayInfo
    is_active: bool
    is_admin: bool
    module_permissions: frozenset[str]


@dataclass(frozen=True)
class PermissionRevokeImpact:
    """DOM-R62 摘要：撤回 `project.use` 可能影響的成員與管理專案。"""

    member_count: int
    project_ids: tuple[uuid.UUID, ...]
    projects_without_manager: tuple[uuid.UUID, ...]


def query_person_access(
    session: Session, *, user_id: uuid.UUID
) -> PersonAccess | None:
    """回答 DOM-R60 的人員顯示、有效狀態、Admin 與模組權限查詢。

    專案層只消費此 Service 結果，避免直接依賴人員與模組權限資料表。
    """
    return query_people_access(session, user_ids={user_id}).get(user_id)


def query_people_access(
    session: Session, *, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, PersonAccess]:
    """批次回答 DOM-R60 人員查詢，避免候選清單逐人查詢。"""
    if not user_ids:
        return {}
    rows = session.execute(
        select(User, UserModulePermission.permission_code)
        .outerjoin(
            UserModulePermission,
            UserModulePermission.user_id == User.id,
        )
        .where(User.id.in_(user_ids))
    ).all()
    users: dict[uuid.UUID, User] = {}
    codes_by_user: dict[uuid.UUID, set[str]] = {}
    for user, code in rows:
        users[user.id] = user
        if code is not None:
            codes_by_user.setdefault(user.id, set()).add(code)

    all_module_codes = frozenset(
        item.value
        for item in PermissionCode
        if permission_code_scope(item.value) == "module"
    )
    return {
        user_id: PersonAccess(
            display=PersonDisplayInfo(
                user_id=user.id,
                username=user.username,
                name_zh=user.name_zh,
                name_en=user.name_en,
            ),
            is_active=user.is_active,
            is_admin=user.is_admin,
            module_permissions=(
                all_module_codes
                if user.is_admin
                else frozenset(codes_by_user.get(user_id, set()))
            ),
        )
        for user_id, user in users.items()
    }


def permission_revoke_impact(
    session: Session, *, user_id: uuid.UUID, permission_code: str
) -> PermissionRevokeImpact:
    """計算撤回 `project.use` 後的成員與最後管理者影響（DOM-R62/70）。

    用目前有效的 `project_member.manage`、`project.use` 與帳號狀態
    判斷是否尚有其他管理者，避免確認畫面漏報將失去管理者的專案。
    """
    if permission_code != "project.use":
        return PermissionRevokeImpact(0, (), ())
    from app.services.permissions import project_member_management_impact

    member_count, project_ids, projects_without_manager = (
        project_member_management_impact(
            session,
            user_id=user_id,
            module_permission_code="project.use",
            project_permission_code="project_member.manage",
        )
    )
    return PermissionRevokeImpact(
        member_count=member_count,
        project_ids=project_ids,
        projects_without_manager=projects_without_manager,
    )


def validate_role_assignment(
    session: Session,
    *,
    user: User,
    project_id: uuid.UUID,
    project_member_id: uuid.UUID,
    role_ids: Iterable[uuid.UUID],
    actor_user_id: uuid.UUID | None = None,
    previous_role_ids: Iterable[uuid.UUID] = (),
    allow_self_assignment: bool = False,
    check_last_manager: bool = False,
    require_creator_user: bool = False,
    require_active: bool = True,
) -> None:
    """依 DOM-R70、DOM-R72 鎖定資料並驗證角色指派限制。

    先依角色 UUID 鎖定完整的新舊集合，再鎖人員 UUID；此順序也讓
    白名單檢查與角色、外部身分修改共用同一個序列化邊界。
    """
    desired_role_ids = set(role_ids)
    previous_ids = set(previous_role_ids)
    locked_role_ids = desired_role_ids | previous_ids
    roles = list(
        session.scalars(
            select(Role)
            .options(selectinload(Role.permission_codes))
            .where(Role.id.in_(locked_role_ids))
            .order_by(Role.id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
    )
    roles_by_id = {role.id: role for role in roles}
    if len(roles) != len(locked_role_ids):
        raise InvalidModulePermissionError("Role does not exist")
    user_ids = {user.id}
    if actor_user_id is not None:
        user_ids.add(actor_user_id)
    # DOM-R72：先鎖角色，再依 UUID 鎖操作者與對象，重讀外部標記。
    locked_users = list(
        session.scalars(
            select(User)
            .where(User.id.in_(user_ids))
            .order_by(User.id)
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
    )
    users_by_id = {item.id: item for item in locked_users}
    locked_user = users_by_id.get(user.id)
    if locked_user is None:
        raise InvalidModulePermissionError("User does not exist")
    user = locked_user
    if require_active and not user.is_active:
        raise InactiveProjectMemberError("Inactive users cannot join projects")
    if require_creator_user and (
        not user.is_active or user.is_system or user.is_external_collaborator
    ):
        raise InvalidCreatorRoleUserError(
            "Creator-role user must be active, non-system, and internal"
        )

    actor = users_by_id.get(actor_user_id) if actor_user_id else None
    if actor_user_id is not None and actor is None:
        raise InvalidModulePermissionError("Operator does not exist")
    if actor is not None and not actor.is_admin:
        if actor.id == user.id and not allow_self_assignment:
            _record_denied_role_assignment(
                session,
                project_id=project_id,
                project_member_id=project_member_id,
                user=user,
                role_ids=desired_role_ids | previous_ids,
                reason=_SELF_ROLE_CHANGE_REASON,
            )
            raise SelfRoleChangeError("Users cannot change their own roles")
        creator_role_id = (
            session.scalar(
                select(CreatorRoleSetting.role_id).where(
                    CreatorRoleSetting.setting_key == "creator_role"
                )
            )
            if allow_self_assignment
            else None
        )
        disallowed_role_ids = {
            role_id
            for role_id in locked_role_ids
            if not roles_by_id[role_id].is_assignable
            and not (
                allow_self_assignment
                and role_id == creator_role_id
                and role_id in desired_role_ids
                and role_id not in previous_ids
            )
        }
        if disallowed_role_ids:
            _record_denied_role_assignment(
                session,
                project_id=project_id,
                project_member_id=project_member_id,
                user=user,
                role_ids=desired_role_ids | previous_ids,
                reason=_ROLE_NOT_ASSIGNABLE_REASON,
            )
            raise RoleNotAssignableError("Role is not assignable")
        if check_last_manager:
            _check_last_project_manager(
                session,
                actor_is_admin=False,
                user=user,
                project_id=project_id,
                desired_roles=[roles_by_id[item] for item in desired_role_ids],
            )

    for role in roles:
        if role.id not in desired_role_ids:
            continue
        if user.is_external_collaborator and not role.is_external_allowed:
            _record_denied_role_assignment(
                session,
                project_id=project_id,
                project_member_id=project_member_id,
                user=user,
                role_ids=desired_role_ids,
                reason=_EXTERNAL_ROLE_NOT_ALLOWED_REASON,
            )
            raise ExternalRoleAssignmentError(
                "Role is not allowed for external collaborators"
            )
        if user.is_external_collaborator and any(
            not permission_code_external_allowed(permission.code)
            for permission in role.permission_codes
        ):
            _record_denied_role_assignment(
                session,
                project_id=project_id,
                project_member_id=project_member_id,
                user=user,
                role_ids=desired_role_ids,
                reason=_EXTERNAL_ROLE_NOT_ALLOWED_REASON,
            )
            raise ExternalRoleAssignmentError(
                "Role contains a permission unavailable to external users"
            )


def _check_last_project_manager(
    session: Session,
    *,
    actor_is_admin: bool,
    user: User,
    project_id: uuid.UUID,
    desired_roles: list[Role],
) -> None:
    """依 DOM-R70 序列化檢查是否會移除專案最後一位有效管理者。"""
    if actor_is_admin:
        return
    # 不同專案的角色異動可能同時發生；鎖專案列後再重算管理者集合，
    # 讓同一專案的最後管理者檢查依序完成。
    from app.models import Project

    project_exists = session.scalar(
        select(Project.id).where(Project.id == project_id).with_for_update()
    )
    if project_exists is None:
        raise InvalidModulePermissionError("Project does not exist")
    from app.services.permissions import project_member_ids_with_permission

    current_managers = project_member_ids_with_permission(
        session,
        project_id=project_id,
        permission_code="project_member.manage",
        active_only=True,
        module_permission_code="project.use",
    )
    was_manager = user.id in current_managers
    remains_manager = (
        user.is_active
        and not user.is_admin
        and any(
            item.code == "project_member.manage"
            for role in desired_roles
            for item in role.permission_codes
        )
    )
    person = query_person_access(session, user_id=user.id)
    remains_manager = (
        remains_manager
        and person is not None
        and ("project.use" in person.module_permissions)
    )
    if was_manager and not remains_manager and current_managers <= {user.id}:
        raise LastProjectManagerError(
            "A project must retain one active member manager"
        )


def _record_denied_role_assignment(
    session: Session,
    *,
    project_id: uuid.UUID,
    project_member_id: uuid.UUID,
    user: User,
    role_ids: set[uuid.UUID],
    reason: str,
) -> None:
    try:
        audit_service.record_audit_event_in_independent_transaction(
            session,
            "project_member.assignment_denied",
            entity_id=project_member_id,
            project_id=project_id,
            before=None,
            after={
                "project_id": project_id,
                "user_id": user.id,
                "role_ids": sorted(role_ids),
                "reason": reason,
            },
        )
    except Exception:
        logger.exception("Could not write independent role denial")


def validate_role_external_configuration(
    session: Session,
    *,
    role: Role,
    is_external_allowed: bool,
    permission_codes: Iterable[str],
) -> None:
    """依 DOM-R72 鎖定相關資料並拒絕不安全的角色修改。"""
    locked_role = session.scalar(
        select(Role)
        .where(Role.id == role.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_role is None:
        raise InvalidModulePermissionError("Role does not exist")
    role = locked_role
    desired = frozenset(permission_codes)
    creator_role_id = session.scalar(
        select(CreatorRoleSetting.role_id).limit(1)
    )
    if role.id == creator_role_id and not _CREATOR_ROLE_CODES <= desired:
        raise CreatorRolePermissionsError(
            "Creator role must retain its three required project codes"
        )
    if is_external_allowed and role.id == creator_role_id:
        raise InvalidExternalRoleError(
            "The creator role cannot be externally allowed"
        )
    holder_ids = list(
        session.scalars(
            select(User.id)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .join(
                ProjectMemberRole,
                ProjectMemberRole.project_member_id == ProjectMember.id,
            )
            .where(ProjectMemberRole.role_id == role.id)
            .distinct()
            .order_by(User.id)
        )
    )
    # 先鎖 Role，再依 UUID 鎖持有人，與外部標記轉換採相同順序。
    holders = list(
        session.scalars(
            select(User)
            .where(User.id.in_(holder_ids))
            .order_by(User.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
    )
    external_holders = [
        user for user in holders if user.is_external_collaborator
    ]
    if external_holders and (
        not is_external_allowed
        or any(not permission_code_external_allowed(code) for code in desired)
    ):
        raise ExternalRoleInUseError(
            "Role is held by external collaborators and cannot be restricted",
            details=[
                f"{user.name_zh or user.name_en} ({user.id})"
                for user in external_holders
            ],
        )
    if is_external_allowed and any(
        not permission_code_external_allowed(code) for code in desired
    ):
        raise InvalidExternalRoleError(
            "External roles may contain only externally allowed codes"
        )


_CREATOR_ROLE_CODES = frozenset(
    {"project.update", "project_member.manage", "project.read"}
)


def list_user_module_permissions(
    session: Session, *, user_id: uuid.UUID
) -> list[UserModulePermission]:
    """List a person's explicit module permission rows."""
    return list(
        session.scalars(
            select(UserModulePermission)
            .where(UserModulePermission.user_id == user_id)
            .order_by(UserModulePermission.permission_code)
        )
    )


def list_user_module_delegations(
    session: Session, *, user_id: uuid.UUID
) -> list[UserModuleDelegation]:
    """List a person's module delegations in stable module order."""
    return list(
        session.scalars(
            select(UserModuleDelegation)
            .where(UserModuleDelegation.user_id == user_id)
            .order_by(UserModuleDelegation.module)
        )
    )


def list_permission_bundles(
    session: Session, *, actor: User
) -> list[PermissionBundle]:
    """List bundles an Admin or delegate can fully apply."""
    bundles = list(
        session.scalars(
            select(PermissionBundle)
            .options(selectinload(PermissionBundle.permission_codes))
            .order_by(PermissionBundle.name, PermissionBundle.id)
        )
    )
    if actor.is_admin:
        return bundles
    delegated = _delegated_modules(session, actor.id)
    return [
        bundle
        for bundle in bundles
        if all(
            permission_code_module(item.permission_code) in delegated
            and item.permission_code != "all_project_progress.read"
            for item in bundle.permission_codes
        )
    ]


def get_creator_role_setting(session: Session) -> CreatorRoleSetting | None:
    """Read the single creator-role setting, if initialization created it."""
    return session.scalar(select(CreatorRoleSetting))


def create_permission_bundle(
    session: Session,
    *,
    actor: User,
    name: str,
    permission_codes: Iterable[str],
) -> PermissionBundle:
    """Create a named set of module permissions (Admin only)."""
    _require_admin(actor)
    _validate_bundle_name(name)
    codes = _validated_module_codes(permission_codes)
    bundle = PermissionBundle(
        name=name,
        created_by=actor.id,
        updated_by=actor.id,
    )
    bundle.permission_codes.extend(
        PermissionBundlePermission(permission_code=code)
        for code in sorted(codes)
    )
    session.add(bundle)
    session.flush()
    audit_service.record_audit_event(
        session,
        "permission_bundle.created",
        entity_id=bundle.id,
        before=None,
        after={"name": bundle.name, "permission_codes": codes},
    )
    return bundle


def update_permission_bundle(
    session: Session,
    *,
    actor: User,
    bundle: PermissionBundle,
    name: str,
    permission_codes: Iterable[str],
) -> bool:
    """Replace the bundle definition without changing prior grants."""
    _require_admin(actor)
    _validate_bundle_name(name)
    desired = _validated_module_codes(permission_codes)
    current = frozenset(
        item.permission_code for item in bundle.permission_codes
    )
    before: dict[str, object] = {}
    after: dict[str, object] = {}
    if name != bundle.name:
        before["name"] = bundle.name
        after["name"] = name
    if desired != current:
        before["permission_codes"] = current
        after["permission_codes"] = desired
    if not after:
        return False
    new_rows = [
        PermissionBundlePermission(permission_code=code)
        for code in sorted(desired - current)
    ]
    bundle.name = name
    if desired != current:
        removed = current - desired
        bundle.permission_codes[:] = [
            item
            for item in bundle.permission_codes
            if item.permission_code not in removed
        ] + new_rows
    bundle.updated_by = actor.id
    session.flush()
    audit_service.record_audit_event(
        session,
        "permission_bundle.updated",
        entity_id=bundle.id,
        before=before,
        after=after,
    )
    return True


def delete_permission_bundle(
    session: Session, *, actor: User, bundle: PermissionBundle
) -> None:
    """Delete a bundle; already applied user grants remain unchanged."""
    _require_admin(actor)
    before = {
        "name": bundle.name,
        "permission_codes": frozenset(
            item.permission_code for item in bundle.permission_codes
        ),
    }
    session.delete(bundle)
    session.flush()
    audit_service.record_audit_event(
        session,
        "permission_bundle.deleted",
        entity_id=bundle.id,
        before=before,
        after=None,
    )


def change_creator_role(session: Session, *, actor: User, role: Role) -> bool:
    """依 DOM-R64 設定建立者角色並保護其權限下限。"""
    _require_admin(actor)
    # 先鎖候選角色再鎖設定列，與角色修改的順序一致。
    locked_role = session.scalar(
        select(Role)
        .options(selectinload(Role.permission_codes))
        .where(Role.id == role.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_role is None:
        raise InvalidModulePermissionError("Role does not exist")
    role = locked_role
    lock_role_holders(session, role.id)
    codes = frozenset(permission.code for permission in role.permission_codes)
    if not _CREATOR_ROLE_CODES <= codes:
        raise CreatorRolePermissionsError(
            "Creator role must retain project.update, "
            "project_member.manage, and project.read"
        )
    if role.is_external_allowed:
        raise InvalidExternalRoleError(
            "The creator role cannot be externally allowed"
        )
    setting = session.scalar(
        select(CreatorRoleSetting)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if setting is None:
        raise InvalidModulePermissionError(
            "Creator-role setting must be initialized before it can change"
        )
    if setting.role_id == role.id:
        return False
    previous_id = setting.role_id
    setting.role_id = role.id
    session.flush()
    audit_service.record_audit_event(
        session,
        "creator_role.changed",
        entity_id=setting.id,
        before={"creator_role_id": previous_id},
        after={"creator_role_id": role.id},
    )
    return True


def grant_module_permission(
    session: Session,
    *,
    actor: User,
    user: User,
    permission_code: str,
    source: str = "manual",
) -> bool:
    """Grant one module permission and its required implication.

    Returns ``True`` when any row was inserted. Existing grants are
    idempotent and return ``False`` without audit writes.
    """
    _check_permission_code(permission_code)
    module = permission_code_module(permission_code)
    _authorize_mutation(
        session,
        actor=actor,
        user=user,
        module=module,
        permission_codes=[permission_code],
        operation="grant",
    )
    changed = _insert_permission(
        session, user=user, permission_code=permission_code, source=source
    )
    if changed:
        _record_permission_event(
            session,
            event_type="module_permission.granted",
            user=user,
            permission_code=permission_code,
            module=module,
            source=source,
        )
    implied = _IMPLIED_PERMISSIONS.get(permission_code)
    if implied is not None:
        implied_changed = _insert_permission(
            session, user=user, permission_code=implied, source="implied"
        )
        if implied_changed:
            _record_permission_event(
                session,
                event_type="module_permission.granted",
                user=user,
                permission_code=implied,
                module=permission_code_module(implied),
                source="implied",
            )
            changed = True
    session.flush()
    return changed


def revoke_module_permission(
    session: Session,
    *,
    actor: User,
    user: User,
    permission_code: str,
) -> bool:
    """Revoke one grant; implied access requires a separate revoke."""
    _check_permission_code(permission_code)
    module = permission_code_module(permission_code)
    _authorize_mutation(
        session,
        actor=actor,
        user=user,
        module=module,
        permission_codes=[permission_code],
        operation="revoke",
    )
    row = session.scalar(
        select(UserModulePermission).where(
            UserModulePermission.user_id == user.id,
            UserModulePermission.permission_code == permission_code,
        )
    )
    if row is None:
        return False
    primary = _IMPLIED_BY_PERMISSION.get(permission_code)
    if primary in _IMPLIED_PERMISSIONS:
        primary_row = session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == user.id,
                UserModulePermission.permission_code == primary,
            )
        )
        if primary_row is not None:
            raise ImpliedPermissionError(
                f"{permission_code} is implied by {primary}"
            )
    source = row.source
    session.delete(row)
    session.flush()
    _record_permission_event(
        session,
        event_type="module_permission.revoked",
        user=user,
        permission_code=permission_code,
        module=module,
        source=source,
    )
    return True


def grant_module_delegation(
    session: Session,
    *,
    actor: User,
    user: User,
    module: str,
) -> bool:
    """依 DOM-R72 管理員授予模組委派。

    外部協作者不得取得模組委派。
    """
    if not actor.is_admin:
        raise ModulePermissionDeniedError("Only Admin may grant delegation")
    if module not in {"project", "inspection", "template"}:
        raise InvalidModulePermissionError(f"Unregistered module: {module}")
    # 先鎖 User 並重讀，與外部標記轉換共用相同順序。
    locked_user = session.scalar(
        select(User)
        .where(User.id == user.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_user is None:
        raise ModulePermissionDeniedError("User does not exist")
    user = locked_user
    if user.is_external_collaborator:
        _reject_external_mutation(
            session,
            user=user,
            permission_codes=[],
            module=module,
            reason="external_collaborator_delegation",
        )
    if user.is_admin:
        raise ModulePermissionDeniedError(
            "Admin module access is implicit and cannot be stored"
        )
    existing = session.scalar(
        select(UserModuleDelegation.id).where(
            UserModuleDelegation.user_id == user.id,
            UserModuleDelegation.module == module,
        )
    )
    if existing is not None:
        return False
    session.add(UserModuleDelegation(user_id=user.id, module=module))
    session.flush()
    audit_service.record_audit_event(
        session,
        "module_delegation.granted",
        entity_id=user.id,
        before=None,
        after={"user_id": user.id, "module": module},
    )
    return True


def revoke_module_delegation(
    session: Session,
    *,
    actor: User,
    user: User,
    module: str,
) -> bool:
    """Admin-only, idempotent delegation removal."""
    if not actor.is_admin:
        raise ModulePermissionDeniedError("Only Admin may revoke delegation")
    row = session.scalar(
        select(UserModuleDelegation).where(
            UserModuleDelegation.user_id == user.id,
            UserModuleDelegation.module == module,
        )
    )
    if row is None:
        return False
    session.delete(row)
    session.flush()
    audit_service.record_audit_event(
        session,
        "module_delegation.revoked",
        entity_id=user.id,
        before={"user_id": user.id, "module": module},
        after=None,
    )
    return True


def apply_permission_bundle(
    session: Session,
    *,
    actor: User,
    user: User,
    bundle: PermissionBundle,
) -> bool:
    """Apply every bundle item atomically after checking the full set."""
    codes = sorted({item.permission_code for item in bundle.permission_codes})
    invalid_codes = [
        code
        for code in codes
        if not is_permission_code_registered(code)
        or permission_code_scope(code) != "module"
    ]
    if invalid_codes:
        _record_denied_grant(
            session,
            user=user,
            permission_codes=invalid_codes,
            bundle_id=bundle.id,
            reason="invalid_permission_codes",
        )
        raise InvalidModulePermissionError(
            "Bundle contains invalid module permissions",
            details=invalid_codes,
        )
    external_codes = [
        code for code in codes if not permission_code_external_allowed(code)
    ]
    if user.is_external_collaborator and external_codes:
        _record_denied_grant(
            session,
            user=user,
            permission_codes=external_codes,
            bundle_id=bundle.id,
            reason="external_not_allowed",
        )
        raise ExternalCollaboratorPermissionError(
            "External collaborators cannot receive this permission",
            details=external_codes,
        )
    delegated_modules = _delegated_modules(session, actor.id)
    denied_codes = [
        code
        for code in codes
        if user.is_admin
        or (
            not actor.is_admin
            and (
                code == "all_project_progress.read"
                or actor.id == user.id
                or permission_code_module(code) not in delegated_modules
            )
        )
    ]
    if denied_codes:
        _record_denied_grant(
            session,
            user=user,
            permission_codes=denied_codes,
            bundle_id=bundle.id,
            reason="outside_delegation_scope",
        )
        raise PermissionBundleScopeError(
            "Actor cannot manage every permission in the bundle",
            details=denied_codes,
        )
    changed_codes: set[str] = set()
    for code in codes:
        changed = _insert_permission(
            session, user=user, permission_code=code, source="bundle"
        )
        if changed:
            changed_codes.add(code)
        implied = _IMPLIED_PERMISSIONS.get(code)
        if implied is not None and _insert_permission(
            session, user=user, permission_code=implied, source="implied"
        ):
            changed_codes.add(implied)
    if not changed_codes:
        return False
    session.flush()
    audit_service.record_audit_event(
        session,
        "permission_bundle.applied",
        entity_id=bundle.id,
        before=None,
        after={
            "user_id": user.id,
            "bundle_id": bundle.id,
            "bundle_name": bundle.name,
            "permission_codes": sorted(changed_codes),
        },
    )
    return True


def _check_permission_code(code: str) -> None:
    if (
        not is_permission_code_registered(code)
        or permission_code_scope(code) != "module"
    ):
        raise InvalidModulePermissionError(
            f"Not a registered module permission: {code}"
        )


def _validated_module_codes(permission_codes: Iterable[str]) -> frozenset[str]:
    codes = frozenset(permission_codes)
    for code in codes:
        _check_permission_code(code)
    return codes


def _validate_bundle_name(name: str) -> None:
    if not name or len(name) > 64:
        raise InvalidModulePermissionError(
            "Permission bundle name must contain 1-64 characters"
        )


def _require_admin(actor: User) -> None:
    if not actor.is_admin:
        raise ModulePermissionDeniedError("Only Admin may maintain bundles")


_IMPLIED_PERMISSIONS = {
    "project.create": "project.use",
    "template.manage": "template.use",
}
_IMPLIED_BY_PERMISSION = {
    implied: primary for primary, implied in _IMPLIED_PERMISSIONS.items()
}


def _insert_permission(
    session: Session,
    *,
    user: User,
    permission_code: str,
    source: str,
) -> bool:
    values = {
        "user_id": user.id,
        "permission_code": permission_code,
        "source": source,
    }
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgres_insert(UserModulePermission).values(**values)
    elif dialect == "sqlite":
        statement = sqlite_insert(UserModulePermission).values(**values)
    else:
        raise RuntimeError(f"Unsupported permission database: {dialect}")

    # DOM-R62 要求併發的重複授予也冪等；唯一約束決定真正的勝者。
    result = session.execute(
        statement.on_conflict_do_nothing(
            index_elements=[
                UserModulePermission.user_id,
                UserModulePermission.permission_code,
            ]
        ).returning(UserModulePermission.id)
    )
    return result.scalar_one_or_none() is not None


def lock_role_holders(session: Session, role_id: uuid.UUID) -> None:
    """依 DOM-R72 先鎖定持有角色的人員，並按 UUID 固定順序。"""
    holder_ids = session.scalars(
        select(User.id)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .join(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .where(ProjectMemberRole.role_id == role_id)
        .distinct()
        .order_by(User.id)
    ).all()
    if not holder_ids:
        return
    session.scalars(
        select(User)
        .where(User.id.in_(holder_ids))
        .order_by(User.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()


def _delegated_modules(session: Session, user_id: uuid.UUID) -> set[str]:
    return set(
        session.scalars(
            select(UserModuleDelegation.module).where(
                UserModuleDelegation.user_id == user_id
            )
        ).all()
    )


def _authorize_mutation(
    session: Session,
    *,
    actor: User,
    user: User,
    module: str | None,
    permission_codes: list[str],
    operation: str,
    bundle_id: uuid.UUID | None = None,
    record_denial: bool = True,
) -> None:
    if module is None:
        raise InvalidModulePermissionError("Permission has no owning module")
    if user.is_admin:
        raise ModulePermissionDeniedError(
            "Admin module access is implicit and cannot be stored"
        )
    if (
        operation == "grant"
        and user.is_external_collaborator
        and any(
            not permission_code_external_allowed(code)
            for code in permission_codes
        )
    ):
        _reject_external_mutation(
            session,
            user=user,
            permission_codes=permission_codes,
            module=module,
            reason="external_not_allowed",
            bundle_id=bundle_id,
            record_denial=record_denial,
        )
    allowed = actor.is_admin
    delegated = module in _delegated_modules(session, actor.id)
    if not allowed:
        allowed = delegated and actor.id != user.id
        if "all_project_progress.read" in permission_codes:
            allowed = (
                operation == "revoke" and delegated and actor.id != user.id
            )
    if not allowed:
        if record_denial:
            _record_denied_grant(
                session,
                user=user,
                permission_codes=permission_codes,
                bundle_id=bundle_id,
                reason="outside_delegation_scope",
            )
        raise ModulePermissionDeniedError(
            "Actor cannot manage this module permission"
        )


def _reject_external_mutation(
    session: Session,
    *,
    user: User,
    permission_codes: list[str],
    module: str,
    reason: str,
    bundle_id: uuid.UUID | None = None,
    record_denial: bool = True,
) -> None:
    if record_denial:
        _record_denied_grant(
            session,
            user=user,
            permission_codes=permission_codes,
            bundle_id=bundle_id,
            reason=reason,
        )
    raise ExternalCollaboratorPermissionError(
        "External collaborators cannot receive this permission"
    )


def _record_denied_grant(
    session: Session,
    *,
    user: User,
    permission_codes: Iterable[str],
    bundle_id: uuid.UUID | None,
    reason: str,
) -> None:
    after: dict[str, object] = {
        "user_id": user.id,
        "permission_codes": sorted(set(permission_codes)),
        "reason": reason,
    }
    if bundle_id is not None:
        after["bundle_id"] = bundle_id
    try:
        audit_service.record_audit_event_in_independent_transaction(
            session,
            "module_permission.grant_denied",
            entity_id=user.id,
            before=None,
            after=after,
        )
    except Exception:
        logger.exception("Could not write independent permission denial")


def _record_permission_event(
    session: Session,
    *,
    event_type: str,
    user: User,
    permission_code: str,
    module: str | None,
    source: str,
) -> None:
    audit_service.record_audit_event(
        session,
        event_type,
        entity_id=user.id,
        before=(
            {
                "user_id": user.id,
                "permission_code": permission_code,
                "module": module,
                "source": source,
            }
            if event_type.endswith("revoked")
            else None
        ),
        after=(
            None
            if event_type.endswith("revoked")
            else {
                "user_id": user.id,
                "permission_code": permission_code,
                "module": module,
                "source": source,
            }
        ),
    )
