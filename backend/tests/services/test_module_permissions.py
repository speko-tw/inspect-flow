"""Contract tests for person-scoped module permission services."""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.db.unit_of_work import unit_of_work
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


def test_grant_and_revoke_project_create_tracks_implied_use(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
    user = create_root_user_with_company(session, "MOD001")
    session.commit()

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
    events = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == user.id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )
    assert [event.event_type for event in events] == [
        "module_permission.granted",
        "module_permission.granted",
    ]
    assert [event.after["source"] for event in events] == ["manual", "implied"]

    assert not service.grant_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="project.create",
    )
    assert (
        len(
            list(
                session.scalars(
                    select(AuditLog).where(AuditLog.entity_id == user.id)
                )
            )
        )
        == 2
    )

    with pytest.raises(service.ImpliedPermissionError):
        service.revoke_module_permission(
            session,
            actor=operator,
            user=user,
            permission_code="project.use",
        )
    assert (
        len(
            list(
                session.scalars(
                    select(AuditLog).where(AuditLog.entity_id == user.id)
                )
            )
        )
        == 2
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
        "module_permission.granted",
        "module_permission.revoked",
        "module_permission.revoked",
    ]
    assert [event.after["source"] for event in events[:2]] == [
        "manual",
        "implied",
    ]
    assert [event.before["source"] for event in events[2:]] == [
        "manual",
        "implied",
    ]


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


def test_template_manage_revoke_preserves_use_for_two_step_revoke(
    session, operator
):
    user = create_root_user_with_company(session, "TMPL-IMPLIED")

    assert service.grant_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="template.manage",
    )
    rows = list(
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == user.id
            )
        )
    )
    assert {row.permission_code: row.source for row in rows} == {
        "template.manage": "manual",
        "template.use": "implied",
    }

    with pytest.raises(service.ImpliedPermissionError):
        service.revoke_module_permission(
            session,
            actor=operator,
            user=user,
            permission_code="template.use",
        )

    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="template.manage",
    )
    rows = list(
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == user.id
            )
        )
    )
    assert [(row.permission_code, row.source) for row in rows] == [
        ("template.use", "implied")
    ]

    assert service.revoke_module_permission(
        session,
        actor=operator,
        user=user,
        permission_code="template.use",
    )
    assert (
        list(
            session.scalars(
                select(UserModulePermission).where(
                    UserModulePermission.user_id == user.id
                )
            )
        )
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


def test_admin_can_apply_bundle_with_all_project_progress_read(
    session, operator
):
    target = create_root_user_with_company(session, "BND-ADM-PROG")
    bundle = PermissionBundle(
        name="Company lead bundle",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(
                permission_code="all_project_progress.read"
            )
        ],
    )
    session.add(bundle)
    session.flush()

    assert operator.is_admin
    assert service.apply_permission_bundle(
        session, actor=operator, user=target, bundle=bundle
    )
    assert [
        row.permission_code
        for row in session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    ] == ["all_project_progress.read"]


def test_project_delegate_cannot_grant_but_can_revoke_all_progress_read(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    delegate = create_root_user_with_company(session, "PROJ-DELEGATE")
    target = create_root_user_with_company(session, "PROJ-TARGET")
    session.add(UserModuleDelegation(user_id=delegate.id, module="project"))
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    with pytest.raises(service.ModulePermissionDeniedError):
        with unit_of_work(factory) as transaction:
            actor = transaction.get(User, delegate.id)
            recipient = transaction.get(User, target.id)
            assert actor is not None and recipient is not None
            service.grant_module_permission(
                transaction,
                actor=actor,
                user=recipient,
                permission_code="all_project_progress.read",
            )

    session.expire_all()
    recipient = session.get(User, target.id)
    actor = session.get(User, delegate.id)
    assert recipient is not None and actor is not None
    session.add(
        UserModulePermission(
            user_id=recipient.id,
            permission_code="all_project_progress.read",
            source="manual",
        )
    )
    session.commit()

    assert service.revoke_module_permission(
        session,
        actor=actor,
        user=recipient,
        permission_code="all_project_progress.read",
    )
    assert not service.revoke_module_permission(
        session,
        actor=actor,
        user=recipient,
        permission_code="all_project_progress.read",
    )
    session.commit()

    events = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == recipient.id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )
    assert [event.event_type for event in events] == [
        "module_permission.grant_denied",
        "module_permission.revoked",
    ]


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
    session.add(
        UserModulePermission(
            user_id=target.id,
            permission_code="project.use",
            source="manual",
        )
    )
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
    before_permissions = [
        (row.permission_code, row.source)
        for row in session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    ]

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
    session.expire_all()
    after_permissions = [
        (row.permission_code, row.source)
        for row in session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    ]
    assert after_permissions == before_permissions
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


