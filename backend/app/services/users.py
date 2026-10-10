"""``User`` create and manual-modification Service entry points
(DOM-R04, DOM-R06, DOM-R07, DOM-R14, DOM-R18, DOM-R22, DOM-R32).

Modifying ``User`` must always go through here: direct ORM writes
skip DOM-R04's "外部帳號拒絕人工修改基本欄位" entirely (see plan.md's
"Service 層規則被繞過" risk). This module covers creation
(:func:`create_user`), the *manual* basic/contact-field modification
path (:func:`update_user_manual`) -- DOM-R04 explicitly distinguishes
"人工修改" from ``external-identity-sync``'s sync path, which is out
of scope here and gets its own entry point in that spec -- and (T7,
issue #135) ``is_admin``/``is_active`` modification
(:func:`set_is_admin`, :func:`set_is_active`), each protecting the
built-in account (DOM-R06) and the last active Admin (DOM-R07).
The username path additionally checks the current operator's Admin
status (DOM-R45). HTTP management routes declare ``require_admin``
for the other writes.

:func:`set_is_admin` writes one ``user.admin_changed`` audit event
per call (DOM-R22); :func:`set_is_active` never writes one -- DOM-R22
explicitly lists ``is_active`` as outside its event scope. Both
reject *before* touching ``user`` at all when DOM-R06/DOM-R07 would
be violated, the same "reject before any attribute is touched" idiom
:func:`update_user_manual` already follows for
``ExternalBasicFieldModificationError``. :func:`set_is_admin`
additionally rejects a call that would not actually change
``is_admin`` (:class:`AdminStatusUnchangedError`) before touching
anything either -- unlike :func:`set_is_active` (which has no audit
event to protect), letting a no-op through to
:func:`app.services.audit.record_audit_event` would only fail
*after* ``updated_by``/``updated_at`` had already been bumped for
nothing to audit.
"""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    Company,
    CreatorRoleSetting,
    ProjectMember,
    ProjectMemberRole,
    Role,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.permission_codes import permission_code_external_allowed
from app.services import UNSET, _Unset
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class CompanyNotActiveError(ValueError):
    """DOM-R32: refused because the target ``Company`` is disabled
    (``is_active = False``). Raised before any attribute on the
    ``User`` is touched, so a caller inside a still-open transaction
    is left with no partial write.
    """


class ExternalBasicFieldModificationError(ValueError):
    """DOM-R04: an ``auth_source = external`` account's basic
    fields may only be changed by ``external-identity-sync``, never
    by a manual entry point. Raised before any attribute on the
    ``User`` is touched, so none of the fields in the same call --
    including ones that would otherwise have been allowed -- are
    written.
    """


class BuiltInAccountModificationError(ValueError):
    """DOM-R06: ``user.is_system`` is ``True`` and the requested
    change would disable it (``is_active = False``) or take away
    its Admin status (``is_admin = False``). Raised before any
    attribute on ``user`` is touched.
    """


class LastActiveAdminRemovalError(ValueError):
    """DOM-R07: the requested change would leave zero ``User`` rows
    that are both ``is_active = True`` and ``is_admin = True`` --
    "拿掉 Admin" covers both un-checking ``is_admin`` and disabling
    an active Admin's account. Raised before any attribute on
    ``user`` is touched.
    """


class AdminStatusUnchangedError(ValueError):
    """:func:`set_is_admin` was called with the value ``user.
    is_admin`` already has. Raised before ``user`` is touched -- see
    this module's docstring for why this is checked here rather than
    left for :func:`app.services.audit.record_audit_event` to catch.
    """


class UsernameChangePermissionError(ValueError):
    """Only an Admin may change a local account's username."""


class InvalidUserFieldError(ValueError):
    """A submitted User field failed model validation."""


class ExternalFlagChangeError(ValueError):
    """An external-collaborator flag change violates DOM-R73."""

    def __init__(
        self, message: str, *, details: list[str] | None = None
    ) -> None:
        self.details = details
        super().__init__(message)


def _reject_if_company_inactive(
    session: Session, company_id: uuid.UUID
) -> None:
    company = session.get(Company, company_id)
    # A company_id with no matching row at all is left to the
    # (deferred) foreign key constraint to reject at commit time,
    # same as every other dangling foreign key in this codebase --
    # this check only concerns a company that exists but is
    # disabled.
    if company is not None and not company.is_active:
        raise CompanyNotActiveError(
            f"Company {company_id} is not active (DOM-R32); a User "
            "cannot be created or reassigned to it"
        )


