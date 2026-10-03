"""System-wide role assignment operations (template-system T1)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SystemRoleAssignment, SystemRoleCode
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class SystemRoleAlreadyAssignedError(ValueError):
    """Raised when the user already has the requested system role."""


class SystemRoleNotAssignedError(LookupError):
    """Raised when the requested system role assignment does not exist."""


def assign_system_role(
    session: Session, user_id: uuid.UUID, role_code: SystemRoleCode
) -> SystemRoleAssignment:
    """Assign one fixed system role and write its audit event."""
    existing = session.scalar(
        select(SystemRoleAssignment).where(
            SystemRoleAssignment.user_id == user_id,
            SystemRoleAssignment.role_code == role_code.value,
        )
    )
    if existing is not None:
        raise SystemRoleAlreadyAssignedError(
            f"user {user_id} already has {role_code.value}"
        )
    operator = get_current_operator(session)
    assignment = SystemRoleAssignment(
        user_id=user_id,
        role_code=role_code.value,
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(assignment)
    session.flush()
    record_audit_event(
        session,
        "system_role_assignment.created",
        entity_id=assignment.id,
        before=None,
        after={"user_id": user_id, "role_code": role_code.value},
    )
    return assignment


def revoke_system_role(
    session: Session, user_id: uuid.UUID, role_code: SystemRoleCode
) -> SystemRoleAssignment:
    """Revoke one fixed system role and write its audit event."""
    assignment = session.scalar(
        select(SystemRoleAssignment).where(
            SystemRoleAssignment.user_id == user_id,
            SystemRoleAssignment.role_code == role_code.value,
        )
    )
    if assignment is None:
        raise SystemRoleNotAssignedError(
            f"user {user_id} does not have {role_code.value}"
        )
    event_data = {"user_id": user_id, "role_code": role_code.value}
    session.delete(assignment)
    session.flush()
    record_audit_event(
        session,
        "system_role_assignment.deleted",
        entity_id=assignment.id,
        before=event_data,
        after=None,
    )
    return assignment
