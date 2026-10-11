"""驗證 DOM-AC56/63 與 AUT-AC74 的預建資料及權限回填。"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.cli.init_system import run as run_init
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
from app.services.permissions import calculate_effective_access
from tests.db.conftest import create_root_user_with_company, make_system_admin

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
_PARENT_REVISION = "6eaaafbe0ef2"
# migration 的回填條件是歷史資料契約，測試不可隨 runtime registry 增碼而改變。
_PROJECT_CODES = {
    "project_member.manage",
    "project.update",
    "project.read",
    "project_inspection_item.edit",
    "project_inspection_item.read",
    "project_zone.read",
    "project_zone.manage",
    "inspection_plan.read",
    "inspection_plan.create",
    "inspection_plan.manage",
    "inspection_plan.archive",
    "inspection_plan.unarchive",
    "inspection_task.read",
    "inspection_task.manage",
    "inspection_task.create",
    "inspection_task.dispatch",
    "inspection_task.assign",
    "inspection_task.inspect",
    "inspection_task.delete_draft",
    "inspection_task.cancel",
}
_MODULE_CODES = {
    "project.use",
    "project.create",
    "all_project_progress.read",
    "inspection.use",
    "template.use",
    "template.manage",
}


def _legacy_access_snapshot(session, user_id, project_id):
    """重建 migration 前由成員、角色與系統角色共同提供的舊授權。

    舊版兩層權限程式已不在此 revision 的測試執行環境；因此依其資料來源
    保存 migration 前快照，再與目前的集中計算入口逐人比對（AUT-AC74）。
    """
    user = session.get(User, user_id)
    assert user is not None
    members = session.scalars(
        select(ProjectMember).where(ProjectMember.user_id == user_id)
    ).all()
    project_codes: set[str] = set()
    applicable = False
    for member in members:
        for assignment in member.role_assignments:
            codes = {item.code for item in assignment.role.permission_codes}
            if member.project_id == project_id:
                project_codes.update(codes)
            applicable = applicable or (
                "project_inspection_item.edit" in codes
            )

    if user.is_admin:
        module_codes = set(_MODULE_CODES)
    else:
        module_codes = set()
        if members:
            module_codes.update({"project.use", "inspection.use"})
        if applicable:
            module_codes.add("template.use")
        if (
            session.scalar(
                select(SystemRoleAssignment.id).where(
                    SystemRoleAssignment.user_id == user_id,
                    SystemRoleAssignment.role_code
                    == SystemRoleCode.TEMPLATE_ADMIN.value,
                )
            )
            is not None
        ):
            module_codes.update({"template.manage", "template.use"})
    return frozenset(module_codes), frozenset(project_codes)


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
            assert admin_access.module_permissions == frozenset(_MODULE_CODES)
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


def test_backfill_does_not_create_module_rows_for_admin_members(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            admin = create_root_user_with_company(session, "M575D1")
            make_system_admin(admin)
            project = _new_project(admin, "M575D1")
            role = _new_role(admin, "管理者成員角色", "project.read")
            session.add_all([project, role])
            session.flush()
            session.add_all(
                [
                    _new_member(admin, project, admin, role),
                    SystemRoleAssignment(
                        user_id=admin.id,
                        role_code=SystemRoleCode.TEMPLATE_ADMIN.value,
                        created_by=admin.id,
                        updated_by=admin.id,
                    ),
                ]
            )
            admin_id = admin.id
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            rows = session.scalars(select(UserModulePermission)).all()
            codes_by_user: dict[object, set[str]] = {}
            for row in rows:
                codes_by_user.setdefault(row.user_id, set()).add(
                    row.permission_code
                )
            assert admin_id not in codes_by_user
    finally:
        engine.dispose()


def test_external_template_admin_backfill_keeps_only_external_codes(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            actor = create_root_user_with_company(session, "M575D3")
            external = create_root_user_with_company(session, "M575D4")
            external.is_external_collaborator = True
            project = _new_project(actor, "M575D2")
            applicable_role = _new_role(
                actor,
                "可套用範本的外部人員角色",
                "project_inspection_item.edit",
            )
            session.add_all([project, applicable_role])
            session.flush()
            session.add_all(
                [
                    _new_member(actor, project, external, applicable_role),
                    SystemRoleAssignment(
                        user_id=external.id,
                        role_code=SystemRoleCode.TEMPLATE_ADMIN.value,
                        created_by=actor.id,
                        updated_by=actor.id,
                    ),
                ]
            )
            external_id = external.id
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            rows = session.scalars(select(UserModulePermission)).all()
            codes_by_user: dict[object, set[str]] = {}
            for row in rows:
                codes_by_user.setdefault(row.user_id, set()).add(
                    row.permission_code
                )
            assert codes_by_user[external_id] == {
                "project.use",
                "inspection.use",
                "template.use",
            }
            assert "template.manage" not in codes_by_user[external_id]
    finally:
        engine.dispose()


def test_migration_preserves_legacy_access_across_mixed_members(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            admin = create_root_user_with_company(session, "M575R1")
            make_system_admin(admin)
            demo_user = create_root_user_with_company(session, "M575R2")
            inactive_user = create_root_user_with_company(session, "M575R3")
            inactive_user.is_active = False
            external_user = create_root_user_with_company(session, "M575R4")
            external_user.is_external_collaborator = True
            template_admin = create_root_user_with_company(session, "M575R5")

            demo_project = _new_project(admin, "M575R1")
            trial_project = _new_project(admin, "M575R2")
            role_a = _new_role(
                admin,
                "跨專案角色甲",
                "project_zone.read",
                "project_inspection_item.edit",
            )
            role_b = _new_role(admin, "同人第二角色", "inspection_plan.read")
            trial_role = _new_role(
                admin, "跨專案角色乙", "inspection_task.read"
            )
            inactive_role = _new_role(
                admin, "停用者舊角色", "project_inspection_item.read"
            )
            external_role = _new_role(
                admin, "外部人員舊角色", "project_zone.read"
            )
            session.add_all(
                [
                    demo_project,
                    trial_project,
                    role_a,
                    role_b,
                    trial_role,
                    inactive_role,
                    external_role,
                ]
            )
            session.flush()
            session.add_all(
                [
                    _new_member(admin, demo_project, admin, role_a),
                    _new_member(
                        admin, demo_project, demo_user, role_a, role_b
                    ),
                    _new_member(admin, trial_project, demo_user, trial_role),
                    _new_member(
                        admin, demo_project, inactive_user, inactive_role
                    ),
                    _new_member(
                        admin, demo_project, external_user, external_role
                    ),
                    SystemRoleAssignment(
                        user_id=admin.id,
                        role_code=SystemRoleCode.TEMPLATE_ADMIN.value,
                        created_by=admin.id,
                        updated_by=admin.id,
                    ),
                    SystemRoleAssignment(
                        user_id=template_admin.id,
                        role_code=SystemRoleCode.TEMPLATE_ADMIN.value,
                        created_by=admin.id,
                        updated_by=admin.id,
                    ),
                ]
            )
            session.flush()
            cases = [
                (admin.id, demo_project.id),
                (demo_user.id, demo_project.id),
                (demo_user.id, trial_project.id),
                (inactive_user.id, demo_project.id),
                (external_user.id, demo_project.id),
                (template_admin.id, None),
            ]
            legacy = {
                case: _legacy_access_snapshot(session, *case) for case in cases
            }
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            for (user_id, project_id), (
                old_modules,
                old_project,
            ) in legacy.items():
                current = calculate_effective_access(
                    session, user_id=user_id, project_id=project_id
                )
                assert current.module_permissions == old_modules
                expected_project = set(old_project)
                if old_project:
                    expected_project.add("project.read")
                assert current.project_permissions == frozenset(
                    expected_project
                )
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


def test_reapplying_migration_after_preset_rename_preserves_renamed_role(
    db_url,
):
    command.upgrade(_cfg(), _PARENT_REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        assert (
            run_init(sessionmaker(bind=engine), output=lambda _line: None) == 0
        )
    finally:
        engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            role = session.scalars(
                select(Role).where(Role.name == "現場工程師")
            ).one()
            role.name = "維護者自訂現場角色"
            role_id = role.id
            expected_codes = {item.code for item in role.permission_codes}
            session.commit()
    finally:
        engine.dispose()

    # Alembic 已記錄 revision；再次 upgrade 不應重建或覆寫管理員改名的角色。
    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            assert (
                session.scalar(
                    select(Role.id).where(Role.name == "現場工程師")
                )
                is None
            )
            role = session.get(Role, role_id)
            assert role is not None
            assert role.name == "維護者自訂現場角色"
            assert {
                item.code for item in role.permission_codes
            } == expected_codes
    finally:
        engine.dispose()


def test_init_after_migration_does_not_duplicate_default_permissions(
    db_url,
):
    command.upgrade(_cfg(), _PARENT_REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        assert (
            run_init(sessionmaker(bind=engine), output=lambda _line: None) == 0
        )
    finally:
        engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            counts_before = (
                len(session.scalars(select(Role)).all()),
                len(session.scalars(select(RolePermission)).all()),
                len(session.scalars(select(CreatorRoleSetting)).all()),
                len(session.scalars(select(PermissionBundle)).all()),
                len(session.scalars(select(PermissionBundlePermission)).all()),
            )
    finally:
        engine.dispose()

    engine = create_engine_from_settings(db_url)
    try:
        assert (
            run_init(sessionmaker(bind=engine), output=lambda _line: None) == 0
        )
        with Session(engine) as session:
            counts_after = (
                len(session.scalars(select(Role)).all()),
                len(session.scalars(select(RolePermission)).all()),
                len(session.scalars(select(CreatorRoleSetting)).all()),
                len(session.scalars(select(PermissionBundle)).all()),
                len(session.scalars(select(PermissionBundlePermission)).all()),
            )
            assert counts_after == counts_before
    finally:
        engine.dispose()
