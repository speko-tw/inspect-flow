"""Read-only permission calculations (DOM-R23, DOM-R24, DOM-R26).

Three query-only entry points, none of which add, flush, commit or
otherwise mutate any row. Each result reflects whatever is already
flushed to the database at call time; a caller with its own pending
(unflushed) changes that should count must flush them itself first
-- this module never flushes on a caller's behalf, precisely because
it is read-only. Correspondingly, every query below runs inside
``session.no_autoflush`` so that reading here never forces out a
caller's pending write as a side effect (SQLAlchemy's default
autoflush would otherwise ``UPDATE``/``INSERT`` before every
``SELECT``):

- :func:`effective_permissions` (DOM-R26): the union of permission
  codes a ``User`` holds in one ``Project``, computed fresh from
  ``Role.permission_codes`` on every call -- never a copy stored on
  ``ProjectMember`` itself, so a later edit to a ``Role`` is
  reflected immediately for every holder (once flushed).
- :func:`role_impact_scope` (DOM-R23): how many ``ProjectMember``
  rows hold a given ``Role``, and how many distinct ``User``s that
  is -- the numbers a future confirmation screen shows before a
  ``Role`` is changed or deleted.
- :func:`has_modify_capability` (DOM-R24): whether any of a
  ``Role``'s permission codes represents something other than
  reading, used by a future feature spec to decide whether to warn
  before assigning that role to a customer-company member.

DOM-R35 registers permission codes as one dot-namespaced string
(``<data>.<action>``) per code, with the read action always spelled
``read`` -- see ``app/permission_codes.py``. ``effective_permissions``
therefore only ever ``SELECT``s ``RolePermission.code``, never
filters ``WHERE ... code = ...``: a code used as a bind parameter
would go through ``BoundedString``'s registration check
(``app/models/role.py``), which is meant to gate *writes*, not reads,
and would raise ``ValueError`` for any code no feature spec has
registered yet.
"""

import contextlib
import uuid
from dataclasses import dataclass

from sqlalchemy import distinct, func, select
from sqlalchemy.orm import Session, object_session

from app.models import (
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModulePermission,
)
from app.permission_codes import PermissionCode, permission_code_scope


@dataclass(frozen=True)
class EffectiveAccess:
    """One effective permission snapshot for a person and optional project."""

    is_active: bool
    is_admin: bool
    module_permissions: frozenset[str]
    project_permissions: frozenset[str]
    project_permissions_by_project: dict[uuid.UUID, frozenset[str]]


def calculate_effective_access(
    session: Session, *, user_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
) -> EffectiveAccess:
    """DOM-R69: single calculation entry for module and project access."""
    with session.no_autoflush:
        user = session.get(User, user_id)
        if user is None:
            return EffectiveAccess(
                False, False, frozenset(), frozenset(), {}
            )
        if user.is_admin:
            module_codes = frozenset(
                code.value for code in PermissionCode
                if permission_code_scope(code.value) == "module"
            )
        else:
            module_codes = frozenset(session.scalars(
                select(UserModulePermission.permission_code).where(
                    UserModulePermission.user_id == user_id
                )
            ).all())
        project_map = _project_permissions_by_project(
            session, user_id=user_id, project_id=project_id
        )
        project_codes = (
            project_map.get(project_id, frozenset())
            if project_id
            else frozenset()
        )
    return EffectiveAccess(
        is_active=user.is_active,
        is_admin=user.is_admin,
        module_permissions=module_codes,
        project_permissions=project_codes,
        project_permissions_by_project=project_map,
    )


def _project_permissions_by_project(
    session: Session, *, user_id: uuid.UUID,
    project_id: uuid.UUID | None,
) -> dict[uuid.UUID, frozenset[str]]:
    query = (
        select(ProjectMember.project_id, RolePermission.code)
        .distinct()
        .join(ProjectMemberRole,
              ProjectMemberRole.project_member_id == ProjectMember.id)
        .join(RolePermission,
              RolePermission.role_id == ProjectMemberRole.role_id)
        .where(ProjectMember.user_id == user_id)
    )
    if project_id is not None:
        query = query.where(ProjectMember.project_id == project_id)
    grouped: dict[uuid.UUID, set[str]] = {}
    for key, code in session.execute(query).all():
        grouped.setdefault(key, set()).add(code)
    return {key: frozenset(values) for key, values in grouped.items()}


def effective_permissions(
    session: Session, *, user_id: uuid.UUID, project_id: uuid.UUID
) -> frozenset[str]:
    """DOM-R26: the set of permission codes ``user_id`` effectively
    holds in ``project_id`` -- the union of every ``Role``'s codes
    across all of that ``ProjectMember``'s role assignments.

    Returns the empty set both when ``user_id`` is not a member of
    ``project_id`` at all, and when the membership exists but holds
    no role (DOM-R36) -- both cases simply match zero rows below,
    so neither needs a separate branch.
    """
    return calculate_effective_access(
        session, user_id=user_id, project_id=project_id
    ).project_permissions


@dataclass(frozen=True)
class RoleImpactScope:
    """DOM-R23: a ``Role``'s influence range before it is changed or
    deleted -- how many ``ProjectMember`` rows currently hold it
    (``member_count``), and how many distinct ``User``s that is
    (``user_count``, always at most ``member_count`` since the same
    person may hold the role on more than one project).
    """

    member_count: int
    user_count: int


def role_impact_scope(
    session: Session, *, role_id: uuid.UUID
) -> RoleImpactScope:
    """DOM-R23: count the ``ProjectMember`` rows holding ``role_id``
    and the distinct ``User``s among them. Both counts are ``0`` when
    nobody holds the role.
    """
    with session.no_autoflush:
        member_count, user_count = session.execute(
            select(
                func.count(ProjectMemberRole.project_member_id),
                func.count(distinct(ProjectMember.user_id)),
            )
            .select_from(ProjectMemberRole)
            .join(
                ProjectMember,
                ProjectMember.id == ProjectMemberRole.project_member_id,
            )
            .where(ProjectMemberRole.role_id == role_id)
        ).one()
    return RoleImpactScope(member_count=member_count, user_count=user_count)


def has_modify_capability(role: Role) -> bool:
    """DOM-R24: whether ``role`` has "modify capability" -- any of
    its permission codes has an action (the part after the first
    ``.``) other than ``read``. A role with no permission codes at
    all does not count (returns ``False``).

    Reads ``role.permission_codes`` directly (an ORM relationship,
    not a query against ``session``) since the judgment only needs
    one already-loaded ``Role``, not a set computed across rows. If
    the relationship is already loaded in memory, this reads it as
    is; if it is not, accessing it below triggers a lazy load,
    which -- for a ``role`` attached to a ``Session`` -- would
    autoflush that ``Session`` just like a direct query would.
    Reading each permission's ``code`` further below can *also* hit
    the database: if that attribute has been expired (e.g. by
    ``session.expire(perm, ["code"])``) while the collection itself
    stayed loaded, accessing it triggers a refresh, which likewise
    autoflushes. So both the collection access and the iteration
    that reads ``.code`` off each element must happen inside the
    owning ``Session``'s ``no_autoflush``. A detached or transient
    ``role`` has no owning ``Session`` to protect and is read
    directly.
    """
    owning_session = object_session(role)
    guard = (
        owning_session.no_autoflush
        if owning_session is not None
        else contextlib.nullcontext()
    )
    with guard:
        return any(
            permission.code.split(".", 1)[1] != "read"
            for permission in role.permission_codes
        )
