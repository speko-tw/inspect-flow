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
        ValueError: ``permission_codes`` contains a code that fails
            DOM-R30's format check or DOM-R35's registration check
            (raised by :class:`app.models.role.RolePermission`'s own
            validation). Every new ``RolePermission`` is constructed
            -- and therefore validated -- up front, *before* ``role``
            or ``created_by``/``updated_by`` are touched: constructing
            them only after ``role.name`` had already been reassigned
            would leave that reassignment sitting in memory on a
            rejected call, ready to be written by a later, unrelated
            ``flush``/``commit`` in the same transaction with no
            ``role.updated`` event to show for it.
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

    # Build every new RolePermission row now, while `role` is still
    # completely untouched: each constructor call runs
    # RolePermission's own DOM-R30/DOM-R35 validation, so an invalid
    # or unregistered code raises here -- before role.name (below) or
    # role.permission_codes has been reassigned to anything.
    new_permission_rows = None
    to_remove: frozenset[str] = frozenset()
    if codes_changed:
        to_remove = current_codes - desired_codes
        to_add = desired_codes - current_codes
        new_permission_rows = [
            RolePermission(code=code) for code in sorted(to_add)
        ]

    operator = get_current_operator(session)
    before: dict[str, object] = {}
    after: dict[str, object] = {}
    if name_changed:
        assert name is not UNSET
        before["name"] = current_name
        after["name"] = name
        role.name = name
    if codes_changed:
        assert new_permission_rows is not None
        before["permission_codes"] = current_codes
        after["permission_codes"] = desired_codes
        role.permission_codes[:] = [
            permission
            for permission in role.permission_codes
            if permission.code not in to_remove
        ] + new_permission_rows
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

    Resolves the current operator up front, purely to fail fast: this
    function has no ``created_by``/``updated_by`` column of its own
    to fill, but
    :func:`app.services.audit.record_audit_event` still needs one
    for the event's ``created_by``, and it does not resolve one until
    after this function's own ``session.flush()`` has already
    deleted ``role``. Resolving it first means an unauthenticated
    caller (:class:`app.services.operator.OperatorNotAuthenticatedError`)
    is rejected before ``role`` is touched at all, the same "reject
    before any mutation" ordering :func:`create_role`/
    :func:`update_role` already give their own operator lookups.
    """
    get_current_operator(session)
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
