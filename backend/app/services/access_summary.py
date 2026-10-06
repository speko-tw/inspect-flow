"""Office/field access summary for the current user (Issue #480).

The login landing page and the admin navigation need to know which
areas of the UI a user can actually use. The frontend must not guess
that from ``is_admin`` alone, so ``/auth/me`` carries this summary.

Every registered permission code is classified into exactly one group
below; a contract test fails when a new code is registered without a
decision here.

- Field: ``inspection_task.inspect`` only -- the code the ``/field``
  task list requires.
- Task read: ``inspection_task.read`` alone is neither. #447 (ADM-R18)
  already treats it as a field-side code that hides the project's
  office sections, so counting it as office here would send such a
  user to a project list whose project page redirects away again.
- Office: every other registered code (project members, inspection
  items, zones, plans, and task manage/create/dispatch/assign/delete/
  cancel).

The summary is computed with one query per call (no per-project loop).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ProjectMember,
    ProjectMemberRole,
    RolePermission,
    SystemRoleAssignment,
    SystemRoleCode,
    User,
)

FIELD_PERMISSION_CODES: frozenset[str] = frozenset({"inspection_task.inspect"})
OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    {
        "project_member.manage",
        "project_inspection_item.edit",
        "project_zone.read",
        "project_zone.manage",
        "inspection_plan.read",
        "inspection_plan.create",
        "inspection_plan.manage",
        "inspection_plan.archive",
        "inspection_plan.unarchive",
        "inspection_task.manage",
        "inspection_task.create",
        "inspection_task.dispatch",
        "inspection_task.assign",
        "inspection_task.delete_draft",
        "inspection_task.cancel",
    }
)
TASK_READ_ONLY_CODES: frozenset[str] = frozenset({"inspection_task.read"})
# The template library is readable with this code in any project
# (same rule as ``require_system_role_or_any_project_permission`` on
# the template routes).
TEMPLATE_READ_PERMISSION_CODE = "project_inspection_item.edit"


@dataclass(frozen=True)
class AccessSummary:
    has_office_access: bool
    has_field_access: bool
    has_template_access: bool


def permission_codes_by_project(
    session: Session, *, user_id: uuid.UUID
) -> dict[uuid.UUID, frozenset[str]]:
    """Effective permission codes of ``user_id`` in every project the
    user is a member of, from a single query.
    """
    with session.no_autoflush:
        rows = session.execute(
            select(ProjectMember.project_id, RolePermission.code)
            .join(
                ProjectMemberRole,
                ProjectMemberRole.project_member_id == ProjectMember.id,
            )
            .join(
                RolePermission,
                RolePermission.role_id == ProjectMemberRole.role_id,
            )
            .where(ProjectMember.user_id == user_id)
        ).all()
    grouped: dict[uuid.UUID, set[str]] = {}
    for project_id, code in rows:
        grouped.setdefault(project_id, set()).add(code)
    return {key: frozenset(value) for key, value in grouped.items()}


def summarize_access(session: Session, user: User) -> AccessSummary:
    """Admin holds every area; others get the union over their
    projects. ``has_template_access`` also covers the template admin
    system role.
    """
    if user.is_admin:
        return AccessSummary(True, True, True)
    codes: set[str] = set()
    for project_codes in permission_codes_by_project(
        session, user_id=user.id
    ).values():
        codes |= project_codes
    with session.no_autoflush:
        is_template_admin = (
            session.scalar(
                select(SystemRoleAssignment.id).where(
                    SystemRoleAssignment.user_id == user.id,
                    SystemRoleAssignment.role_code
                    == SystemRoleCode.TEMPLATE_ADMIN.value,
                )
            )
            is not None
        )
    return AccessSummary(
        has_office_access=bool(codes & OFFICE_PERMISSION_CODES),
        has_field_access=bool(codes & FIELD_PERMISSION_CODES),
        has_template_access=is_template_admin
        or TEMPLATE_READ_PERMISSION_CODE in codes,
    )