def create_user(
    session: Session,
    *,
    username: str,
    name_zh: str,
    email: str,
    company_id: uuid.UUID | None = None,
    department: str | None = None,
    location: str | None = None,
    employee_no: str | None = None,
    name_en: str | None = None,
    is_active: bool = True,
    is_external_collaborator: bool,
    account_expires_on: date | None = None,
    auth_source: str = "local",
    external_source: str | None = None,
    external_id: str | None = None,
    extension_1: str | None = None,
    extension_2: str | None = None,
    mobile: str | None = None,
    line_id: str | None = None,
    wechat_id: str | None = None,
    responsibilities: str | None = None,
) -> User:
    """Add a ``User`` (DOM-R46, DOM-R03, DOM-R08), filling
    ``created_by``/``updated_by`` from the current operator
    (DOM-R14). ``username``, ``name_zh`` and ``email`` are
    required (DOM-R46); the company and the fields that depend on it
    are optional. Refuses a ``company_id`` pointing at a disabled
    ``Company`` (DOM-R32).
    """
    if company_id is not None:
        _reject_if_company_inactive(session, company_id)
    operator = get_current_operator(session)
    try:
        user = User(
            username=username,
            company_id=company_id,
            department=department,
            location=location,
            employee_no=employee_no,
            name_en=name_en,
            name_zh=name_zh,
            email=email,
            is_active=is_active,
            is_external_collaborator=is_external_collaborator,
            account_expires_on=account_expires_on,
            auth_source=auth_source,
            external_source=external_source,
            external_id=external_id,
            extension_1=extension_1,
            extension_2=extension_2,
            mobile=mobile,
            line_id=line_id,
            wechat_id=wechat_id,
            responsibilities=responsibilities,
            created_by=operator.id,
            updated_by=operator.id,
        )
    except ValueError as exc:
        raise InvalidUserFieldError from exc
    session.add(user)
    session.flush()
    return user


def set_external_collaborator(
    session: Session,
    user: User,
    is_external_collaborator: bool,
    *,
    confirmed: bool = False,
) -> bool:
    """Change external-collaborator status after DOM-R73 checks."""
    operator = get_current_operator(session)
    if not operator.is_admin:
        raise ExternalFlagChangeError("Only Admin may change this flag")
    if user.is_external_collaborator == is_external_collaborator:
        return False
    if user.is_external_collaborator and not confirmed:
        raise ExternalFlagChangeError(
            "Changing an external collaborator to internal requires "
            "confirmation"
        )
    if is_external_collaborator:
        role_rows = session.execute(
            select(Role.name, Role.is_external_allowed, Role.id)
            .join(ProjectMemberRole, ProjectMemberRole.role_id == Role.id)
            .join(
                ProjectMember,
                ProjectMember.id == ProjectMemberRole.project_member_id,
            )
            .where(ProjectMember.user_id == user.id)
        ).all()
        creator_role_id = session.scalar(
            select(CreatorRoleSetting.role_id).limit(1)
        )
        invalid_roles = [
            (name, role_id)
            for name, allowed, role_id in role_rows
            if not allowed or role_id == creator_role_id
        ]
        permissions = list(
            session.scalars(
                select(UserModulePermission.permission_code).where(
                    UserModulePermission.user_id == user.id
                )
            ).all()
        )
        invalid_permissions = [
            code
            for code in permissions
            if not permission_code_external_allowed(code)
        ]
        delegations = list(
            session.scalars(
                select(UserModuleDelegation.module).where(
                    UserModuleDelegation.user_id == user.id
                )
            ).all()
        )
        if (
            user.is_admin
            or invalid_roles
            or invalid_permissions
            or delegations
        ):
            details = [
                f"role: {name} ({role_id})" for name, role_id in invalid_roles
            ]
            details.extend(
                f"module permission: {code}" for code in invalid_permissions
            )
            details.extend(f"delegation: {module}" for module in delegations)
            if user.is_admin:
                details.append("administrator status")
            raise ExternalFlagChangeError(
                "User does not qualify as an external collaborator: "
                f"admin={user.is_admin}, roles={invalid_roles}, "
                f"permissions={invalid_permissions}, "
                f"delegations={delegations}",
                details=details,
            )
    previous = user.is_external_collaborator
    user.is_external_collaborator = is_external_collaborator
    user.updated_by = operator.id
    session.flush()
    record_audit_event(
        session,
        "user.external_flag_changed",
        entity_id=user.id,
        before={"is_external_collaborator": previous},
        after={"is_external_collaborator": is_external_collaborator},
    )
    return True


