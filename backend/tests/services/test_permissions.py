"""Tests for ``app/services/permissions.py`` (domain-model plan.md
T5, issue #133).

AC labels follow ``docs/specs/domain-model/spec.md``'s final
numbering:

- DOM-AC15: :func:`effective_permissions` (DOM-R26) -- the union of
  a member's role codes, recomputed live from ``Role`` rather than
  copied onto ``ProjectMember``.
- DOM-AC17: :func:`role_impact_scope` (DOM-R23) -- how many
  ``ProjectMember`` rows and distinct ``User``s hold a ``Role``.
- DOM-AC26: :func:`has_modify_capability` (DOM-R24) -- whether any
  of a ``Role``'s codes is not a ``read`` action.

An extra ``TestReadOnly`` class checks all three functions never
add, flush or delete anything, per this task's ticket.

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``; ``registered_permission_codes`` comes from
``backend/tests/conftest.py``.
"""

from sqlalchemy import event, inspect

from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from app.services.permissions import (
    RoleImpactScope,
    effective_permissions,
    has_modify_capability,
    role_impact_scope,
)
from tests.db.conftest import create_root_user_with_company


def _new_project(code: str, creator: User) -> Project:
    return Project(
        project_code=code, created_by=creator.id, updated_by=creator.id
    )


def _new_role(creator: User, name: str, *codes: str) -> Role:
    role = Role(name=name, created_by=creator.id, updated_by=creator.id)
    role.permission_codes.extend(RolePermission(code=code) for code in codes)
    return role


