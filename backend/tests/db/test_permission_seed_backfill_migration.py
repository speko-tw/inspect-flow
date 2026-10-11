"""DOM-AC56/63 and AUT-AC74 seed and permission backfill coverage."""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    AuditLog,
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    SystemRoleAssignment,
    SystemRoleCode,
    User,
    UserModulePermission,
)
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.permissions import calculate_effective_access
from tests.db.conftest import create_root_user_with_company, make_system_admin

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
_PARENT_REVISION = "6eaaafbe0ef2"
_PROJECT_CODES = {
    item.value
    for item in PermissionCode
    if permission_code_scope(item.value) == "project"
}


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


def _cfg() -> Config:
    return Config(str(_ALEMBIC_INI))


def _new_role(actor: User, name: str, *codes: str) -> Role:
    role = Role(
        name=name,
        created_by=actor.id,
        updated_by=actor.id,
    )
    role.permission_codes.extend(RolePermission(code=code) for code in codes)
    return role


def _new_project(actor: User, suffix: str) -> Project:
    return Project(
        name=f"工程 {suffix}",
        client_name="測試業主",
        site_location="測試工地",
        project_code=f"P-{suffix}",
        created_by=actor.id,
        updated_by=actor.id,
    )


def _new_member(
    actor: User, project: Project, user: User, *roles: Role
) -> ProjectMember:
    member = ProjectMember(
        project_id=project.id,
        user_id=user.id,
        created_by=actor.id,
        updated_by=actor.id,
    )
    member.role_assignments.extend(
        ProjectMemberRole(role=role) for role in roles
    )
    return member