def update_user_manual(
    session: Session,
    user: User,
    *,
    username: str | _Unset = UNSET,
    company_id: uuid.UUID | None | _Unset = UNSET,
    department: str | None | _Unset = UNSET,
    location: str | None | _Unset = UNSET,
    employee_no: str | None | _Unset = UNSET,
    name_en: str | None | _Unset = UNSET,
    name_zh: str | _Unset = UNSET,
    email: str | _Unset = UNSET,
    extension_1: str | None | _Unset = UNSET,
    extension_2: str | None | _Unset = UNSET,
    mobile: str | None | _Unset = UNSET,
    line_id: str | None | _Unset = UNSET,
    wechat_id: str | None | _Unset = UNSET,
    responsibilities: str | None | _Unset = UNSET,
    account_expires_on: date | None | _Unset = UNSET,
) -> User:
    """Manually modify a ``User`` (DOM-R04, DOM-R18, DOM-R32).

    Basic fields (``username``, ``company_id``, ``department``,
    ``location``, ``employee_no``, ``name_en``, ``name_zh``, ``email``) are
    rejected outright -- with no change to any field passed in the
    same call -- when ``user.auth_source == "external"`` (DOM-R04).
    For any other account, changing ``company_id`` additionally
    requires the target ``Company`` to be active (DOM-R18, DOM-R32);
    the other basic fields have no such restriction here (DOM-R04
    leaves "who may change a ``local`` account's basic fields" --
    Admin only -- to ``authentication``'s authorization check, not
    this function).

    Contact and supplementary fields (``extension_1``,
    ``extension_2``, ``mobile``, ``line_id``, ``wechat_id``,
    ``responsibilities``) are always allowed regardless of
    ``auth_source``; but when the same call is rejected for a
    basic field, none of its fields -- contact fields included --
    are written.

    Only keyword arguments actually passed are changed -- see
    :data:`app.services.UNSET`.
    """
    basic_fields = {
        "username": username,
        "company_id": company_id,
        "department": department,
        "location": location,
        "employee_no": employee_no,
        "name_en": name_en,
        "name_zh": name_zh,
        "email": email,
    }
    changed_basic_fields = {
        field: value
        for field, value in basic_fields.items()
        if value is not UNSET
    }

    if changed_basic_fields and user.auth_source == "external":
        raise ExternalBasicFieldModificationError(
            "User "
            f"{user.id} is an external account; its basic fields "
            f"({', '.join(sorted(changed_basic_fields))}) may only "
            "be changed by external-identity-sync (DOM-R04)"
        )
    new_company_id = changed_basic_fields.get("company_id")
    if isinstance(new_company_id, uuid.UUID):
        _reject_if_company_inactive(session, new_company_id)

    operator = get_current_operator(session)
    if username is not UNSET and not operator.is_admin:
        raise UsernameChangePermissionError(
            "Only an Admin may change a username (DOM-R45)"
        )
    old_username = user.username
    old_company_id = user.company_id
    old_company_fields = {
        field: getattr(user, field)
        for field in ("employee_no", "department", "location")
    }
    company_changed = company_id is not UNSET and company_id != old_company_id
    if company_changed:
        for field in old_company_fields:
            if field not in changed_basic_fields:
                changed_basic_fields[field] = None
    try:
        for field, value in changed_basic_fields.items():
            setattr(user, field, value)
    except ValueError as exc:
        raise InvalidUserFieldError from exc
    contact_fields = {
        "extension_1": extension_1,
        "extension_2": extension_2,
        "mobile": mobile,
        "line_id": line_id,
        "wechat_id": wechat_id,
        "responsibilities": responsibilities,
    }
    try:
        for field, value in contact_fields.items():
            if value is not UNSET:
                setattr(user, field, value)
        if account_expires_on is not UNSET:
            user.account_expires_on = account_expires_on
    except ValueError as exc:
        raise InvalidUserFieldError from exc
    user.updated_by = operator.id
    session.flush()
    if user.username != old_username:
        record_audit_event(
            session,
            "user.username_changed",
            entity_id=user.id,
            before={"username": old_username},
            after={"username": user.username},
        )
    if company_changed:
        before_company = {"company_id": old_company_id} | old_company_fields
        after_company = {
            "company_id": user.company_id,
            **{field: getattr(user, field) for field in old_company_fields},
        }
        record_audit_event(
            session,
            "user.company_changed",
            entity_id=user.id,
            before=before_company,
            after=after_company,
        )
    return user


