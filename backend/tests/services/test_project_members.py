"""Tests for ``app/services/project_members.py`` (domain-model
plan.md T7, issue #135).

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``.
"""

from typing import Any

from sqlalchemy import select

from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
)
from app.services.project_members import (
    RoleAlreadyAssignedError,
    RoleNotAssignedError,
    add_project_member,
    assign_role,
    remove_project_member,
    unassign_role,
)
from tests.db.conftest import create_root_user_with_company


def _new_project(creator, code: str) -> Project:
    return Project(
        project_code=code, created_by=creator.id, updated_by=creator.id
    )


def _new_role(creator, name: str) -> Role:
    return Role(name=name, created_by=creator.id, updated_by=creator.id)


def _audit_rows_for(session, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == entity_id)
            .order_by(AuditLog.created_at)
        ).all()
    )


def _field(payload: object, key: str) -> Any:
    """Read one field out of an ``AuditLog.before``/``after`` value
    (typed ``dict | list | None`` at the model level) -- every
    payload this module writes is a ``dict``, so this both narrows
    that for type-checking and gives a clear failure if it were not.
    """
    assert isinstance(payload, dict)
    return payload[key]


class TestAddProjectMemberWithoutRoles:
    """DOM-R36 / DOM-R22 scope: adding a member with no role at all
    is allowed and writes no audit event.
    """

    def test_no_roles_no_audit_event(self, session, operator):
        project = _new_project(operator, "P-NOROLE")
        user = create_root_user_with_company(session, "U-NOROLE")
        session.add(project)
        session.flush()

        member = add_project_member(
            session, project_id=project.id, user_id=user.id
        )
        session.commit()

        assert list(member.role_assignments) == []
        assert _audit_rows_for(session, member.id) == []


class TestAddProjectMemberWithRoles:
    """Adding a member together with an initial set of roles writes
    one ``project_member.roles_changed`` event whose ``before.
    role_ids`` is empty.
    """

    def test_initial_roles_write_roles_changed(self, session, operator):
        project = _new_project(operator, "P-INIT")
        user = create_root_user_with_company(session, "U-INIT")
        role_1 = _new_role(operator, "R1-INIT")
        role_2 = _new_role(operator, "R2-INIT")
        session.add_all([project, role_1, role_2])
        session.flush()

        member = add_project_member(
            session,
            project_id=project.id,
            user_id=user.id,
            role_ids=[role_1.id, role_2.id],
        )
        session.commit()

        assert {a.role_id for a in member.role_assignments} == {
            role_1.id,
            role_2.id,
        }
        rows = _audit_rows_for(session, member.id)
        assert len(rows) == 1
        assert rows[0].event_type == "project_member.roles_changed"
        assert rows[0].entity_type == "project_member"
        assert rows[0].before == {
            "role_ids": [],
            "project_id": str(project.id),
            "user_id": str(user.id),
        }
        assert sorted(_field(rows[0].after, "role_ids")) == sorted(
            [str(role_1.id), str(role_2.id)]
        )
        assert _field(rows[0].after, "project_id") == str(project.id)
        assert _field(rows[0].after, "user_id") == str(user.id)


class TestAssignRole:
    def test_assign_writes_roles_changed(self, session, operator):
        project = _new_project(operator, "P-ASSIGN")
        user = create_root_user_with_company(session, "U-ASSIGN")
        role_1 = _new_role(operator, "R1-ASSIGN")
        role_2 = _new_role(operator, "R2-ASSIGN")
        session.add_all([project, role_1, role_2])
        session.flush()
        member = add_project_member(
            session,
            project_id=project.id,
            user_id=user.id,
            role_ids=[role_1.id],
        )
        session.commit()

        assign_role(session, member, role_2.id)
        session.commit()

        assert {a.role_id for a in member.role_assignments} == {
            role_1.id,
            role_2.id,
        }
        rows = _audit_rows_for(session, member.id)
        assert len(rows) == 2
        latest = rows[-1]
        assert _field(latest.before, "role_ids") == [str(role_1.id)]
        assert sorted(_field(latest.after, "role_ids")) == sorted(
            [str(role_1.id), str(role_2.id)]
        )

    def test_assign_already_assigned_rejected(self, session, operator):
        project = _new_project(operator, "P-ASSIGN2")
        user = create_root_user_with_company(session, "U-ASSIGN2")
        role_1 = _new_role(operator, "R1-ASSIGN2")
        session.add_all([project, role_1])
        session.flush()
        member = add_project_member(
            session,
            project_id=project.id,
            user_id=user.id,
            role_ids=[role_1.id],
        )
        session.commit()
        rows_before = _audit_rows_for(session, member.id)

        try:
            assign_role(session, member, role_1.id)
        except RoleAlreadyAssignedError:
            pass
        else:
            raise AssertionError("expected RoleAlreadyAssignedError")

        assert {a.role_id for a in member.role_assignments} == {role_1.id}
        assert _audit_rows_for(session, member.id) == rows_before


