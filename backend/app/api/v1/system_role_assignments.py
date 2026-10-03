"""Admin endpoints for fixed system role assignments (TPL-R09)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.models import SystemRoleCode, User
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