@pytest.mark.parametrize(
    ("write", "permission_code"),
    [
        ("permission", "project.create"),
        ("permission", "template.manage"),
        ("delegation", None),
    ],
)
def test_external_collaborator_write_entries_reject_and_audit_once(
    session, operator, monkeypatch, write, permission_code
):
    target = create_root_user_with_company(session, f"EXT-WRITE-{write[:4]}")
    target.is_external_collaborator = True
    session.commit()
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    with pytest.raises(service.ExternalCollaboratorPermissionError):
        with unit_of_work(factory) as transaction:
            actor_in_transaction = transaction.get(User, operator.id)
            target_in_transaction = transaction.get(User, target.id)
            assert actor_in_transaction is not None
            assert target_in_transaction is not None
            if write == "permission":
                assert permission_code is not None
                service.grant_module_permission(
                    transaction,
                    actor=actor_in_transaction,
                    user=target_in_transaction,
                    permission_code=permission_code,
                )
            else:
                service.grant_module_delegation(
                    transaction,
                    actor=actor_in_transaction,
                    user=target_in_transaction,
                    module="project",
                )

    session.expire_all()
    assert (
        session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        ).all()
        == []
    )
    assert (
        session.scalars(
            select(UserModuleDelegation).where(
                UserModuleDelegation.user_id == target.id
            )
        ).all()
        == []
    )
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
    assert events[0].after["reason"] == (
        "external_not_allowed"
        if write == "permission"
        else "external_collaborator_delegation"
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

    assert sorted(
        row.permission_code
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ) == sorted(["inspection.use", "project.use"])
    assert sorted(
        row.module
        for row in service.list_user_module_delegations(
            session, user_id=delegate.id
        )
    ) == sorted(["inspection", "project"])
    assert service.list_permission_bundles(session, actor=delegate) == [
        visible
    ]
    assert service.list_permission_bundles(session, actor=operator) == [
        hidden,
        visible,
    ]


def test_person_access_service_answers_all_dom_r60_questions(
    session, operator
):
    target = create_root_user_with_company(session, "DOM-R60-PERSON")
    target.name_zh = "測試人員"
    target.name_en = "Test Person"
    target.is_active = False
    session.add(
        UserModulePermission(
            user_id=target.id,
            permission_code="project.use",
            source="manual",
        )
    )
    session.flush()

    person = service.query_person_access(session, user_id=target.id)
    admin = service.query_person_access(session, user_id=operator.id)

    assert person is not None
    assert person.display.user_id == target.id
    assert person.display.username == target.username
    assert person.display.name_zh == "測試人員"
    assert person.display.name_en == "Test Person"
    assert person.is_active is False
    assert person.is_admin is False
    assert person.module_permissions == frozenset({"project.use"})
    assert admin is not None
    assert admin.is_admin is True
    assert "project.use" in admin.module_permissions
    assert service.query_person_access(session, user_id=uuid.uuid4()) is None


def test_bundle_crud_and_apply_write_one_audit_event_each(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
    target = create_root_user_with_company(session, "BND-AUD-1")
    session.commit()

    bundle = service.create_permission_bundle(
        session,
        actor=operator,
        name="Audit bundle",
        permission_codes=["project.use"],
    )
    assert service.update_permission_bundle(
        session,
        actor=operator,
        bundle=bundle,
        name="Audit bundle v2",
        permission_codes=["inspection.use"],
    )
    assert not service.update_permission_bundle(
        session,
        actor=operator,
        bundle=bundle,
        name="Audit bundle v2",
        permission_codes=["inspection.use"],
    )
    assert service.apply_permission_bundle(
        session, actor=operator, user=target, bundle=bundle
    )
    assert not service.apply_permission_bundle(
        session, actor=operator, user=target, bundle=bundle
    )
    permissions_before_delete = [
        (row.permission_code, row.source)
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ]
    service.delete_permission_bundle(session, actor=operator, bundle=bundle)
    session.commit()
    assert [
        (row.permission_code, row.source)
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ] == permissions_before_delete

    events = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == bundle.id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )
    assert [event.event_type for event in events] == [
        "permission_bundle.created",
        "permission_bundle.updated",
        "permission_bundle.applied",
        "permission_bundle.deleted",
    ]


def test_bundle_name_conflict_is_case_insensitive(session, operator):
    service.create_permission_bundle(
        session,
        actor=operator,
        name="Case-Sensitive Bundle",
        permission_codes=["project.use"],
    )
    session.flush()

    with pytest.raises(IntegrityError):
        service.create_permission_bundle(
            session,
            actor=operator,
            name="case-sensitive bundle",
            permission_codes=["project.use"],
        )
    session.rollback()


def test_template_delegate_can_only_apply_template_bundle(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    delegate = create_root_user_with_company(session, "TPL-DELEGATE")
    target = create_root_user_with_company(session, "TPL-TARGET")
    session.add(UserModuleDelegation(user_id=delegate.id, module="template"))
    template_bundle = PermissionBundle(
        name="Template only",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(permission_code="template.use")
        ],
    )
    project_bundle = PermissionBundle(
        name="Project only",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[
            PermissionBundlePermission(permission_code="project.use")
        ],
    )
    session.add_all([template_bundle, project_bundle])
    session.flush()
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)

    assert service.list_permission_bundles(session, actor=delegate) == [
        template_bundle
    ]
    assert service.apply_permission_bundle(
        session, actor=delegate, user=target, bundle=template_bundle
    )
    session.commit()
    with pytest.raises(service.PermissionBundleScopeError):
        with unit_of_work(factory) as transaction:
            transaction_actor = transaction.get(User, delegate.id)
            transaction_target = transaction.get(User, target.id)
            transaction_bundle = transaction.get(
                PermissionBundle, project_bundle.id
            )
            assert transaction_actor is not None
            assert transaction_target is not None
            assert transaction_bundle is not None
            service.apply_permission_bundle(
                transaction,
                actor=transaction_actor,
                user=transaction_target,
                bundle=transaction_bundle,
            )
    session.expire_all()
    target = session.get(User, target.id)
    assert target is not None
    assert [
        row.permission_code
        for row in service.list_user_module_permissions(
            session, user_id=target.id
        )
    ] == ["template.use"]
    session.commit()
    events = list(
        session.scalars(
            select(AuditLog).where(AuditLog.entity_id == target.id)
        )
    )
    bundle_events = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.entity_id == template_bundle.id,
                AuditLog.event_type == "permission_bundle.applied",
            )
        )
    )
    assert len(bundle_events) == 1
    denied = [
        event
        for event in events
        if event.event_type == "module_permission.grant_denied"
    ]
    assert len(denied) == 1
    assert denied[0].after["permission_codes"] == ["project.use"]