def test_migration_backfills_demo_and_trial_permissions_without_loss(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            actor = create_root_user_with_company(session, "M575A")
            make_system_admin(actor)
            demo_user = create_root_user_with_company(session, "M575D")
            trial_user = create_root_user_with_company(session, "M575T")
            template_admin = create_root_user_with_company(session, "M575G")
            empty_member = create_root_user_with_company(session, "M575E")

            demo_project = _new_project(actor, "M575D")
            trial_project = _new_project(actor, "M575T")
            demo_role = _new_role(
                actor,
                "示範既有角色",
                "project_zone.read",
                "project_inspection_item.edit",
            )
            trial_role = _new_role(
                actor, "試用既有角色", "inspection_plan.read"
            )
            empty_role = _new_role(actor, "空權限舊角色")
            session.add_all(
                [
                    demo_project,
                    trial_project,
                    demo_role,
                    trial_role,
                    empty_role,
                ]
            )
            session.flush()
            session.add_all(
                [
                    _new_member(actor, demo_project, demo_user, demo_role),
                    _new_member(actor, trial_project, trial_user, trial_role),
                    _new_member(actor, trial_project, empty_member),
                ]
            )
            session.add(
                SystemRoleAssignment(
                    user_id=template_admin.id,
                    role_code=SystemRoleCode.TEMPLATE_ADMIN.value,
                    created_by=actor.id,
                    updated_by=actor.id,
                )
            )
            session.add(
                UserModulePermission(
                    user_id=demo_user.id,
                    permission_code="project.use",
                    source="manual",
                )
            )
            session.flush()

            user_ids = {
                "demo": demo_user.id,
                "trial": trial_user.id,
                "template_admin": template_admin.id,
                "empty_member": empty_member.id,
                "admin": actor.id,
            }
            old_role_codes = {
                role.id: {item.code for item in role.permission_codes}
                for role in (demo_role, trial_role, empty_role)
            }
            old_permissions_by_project = {
                demo_user.id: (demo_project.id, old_role_codes[demo_role.id]),
                trial_user.id: (
                    trial_project.id,
                    old_role_codes[trial_role.id],
                ),
                empty_member.id: (trial_project.id, set()),
            }
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            for role_id, old_codes in old_role_codes.items():
                role = session.get(Role, role_id)
                assert role is not None
                current_codes = {item.code for item in role.permission_codes}
                expected = set(old_codes)
                if old_codes & _PROJECT_CODES:
                    expected.add("project.read")
                assert current_codes == expected

            demo_access = calculate_effective_access(
                session,
                user_id=user_ids["demo"],
                project_id=old_permissions_by_project[user_ids["demo"]][0],
            )
            trial_access = calculate_effective_access(
                session,
                user_id=user_ids["trial"],
                project_id=old_permissions_by_project[user_ids["trial"]][0],
            )
            empty_access = calculate_effective_access(
                session,
                user_id=user_ids["empty_member"],
                project_id=old_permissions_by_project[
                    user_ids["empty_member"]
                ][0],
            )
            assert demo_access.project_permissions == frozenset(
                old_permissions_by_project[user_ids["demo"]][1]
                | {"project.read"}
            )
            assert trial_access.project_permissions == frozenset(
                old_permissions_by_project[user_ids["trial"]][1]
                | {"project.read"}
            )
            assert empty_access.project_permissions == frozenset()

            assert demo_access.module_permissions == frozenset(
                {"project.use", "inspection.use", "template.use"}
            )
            assert trial_access.module_permissions == frozenset(
                {"project.use", "inspection.use"}
            )
            assert empty_access.module_permissions == frozenset(
                {"project.use", "inspection.use"}
            )
            template_access = calculate_effective_access(
                session, user_id=user_ids["template_admin"]
            )
            assert template_access.module_permissions == frozenset(
                {"template.manage", "template.use"}
            )
            admin_access = calculate_effective_access(
                session, user_id=user_ids["admin"]
            )
            assert admin_access.module_permissions == frozenset(
                item.value
                for item in PermissionCode
                if permission_code_scope(item.value) == "module"
            )
            assert (
                session.scalars(
                    select(UserModulePermission).where(
                        UserModulePermission.user_id == user_ids["admin"]
                    )
                ).all()
                == []
            )

            backfill_rows = session.scalars(select(UserModulePermission)).all()
            rows_by_user = {}
            for row in backfill_rows:
                rows_by_user.setdefault(row.user_id, {})[
                    row.permission_code
                ] = row.source
            assert rows_by_user[user_ids["demo"]] == {
                "project.use": "manual",
                "inspection.use": "backfill",
                "template.use": "backfill",
            }
            assert rows_by_user[user_ids["trial"]] == {
                "project.use": "backfill",
                "inspection.use": "backfill",
            }
            assert rows_by_user[user_ids["empty_member"]] == {
                "project.use": "backfill",
                "inspection.use": "backfill",
            }
            assert rows_by_user[user_ids["template_admin"]] == {
                "template.manage": "backfill",
                "template.use": "backfill",
            }
            assert session.scalars(
                select(SystemRoleAssignment).where(
                    SystemRoleAssignment.user_id == user_ids["template_admin"],
                    SystemRoleAssignment.role_code
                    == SystemRoleCode.TEMPLATE_ADMIN.value,
                )
            ).one()
            assert session.scalars(select(AuditLog)).all() == []

            seeded_roles = {
                role.name: role
                for role in session.scalars(select(Role)).all()
                if role.name
                in {
                    "專案工程師",
                    "現場工程師",
                    "專案查閱人員",
                }
            }
            assert set(seeded_roles) == {
                "專案工程師",
                "現場工程師",
                "專案查閱人員",
            }
            assert seeded_roles["專案工程師"].is_assignable is False
            assert seeded_roles["專案工程師"].is_external_allowed is False
            assert seeded_roles["現場工程師"].is_assignable is True
            assert seeded_roles["現場工程師"].is_external_allowed is False
            assert seeded_roles["專案查閱人員"].is_assignable is True
            assert seeded_roles["專案查閱人員"].is_external_allowed is True
            read_codes = {
                code for code in _PROJECT_CODES if code.endswith(".read")
            }
            assert {
                item.code
                for item in seeded_roles["專案工程師"].permission_codes
            } == _PROJECT_CODES - {"inspection_task.inspect"}
            assert {
                item.code
                for item in seeded_roles["現場工程師"].permission_codes
            } == read_codes | {"inspection_task.inspect"}
            assert {
                item.code
                for item in seeded_roles["專案查閱人員"].permission_codes
            } == read_codes
            setting = session.scalars(select(CreatorRoleSetting)).one()
            assert setting.role_id == seeded_roles["專案工程師"].id
            seeded_bundles = {
                bundle.name: {
                    item.permission_code for item in bundle.permission_codes
                }
                for bundle in session.scalars(select(PermissionBundle)).all()
            }
            assert seeded_bundles == {
                "公司主管": {"project.use", "all_project_progress.read"},
                "專案工程師常用": {
                    "project.use",
                    "project.create",
                    "inspection.use",
                    "template.use",
                },
                "現場工程師常用": {"project.use", "inspection.use"},
            }
    finally:
        engine.dispose()


def test_migration_seeds_named_defaults_without_overwriting_existing_rows(
    db_url,
):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            actor = create_root_user_with_company(session, "M575X")
            custom_field_role = _new_role(
                actor, "現場工程師", "project_zone.manage"
            )
            custom_setting_target = _new_role(
                actor, "自訂建立者角色", "project.read"
            )
            session.add_all([custom_field_role, custom_setting_target])
            session.flush()
            session.add(CreatorRoleSetting(role_id=custom_setting_target.id))
            custom_bundle = PermissionBundle(
                name="公司主管",
                created_by=actor.id,
                updated_by=actor.id,
                permission_codes=[
                    PermissionBundlePermission(
                        permission_code="project.create"
                    )
                ],
            )
            session.add(custom_bundle)
            session.commit()
            role_id = custom_field_role.id
            setting_role_id = custom_setting_target.id
            bundle_id = custom_bundle.id
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            assert (
                session.scalar(
                    select(Role.id).where(Role.name == "現場工程師")
                )
                == role_id
            )
            role = session.get(Role, role_id)
            assert role is not None
            assert role.is_assignable is False
            assert role.is_external_allowed is False
            assert {item.code for item in role.permission_codes} == {
                "project_zone.manage",
                "project.read",
            }
            assert (
                session.scalar(select(CreatorRoleSetting.role_id))
                == setting_role_id
            )
            assert (
                session.scalar(
                    select(PermissionBundle.id).where(
                        PermissionBundle.name == "公司主管"
                    )
                )
                == bundle_id
            )
            bundle = session.get(PermissionBundle, bundle_id)
            assert bundle is not None
            assert {
                item.permission_code for item in bundle.permission_codes
            } == {"project.create"}
    finally:
        engine.dispose()

    command.downgrade(_cfg(), _PARENT_REVISION)
    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            assert len(session.scalars(select(Role)).all()) == 4
            assert len(session.scalars(select(PermissionBundle)).all()) == 3
            assert len(session.scalars(select(CreatorRoleSetting)).all()) == 1
            assert (
                len(session.scalars(select(UserModulePermission)).all()) == 0
            )
            role = session.get(Role, role_id)
            assert role is not None
            assert {item.code for item in role.permission_codes} == {
                "project_zone.manage",
                "project.read",
            }
            bundle = session.get(PermissionBundle, bundle_id)
            assert bundle is not None
            assert {
                item.permission_code for item in bundle.permission_codes
            } == {"project.create"}
    finally:
        engine.dispose()
