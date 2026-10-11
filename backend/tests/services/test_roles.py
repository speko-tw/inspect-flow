"""Tests for ``app/services/roles.py`` (domain-model plan.md T7,
issue #135).

AC labels follow ``docs/specs/domain-model/spec.md``'s numbering;
DOM-AC14/DOM-AC16's schema-level assertions (the ``Role`` table
itself, the ``IntegrityError`` on a duplicate code) already live in
``tests/db/test_role_member.py`` (T3) -- this file only covers the
Service-layer entry points DOM-AC14/DOM-AC16 exercise through
``update_role``/``delete_role``.

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``; ``registered_permission_codes`` comes from
``backend/tests/conftest.py``.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.db import clock
from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
)
from app.services.module_permissions import (
    ExternalRoleInUseError,
    InvalidExternalRoleError,
)
from app.services.roles import (
    RoleUnchangedError,
    create_role,
    delete_role,
    update_role,
)
from tests.db.conftest import create_root_user_with_company
from tests.services.conftest import snapshot_persisted_columns


def _new_project(creator, code: str) -> Project:
    return Project(
        project_code=code,
        name="示範廠機電工程",
        client_name="示範業主",
        site_location="示範工地",
        created_by=creator.id,
        updated_by=creator.id,
    )


def _new_member(
    creator, project: Project, user, *roles: Role
) -> ProjectMember:
    member = ProjectMember(
        project_id=project.id,
        user_id=user.id,
        created_by=creator.id,
        updated_by=creator.id,
    )
    member.role_assignments.extend(
        ProjectMemberRole(role=role) for role in roles
    )
    return member


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


class TestCreateRoleWritesAuditEvent:
    """:func:`create_role` (DOM-R19, DOM-R22): every new ``Role``
    writes exactly one ``role.created`` event, whether or not it
    starts with any permission code.
    """

    def test_create_role_with_codes(
        self, session, operator, registered_permission_codes
    ):
        role = create_role(
            session,
            name="R1-Create",
            permission_codes={"report.read", "report.approve"},
        )
        session.commit()

        assert {p.code for p in role.permission_codes} == {
            "report.read",
            "report.approve",
        }
        rows = _audit_rows_for(session, role.id)
        assert len(rows) == 1
        assert rows[0].event_type == "role.created"
        assert rows[0].project_id is None
        assert rows[0].entity_type == "role"
        assert rows[0].before is None
        assert rows[0].after == {
            "name": "R1-Create",
            "permission_codes": ["report.approve", "report.read"],
        }
        assert rows[0].created_by == operator.id

    def test_create_role_without_codes(self, session, operator):
        role = create_role(session, name="R2-Create")
        session.commit()

        assert list(role.permission_codes) == []
        rows = _audit_rows_for(session, role.id)
        assert len(rows) == 1
        assert rows[0].after == {"name": "R2-Create", "permission_codes": []}


class TestDomAc14RenameAndAddPermissionCode:
    """DOM-AC14 (Service-layer portion): rename a ``Role`` and add a
    permission code in the same call, at least a second after
    creation. ``updated_at`` moves forward, ``updated_by`` is the
    current operator, and the ``role.updated`` event records only
    the two fields that changed.
    """

    def test_rename_and_add_code(
        self, session, operator, registered_permission_codes
    ):
        t0 = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: t0)
        try:
            role = create_role(
                session, name="Old Name", permission_codes={"report.read"}
            )
            session.commit()
            created_at = role.created_at

            t1 = t0 + timedelta(seconds=1)
            clock.set_clock(lambda: t1)
            update_role(
                session,
                role,
                name="New Name",
                permission_codes={"report.read", "report.approve"},
            )
            session.commit()
        finally:
            clock.reset_clock()

        assert role.name == "New Name"
        assert {p.code for p in role.permission_codes} == {
            "report.read",
            "report.approve",
        }
        assert role.created_at == created_at
        assert role.updated_at == t1
        assert role.updated_at > created_at
        assert role.updated_by == operator.id

        rows = _audit_rows_for(session, role.id)
        assert len(rows) == 2
        updated = rows[1]
        assert updated.event_type == "role.updated"
        assert updated.project_id is None
        assert updated.before == {
            "name": "Old Name",
            "permission_codes": ["report.read"],
        }
        assert updated.after == {
            "name": "New Name",
            "permission_codes": ["report.approve", "report.read"],
        }

    def test_only_changed_field_is_recorded(
        self, session, operator, registered_permission_codes
    ):
        role = create_role(
            session, name="Only Rename", permission_codes={"report.read"}
        )
        session.commit()

        update_role(session, role, name="Renamed Only")
        session.commit()

        rows = _audit_rows_for(session, role.id)
        updated = rows[-1]
        assert updated.before == {"name": "Only Rename"}
        assert updated.after == {"name": "Renamed Only"}
        # permission_codes did not change, so it is absent from both
        # sides -- not merely unchanged.
        assert isinstance(updated.before, dict)
        assert isinstance(updated.after, dict)
        assert "permission_codes" not in updated.before
        assert "permission_codes" not in updated.after


class TestUpdateRoleUnchangedRejected:
    """:func:`update_role` raises :class:`RoleUnchangedError` -- and
    writes nothing -- when neither argument would actually change
    ``role``.
    """

    def test_no_arguments_raises(self, session, operator):
        role = create_role(session, name="Untouched")
        session.commit()
        rows_before = _audit_rows_for(session, role.id)

        try:
            update_role(session, role)
        except RoleUnchangedError:
            pass
        else:
            raise AssertionError("expected RoleUnchangedError")

        assert role.name == "Untouched"
        assert _audit_rows_for(session, role.id) == rows_before

    def test_same_values_raise(
        self, session, operator, registered_permission_codes
    ):
        role = create_role(
            session, name="Same Values", permission_codes={"report.read"}
        )
        session.commit()
        rows_before = _audit_rows_for(session, role.id)

        try:
            update_role(
                session,
                role,
                name="Same Values",
                permission_codes={"report.read"},
            )
        except RoleUnchangedError:
            pass
        else:
            raise AssertionError("expected RoleUnchangedError")

        assert _audit_rows_for(session, role.id) == rows_before


class TestUpdateRoleInvalidCodeLeavesNameUnchanged:
    """:func:`update_role` validates every new permission code (DOM-
    R30/DOM-R35) *before* touching ``role`` at all: a rename combined
    with an unregistered code must reject the whole call and leave
    ``role`` -- including ``name`` -- completely untouched, with no
    ``role.updated`` event, rather than leaving the rename sitting in
    memory for a later, unrelated flush/commit in the same
    transaction to write with no audit trail behind it.
    """

    def test_rename_and_unregistered_code_rejected(
        self, session, operator, registered_permission_codes
    ):
        role = create_role(
            session, name="Old Name", permission_codes={"report.read"}
        )
        session.commit()
        before = snapshot_persisted_columns(role)
        before_codes = {p.code for p in role.permission_codes}
        rows_before = _audit_rows_for(session, role.id)

        try:
            update_role(
                session,
                role,
                name="New Name",
                permission_codes={"report.read", "not.registered"},
            )
        except ValueError:
            pass
        else:
            raise AssertionError("expected ValueError")

        # In-session state first: expire_all() would discard any
        # unflushed change and hide it from the assertion.
        assert snapshot_persisted_columns(role) == before
        assert {p.code for p in role.permission_codes} == before_codes
        session.commit()
        session.expire_all()
        after = snapshot_persisted_columns(role)
        assert after == before
        assert after["name"] == "Old Name"
        assert {p.code for p in role.permission_codes} == before_codes
        assert _audit_rows_for(session, role.id) == rows_before


class TestDomAc16DeleteRole:
    """DOM-AC16 (Service-layer portion): two ``ProjectMember`` rows
    hold R1, one of them also holds R2; deleting R1 through
    :func:`delete_role` removes only R1's assignments, leaves both
    members and R2 intact, and writes exactly one ``role.deleted``
    event naming every member that held R1 -- no separate
    ``project_member.roles_changed`` events.
    """

    def test_delete_role_removes_assignments_only(
        self, session, operator, registered_permission_codes
    ):
        role_1 = create_role(
            session, name="R1-AC16", permission_codes={"report.read"}
        )
        role_2 = create_role(
            session, name="R2-AC16", permission_codes={"report.approve"}
        )
        project = _new_project(operator, "P-AC16")
        user_a = create_root_user_with_company(session, "UA-AC16")
        user_b = create_root_user_with_company(session, "UB-AC16")
        session.add(project)
        session.flush()
        member_1 = _new_member(operator, project, user_a, role_1, role_2)
        member_2 = _new_member(operator, project, user_b, role_1)
        session.add_all([member_1, member_2])
        session.commit()

        role_1_id = role_1.id
        delete_role(session, role_1)
        session.commit()

        assert session.get(Role, role_1_id) is None
        assert session.get(ProjectMember, member_1.id) is not None
        assert session.get(ProjectMember, member_2.id) is not None
        session.refresh(member_1)
        session.refresh(member_2)
        assert {a.role_id for a in member_1.role_assignments} == {role_2.id}
        assert {a.role_id for a in member_2.role_assignments} == set()
        remaining_assignments = session.scalar(
            select(func.count())
            .select_from(ProjectMemberRole)
            .where(ProjectMemberRole.role_id == role_1_id)
        )
        assert remaining_assignments == 0

        rows = _audit_rows_for(session, role_1_id)
        assert len(rows) == 2  # role.created, role.deleted
        deleted = rows[-1]
        assert deleted.event_type == "role.deleted"
        assert deleted.project_id is None
        assert deleted.after is None
        assert _field(deleted.before, "name") == "R1-AC16"
        assert _field(deleted.before, "permission_codes") == ["report.read"]
        assert set(_field(deleted.before, "project_member_ids")) == {
            str(member_1.id),
            str(member_2.id),
        }

        # No project_member.roles_changed events were written as a
        # side effect of the deletion.
        member_events = session.scalars(
            select(AuditLog).where(AuditLog.entity_type == "project_member")
        ).all()
        assert member_events == []


def test_external_role_cannot_be_restricted_while_held(
    session, operator, registered_permission_codes
):
    role = create_role(
        session,
        name="External Manager",
        permission_codes={"project_member.manage"},
    )
    role.is_external_allowed = True
    user = create_root_user_with_company(session, "EXT-HOLDER")
    user.is_external_collaborator = True
    user.is_active = False
    project = _new_project(operator, "P-EXT-HOLDER")
    session.add(project)
    session.flush()
    session.add(_new_member(operator, project, user, role))
    session.commit()

    with pytest.raises(ExternalRoleInUseError) as error:
        update_role(session, role, is_external_allowed=False)

    assert error.value.details
    assert str(user.id) in error.value.details[0]
    session.refresh(role)
    assert role.is_external_allowed is True


def test_role_with_internal_code_cannot_be_marked_external(
    session, operator, registered_permission_codes
):
    role = create_role(
        session,
        name="內部管理角色",
        permission_codes={"project_member.manage"},
    )
    before_codes = {item.code for item in role.permission_codes}

    with pytest.raises(InvalidExternalRoleError):
        update_role(session, role, is_external_allowed=True)

    session.refresh(role)
    assert role.is_external_allowed is False
    assert {item.code for item in role.permission_codes} == before_codes


def test_held_external_role_cannot_gain_internal_permission(session, operator):
    role = create_role(
        session,
        name="外部查閱角色",
        permission_codes={"project.read"},
    )
    role.is_external_allowed = True
    user = create_root_user_with_company(session, "EXT-ROLE-EDIT")
    user.is_external_collaborator = True
    project = _new_project(operator, "P-EXT-ROLE-EDIT")
    session.add(project)
    session.flush()
    session.add(_new_member(operator, project, user, role))
    session.commit()

    with pytest.raises(ExternalRoleInUseError) as error:
        update_role(
            session,
            role,
            permission_codes={"project.read", "inspection_task.inspect"},
        )

    assert error.value.details is not None
    assert str(user.id) in error.value.details[0]
    session.refresh(role)
    assert role.is_external_allowed is True
    assert {item.code for item in role.permission_codes} == {"project.read"}