def test_project_use_revoke_impact_includes_unmanaged_projects(
    session, operator
):
    from app.services.module_permissions import permission_revoke_impact

    target = create_root_user_with_company(session, "IMPACT-TARGET")
    other = create_root_user_with_company(session, "IMPACT-OTHER")
    project_a = Project(
        project_code="IMPACT-A",
        name="無其他管理者",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    project_b = Project(
        project_code="IMPACT-B",
        name="仍有管理者",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    role = Role(
        name="專案管理者",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="project_member.manage")],
    )
    session.add_all([project_a, project_b, role])
    session.flush()
    for project, user in (
        (project_a, target),
        (project_b, target),
        (project_b, other),
    ):
        session.add(
            ProjectMember(
                project_id=project.id,
                user_id=user.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=role.id)],
            )
        )
    session.add_all(
        [
            UserModulePermission(
                user_id=user.id,
                permission_code="project.use",
                source="manual",
            )
            for user in (target, other)
        ]
    )
    session.flush()

    impact = permission_revoke_impact(
        session, user_id=target.id, permission_code="project.use"
    )

    assert impact.member_count == 2
    assert set(impact.project_ids) == {project_a.id, project_b.id}
    assert impact.projects_without_manager == (project_a.id,)


@pytest.mark.parametrize(
    ("other_manager_state", "expected_unmanaged"),
    [
        ("active_manager", False),
        ("admin_manager", False),
        ("inactive_manager", True),
        ("manager_without_project_use", True),
        ("project_use_without_manager_role", True),
        ("no_other_member", True),
    ],
)
def test_project_use_revoke_impact_requires_an_active_authorized_manager(
    session, operator, other_manager_state, expected_unmanaged
):
    from app.services.module_permissions import permission_revoke_impact

    target = create_root_user_with_company(session, "IMPRULETARGET")
    project = Project(
        project_code=f"IMPACT-RULE-{other_manager_state[:5]}",
        name="撤回影響專案",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    manage_role = Role(
        name=f"撤回影響管理者 {other_manager_state}",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="project_member.manage")],
    )
    empty_role = Role(
        name=f"撤回影響一般成員 {other_manager_state}",
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add_all([project, manage_role, empty_role])
    session.flush()
    session.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=target.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=manage_role.id)],
            ),
            UserModulePermission(
                user_id=target.id,
                permission_code="project.use",
                source="manual",
            ),
        ]
    )
    if other_manager_state != "no_other_member":
        other = create_root_user_with_company(
            session, f"IMPRULE{other_manager_state[:5]}"
        )
        member_role = (
            empty_role
            if other_manager_state
            in {"project_use_without_manager_role", "admin_manager"}
            else manage_role
        )
        if other_manager_state == "admin_manager":
            other.is_admin = True
        session.add(
            ProjectMember(
                project_id=project.id,
                user_id=other.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=member_role.id)],
            )
        )
        if other_manager_state not in {
            "manager_without_project_use",
            "admin_manager",
        }:
            session.add(
                UserModulePermission(
                    user_id=other.id,
                    permission_code="project.use",
                    source="manual",
                )
            )
        if other_manager_state == "inactive_manager":
            other.is_active = False
    session.flush()

    impact = permission_revoke_impact(
        session, user_id=target.id, permission_code="project.use"
    )

    assert impact.member_count == 1
    assert impact.project_ids == (project.id,)
    assert (
        project.id in impact.projects_without_manager
    ) is expected_unmanaged