class TestUnassignRole:
    def test_unassign_writes_roles_changed(self, session, operator):
        project = _new_project(operator, "P-UNASSIGN")
        user = create_root_user_with_company(session, "U-UNASSIGN")
        role_1 = _new_role(operator, "R1-UNASSIGN")
        role_2 = _new_role(operator, "R2-UNASSIGN")
        session.add_all([project, role_1, role_2])
        session.flush()
        member = add_project_member(
            session,
            project_id=project.id,
            user_id=user.id,
            role_ids=[role_1.id, role_2.id],
        )
        session.commit()

        unassign_role(session, member, role_1.id)
        session.commit()

        assert {a.role_id for a in member.role_assignments} == {role_2.id}
        rows = _audit_rows_for(session, member.id)
        latest = rows[-1]
        assert sorted(_field(latest.before, "role_ids")) == sorted(
            [str(role_1.id), str(role_2.id)]
        )
        assert _field(latest.after, "role_ids") == [str(role_2.id)]

    def test_unassign_not_assigned_rejected(self, session, operator):
        project = _new_project(operator, "P-UNASSIGN2")
        user = create_root_user_with_company(session, "U-UNASSIGN2")
        role_1 = _new_role(operator, "R1-UNASSIGN2")
        session.add_all([project, role_1])
        session.flush()
        member = add_project_member(
            session, project_id=project.id, user_id=user.id
        )
        session.commit()
        rows_before = _audit_rows_for(session, member.id)

        try:
            unassign_role(session, member, role_1.id)
        except RoleNotAssignedError:
            pass
        else:
            raise AssertionError("expected RoleNotAssignedError")

        assert list(member.role_assignments) == []
        assert _audit_rows_for(session, member.id) == rows_before


class TestRemoveProjectMember:
    """DOM-R36: removing a member deletes the row (and, by the
    database's own cascade, its role assignments), writing exactly
    one ``project_member.removed`` event -- even when the member
    held no role at all.
    """

    def test_remove_member_with_roles(self, session, operator):
        project = _new_project(operator, "P-REMOVE")
        user = create_root_user_with_company(session, "U-REMOVE")
        role_1 = _new_role(operator, "R1-REMOVE")
        session.add_all([project, role_1])
        session.flush()
        member = add_project_member(
            session,
            project_id=project.id,
            user_id=user.id,
            role_ids=[role_1.id],
        )
        session.commit()
        member_id = member.id

        remove_project_member(session, member)
        session.commit()

        assert session.get(ProjectMember, member_id) is None
        remaining = session.scalars(
            select(ProjectMemberRole).where(
                ProjectMemberRole.project_member_id == member_id
            )
        ).all()
        assert remaining == []

        rows = _audit_rows_for(session, member_id)
        assert len(rows) == 2  # roles_changed (initial), removed
        removed = rows[-1]
        assert removed.event_type == "project_member.removed"
        assert removed.after is None
        assert removed.before == {
            "project_id": str(project.id),
            "user_id": str(user.id),
            "role_ids": [str(role_1.id)],
        }

    def test_remove_member_without_roles_still_writes_event(
        self, session, operator
    ):
        project = _new_project(operator, "P-REMOVE2")
        user = create_root_user_with_company(session, "U-REMOVE2")
        session.add(project)
        session.flush()
        member = add_project_member(
            session, project_id=project.id, user_id=user.id
        )
        session.commit()
        member_id = member.id

        remove_project_member(session, member)
        session.commit()

        rows = _audit_rows_for(session, member_id)
        assert len(rows) == 1
        assert rows[0].event_type == "project_member.removed"
        assert _field(rows[0].before, "role_ids") == []