def _new_member(
    creator: User, project: Project, user: User, *roles: Role
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


class TestDomAc15EffectivePermissions:
    """DOM-AC15 (DOM-R26): U holds R1 (``report.read``) and R2
    (``report.approve``, ``report.read``) on project P; U is not a
    member of Q; V is a member of P with no role at all. P's result
    is the union of R1/R2's codes; Q and V are both empty. Changing
    R1's own codes (via the ORM, flushed but not through this
    service) is reflected in P's next calculation without touching
    ``ProjectMember``/``ProjectMemberRole``.
    """

    def test_dom_ac15_union_across_roles_and_empty_for_non_member(
        self, session, operator, registered_permission_codes
    ):
        project_p = _new_project("P-AC15", operator)
        project_q = _new_project("Q-AC15", operator)
        user_u = create_root_user_with_company(session, "U-AC15")
        user_v = create_root_user_with_company(session, "V-AC15")
        session.add_all([project_p, project_q, user_u, user_v])
        session.flush()

        role_1 = _new_role(operator, "R1-AC15", "report.read")
        role_2 = _new_role(
            operator, "R2-AC15", "report.approve", "report.read"
        )
        session.add_all([role_1, role_2])
        session.flush()

        member_u_p = _new_member(operator, project_p, user_u, role_1, role_2)
        member_v_p = _new_member(operator, project_p, user_v)
        session.add_all([member_u_p, member_v_p])
        session.flush()

        assert effective_permissions(
            session, user_id=user_u.id, project_id=project_p.id
        ) == frozenset({"report.read", "report.approve"})
        assert (
            effective_permissions(
                session, user_id=user_u.id, project_id=project_q.id
            )
            == frozenset()
        )
        assert (
            effective_permissions(
                session, user_id=user_v.id, project_id=project_p.id
            )
            == frozenset()
        )

        # DOM-R26: change R1's own content (not ProjectMember) and
        # recompute -- the new code shows up immediately.
        role_1.permission_codes.clear()
        role_1.permission_codes.append(RolePermission(code="evidence.read"))
        session.flush()

        assert effective_permissions(
            session, user_id=user_u.id, project_id=project_p.id
        ) == frozenset({"evidence.read", "report.read", "report.approve"})

    def test_dom_ac15_no_permission_code_column_on_membership_tables(
        self, engine
    ):
        for table_name in ("project_members", "project_member_roles"):
            columns = {
                col["name"] for col in inspect(engine).get_columns(table_name)
            }
            assert "code" not in columns
            assert "permission_codes" not in columns


class TestDomAc17RoleImpactScope:
    """DOM-AC17 (DOM-R23): a role held by three ``ProjectMember``
    rows across two ``User``s (one of whom holds it on two
    projects) reports 3 members / 2 users; an unheld role reports
    0 / 0.
    """

    def test_dom_ac17_member_and_user_counts(
        self, session, operator, registered_permission_codes
    ):
        project_1 = _new_project("P1-AC17", operator)
        project_2 = _new_project("P2-AC17", operator)
        user_a = create_root_user_with_company(session, "A-AC17")
        user_b = create_root_user_with_company(session, "B-AC17")
        session.add_all([project_1, project_2, user_a, user_b])
        session.flush()

        held_role = _new_role(operator, "Held-AC17", "report.read")
        unheld_role = _new_role(operator, "Unheld-AC17", "report.read")
        session.add_all([held_role, unheld_role])
        session.flush()

        member_a1 = _new_member(operator, project_1, user_a, held_role)
        member_a2 = _new_member(operator, project_2, user_a, held_role)
        member_b1 = _new_member(operator, project_1, user_b, held_role)
        session.add_all([member_a1, member_a2, member_b1])
        session.flush()

        assert role_impact_scope(
            session, role_id=held_role.id
        ) == RoleImpactScope(member_count=3, user_count=2)
        assert role_impact_scope(
            session, role_id=unheld_role.id
        ) == RoleImpactScope(member_count=0, user_count=0)


class TestDomAc26HasModifyCapability:
    """DOM-AC26 (DOM-R24): a role with no codes, or only
    ``report.read``, has no modify capability; a role with
    ``report.read`` plus ``report.approve``, or only
    ``evidence.delete``, does.
    """

    def test_dom_ac26_no_codes_is_false(self, operator):
        role = _new_role(operator, "NoCodes-AC26")
        assert has_modify_capability(role) is False

    def test_dom_ac26_only_read_is_false(
        self, operator, registered_permission_codes
    ):
        role = _new_role(operator, "OnlyRead-AC26", "report.read")
        assert has_modify_capability(role) is False

    def test_dom_ac26_read_and_approve_is_true(
        self, operator, registered_permission_codes
    ):
        role = _new_role(
            operator, "ReadApprove-AC26", "report.read", "report.approve"
        )
        assert has_modify_capability(role) is True

    def test_dom_ac26_only_delete_is_true(
        self, operator, registered_permission_codes
    ):
        role = _new_role(operator, "OnlyDelete-AC26", "evidence.delete")
        assert has_modify_capability(role) is True


class TestReadOnly:
    """This task's ticket: none of the three functions may add,
    flush, commit or otherwise modify any row.
    """

    def test_calling_all_three_leaves_the_session_unchanged(
        self, session, operator, registered_permission_codes
    ):
        project = _new_project("P-RO", operator)
        user = create_root_user_with_company(session, "U-RO")
        session.add_all([project, user])
        session.flush()

        role = _new_role(operator, "Role-RO", "report.read")
        session.add(role)
        session.flush()

        member = _new_member(operator, project, user, role)
        session.add(member)
        session.commit()

        effective_permissions(session, user_id=user.id, project_id=project.id)
        role_impact_scope(session, role_id=role.id)
        has_modify_capability(role)

        assert not session.new
        assert not session.dirty
        assert not session.deleted


class TestNoAutoflushOnRead:
    """PR #226 review comment 4113944357: a caller may hold a
    pending (unflushed) edit on a ``Role`` -- e.g. it is mid-way
    through renaming one -- when it asks one of these three
    functions a read-only question. None of them may flush that
    pending edit out as a side effect of their own ``SELECT``s: this
    module's docstring says a caller must flush its own pending
    changes itself if it wants them counted, which only holds if a
    read here never does that flushing on the caller's behalf
    (SQLAlchemy's default autoflush otherwise runs a pending
    ``UPDATE`` before every ``SELECT``).

    ``has_modify_capability``'s only path to the database is a lazy
    load of ``role.permission_codes`` if that relationship is not
    already loaded, so ``role`` is expired first to force that lazy
    load rather than let it silently read already-loaded identity
    map state.
    """

    def test_pending_role_edit_is_not_autoflushed(
        self, session, engine, operator, registered_permission_codes
    ):
        project = _new_project("P-NOFLUSH", operator)
        user = create_root_user_with_company(session, "U-NOFLUSH")
        session.add_all([project, user])
        session.flush()

        role = _new_role(operator, "Role-NOFLUSH", "report.read")
        session.add(role)
        session.flush()

        member = _new_member(operator, project, user, role)
        session.add(member)
        session.flush()

        # A pending, unflushed edit -- this is the state under test.
        role.name = "Role-NOFLUSH-renamed"
        # Force has_modify_capability's relationship access below to
        # go through a real lazy load instead of reading already
        # loaded state.
        session.expire(role, ["permission_codes"])

        statements: list[str] = []

        def _record_statement(
            conn, cursor, statement, parameters, context, executemany
        ):
            statements.append(statement)

        event.listen(engine, "before_cursor_execute", _record_statement)
        try:
            effective_permissions(
                session, user_id=user.id, project_id=project.id
            )
            role_impact_scope(session, role_id=role.id)
            has_modify_capability(role)
        finally:
            event.remove(engine, "before_cursor_execute", _record_statement)

        mutating_statements = [
            statement
            for statement in statements
            if statement.strip()
            .upper()
            .startswith(("INSERT", "UPDATE", "DELETE"))
        ]
        assert mutating_statements == []
        assert role in session.dirty