@pytest.mark.parametrize("has_membership", [False, True])
def test_project_use_revoke_impact_ignores_other_permission_codes(
    session, operator, has_membership
):
    from app.services.module_permissions import permission_revoke_impact

    target = create_root_user_with_company(session, "IMPACT-NON-USE")
    if has_membership:
        project = Project(
            project_code="IMPACT-NON-USE-P",
            name="其他權限影響",
            client_name="業主",
            site_location="工地",
            created_by=operator.id,
            updated_by=operator.id,
        )
        session.add(project)
        session.flush()
        session.add(
            ProjectMember(
                project_id=project.id,
                user_id=target.id,
                created_by=operator.id,
                updated_by=operator.id,
            )
        )
    impact = permission_revoke_impact(
        session, user_id=target.id, permission_code="project.create"
    )
    assert impact.member_count == 0
    assert impact.project_ids == ()
    assert impact.projects_without_manager == ()


def test_project_use_revoke_impact_checks_manager_roles_per_project(
    session, operator
):
    from app.services.module_permissions import permission_revoke_impact

    target = create_root_user_with_company(session, "SPLIT-TARGET")
    candidate = create_root_user_with_company(session, "SPLIT-CANDIDATE")
    project_a = Project(
        project_code="IMPACT-SPLIT-A",
        name="沒有其他管理者",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    project_b = Project(
        project_code="IMPACT-SPLIT-B",
        name="仍有其他管理者",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    member_role = Role(
        name="跨專案一般成員",
        created_by=operator.id,
        updated_by=operator.id,
    )
    manager_role = Role(
        name="跨專案管理成員",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="project_member.manage")],
    )
    session.add_all([project_a, project_b, member_role, manager_role])
    session.flush()
    session.add_all(
        [
            ProjectMember(
                project_id=project_a.id,
                user_id=target.id,
                created_by=operator.id,
                updated_by=operator.id,
            ),
            ProjectMember(
                project_id=project_b.id,
                user_id=target.id,
                created_by=operator.id,
                updated_by=operator.id,
            ),
            ProjectMember(
                project_id=project_a.id,
                user_id=candidate.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=member_role.id)],
            ),
            ProjectMember(
                project_id=project_b.id,
                user_id=candidate.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=manager_role.id)],
            ),
            UserModulePermission(
                user_id=target.id,
                permission_code="project.use",
                source="manual",
            ),
            UserModulePermission(
                user_id=candidate.id,
                permission_code="project.use",
                source="manual",
            ),
        ]
    )
    session.flush()

    impact = permission_revoke_impact(
        session, user_id=target.id, permission_code="project.use"
    )

    assert impact.member_count == 2
    assert set(impact.project_ids) == {project_a.id, project_b.id}
    assert impact.projects_without_manager == (project_a.id,)


