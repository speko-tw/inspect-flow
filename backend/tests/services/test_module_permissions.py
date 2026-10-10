"""Contract tests for person-scoped module permission services."""

import pytest
from sqlalchemy import select

from app.models import (
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Role,
    RolePermission,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services import module_permissions as service
from tests.db.conftest import create_root_user_with_company


@pytest.fixture(autouse=True)
def _stub_audit(monkeypatch):
    """Keep these service contracts independent of audit-log T6."""
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        lambda *args, **kwargs: None,
        raising=False,
    )


def test_grant_and_revoke_project_create_tracks_implied_use(session, operator):
    user = create_root_user_with_company(session, "MOD001")
    session.flush()

    assert service.grant_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.create",
    )
    rows = list(
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == user.id
            )
        )
    )
    assert {row.permission_code: row.source for row in rows} == {
        "project.create": "manual",
        "project.use": "implied",
    }

    with pytest.raises(service.ImpliedPermissionError):
        service.revoke_module_permission(
            session,
            actor=operator,
            user=user,
            permission_code="project.use",
        )
    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.create",
    )
    assert (
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == user.id
            )
        ).all()
        == []
    )


def test_delegate_can_manage_other_user_but_not_self(session, operator):
    actor = create_root_user_with_company(session, "DEL001")
    target = create_root_user_with_company(session, "DEL002")
    session.add(UserModuleDelegation(user_id=actor.id, module="project"))
    session.flush()

    assert service.grant_module_permission(
        session,
        actor=actor,
        user=target,
        permission_code="project.use",
    )
    with pytest.raises(service.ModulePermissionDeniedError):
        service.grant_module_permission(
            session,
            actor=actor,
            user=actor,
            permission_code="project.use",
        )


def test_bundle_application_is_all_or_nothing_for_delegate(session, operator):
    actor = create_root_user_with_company(session, "BND001")
    target = create_root_user_with_company(session, "BND002")
    session.add(UserModuleDelegation(user_id=actor.id, module="project"))
    bundle = PermissionBundle(
        name="Project bundle",
        created_by=operator.id,
        updated_by=operator.id,
    )
    bundle.permission_codes.extend(
        [
            PermissionBundlePermission(permission_code="project.create"),
            PermissionBundlePermission(permission_code="inspection.use"),
        ]
    )
    session.add(bundle)
    session.flush()

    with pytest.raises(service.ModulePermissionDeniedError):
        service.apply_permission_bundle(
            session, actor=actor, user=target, bundle=bundle
        )
    assert (
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        ).all()
        == []
    )


def test_permission_bundle_name_is_validated_on_model_assignment():
    with pytest.raises(ValueError):
        PermissionBundle(
            name="",
            created_by="00000000-0000-0000-0000-000000000000",
            updated_by="00000000-0000-0000-0000-000000000000",
        )


def test_person_permission_queries_and_bundle_visibility(session, operator):
    delegate = create_root_user_with_company(session, "QRY001")
    target = create_root_user_with_company(session, "QRY002")
    session.add_all(
        [
            UserModulePermission(
                user_id=target.id,
                permission_code="project.use",
                source="manual",
            ),
            UserModulePermission(
                user_id=target.id,
                permission_code="inspection.use",
                source="bundle",
            ),
            UserModuleDelegation(user_id=delegate.id, module="project"),
            UserModuleDelegation(user_id=delegate.id, module="inspection"),
        ]
    )
    visible = PermissionBundle(
        name="Project bundle",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(permission_code="project.use")
        ],
    )
    hidden = PermissionBundle(
        name="Progress bundle",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(
                permission_code="all_project_progress.read"
            )
        ],
    )
    session.add_all([visible, hidden])
    session.flush()

    assert [
        row.permission_code
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ] == ["inspection.use", "project.use"]
    assert [
        row.module
        for row in service.list_user_module_delegations(
            session, user_id=delegate.id
        )
    ] == ["inspection", "project"]
    assert service.list_permission_bundles(session, actor=delegate) == [
        visible
    ]
    assert service.list_permission_bundles(session, actor=operator) == [
        hidden,
        visible,
    ]


def test_admin_delegation_grant_and_revoke_are_idempotent(session, operator):
    target = create_root_user_with_company(session, "DLG001")

    assert service.grant_module_delegation(
        session, actor=operator, user=target, module="project"
    )
    assert not service.grant_module_delegation(
        session, actor=operator, user=target, module="project"
    )
    assert service.revoke_module_delegation(
        session, actor=operator, user=target, module="project"
    )
    assert not service.revoke_module_delegation(
        session, actor=operator, user=target, module="project"
    )
    with pytest.raises(service.InvalidModulePermissionError):
        service.grant_module_delegation(
            session, actor=operator, user=target, module="reports"
        )
    with pytest.raises(service.ModulePermissionDeniedError):
        service.grant_module_delegation(
            session, actor=target, user=target, module="project"
        )


def test_bundle_crud_and_application_preserve_grant_sources(session, operator):
    target = create_root_user_with_company(session, "BND003")
    bundle = service.create_permission_bundle(
        session,
        actor=operator,
        name="Project access",
        permission_codes=["project.create"],
    )
    assert service.apply_permission_bundle(
        session, actor=operator, user=target, bundle=bundle
    )
    rows = list(
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    )
    assert {row.permission_code: row.source for row in rows} == {
        "project.create": "bundle",
        "project.use": "implied",
    }

    assert service.update_permission_bundle(
        session,
        actor=operator,
        bundle=bundle,
        name="Project and inspection access",
        permission_codes=["inspection.use"],
    )
    assert not service.update_permission_bundle(
        session,
        actor=operator,
        bundle=bundle,
        name="Project and inspection access",
        permission_codes=["inspection.use"],
    )
    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=target,
        permission_code="project.create",
    )
    assert [
        row.permission_code
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ] == []

    service.delete_permission_bundle(session, actor=operator, bundle=bundle)
    assert service.list_permission_bundles(session, actor=operator) == []


def test_creator_role_setting_changes_only_to_qualified_role(
    session, operator
):
    current = Role(
        name="Current creator",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            RolePermission(code=code)
            for code in (
                "project.update",
                "project_member.manage",
                "project.read",
            )
        ],
    )
    replacement = Role(
        name="Replacement creator",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            RolePermission(code=code)
            for code in (
                "project.update",
                "project_member.manage",
                "project.read",
            )
        ],
    )
    session.add_all([current, replacement])
    session.flush()
    setting = CreatorRoleSetting(role_id=current.id)
    session.add(setting)
    session.flush()

    assert service.get_creator_role_setting(session) == setting
    assert service.change_creator_role(
        session, actor=operator, role=replacement
    )
    assert setting.role_id == replacement.id
    assert not service.change_creator_role(
        session, actor=operator, role=replacement
    )
