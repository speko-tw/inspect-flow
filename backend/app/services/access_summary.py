"""Office/field access summary for the current user (Issue #480).

The login landing page and the admin navigation need to know which
areas of the UI a user can actually use. The frontend must not guess
that from ``is_admin`` alone, so ``/auth/me`` carries this summary.

Every registered project permission code is classified into exactly
one group below; module permissions are reported separately and are
used to gate the owning module's access.

- Field: ``inspection_task.inspect`` only -- the code the ``/field``
  task list requires.
- Read-only project permissions (all project-scoped ``*.read`` codes)
  are neither office nor field access. In particular,
  ``inspection_task.read`` alone is insufficient to open the field task
  list, which requires ``inspection_task.inspect`` (ADM-R18).
- Office: project permissions that grant an action beyond reading.

The summary is computed with one query per call (no per-project loop).
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SystemRoleAssignment, SystemRoleCode, User
from app.permission_codes import (
    PermissionCode,
    permission_code_module,
    permission_code_scope,
)
from app.services.permissions import calculate_effective_access

FIELD_PERMISSION_CODES: frozenset[str] = frozenset({"inspection_task.inspect"})
OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    {
        "project_member.manage",
        "project.update",
        "project_inspection_item.edit",
        "project_zone.manage",
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
READ_ONLY_PERMISSION_CODES: frozenset[str] = frozenset(
    code.value
    for code in PermissionCode
    if permission_code_scope(code.value) == "project"
    and code.value.endswith(".read")
)
PROJECT_OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    code
    for code in OFFICE_PERMISSION_CODES
    if permission_code_module(code) == "project"
)
INSPECTION_OFFICE_PERMISSION_CODES: frozenset[str] = frozenset(
    code
    for code in OFFICE_PERMISSION_CODES
    if permission_code_module(code) == "inspection"
)


@dataclass(frozen=True)
class AccessSummary:
    has_office_access: bool
    has_field_access: bool
    has_template_access: bool
    module_permissions: frozenset[str]


def permission_codes_by_project(
    session: Session, *, user_id: uuid.UUID
) -> dict[uuid.UUID, frozenset[str]]:
    """Effective permission codes of ``user_id`` in every project the
    user is a member of, from a single query.
    """
    return calculate_effective_access(
        session, user_id=user_id
    ).project_permissions_by_project


def summarize_access(session: Session, user: User) -> AccessSummary:
    """Admin holds every area; others get the union over their
    projects. ``has_template_access`` is the template library
    management area (``/admin/templates``): Admin or the template admin
    system role, the same rule the template write routes use. Reading
    templates to apply them to a project needs no summary flag; it
    lives inside the project pages.
    """
    access = calculate_effective_access(session, user_id=user.id)
    if access.is_admin:
        return AccessSummary(True, True, True, access.module_permissions)
    codes: set[str] = set(access.module_permissions)
    for project_codes in access.project_permissions_by_project.values():
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
    project_access = "project.use" in access.module_permissions and bool(
        codes & PROJECT_OFFICE_PERMISSION_CODES
    )
    return AccessSummary(
        has_office_access=project_access
        or bool(
            "inspection.use" in access.module_permissions
            and codes & INSPECTION_OFFICE_PERMISSION_CODES
        ),
        has_field_access=(
            "inspection.use" in access.module_permissions
            and bool(codes & FIELD_PERMISSION_CODES)
        ),
        has_template_access=(
            "template.manage" in access.module_permissions or is_template_admin
        ),
        module_permissions=access.module_permissions,
    )