@pytest.mark.parametrize("permission_code", ["inspection.use", "template.use"])
def test_non_project_use_revoke_impact_is_currently_empty(
    session, operator, permission_code
):
    from app.services.module_permissions import permission_revoke_impact

    target = create_root_user_with_company(session, "IMPACT-NO-MEMBER")

    impact = permission_revoke_impact(
        session, user_id=target.id, permission_code=permission_code
    )

    assert impact.member_count == 0
    assert impact.project_ids == ()
    assert impact.projects_without_manager == ()


@pytest.mark.parametrize(
    ("actor_kind", "operation"),
    [
        ("cross_module_delegate", "grant"),
        ("non_delegate", "grant"),
        ("self_delegate", "revoke"),
    ],
)
def test_denied_permission_mutations_write_one_audit_without_changing_rows(
    session, operator, monkeypatch, actor_kind, operation
):
    monkeypatch.setattr(
        service.audit_service,
        "record_audit_event_in_independent_transaction",
        record_audit_event_in_independent_transaction,
    )
    actor = create_root_user_with_company(session, f"AUD{actor_kind[:8]}")
    target = (
        actor
        if actor_kind == "self_delegate"
        else create_root_user_with_company(session, f"AUDTGT{actor_kind[:8]}")
    )
    if actor_kind == "cross_module_delegate":
        session.add(UserModuleDelegation(user_id=actor.id, module="template"))
    elif actor_kind == "self_delegate":
        session.add(UserModuleDelegation(user_id=actor.id, module="project"))
    if operation == "revoke":
        session.add(
            UserModulePermission(
                user_id=target.id,
                permission_code="project.use",
                source="manual",
            )
        )
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    before = [
        (row.user_id, row.permission_code, row.source)
        for row in session.scalars(select(UserModulePermission)).all()
    ]

    with pytest.raises(service.ModulePermissionDeniedError):
        with unit_of_work(factory) as transaction:
            transaction_actor = transaction.get(User, actor.id)
            transaction_target = transaction.get(User, target.id)
            assert transaction_actor is not None
            assert transaction_target is not None
            mutation = (
                service.grant_module_permission
                if operation == "grant"
                else service.revoke_module_permission
            )
            mutation(
                transaction,
                actor=transaction_actor,
                user=transaction_target,
                permission_code="project.use",
            )

    session.expire_all()
    after = [
        (row.user_id, row.permission_code, row.source)
        for row in session.scalars(select(UserModulePermission)).all()
    ]
    assert after == before
    denials = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == target.id,
            )
        )
    )
    assert len(denials) == 1
    assert denials[0].created_by == operator.id
    assert denials[0].after["permission_codes"] == ["project.use"]


