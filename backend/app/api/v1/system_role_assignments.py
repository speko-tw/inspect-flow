"""Admin endpoints for fixed system role assignments (TPL-R09)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.models import SystemRoleAssignment, SystemRoleCode, User
from app.services.system_roles import (
    SystemRoleAlreadyAssignedError,
    SystemRoleNotAssignedError,
    assign_system_role,
    revoke_system_role,
)

router = APIRouter(
    prefix="/system-role-assignments",
    tags=["system-role-assignments"],
    dependencies=[Depends(require_admin)],
)


def _get_user(db: Session, user_id: UUID) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return user


def _is_duplicate_assignment_error(exc: IntegrityError) -> bool:
    """Recognize only the role assignment's user/role unique constraint."""
    diagnostic = getattr(exc.orig, "diag", None)
    if (
        getattr(diagnostic, "constraint_name", None)
        == "uq_system_role_assignments_user_id"
    ):
        return True
    return (
        "unique constraint failed: system_role_assignments.user_id, "
        "system_role_assignments.role_code"
    ) in str(exc.orig).lower()


@router.put("/template_admin/{user_id}", status_code=204)
def assign_template_admin(
    user_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> Response:
    """Ensure the user has the fixed template_admin role."""
    _get_user(db, user_id)
    try:
        assign_system_role(db, user_id, SystemRoleCode.TEMPLATE_ADMIN)
    except SystemRoleAlreadyAssignedError:
        pass
    except IntegrityError as exc:
        if not _is_duplicate_assignment_error(exc):
            raise
        db.rollback()
        existing = db.scalar(
            select(SystemRoleAssignment.id).where(
                SystemRoleAssignment.user_id == user_id,
                SystemRoleAssignment.role_code
                == SystemRoleCode.TEMPLATE_ADMIN.value,
            )
        )
        if existing is None:
            raise
    return Response(status_code=204)


@router.delete("/template_admin/{user_id}", status_code=204)
def revoke_template_admin(
    user_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> Response:
    """Remove the user's fixed template_admin role."""
    _get_user(db, user_id)
    try:
        revoke_system_role(db, user_id, SystemRoleCode.TEMPLATE_ADMIN)
    except SystemRoleNotAssignedError as exc:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404) from exc
    return Response(status_code=204)
