"""Contract tests for person-scoped module permission services."""

import pytest
from sqlalchemy import select

from app.models import (
    PermissionBundle,
    PermissionBundlePermission,
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
