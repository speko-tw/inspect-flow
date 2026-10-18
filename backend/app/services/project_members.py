"""``ProjectMember`` role assignment and removal Service entry
points (DOM-R25, DOM-R36, plan.md T7, issue #135).

Mutation entry points fill ``created_by``/``updated_by`` (or,
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
- :func:`set_project_member_roles`: replaces the complete role set
  on an existing ``ProjectMember`` and records the full before/after
  role id sets in one ``project_member.roles_changed`` event.
- :func:`remove_project_member`: DOM-R36's "把人移出專案" -- deletes
  the ``ProjectMember`` row outright (no "removed" flag is kept),
  relying on the database's own ``ON DELETE CASCADE`` to remove its
  role assignments (see ``app/models/project_member.py``'s
  docstring), and records one ``project_member.removed`` event
  (written even when the member held no role at all, per the
  audit-log event catalog).

``project_id``/``user_id`` are always included in
``project_member.roles_changed``'s payload (the event catalog's
``always_recorded``); :func:`app.services.audit.record_audit_event`
requires them regardless of whether they changed.
"""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.base import uuid7
from app.models import (
    ProjectMember,
    ProjectMemberRole,
    User,
)
from app.services.audit import record_audit_event
from app.services.module_permissions import validate_role_assignment
from app.services.operator import get_current_operator


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
    actor_user_id: uuid.UUID | None = None,
    allow_self_assignment: bool = False,
    require_creator_user: bool = False,
) -> ProjectMember:
    """Add ``user_id`` to ``project_id`` (DOM-R25), optionally
    assigning ``role_ids`` at the same time. Records one
    ``project_member.roles_changed`` event only when ``role_ids`` is
    non-empty (DOM-R22's scope; DOM-R36 allows a member with no
    role, and adding one with no role is not audited).
    """
    operator = get_current_operator(session)
    role_id_set = frozenset(role_ids)
    user = session.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id} does not exist")
    member_id = uuid7()
    validate_role_assignment(
        session,
        user=user,
        project_id=project_id,
        project_member_id=member_id,
        role_ids=role_id_set,
        actor_user_id=actor_user_id or operator.id,
        allow_self_assignment=allow_self_assignment,
        require_creator_user=require_creator_user,
    )
    member = ProjectMember(
        id=member_id,
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


def set_project_member_roles(
    session: Session,
    member: ProjectMember,
    role_ids: Iterable[uuid.UUID],
    *,
    actor_user_id: uuid.UUID | None = None,
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
    user = session.get(User, member.user_id)
    if user is None:
        raise ValueError(f"User {member.user_id} does not exist")
    validate_role_assignment(
        session,
        user=user,
        project_id=member.project_id,
        project_member_id=member.id,
        role_ids=after_role_ids,
        actor_user_id=actor_user_id or operator.id,
        previous_role_ids=before_role_ids,
        check_last_manager=True,
    )
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


def remove_project_member(
    session: Session,
    member: ProjectMember,
    *,
    actor_user_id: uuid.UUID | None = None,
) -> None:
    """Remove ``member`` from its project (DOM-R36): deletes the
    ``ProjectMember`` row outright, relying on the database's own
    ``ON DELETE CASCADE`` to remove its role assignments (see
    ``app/models/project_member.py``'s docstring). Records one
    ``project_member.removed`` event (DOM-R22) even when ``member``
    held no role at all.
    """
    user = session.get(User, member.user_id)
    if user is None:
        raise ValueError(f"User {member.user_id} does not exist")
    validate_role_assignment(
        session,
        user=user,
        project_id=member.project_id,
        project_member_id=member.id,
        role_ids=(),
        actor_user_id=actor_user_id or get_current_operator(session).id,
        previous_role_ids=_current_role_ids(member),
        check_last_manager=True,
        require_active=False,
    )
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
    from app.services.user_lifecycle import (
        deactivate_external_account_without_memberships,
    )

    deactivate_external_account_without_memberships(session, user.id)


__all__ = [
    "add_project_member",
    "list_project_members",
    "remove_project_member",
    "set_project_member_roles",
]
