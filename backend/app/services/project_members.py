"""``ProjectMember`` role assignment and removal Service entry
points (DOM-R25, DOM-R36, plan.md T7, issue #135).

Three entry points, each filling ``created_by``/``updated_by`` (or,
for :func:`remove_project_member`, nothing -- the row is deleted)
from the current operator (DOM-R14), and each recording exactly one
DOM-R22 audit event through
:func:`app.services.audit.record_audit_event`:

- :func:`add_project_member`: adds a ``User`` to a ``Project``, with
  an optional initial set of ``Role`` ids. Per the audit-log event
  catalog's ``project_member.roles_changed`` row ("加入時就指派角色"),
  this is recorded as a ``project_member.roles_changed`` event whose
  ``before.role_ids`` is the empty set -- *not* a separate "member
  created" event, since none is registered. When no roles are
  assigned at all, DOM-R36 allows the resulting membership to simply
  hold zero roles, and per DOM-R22's scope ("加入時沒有指派角色不
  寫") nothing is recorded.
- :func:`assign_role`/:func:`unassign_role`: add or remove one
  ``Role`` from an existing ``ProjectMember``, each recording the
  full before/after role id sets as one more
  ``project_member.roles_changed`` event.
- :func:`remove_project_member`: DOM-R36's "把人移出專案" -- deletes
  the ``ProjectMember`` row outright (no "removed" flag is kept),
  relying on the database's own ``ON DELETE CASCADE`` to remove its
  role assignments (see ``app/models/project_member.py``'s
  docstring), and records one ``project_member.removed`` event
  (written even when the member held no role at all, per the
  audit-log event catalog).

``project_id``/``user_id`` are always included in
``project_member.roles_changed``'s payload (the event catalog's
``always_recorded``), even though neither ever changes across these
three functions -- :func:`app.services.audit.record_audit_event`
requires it regardless.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import ProjectMember, ProjectMemberRole
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class RoleAlreadyAssignedError(ValueError):
    """:func:`assign_role`: ``role_id`` is already one of
    ``member``'s role assignments (DOM-R25's "同一個 Role 在同一筆
    成員上不得重複指派"). Raised before ``member`` is touched, so a
    caller that raced this check against a concurrent assignment
    still relies on the database's own unique constraint, not this
    check, to be the final authority.
    """


class RoleNotAssignedError(ValueError):
    """:func:`unassign_role`: ``role_id`` is not currently one of
    ``member``'s role assignments -- there is nothing to remove.
    Raised before ``member`` is touched.
    """


def _current_role_ids(member: ProjectMember) -> frozenset[uuid.UUID]:
    return frozenset(
        assignment.role_id for assignment in member.role_assignments
    )


def _record_roles_changed(
    session: Session,
    member: ProjectMember,
    *,
    before_role_ids: frozenset[uuid.UUID],
    after_role_ids: frozenset[uuid.UUID],
) -> None:
    record_audit_event(
        session,
        "project_member.roles_changed",
        entity_id=member.id,
        project_id=member.project_id,
        before={
            "role_ids": before_role_ids,
            "project_id": member.project_id,
            "user_id": member.user_id,
        },
        after={
            "role_ids": after_role_ids,
            "project_id": member.project_id,
            "user_id": member.user_id,
        },
    )


def add_project_member(
    session: Session,
    *,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    role_ids: Iterable[uuid.UUID] = (),
) -> ProjectMember:
    """Add ``user_id`` to ``project_id`` (DOM-R25), optionally
    assigning ``role_ids`` at the same time. Records one
    ``project_member.roles_changed`` event only when ``role_ids`` is
    non-empty (DOM-R22's scope; DOM-R36 allows a member with no
    role, and adding one with no role is not audited).
    """
    operator = get_current_operator(session)
    role_id_set = frozenset(role_ids)
    member = ProjectMember(
        project_id=project_id,
        user_id=user_id,
        created_by=operator.id,
        updated_by=operator.id,
    )
    member.role_assignments.extend(
        ProjectMemberRole(role_id=role_id) for role_id in role_id_set
    )
    session.add(member)
    session.flush()
    if role_id_set:
        _record_roles_changed(
            session,
            member,
            before_role_ids=frozenset(),
            after_role_ids=role_id_set,
        )
    return member


def assign_role(
    session: Session, member: ProjectMember, role_id: uuid.UUID
) -> ProjectMember:
    """Assign ``role_id`` to ``member`` (DOM-R25), filling
    ``updated_by`` from the current operator (DOM-R14), and record
    one ``project_member.roles_changed`` event (DOM-R22).

    Raises:
        RoleAlreadyAssignedError: ``member`` already holds
            ``role_id``.
    """
    before_role_ids = _current_role_ids(member)
    if role_id in before_role_ids:
        raise RoleAlreadyAssignedError(
            f"ProjectMember {member.id} already holds role {role_id}"
        )
    operator = get_current_operator(session)
    member.role_assignments.append(ProjectMemberRole(role_id=role_id))
    member.updated_by = operator.id
    session.flush()
    _record_roles_changed(
        session,
        member,
        before_role_ids=before_role_ids,
        after_role_ids=before_role_ids | {role_id},
    )
    return member


def unassign_role(
    session: Session, member: ProjectMember, role_id: uuid.UUID
) -> ProjectMember:
    """Remove ``role_id`` from ``member``, filling ``updated_by``
    from the current operator (DOM-R14), and record one
    ``project_member.roles_changed`` event (DOM-R22).

    Deletes the matching ``ProjectMemberRole`` row directly
    (``session.delete``) rather than dropping it from ``member.
    role_assignments`` and relying on cascade: that relationship's
    cascade is deliberately only ``"save-update, merge"`` (see
    ``app/models/project_member.py``'s docstring), *not*
    ``delete-orphan`` -- dropping an item from the collection would
    instead try to ``UPDATE ... SET project_member_id = NULL``,
    which fails outright since that column is ``NOT NULL``.

    Deleting the child this way, instead of through the collection,
    also means SQLAlchemy never removes it from ``member.
    role_assignments``'s own in-memory list -- that list is only kept
    in sync when *it* is the thing mutated. Left alone, a later call
    in the same transaction (no commit in between) that reads
    ``member.role_assignments`` -- :func:`_current_role_ids`, used by
    both :func:`assign_role` and this function -- would still see the
    just-deleted row and wrongly report ``role_id`` as still
    assigned. This function therefore expires that one relationship
    (``session.expire(member, ["role_assignments"])``) right after
    flushing the delete, forcing the next access to re-``SELECT`` it
    rather than reuse the stale in-memory list.

    Raises:
        RoleNotAssignedError: ``member`` does not currently hold
            ``role_id``.
    """
    before_role_ids = _current_role_ids(member)
    if role_id not in before_role_ids:
        raise RoleNotAssignedError(
            f"ProjectMember {member.id} does not hold role {role_id}"
        )
    operator = get_current_operator(session)
    assignment = next(
        a for a in member.role_assignments if a.role_id == role_id
    )
    session.delete(assignment)
    member.updated_by = operator.id
    session.flush()
    session.expire(member, ["role_assignments"])
    _record_roles_changed(
        session,
        member,
        before_role_ids=before_role_ids,
        after_role_ids=before_role_ids - {role_id},
    )
    return member


def set_project_member_roles(
    session: Session,
    member: ProjectMember,
    role_ids: Iterable[uuid.UUID],
) -> ProjectMember:
    """Replace a member's full role set with one audit event.

    An empty set is valid (DOM-R36). A request that supplies the
    existing set is idempotent and does not update timestamps or add
    an audit row.
    """
    before_role_ids = _current_role_ids(member)
    after_role_ids = frozenset(role_ids)
    if before_role_ids == after_role_ids:
        return member

    operator = get_current_operator(session)
    to_remove = before_role_ids - after_role_ids
    to_add = after_role_ids - before_role_ids
    for assignment in member.role_assignments:
        if assignment.role_id in to_remove:
            session.delete(assignment)
    member.role_assignments.extend(
        ProjectMemberRole(role_id=role_id) for role_id in to_add
    )
    member.updated_by = operator.id
    session.flush()
    session.expire(member, ["role_assignments"])
    _record_roles_changed(
        session,
        member,
        before_role_ids=before_role_ids,
        after_role_ids=after_role_ids,
    )
    return member


def list_project_members(
    session: Session, project_id: uuid.UUID
) -> list[ProjectMember]:
    """Return ``project_id``'s members, oldest join first.

    Read-only query for the member management page. Ties on
    ``created_at`` fall back to the UUID so the order is stable.
    """
    return list(
        session.scalars(
            select(ProjectMember)
            .options(selectinload(ProjectMember.role_assignments))
            .where(ProjectMember.project_id == project_id)
            .order_by(ProjectMember.created_at, ProjectMember.id)
        )
    )


def remove_project_member(session: Session, member: ProjectMember) -> None:
    """Remove ``member`` from its project (DOM-R36): deletes the
    ``ProjectMember`` row outright, relying on the database's own
    ``ON DELETE CASCADE`` to remove its role assignments (see
    ``app/models/project_member.py``'s docstring). Records one
    ``project_member.removed`` event (DOM-R22) even when ``member``
    held no role at all.
    """
    before = {
        "project_id": member.project_id,
        "user_id": member.user_id,
        "role_ids": _current_role_ids(member),
    }
    member_id = member.id
    session.delete(member)
    session.flush()
    record_audit_event(
        session,
        "project_member.removed",
        entity_id=member_id,
        project_id=member.project_id,
        before=before,
        after=None,
    )


__all__ = [
    "RoleAlreadyAssignedError",
    "RoleNotAssignedError",
    "add_project_member",
    "list_project_members",
    "assign_role",
    "unassign_role",
    "remove_project_member",
    "set_project_member_roles",
]