def test_batch_project_permission_candidates_use_personnel_service(
    session, operator
):
    project = Project(
        project_code="DOM-R69-BATCH",
        name="候選測試",
        client_name="業主",
        site_location="工地",
        created_by=operator.id,
        updated_by=operator.id,
    )
    role = Role(
        name="查核角色",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="inspection_task.inspect")],
    )
    candidate = create_root_user_with_company(session, "BATCH-CANDIDATE")
    admin = create_root_user_with_company(session, "BATCH-ADMIN")
    admin.is_admin = True
    no_role = create_root_user_with_company(session, "BATCH-NO-ROLE")
    inactive = create_root_user_with_company(session, "BATCH-INACTIVE")
    inactive.is_active = False
    session.add_all([project, role])
    session.flush()
    session.add_all(
        [
            ProjectMember(
                project_id=project.id,
                user_id=candidate.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=role.id)],
            ),
            ProjectMember(
                project_id=project.id,
                user_id=admin.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=role.id)],
            ),
            ProjectMember(
                project_id=project.id,
                user_id=no_role.id,
                created_by=operator.id,
                updated_by=operator.id,
            ),
            ProjectMember(
                project_id=project.id,
                user_id=inactive.id,
                created_by=operator.id,
                updated_by=operator.id,
                role_assignments=[ProjectMemberRole(role_id=role.id)],
            ),
        ]
    )
    session.flush()

    from app.services.permissions import project_member_ids_with_permission

    assert project_member_ids_with_permission(
        session,
        project_id=project.id,
        permission_code="inspection_task.inspect",
    ) == frozenset({candidate.id, inactive.id})
    assert project_member_ids_with_permission(
        session,
        project_id=project.id,
        permission_code="inspection_task.inspect",
        active_only=True,
    ) == frozenset({candidate.id})


def test_admin_delegation_grant_and_revoke_are_idempotent(
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
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
    session.commit()
    delegation_events = list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.entity_id == target.id)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )
    assert [event.event_type for event in delegation_events] == [
        "module_delegation.granted",
        "module_delegation.revoked",
    ]
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
    session, operator, monkeypatch
):
    monkeypatch.setattr(
        service.audit_service, "record_audit_event", record_audit_event
    )
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
    session.commit()
    events = list(
        session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "creator_role.changed",
                AuditLog.entity_id == setting.id,
            )
        )
    )
    assert len(events) == 1
    assert events[0].before == {"creator_role_id": str(current.id)}
    assert events[0].after == {"creator_role_id": str(replacement.id)}


def test_creator_role_change_uses_required_permissions_error(
    session, operator
):
    role = Role(
        name="Incomplete creator",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code="project.read")],
    )
    session.add(role)
    session.flush()

    with pytest.raises(service.CreatorRolePermissionsError):
        service.change_creator_role(session, actor=operator, role=role)


def test_external_allowed_role_cannot_become_creator_role(session, operator):
    current = Role(
        name="Current creator external test",
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
    candidate = Role(
        name="External creator candidate",
        is_external_allowed=True,
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
    session.add_all([current, candidate])
    session.flush()
    setting = CreatorRoleSetting(role_id=current.id)
    session.add(setting)
    session.flush()

    with pytest.raises(service.InvalidExternalRoleError):
        service.change_creator_role(session, actor=operator, role=candidate)

    session.refresh(setting)
    assert setting.role_id == current.id


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
