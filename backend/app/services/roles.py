"""``Role`` create/rename/modify/delete Service entry points
(DOM-R19~DOM-R22, plan.md T7, issue #135).

Every write to ``Role`` (including its permission codes) must go
through here, exactly like ``users.py``/``companies.py``: a direct
ORM write would both skip DOM-R20's "改名或修改權限內容時必須更新
updated_at/updated_by" and, more importantly, never write the
DOM-R22 audit event this module's :func:`create_role`,
:func:`update_role` and :func:`delete_role` each write exactly one
of (``role.created``/``role.updated``/``role.deleted``) through
:func:`app.services.audit.record_audit_event`.

:func:`update_role` only ever records the field(s) that actually
changed (DOM-R20's own wording, "改名或修改權限內容"; the audit-log
event catalog's ``role.updated`` row: "有變動的 name、
permission_codes"). A call that would change neither ``name`` nor
``permission_codes`` -- either because no keyword was passed, or
because the value passed is identical to the current one -- is
rejected by :class:`RoleUnchangedError` *before* touching
``role`` or calling :func:`get_current_operator`, the same "reject
before any attribute is touched" idiom ``users.py``'s
``ExternalBasicFieldModificationError`` follows: letting
``record_audit_event`` itself catch this (it would, via its own
``UnchangedAuditFieldError``) would only do so *after* this module
had already set ``role.updated_by``/bumped ``updated_at`` for
nothing to audit, leaving a modified-but-unaudited row behind.

:func:`delete_role` captures ``name``, the current permission codes,
and (DOM-R21) every ``ProjectMember`` id currently holding this role
*before* issuing ``session.delete(role)``: DOM-R21's cascade removes
those ``ProjectMemberRole`` rows at the database level (see
``app/models/role.py``'s docstring), so they are gone by the time
the ``role.deleted`` event would otherwise try to read them. Per the
audit-log event catalog's note under 第一批事件, this is the *only*
audit event a role deletion writes -- no separate
``project_member.roles_changed`` per affected member.
"""

from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ProjectMemberRole, Role, RolePermission
from app.services import UNSET, _Unset
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class RoleUnchangedError(ValueError):
    """:func:`update_role` was called with no keyword that would
    actually change ``role.name`` or its permission codes -- either
    both were omitted, or each value passed equals the role's
    current value. Raised before ``role`` or ``created_by``/
    ``updated_by`` are touched, and before
    :func:`app.services.audit.record_audit_event` is ever called
    (DOM-R20 only requires an update record when something actually
    changed).
    """


def create_role(
    session: Session,
    *,
    name: str,
    permission_codes: Iterable[str] = (),
) -> Role:
    """Add a ``Role`` (DOM-R19), filling ``created_by``/
    ``updated_by`` from the current operator (DOM-R14), and record
    one ``role.created`` event (DOM-R22).
    """
    operator = get_current_operator(session)
    codes = frozenset(permission_codes)
    role = Role(
        name=name,
        created_by=operator.id,
        updated_by=operator.id,
    )
    role.permission_codes.extend(
        RolePermission(code=code) for code in sorted(codes)
    )
    session.add(role)
    session.flush()
    record_audit_event(
        session,
        "role.created",
        entity_id=role.id,
        before=None,
        after={"name": role.name, "permission_codes": codes},
    )
    return role


def update_role(
    session: Session,
    role: Role,
    *,
    name: str | _Unset = UNSET,
    permission_codes: Iterable[str] | _Unset = UNSET,
) -> Role:
    """Rename ``role`` and/or replace its permission codes with
    ``permission_codes`` (DOM-R20), filling ``updated_by`` from the
    current operator (DOM-R14), and record one ``role.updated``
    event containing only the field(s) that actually changed
    (DOM-R22).

    ``permission_codes``, when passed, is the *full* desired set of
    codes -- codes currently on ``role`` but absent from it are
    removed, codes present but not currently on ``role`` are added;
    codes in both are left untouched (so an unrelated code's own
    ``RolePermission`` row is never deleted-and-reinserted only to
    end up unchanged).

    Raises:
        RoleUnchangedError: neither argument was passed, or both
            passed values equal ``role``'s current ones -- see that
            class's docstring for why this is checked first.
    """
    current_name = role.name
    current_codes = frozenset(
        permission.code for permission in role.permission_codes
    )
    name_changed = name is not UNSET and name != current_name
    desired_codes = (
        frozenset(permission_codes)
        if permission_codes is not UNSET
        else current_codes
    )
    codes_changed = permission_codes is not UNSET and (
        desired_codes != current_codes
    )
    if not name_changed and not codes_changed:
        raise RoleUnchangedError(
            f"Role {role.id}: update_role() was called but neither "
            "name nor permission_codes would change"
        )

    operator = get_current_operator(session)
    before: dict[str, object] = {}
    after: dict[str, object] = {}
    if name_changed:
        assert name is not UNSET
        before["name"] = current_name
        after["name"] = name
        role.name = name
    if codes_changed:
        before["permission_codes"] = current_codes
        after["permission_codes"] = desired_codes
        to_remove = current_codes - desired_codes
        to_add = desired_codes - current_codes
        role.permission_codes[:] = [
            permission
            for permission in role.permission_codes
            if permission.code not in to_remove
        ] + [RolePermission(code=code) for code in sorted(to_add)]
    role.updated_by = operator.id
    session.flush()

    record_audit_event(
        session,
        "role.updated",
        entity_id=role.id,
        before=before,
        after=after,
    )
    return role


def delete_role(session: Session, role: Role) -> None:
    """Delete ``role`` and (DOM-R21) every ``ProjectMember``'s
    assignment to it -- the assignments are removed by the
    database's own ``ON DELETE CASCADE`` (see ``app/models/role.py``
    and ``app/models/project_member.py``'s docstrings), not by this
    function. Records one ``role.deleted`` event (DOM-R22) whose
    ``before.project_member_ids`` is exactly the set of
    ``ProjectMember`` ids that held ``role`` immediately before
    deletion -- captured up front, since the cascade removes the
    rows this would otherwise be computed from.
    """
    member_ids = session.scalars(
        select(ProjectMemberRole.project_member_id)
        .distinct()
        .where(ProjectMemberRole.role_id == role.id)
    ).all()
    before = {
        "name": role.name,
        "permission_codes": frozenset(
            permission.code for permission in role.permission_codes
        ),
        "project_member_ids": frozenset(member_ids),
    }
    role_id = role.id
    session.delete(role)
    session.flush()
    record_audit_event(
        session,
        "role.deleted",
        entity_id=role_id,
        before=before,
        after=None,
    )


__all__ = [
    "RoleUnchangedError",
    "create_role",
    "update_role",
    "delete_role",
]
