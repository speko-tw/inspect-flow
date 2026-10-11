"""System-wide role assignment operations (template-system T1)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import SystemRoleAssignment, SystemRoleCode, User
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class SystemRoleAlreadyAssignedError(ValueError):
    """Raised when the user already has the requested system role."""


class SystemRoleNotAssignedError(LookupError):
    """Raised when the requested system role assignment does not exist."""


class ExternalUserSystemRoleError(ValueError):
    """外部協作人員不得取得 template_admin 系統角色。"""

    def __init__(self) -> None:
        self.details = ["system role: template_admin"]
        super().__init__("External collaborators cannot hold template_admin")


def assign_system_role(
    session: Session, user_id: uuid.UUID, role_code: SystemRoleCode
) -> SystemRoleAssignment:
    """Assign one fixed system role and write its audit event."""
    # 呼叫端的 user 可能在取鎖前就已載入，需用 populate_existing 重讀
    # 最新旗標，才不會以過期的外部協作者狀態判斷。改用 FOR NO KEY
    # UPDATE，與外鍵檢查的 KEY SHARE 不互鎖，避免死結；兩個寫入口之間
    # 仍互斥。
    user = session.scalar(
        select(User)
        .where(User.id == user_id)
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if (
        role_code is SystemRoleCode.TEMPLATE_ADMIN
        and user is not None
        and user.is_external_collaborator
    ):
        # 身分規則禁止外部協作者持有系統層級的範本管理權。
        raise ExternalUserSystemRoleError()
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
