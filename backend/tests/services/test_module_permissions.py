"""Contract tests for person-scoped module permission services."""

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db.unit_of_work import unit_of_work
from app.models import (
    AuditLog,
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Role,
    RolePermission,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services import module_permissions as service
from app.services.audit import (
    record_audit_event,
    record_audit_event_in_independent_transaction,
)
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
    assert [
        (row.permission_code, row.source)
        for row in session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == user.id
            )
        )
    ] == [("project.use", "implied")]
    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.use",
    )


@pytest.mark.parametrize("source", ["manual", "bundle", "backfill"])
def test_primary_permission_blocks_use_revoke_for_every_source(
    session, operator, source
):
    user = create_root_user_with_company(session, f"IMPLIED-{source}")
    session.add_all(
        [
            UserModulePermission(
                user_id=user.id,
                permission_code="project.create",
                source="manual",
            ),
            UserModulePermission(
                user_id=user.id,
                permission_code="project.use",
                source=source,
            ),
        ]
    )
    session.flush()

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
        session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == user.id,
                UserModulePermission.permission_code == "project.use",
            )
        )
        is not None
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
    session.commit()

    with pytest.raises(service.PermissionBundleScopeError) as error:
        service.apply_permission_bundle(
            session, actor=actor, user=target, bundle=bundle
        )
    assert error.value.status_code == 403
    assert error.value.details == ["inspection.use"]
    assert (
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        ).all()
        == []
    )


def test_bundle_rejects_all_invalid_codes_with_one_denial_audit(
    session, operator, monkeypatch
):
    target = create_root_user_with_company(session, "BND-INVALID-TGT")
    bundle = PermissionBundle(
        name="Invalid bundle",
        created_by=operator.id,
        updated_by=operator.id,
    )
    bundle.permission_codes.extend(
        [
            PermissionBundlePermission(permission_code="project.use"),
            PermissionBundlePermission(permission_code="inspection.use"),
        ]
    )
    session.add(bundle)
    session.flush()
    session.commit()
    original_scope = service.permission_code_scope

    def outdated_scope(code):
        if code in {"project.use", "inspection.use"}:
            return "project"
        return original_scope(code)

    monkeypatch.setattr(service, "permission_code_scope", outdated_scope)
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    with pytest.raises(service.InvalidModulePermissionError) as error:
        with unit_of_work(factory) as transaction:
            actor_in_transaction = transaction.get(User, operator.id)
            target_in_transaction = transaction.get(User, target.id)
            bundle_in_transaction = transaction.get(
                PermissionBundle, bundle.id
            )
            assert actor_in_transaction is not None
            assert target_in_transaction is not None
            assert bundle_in_transaction is not None
            service.apply_permission_bundle(
                transaction,
                actor=actor_in_transaction,
                user=target_in_transaction,
                bundle=bundle_in_transaction,
            )

    assert error.value.details == ["inspection.use", "project.use"]
    events = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == target.id,
            )
        )
    )
    assert len(events) == 1
    assert events[0].created_by == operator.id
    assert events[0].after["permission_codes"] == error.value.details


def test_external_bundle_denial_is_422_and_written_once(
    session, operator, monkeypatch
):
    target = create_root_user_with_company(session, "BND-EXT-TARGET")
    target.is_external_collaborator = True
    bundle = PermissionBundle(
        name="External bundle",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(permission_code="project.use"),
            PermissionBundlePermission(permission_code="project.create"),
        ],
    )
    session.add(bundle)
    session.flush()
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    with pytest.raises(service.ExternalCollaboratorPermissionError) as error:
        with unit_of_work(factory) as transaction:
            actor_in_transaction = transaction.get(User, operator.id)
            target_in_transaction = transaction.get(User, target.id)
            bundle_in_transaction = transaction.get(
                PermissionBundle, bundle.id
            )
            assert actor_in_transaction is not None
            assert target_in_transaction is not None
            assert bundle_in_transaction is not None
            service.apply_permission_bundle(
                transaction,
                actor=actor_in_transaction,
                user=target_in_transaction,
                bundle=bundle_in_transaction,
            )

    assert error.value.status_code == 422
    assert error.value.details == ["project.create"]
    events = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == target.id,
            )
        )
    )
    assert len(events) == 1
    assert events[0].created_by == operator.id
    assert events[0].after["permission_codes"] == ["project.create"]


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
    ] == ["project.use"]
    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=target,
        permission_code="project.use",
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


def test_grant_and_revoke_events_preserve_permission_source(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
    user = create_root_user_with_company(session, "AUD-MOD-SOURCE")
    session.commit()

    assert service.grant_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.use",
    )
    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.use",
    )
    session.commit()

    events = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == user.id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )
    assert [event.event_type for event in events] == [
        "module_permission.granted",
        "module_permission.revoked",
    ]
    assert events[0].after == {
        "user_id": str(user.id),
        "permission_code": "project.use",
        "module": "project",
        "source": "manual",
    }
    assert events[1].before == {
        "user_id": str(user.id),
        "permission_code": "project.use",
        "module": "project",
        "source": "manual",
    }


def test_denied_grant_event_survives_unit_of_work_rollback(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    actor = create_root_user_with_company(session, "AUD-MOD-ACTOR")
    target = create_root_user_with_company(session, "AUD-MOD-TARGET")
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    with pytest.raises(service.ModulePermissionDeniedError):
        with unit_of_work(factory) as transaction:
            actor_in_transaction = transaction.get(User, actor.id)
            target_in_transaction = transaction.get(User, target.id)
            assert actor_in_transaction is not None
            assert target_in_transaction is not None
            service.grant_module_permission(
                transaction,
                actor=actor_in_transaction,
                user=target_in_transaction,
                permission_code="project.use",
            )

    event = session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "module_permission.grant_denied",
            AuditLog.entity_id == target.id,
        )
    )
    assert event is not None
    assert event.created_by == operator.id
    assert event.project_id is None
    assert event.after == {
        "user_id": str(target.id),
        "permission_codes": ["project.use"],
        "reason": "outside_delegation_scope",
    }
    assert (
        session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == target.id
            )
        )
        is None
    )
