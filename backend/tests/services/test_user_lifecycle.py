"""DOM-AC62、DOM-AC72：帳號到期與重新啟用生命週期。"""

from datetime import date

from sqlalchemy import event, select

from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services.companies import create_company
from app.services.user_lifecycle import (
    expire_external_account_if_due,
    reactivate_user,
    reactivation_preview,
    unmanaged_project_ids,
)
from app.services.users import create_user, set_is_active
from tests.db.conftest import create_root_user_with_company


def test_unmanaged_project_query_count_does_not_grow_with_projects(
    session, operator
):
    """DOM-R75: determine unmanaged projects with one aggregate query."""

    def add_project(code: str) -> Project:
        project = Project(
            project_code=code,
            name=code,
            client_name="業主",
            site_location="工地",
            created_by=operator.id,
            updated_by=operator.id,
        )
        session.add(project)
        return project

    baseline = [add_project(f"UNM712-{index}") for index in range(2)]
    session.commit()

    def read_with_select_count():
        statements: list[str] = []

        def before_cursor_execute(
            _connection, _cursor, statement, _parameters, _context, _many
        ):
            if statement.lstrip().upper().startswith("SELECT"):
                statements.append(statement)

        engine = session.get_bind()
        event.listen(engine, "before_cursor_execute", before_cursor_execute)
        try:
            result = unmanaged_project_ids(session)
        finally:
            event.remove(
                engine, "before_cursor_execute", before_cursor_execute
            )
        return result, len(statements)

    baseline_ids = {project.id for project in baseline}
    small_result, small_query_count = read_with_select_count()
    assert small_result == baseline_ids
    assert small_query_count > 0

    added = [add_project(f"UNM712-{index}") for index in range(2, 10)]
    manager = create_root_user_with_company(session, "UNM712MGR")
    manager_role = Role(
        name="UNM712 專案管理者",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="project_member.manage")],
    )
    managed = add_project("UNM712-MANAGED")
    session.add_all(
        [
            manager_role,
            UserModulePermission(
                user_id=manager.id,
                permission_code="project.use",
                source="manual",
            ),
        ]
    )
    session.flush()
    member = ProjectMember(
        project_id=managed.id,
        user_id=manager.id,
        created_by=operator.id,
        updated_by=operator.id,
        role_assignments=[ProjectMemberRole(role_id=manager_role.id)],
    )
    session.add(member)
    session.commit()

    large_result, large_query_count = read_with_select_count()
    expected_unmanaged = baseline_ids | {project.id for project in added}
    assert large_result == expected_unmanaged
    assert large_query_count == small_query_count, (
        f"SELECT count grew from {small_query_count} to "
        f"{large_query_count} for {len(expected_unmanaged)} projects"
    )


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
