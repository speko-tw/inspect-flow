"""DOM-AC62、DOM-AC72：帳號到期與重新啟用生命週期。"""

from datetime import date

from sqlalchemy import select

from app.models import (
    AuditLog,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services.companies import create_company
from app.services.user_lifecycle import (
    expire_external_account_if_due,
    reactivate_user,
    reactivation_preview,
)
from app.services.users import create_user, set_is_active


def test_external_expiry_is_end_of_day_and_idempotent(session, operator):
    company = create_company(session, name="Lifecycle Test")
    user = create_user(
        session,
        username="lifecycle.external",
        name_zh="外部協作者",
        email="lifecycle.external@example.test",
        company_id=company.id,
        is_external_collaborator=True,
        account_expires_on=date(2026, 10, 17),
    )
    session.commit()

    assert not expire_external_account_if_due(
        session, user.id, today=date(2026, 10, 17)
    )
    assert expire_external_account_if_due(
        session, user.id, today=date(2026, 10, 18)
    )
    session.commit()
    assert not expire_external_account_if_due(
        session, user.id, today=date(2026, 10, 19)
    )

    session.expire_all()
    assert session.get(User, user.id).is_active is False
    events = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == user.id,
                AuditLog.event_type == "user.active_changed",
            )
        )
    )
    assert len(events) == 1
    assert events[0].after["reason"] == "account_expired"
    assert events[0].actor_snapshot == operator.username


def test_reactivation_preview_is_read_only_and_choices_are_applied(
    session, operator
):
    company = create_company(session, name="Restore Test")
    user = create_user(
        session,
        username="restore.user",
        name_zh="恢復人員",
        email="restore.user@example.test",
        company_id=company.id,
        is_external_collaborator=False,
    )
    session.add_all(
        [
            UserModulePermission(
                user_id=user.id,
                permission_code="project.use",
                source="manual",
            ),
            UserModuleDelegation(user_id=user.id, module="inspection"),
        ]
    )
    session.commit()

    set_is_active(session, user, False)
    session.commit()
    event_query = select(AuditLog).where(AuditLog.entity_id == user.id)
    prior_events = len(list(session.scalars(event_query)))
    preview = reactivation_preview(session, user)
    assert preview["permission_codes"] == ["project.use"]
    assert preview["delegated_modules"] == ["inspection"]
    assert len(list(session.scalars(event_query))) == prior_events
    assert (
        session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == user.id
            )
        )
        is not None
    )

    reactivate_user(
        session,
        user_id=user.id,
        permission_codes=["project.use"],
        delegated_modules=[],
        project_ids=[],
        task_ids=[],
    )
    session.commit()
    assert session.get(User, user.id).is_active is True
    assert (
        session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == user.id
            )
        )
        is not None
    )
    assert (
        session.scalar(
            select(UserModuleDelegation.id).where(
                UserModuleDelegation.user_id == user.id
            )
        )
        is None
    )
