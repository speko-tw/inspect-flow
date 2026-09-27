"""Tests for the ``Role``/``RolePermission`` and
``ProjectMember``/``ProjectMemberRole`` tables (domain-model plan.md
T3, issue #131).

AC labels below follow ``docs/specs/domain-model/spec.md``'s final
numbering:

- DOM-AC18: ``ProjectMember``/``ProjectMemberRole`` table structure
  and constraints (DOM-R15, DOM-R25).
- DOM-AC21: ``Role``/``RolePermission`` length and format limits
  (DOM-R30).
- DOM-AC24: ``Role.name``'s case-insensitive uniqueness (DOM-R34).
- DOM-AC25: the permission code registry (DOM-R35).
- DOM-AC27: a member's role count has no lower bound, and deleting
  either side of a role assignment cascades at the database level
  (DOM-R25, DOM-R36).

A few extra tests cover DOM-R19 and DOM-R21 directly (deleting a
``Role`` cascades to its own permission codes and to every
``ProjectMemberRole`` assignment pointing at it); neither has its own
AC number, so they are labeled by requirement instead.

Same fixture pattern as ``test_company.py``/``test_user_fields.py``:
migrates the database behind ``conftest.py``'s ``db_url`` fixture
with the real Alembic migration chain, then reads and writes it
exclusively through SQLAlchemy (DBF-R01).
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, delete, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app import permission_codes
from app.api.errors import DescribedStrEnum
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
)
from app.permission_codes import (
    is_permission_code_registered,
    permission_code_descriptions,
)
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_MAX_NAME = "N" * 64
# 31 + 1 (dot) + 32 = 64 characters, matching DOM-R30's format.
_MAX_CODE = "d" * 31 + "." + "a" * 32


class _BoundaryCodeRegistry(DescribedStrEnum):
    """Test-only registry containing exactly the boundary-length
    code ``_MAX_CODE`` DOM-AC21 needs -- separate from
    ``tests/conftest.py``'s ``registered_permission_codes`` fixture,
    whose fixed code set does not include an artificial 64-character
    boundary string.
    """

    MAX_CODE = (_MAX_CODE, "boundary-length test code")


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(_alembic_config(), "head")
    return db_url


@pytest.fixture
def engine(migrated_url) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def creator(session) -> User:
    """A ``User`` to use as ``created_by``/``updated_by`` for
    ``Role``/``ProjectMember`` rows in these tests -- not itself
    under test. Built with ``create_root_user_with_company`` since
    ``User.company_id`` is required (DOM-R01).
    """
    user = create_root_user_with_company(session, "E910")
    session.commit()
    return user


@pytest.fixture
def project(session, creator) -> Project:
    proj = Project(
        project_code="PM-T3",
        created_by=creator.id,
        updated_by=creator.id,
    )
    session.add(proj)
    session.commit()
    return proj


def _new_role(creator: User, **kwargs) -> Role:
    kwargs.setdefault("created_by", creator.id)
    kwargs.setdefault("updated_by", creator.id)
    return Role(**kwargs)


def _new_member(creator: User, project: Project, **kwargs) -> ProjectMember:
    kwargs.setdefault("project_id", project.id)
    kwargs.setdefault("created_by", creator.id)
    kwargs.setdefault("updated_by", creator.id)
    return ProjectMember(**kwargs)


def test_migration_registers_all_four_tables(migrated_url):
    """Guards ``app/models/__init__.py`` actually importing
    ``role``/``project_member`` -- a missing import would leave a
    table off ``Base.metadata`` and this migration would never have
    matched it.
    """
    engine = create_engine_from_settings(migrated_url)
    try:
        table_names = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    assert {
        "roles",
        "role_permissions",
        "project_members",
        "project_member_roles",
    } <= table_names


class TestTableStructure:
    """DOM-AC18/DOM-R15: all four tables have a UUID primary key and
    ``created_at``/``updated_at`` columns; ``roles``/
    ``project_members`` (but not their child tables, see
    ``app/models/role.py``/``app/models/project_member.py``) also
    have the ``created_by``/``updated_by`` audit columns.
    """

    @pytest.mark.parametrize(
        "table_name,has_audit_columns",
        [
            ("roles", True),
            ("role_permissions", False),
            ("project_members", True),
            ("project_member_roles", False),
        ],
    )
    def test_primary_key_and_timestamp_columns(
        self, engine, table_name, has_audit_columns
    ):
        inspector = inspect(engine)
        pk = inspector.get_pk_constraint(table_name)
        assert pk["constrained_columns"] == ["id"]

        columns = {
            col["name"]: col for col in inspector.get_columns(table_name)
        }
        assert {"created_at", "updated_at"} <= columns.keys()
        assert columns["created_at"]["nullable"] is False
        assert columns["updated_at"]["nullable"] is False

        if has_audit_columns:
            assert columns["created_by"]["nullable"] is False
            assert columns["updated_by"]["nullable"] is False
        else:
            assert "created_by" not in columns
            assert "updated_by" not in columns


class TestDomAc18ProjectMemberAndRoleAssignment:
    """DOM-AC18: duplicate membership, duplicate role assignment,
    and a dangling ``project_id``/``user_id`` are all rejected by
    the database with row counts unchanged; two different roles on
    the same member both succeed.
    """

    def test_duplicate_project_user_pair_is_rejected(
        self, session, creator, project
    ):
        session.add(_new_member(creator, project, user_id=creator.id))
        session.commit()

        session.add(_new_member(creator, project, user_id=creator.id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = (
            session.query(ProjectMember)
            .filter_by(project_id=project.id, user_id=creator.id)
            .count()
        )
        assert count == 1

    def test_duplicate_role_assignment_is_rejected(
        self, session, creator, project, registered_permission_codes
    ):
        member = _new_member(creator, project, user_id=creator.id)
        session.add(member)
        role = _new_role(creator, name="Reader")
        role.permission_codes.append(RolePermission(code="report.read"))
        session.add(role)
        session.commit()

        session.add(
            ProjectMemberRole(project_member_id=member.id, role_id=role.id)
        )
        session.commit()

        session.add(
            ProjectMemberRole(project_member_id=member.id, role_id=role.id)
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = (
            session.query(ProjectMemberRole)
            .filter_by(project_member_id=member.id, role_id=role.id)
            .count()
        )
        assert count == 1

    def test_dangling_project_id_is_rejected(self, session, creator, project):
        before = session.query(ProjectMember).count()
        session.add(
            _new_member(
                creator, project, project_id=uuid7(), user_id=creator.id
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(ProjectMember).count() == before

    def test_dangling_user_id_is_rejected(self, session, creator, project):
        before = session.query(ProjectMember).count()
        session.add(_new_member(creator, project, user_id=uuid7()))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(ProjectMember).count() == before

    def test_two_different_roles_on_same_member_succeed(
        self, session, creator, project
    ):
        member = _new_member(creator, project, user_id=creator.id)
        session.add(member)
        role_a = _new_role(creator, name="Role A")
        role_b = _new_role(creator, name="Role B")
        session.add_all([role_a, role_b])
        session.commit()

        session.add_all(
            [
                ProjectMemberRole(
                    project_member_id=member.id, role_id=role_a.id
                ),
                ProjectMemberRole(
                    project_member_id=member.id, role_id=role_b.id
                ),
            ]
        )
        session.commit()

        assignments = (
            session.query(ProjectMemberRole)
            .filter_by(project_member_id=member.id)
            .all()
        )
        assert {a.role_id for a in assignments} == {role_a.id, role_b.id}


class TestDomAc21LengthAndFormatValidation:
    """DOM-AC21: ``Role.name`` (64 chars) and ``RolePermission.code``
    (64 chars, ``<data>.<action>`` format) limits are enforced before
    a value reaches the database, on both construction and
    attribute assignment.
    """

    _MAX_NAME = _MAX_NAME
    _MAX_CODE = _MAX_CODE

    @pytest.fixture(autouse=True)
    def _register_max_code(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            permission_codes, "_active_registry", _BoundaryCodeRegistry
        )

    def test_inspector_shows_column_lengths(self, engine):
        role_columns = {
            col["name"]: col for col in inspect(engine).get_columns("roles")
        }
        permission_columns = {
            col["name"]: col
            for col in inspect(engine).get_columns("role_permissions")
        }
        assert role_columns["name"]["type"].length == 64
        assert permission_columns["code"]["type"].length == 64

    def test_boundary_name_and_code_are_accepted(self, session, creator):
        assert len(self._MAX_NAME) == 64
        assert len(self._MAX_CODE) == 64

        role = _new_role(creator, name=self._MAX_NAME)
        role.permission_codes.append(RolePermission(code=self._MAX_CODE))
        session.add(role)
        session.commit()

        session.expire(role)
        stored = session.get(Role, role.id)
        assert stored.name == self._MAX_NAME
        assert stored.permission_codes[0].code == self._MAX_CODE

    def test_name_over_64_chars_is_rejected(self, session, creator):
        before = session.query(Role).count()
        with pytest.raises(ValueError):
            _new_role(creator, name="N" * 65)
        assert session.query(Role).count() == before

    def test_code_over_64_chars_is_rejected(self, session, creator):
        role = _new_role(creator, name="Some Role")
        session.add(role)
        session.commit()

        over_length_code = "d" * 31 + "." + "a" * 33
        assert len(over_length_code) == 65
        with pytest.raises(ValueError):
            RolePermission(role_id=role.id, code=over_length_code)

        assert (
            session.query(RolePermission).filter_by(role_id=role.id).count()
            == 0
        )

    @pytest.mark.parametrize(
        "bad_code",
        [
            "report",  # no dot
            "Report.read",  # uppercase
            "report.read.all",  # three segments
            "1report.read",  # starts with a digit
        ],
    )
    def test_malformed_code_is_rejected(self, session, creator, bad_code):
        role = _new_role(creator, name="Some Role")
        session.add(role)
        session.commit()

        with pytest.raises(ValueError):
            RolePermission(role_id=role.id, code=bad_code)

        assert (
            session.query(RolePermission).filter_by(role_id=role.id).count()
            == 0
        )

    def test_renaming_role_to_65_chars_is_rejected_and_unchanged(
        self, session, creator
    ):
        role = _new_role(creator, name=self._MAX_NAME)
        session.add(role)
        session.commit()

        with pytest.raises(ValueError):
            role.name = "N" * 65

        session.expire(role)
        stored = session.get(Role, role.id)
        assert stored.name == self._MAX_NAME

    def test_changing_code_to_invalid_format_is_rejected_and_unchanged(
        self, session, creator
    ):
        role = _new_role(creator, name="Some Role")
        perm = RolePermission(code=self._MAX_CODE)
        role.permission_codes.append(perm)
        session.add(role)
        session.commit()

        with pytest.raises(ValueError):
            perm.code = "Report.read"

        session.expire(perm)
        stored = session.get(RolePermission, perm.id)
        assert stored.code == self._MAX_CODE


class TestDomAc24RoleNameCaseInsensitiveUniqueness:
    """DOM-R34/DOM-AC24: ``Role.name`` is unique regardless of case,
    stored exactly as typed, using ASCII names only.
    """

    def test_duplicate_and_case_variant_names_are_rejected(
        self, session, creator
    ):
        session.add(_new_role(creator, name="Viewer"))
        session.commit()
        before = session.query(Role).count()

        session.add(_new_role(creator, name="Viewer"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(_new_role(creator, name="viewer"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(Role).count() == before

    def test_new_name_succeeds_and_reads_back_verbatim(self, session, creator):
        role = _new_role(creator, name="Field Inspector")
        session.add(role)
        session.commit()

        session.expire(role)
        stored = session.get(Role, role.id)
        assert stored.name == "Field Inspector"

    def test_renaming_to_case_variant_of_another_role_is_rejected(
        self, session, creator
    ):
        session.add(_new_role(creator, name="Viewer"))
        inspector_role = _new_role(creator, name="Field Inspector")
        session.add(inspector_role)
        session.commit()

        inspector_role.name = "VIEWER"
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.expire(inspector_role)
        stored = session.get(Role, inspector_role.id)
        assert stored.name == "Field Inspector"


class TestDomAc25PermissionCodeRegistry:
    """DOM-AC25 (DOM-R35): the production registry starts empty; a
    registered code is accepted while an unregistered one is
    rejected, on both insert and update, with row counts and stored
    data unchanged.
    """

    def test_formal_registry_starts_empty(self):
        assert permission_code_descriptions() == {}

    def test_registered_code_is_accepted(
        self, session, creator, registered_permission_codes
    ):
        role = _new_role(creator, name="Some Role")
        session.add(role)
        session.commit()

        assert is_permission_code_registered("report.read")
        session.add(RolePermission(role_id=role.id, code="report.read"))
        session.commit()

        stored = session.query(RolePermission).filter_by(role_id=role.id).one()
        assert stored.code == "report.read"

    def test_unregistered_code_is_rejected_on_insert(
        self, session, creator, registered_permission_codes
    ):
        role = _new_role(creator, name="Some Role")
        session.add(role)
        session.commit()

        assert not is_permission_code_registered("reprot.read")
        with pytest.raises(ValueError):
            RolePermission(role_id=role.id, code="reprot.read")

        assert (
            session.query(RolePermission).filter_by(role_id=role.id).count()
            == 0
        )

    def test_unregistered_code_is_rejected_on_update(
        self, session, creator, registered_permission_codes
    ):
        role = _new_role(creator, name="Some Role")
        perm = RolePermission(code="report.read")
        role.permission_codes.append(perm)
        session.add(role)
        session.commit()

        with pytest.raises(ValueError):
            perm.code = "reprot.read"

        session.expire(perm)
        stored = session.get(RolePermission, perm.id)
        assert stored.code == "report.read"


class TestDomR19R21RoleDeletionCascades:
    """Not their own AC labels, but exercised alongside DOM-AC27:
    deleting a ``Role`` removes its own permission codes (DOM-R19)
    and every ``ProjectMemberRole`` assignment pointing at it
    (DOM-R21), without disturbing the member rows, their other role
    assignments, or other roles -- verified once through the ORM's
    ``session.delete`` and once through a Core ``delete()``
    statement, since the cascade is enforced by the database's own
    ``ON DELETE CASCADE``, not by SQLAlchemy.
    """

    def test_orm_delete_of_role_cascades_without_touching_members(
        self, session, creator, project
    ):
        """DOM-R21."""
        member_a = _new_member(creator, project, user_id=creator.id)
        other_user = create_root_user_with_company(session, "E911")
        member_b = _new_member(creator, project, user_id=other_user.id)
        role_1 = _new_role(creator, name="Role One")
        role_2 = _new_role(creator, name="Role Two")
        session.add_all([member_a, member_b, role_1, role_2])
        session.commit()
        session.add_all(
            [
                ProjectMemberRole(
                    project_member_id=member_a.id, role_id=role_1.id
                ),
                ProjectMemberRole(
                    project_member_id=member_b.id, role_id=role_1.id
                ),
                ProjectMemberRole(
                    project_member_id=member_b.id, role_id=role_2.id
                ),
            ]
        )
        session.commit()

        session.delete(role_1)
        session.commit()

        assert session.get(Role, role_1.id) is None
        assert (
            session.query(ProjectMemberRole)
            .filter_by(role_id=role_1.id)
            .count()
            == 0
        )
        # Both members still exist ...
        assert session.get(ProjectMember, member_a.id) is not None
        assert session.get(ProjectMember, member_b.id) is not None
        # ... and member_b's other role assignment is untouched.
        remaining = (
            session.query(ProjectMemberRole)
            .filter_by(project_member_id=member_b.id)
            .all()
        )
        assert {a.role_id for a in remaining} == {role_2.id}

    def test_core_delete_of_role_cascades_to_assignments(
        self, session, creator, project
    ):
        """DOM-R21."""
        member = _new_member(creator, project, user_id=creator.id)
        role = _new_role(creator, name="Role Z")
        session.add_all([member, role])
        session.commit()
        session.add(
            ProjectMemberRole(project_member_id=member.id, role_id=role.id)
        )
        session.commit()
        role_id = role.id

        session.execute(delete(Role).where(Role.id == role_id))
        session.commit()

        assert (
            session.query(ProjectMemberRole).filter_by(role_id=role_id).count()
            == 0
        )
        assert session.get(ProjectMember, member.id) is not None

    def test_deleting_role_also_removes_its_own_permission_codes(
        self, session, creator, registered_permission_codes
    ):
        """DOM-R19."""
        role = _new_role(creator, name="Role W")
        role.permission_codes.append(RolePermission(code="report.read"))
        session.add(role)
        session.commit()
        role_id = role.id

        session.execute(delete(Role).where(Role.id == role_id))
        session.commit()

        assert (
            session.query(RolePermission).filter_by(role_id=role_id).count()
            == 0
        )


class TestDomAc27CoreDeleteCascadesMemberAssignments:
    """DOM-AC27 (DOM-R25, DOM-R36): project P has M1 (holding R1 and
    R2) and M2 (holding R1); adding M3 with zero roles succeeds
    (DOM-R36's "a member may hold zero roles"); deleting M1 through a
    Core ``delete()`` statement -- not the ORM, so no relationship-
    level cascade can be doing the work -- removes M1 and every
    assignment pointing at it, while R1, R2, M2's assignment to R1
    and M3 are all untouched.
    """

    def test_core_delete_of_m1_cascades_without_touching_others(
        self, session, creator, project
    ):
        user_m1 = creator
        user_m2 = create_root_user_with_company(session, "E911")
        user_m3 = create_root_user_with_company(session, "E912")

        member_1 = _new_member(creator, project, user_id=user_m1.id)
        member_2 = _new_member(creator, project, user_id=user_m2.id)
        role_1 = _new_role(creator, name="Role One")
        role_2 = _new_role(creator, name="Role Two")
        session.add_all([member_1, member_2, role_1, role_2])
        session.commit()
        session.add_all(
            [
                ProjectMemberRole(
                    project_member_id=member_1.id, role_id=role_1.id
                ),
                ProjectMemberRole(
                    project_member_id=member_1.id, role_id=role_2.id
                ),
                ProjectMemberRole(
                    project_member_id=member_2.id, role_id=role_1.id
                ),
            ]
        )
        session.commit()
        member_1_id = member_1.id

        member_3 = _new_member(creator, project, user_id=user_m3.id)
        session.add(member_3)
        session.commit()

        session.execute(
            delete(ProjectMember).where(ProjectMember.id == member_1_id)
        )
        session.commit()

        assert session.get(ProjectMember, member_1_id) is None
        assert (
            session.query(ProjectMemberRole)
            .filter_by(project_member_id=member_1_id)
            .count()
            == 0
        )
        assert session.get(Role, role_1.id) is not None
        assert session.get(Role, role_2.id) is not None
        remaining = (
            session.query(ProjectMemberRole)
            .filter_by(project_member_id=member_2.id)
            .all()
        )
        assert {a.role_id for a in remaining} == {role_1.id}
        assert session.get(ProjectMember, member_3.id) is not None