def _would_remove_last_active_admin(
    session: Session,
    user: User,
    *,
    is_admin_after: bool,
    is_active_after: bool,
) -> bool:
    """DOM-R07: whether changing ``user`` to
    ``is_admin=is_admin_after``/``is_active=is_active_after`` would
    leave zero ``User`` rows that are both active and Admin.

    Only a transition *out of* being an active Admin can possibly
    cause this: if ``user`` was not already both active and Admin,
    it was never part of the count to begin with, so this always
    returns ``False`` regardless of how many active Admins exist
    elsewhere (including zero -- a pre-existing state this change
    did not cause). If it *was* an active Admin and still would be
    after the change, the change is equally always safe. Only when
    it was an active Admin and would stop being one does the count
    of every *other* active Admin decide the answer.
    """
    was_active_admin = user.is_admin and user.is_active
    will_be_active_admin = is_admin_after and is_active_after
    if not was_active_admin or will_be_active_admin:
        return False
    remaining = session.scalar(
        select(func.count())
        .select_from(User)
        .where(
            User.id != user.id,
            User.is_admin.is_(True),
            User.is_active.is_(True),
        )
    )
    return remaining == 0


def set_is_admin(session: Session, user: User, is_admin: bool) -> User:
    """Modify ``user.is_admin`` (DOM-R05), filling ``updated_by``
    from the current operator (DOM-R14), and record one
    ``user.admin_changed`` audit event (DOM-R22).

    Raises:
        AdminStatusUnchangedError: ``is_admin`` already equals
            ``user.is_admin``.
        BuiltInAccountModificationError: ``is_admin`` is ``False``
            and ``user.is_system`` is ``True`` (DOM-R06).
        LastActiveAdminRemovalError: ``is_admin`` is ``False`` and
            this would leave no active Admin at all (DOM-R07).
    """
    if is_admin == user.is_admin:
        raise AdminStatusUnchangedError(
            f"User {user.id}: is_admin is already {is_admin}"
        )
    if is_admin and user.is_external_collaborator:
        raise ExternalFlagChangeError(
            "External collaborators cannot hold Admin status"
        )
    if not is_admin:
        if user.is_system:
            raise BuiltInAccountModificationError(
                f"User {user.id} is a built-in account; its is_admin "
                "cannot be taken away (DOM-R06)"
            )
        if _would_remove_last_active_admin(
            session,
            user,
            is_admin_after=False,
            is_active_after=user.is_active,
        ):
            raise LastActiveAdminRemovalError(
                f"User {user.id}: taking away is_admin would leave no "
                "active Admin (DOM-R07)"
            )

    operator = get_current_operator(session)
    before_is_admin = user.is_admin
    user.is_admin = is_admin
    user.updated_by = operator.id
    session.flush()
    record_audit_event(
        session,
        "user.admin_changed",
        entity_id=user.id,
        before={"is_admin": before_is_admin},
        after={"is_admin": is_admin},
    )
    return user


def set_is_active(session: Session, user: User, is_active: bool) -> User:
    """Modify ``user.is_active``, filling ``updated_by`` from the
    current operator (DOM-R14). Never writes an audit event --
    DOM-R22 excludes ``is_active`` from its event scope.

    Raises:
        BuiltInAccountModificationError: ``is_active`` is ``False``
            and ``user.is_system`` is ``True`` (DOM-R06).
        LastActiveAdminRemovalError: ``is_active`` is ``False`` and
            this would leave no active Admin at all (DOM-R07).
    """
    if not is_active:
        if user.is_system:
            raise BuiltInAccountModificationError(
                f"User {user.id} is a built-in account; it cannot be "
                "disabled (DOM-R06)"
            )
        if _would_remove_last_active_admin(
            session,
            user,
            is_admin_after=user.is_admin,
            is_active_after=False,
        ):
            raise LastActiveAdminRemovalError(
                f"User {user.id}: disabling this account would leave "
                "no active Admin (DOM-R07)"
            )

    operator = get_current_operator(session)
    user.is_active = is_active
    user.updated_by = operator.id
    session.flush()
    return user


__all__ = [
    "AdminStatusUnchangedError",
    "BuiltInAccountModificationError",
    "CompanyNotActiveError",
    "ExternalBasicFieldModificationError",
    "LastActiveAdminRemovalError",
    "InvalidUserFieldError",
    "UsernameChangePermissionError",
    "create_user",
    "set_is_active",
    "set_is_admin",
    "update_user_manual",
]
