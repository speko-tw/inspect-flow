"""Person-scoped module permission services (DOM-R59–DOM-R64)."""

import logging
import uuid
from collections.abc import Iterable

from sqlalchemy import select
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
    is_permission_code_registered,
    permission_code_external_allowed,
    permission_code_module,
    permission_code_scope,
)
from app.services import audit as audit_service

logger = logging.getLogger(__name__)

# Keep these audit reasons aligned with the corresponding API error codes.
_EXTERNAL_ROLE_NOT_ALLOWED_REASON = "project.external_role_not_allowed"


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


class InvalidExternalRoleError(ModulePermissionError):
    """The role's definition cannot be marked externally allowed."""


class ExternalRoleInUseError(ModulePermissionError):
    """External collaborators currently hold a restricted role."""


class CreatorRoleInUseError(ModulePermissionError):
    """The designated creator role cannot be deleted."""


class CreatorRolePermissionsError(ModulePermissionError):
    """The designated creator role must retain three permissions."""


def validate_role_assignment(
    session: Session,
    *,
    user: User,
    project_id: uuid.UUID,
    project_member_id: uuid.UUID,
    role_ids: Iterable[uuid.UUID],
) -> None:
    """Enforce external-user role constraints."""
    desired_role_ids = set(role_ids)
    roles = list(
        session.scalars(select(Role).where(Role.id.in_(desired_role_ids)))
    )
    if len(roles) != len(desired_role_ids):
        raise InvalidModulePermissionError("Role does not exist")
    for role in roles:
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
    """Reject role edits that would violate external-user constraints."""
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
    holders = session.execute(
        select(User.name_zh, User.name_en, User.id)
        .join(ProjectMember, ProjectMember.user_id == User.id)
        .join(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .where(
            ProjectMemberRole.role_id == role.id,
            User.is_external_collaborator.is_(True),
        )
        .distinct()
    ).all()
    if holders and (
        not is_external_allowed
        or any(not permission_code_external_allowed(code) for code in desired)
    ):
        raise ExternalRoleInUseError(
            "Role is held by external collaborators and cannot be restricted",
            details=[
                f"{name_zh or name_en} ({user_id})"
                for name_zh, name_en, user_id in holders
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
    """Set the designated creator role after validating its invariant."""
    _require_admin(actor)
    codes = frozenset(permission.code for permission in role.permission_codes)
    if not _CREATOR_ROLE_CODES <= codes:
        raise InvalidModulePermissionError(
            "Creator role must retain project.update, "
            "project_member.manage, and project.read"
        )
    if role.is_external_allowed:
        raise InvalidExternalRoleError(
            "The creator role cannot be externally allowed"
        )
    setting = get_creator_role_setting(session)
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
    """Admin-only, idempotent module delegation grant."""
    if not actor.is_admin:
        raise ModulePermissionDeniedError("Only Admin may grant delegation")
    if module not in {"project", "inspection", "template"}:
        raise InvalidModulePermissionError(f"Unregistered module: {module}")
    if user.is_external_collaborator:
        _reject_external_mutation(
            session,
            user=user,
            permission_codes=[],
            module=module,
            reason="external_collaborator_delegation",
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
        or code == "all_project_progress.read"
        or (
            not actor.is_admin
            and (
                actor.id == user.id
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
    existing = session.scalar(
        select(UserModulePermission.id).where(
            UserModulePermission.user_id == user.id,
            UserModulePermission.permission_code == permission_code,
        )
    )
    if existing is not None:
        return False
    session.add(
        UserModulePermission(
            user_id=user.id,
            permission_code=permission_code,
            source=source,
        )
    )
    return True


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
