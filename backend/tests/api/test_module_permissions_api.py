"""模組權限管理 API 行為測試（DOM-AC58、DOM-AC59）。"""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.access import AccessLevel, iter_route_access
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.main import create_app
from app.models import (
    AuditLog,
    PermissionBundle,
    ProjectMember,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.project_members import add_project_member
from app.services.projects import create_project
from app.services.roles import create_role
from app.services.users import create_user
from tests.db.conftest import create_root_user_with_company


def _client_for(user: User, db_session, make_client) -> TestClient:
    _, token = create_session(db_session, user)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


def _user(db_session, username: str, *, external: bool = False) -> User:
    return create_user(
        db_session,
        username=username,
        email=f"{username}@example.test",
        name_zh=username,
        is_external_collaborator=external,
    )


def _admin(db_session, employee_no: str) -> User:
    admin = create_root_user_with_company(db_session, employee_no)
    admin.username = "admin"
    admin.company_id = None
    admin.employee_no = None
    admin.department = None
    admin.location = None
    admin.name_en = None
    admin.name_zh = None
    admin.email = None
    admin.is_admin = True
    admin.is_system = True
    return admin


def test_module_permission_route_contract() -> None:
    routes = {}
    for route in iter_route_access(create_app()):
        assert route.declaration is not None
        routes[(route.method, route.path)] = route.declaration.level
    assert {
        ("GET", "/api/v1/module-permissions"): (
            AccessLevel.MODULE_DELEGATE_REQUIRED
        ),
        ("GET", "/api/v1/users/{user_id}/module-permissions"): (
            AccessLevel.MODULE_DELEGATE_REQUIRED
        ),
        ("PUT", "/api/v1/users/{user_id}/module-permissions/{code}"): (
            AccessLevel.MODULE_DELEGATE_REQUIRED
        ),
        ("DELETE", "/api/v1/users/{user_id}/module-permissions/{code}"): (
            AccessLevel.MODULE_DELEGATE_REQUIRED
        ),
        (
            "GET",
            "/api/v1/users/{user_id}/module-permissions/{code}/revoke-impact",
        ): AccessLevel.MODULE_DELEGATE_REQUIRED,
        ("PUT", "/api/v1/users/{user_id}/module-delegations/{module}"): (
            AccessLevel.ADMIN_REQUIRED
        ),
        (
            "DELETE",
            "/api/v1/users/{user_id}/module-delegations/{module}",
        ): AccessLevel.ADMIN_REQUIRED,
        ("GET", "/api/v1/permission-bundles"): (
            AccessLevel.MODULE_DELEGATE_REQUIRED
        ),
        ("POST", "/api/v1/permission-bundles"): (AccessLevel.ADMIN_REQUIRED),
        ("PATCH", "/api/v1/permission-bundles/{bundle_id}"): (
            AccessLevel.ADMIN_REQUIRED
        ),
        ("DELETE", "/api/v1/permission-bundles/{bundle_id}"): (
            AccessLevel.ADMIN_REQUIRED
        ),
        (
            "POST",
            "/api/v1/users/{user_id}/permission-bundles/{bundle_id}:apply",
        ): AccessLevel.MODULE_DELEGATE_REQUIRED,
    }.items() <= routes.items()


def test_module_permission_grant_revoke_and_catalog(db_session, make_client):
    admin = _admin(db_session, "MOD-PERM-ADMIN")
    target = _user(db_session, "module-target")
    db_session.commit()
    client = _client_for(admin, db_session, make_client)

    catalog = client.get("/api/v1/module-permissions")
    assert catalog.status_code == 200, catalog.text
    expected_codes = {
        code.value
        for code in PermissionCode
        if permission_code_scope(code.value) == "module"
    }
    assert {item["code"] for item in catalog.json()["items"]} == (
        expected_codes
    )
    assert all(
        "module" in item and "description" in item
        for item in catalog.json()["items"]
    )

    grant_url = f"/api/v1/users/{target.id}/module-permissions/template.manage"
    assert client.put(grant_url).status_code == 204
    rows = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    )
    assert {(row.permission_code, row.source) for row in rows} == {
        ("template.manage", "manual"),
        ("template.use", "implied"),
    }
    assert client.put(grant_url).status_code == 204
    assert (
        db_session.scalar(
            select(AuditLog.id).where(
                AuditLog.event_type == "module_permission.granted"
            )
        )
        is not None
    )
    grant_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.granted"
            )
        )
    )
    assert len(grant_events) == 2

    state = client.get(f"/api/v1/users/{target.id}/module-permissions")
    assert state.status_code == 200
    assert state.json() == {
        "permission_codes": ["template.manage", "template.use"],
        "delegated_modules": [],
    }
    revoke_implied = client.delete(
        f"/api/v1/users/{target.id}/module-permissions/template.use"
    )
    assert revoke_implied.status_code == 422
    assert revoke_implied.json()["error"]["code"] == (
        "module_permission.required_by_other"
    )
    assert client.delete(grant_url).status_code == 204
    assert client.delete(grant_url).status_code == 204
    assert (
        client.delete(
            f"/api/v1/users/{target.id}/module-permissions/template.use"
        ).status_code
        == 204
    )
    db_session.expire_all()
    assert (
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        ).all()
        == []
    )
    revoked_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.revoked"
            )
        )
    )
    assert len(revoked_events) == 2


def test_delegate_scope_denial_is_audited_and_bundle_is_atomic(
    db_session, make_client
):
    admin = _admin(db_session, "MOD-DELEGATE-ADM")
    delegate = _user(db_session, "template-delegate")
    project_delegate = _user(db_session, "project-delegate")
    target = _user(db_session, "delegate-target")
    db_session.add(
        UserModuleDelegation(user_id=delegate.id, module="template")
    )
    db_session.add(
        UserModuleDelegation(user_id=project_delegate.id, module="project")
    )
    db_session.add(UserModuleDelegation(user_id=target.id, module="template"))
    db_session.add(UserModuleDelegation(user_id=target.id, module="project"))
    db_session.add_all(
        [
            UserModulePermission(
                user_id=target.id,
                permission_code="template.use",
                source="manual",
            ),
            UserModulePermission(
                user_id=target.id,
                permission_code="project.use",
                source="manual",
            ),
        ]
    )
    db_session.commit()
    admin_client = _client_for(admin, db_session, make_client)
    delegate_client = _client_for(delegate, db_session, make_client)
    project_delegate_client = _client_for(
        project_delegate, db_session, make_client
    )

    catalog = delegate_client.get("/api/v1/module-permissions")
    assert catalog.status_code == 200
    assert all(
        item["module"] == "template" for item in catalog.json()["items"]
    )
    target_state = delegate_client.get(
        f"/api/v1/users/{target.id}/module-permissions"
    )
    assert target_state.status_code == 200
    assert target_state.json() == {
        "permission_codes": ["template.use"],
        "delegated_modules": ["template"],
    }

    permission_url = (
        f"/api/v1/users/{target.id}/module-permissions/inspection.use"
    )
    before = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    )
    denied = delegate_client.put(permission_url)
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "permission.denied"
    db_session.expire_all()
    assert (
        list(
            db_session.scalars(
                select(UserModulePermission).where(
                    UserModulePermission.user_id == target.id
                )
            )
        )
        == before
    )
    assert (
        db_session.scalar(
            select(AuditLog.id).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == target.id,
            )
        )
        is not None
    )

    assert (
        admin_client.put(
            f"/api/v1/users/{target.id}/module-permissions/"
            "all_project_progress.read"
        ).status_code
        == 204
    )
    all_progress_url = (
        f"/api/v1/users/{target.id}/module-permissions/"
        "all_project_progress.read"
    )
    forbidden_grant = project_delegate_client.put(all_progress_url)
    assert forbidden_grant.status_code == 403
    assert forbidden_grant.json()["error"]["code"] == "permission.denied"
    assert project_delegate_client.delete(all_progress_url).status_code == 204
    db_session.expire_all()
    assert (
        db_session.scalar(
            select(UserModulePermission.id).where(
                UserModulePermission.user_id == target.id,
                UserModulePermission.permission_code
                == "all_project_progress.read",
            )
        )
        is None
    )
    revoked_all_progress = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.revoked",
                AuditLog.entity_id == target.id,
                AuditLog.before["permission_code"].as_string()
                == "all_project_progress.read",
            )
        )
    )
    assert len(revoked_all_progress) == 1

    bundle_response = admin_client.post(
        "/api/v1/permission-bundles",
        json={
            "name": "Mixed permissions",
            "permission_codes": ["template.use", "project.create"],
        },
    )
    assert bundle_response.status_code == 201, bundle_response.text
    bundle_id = bundle_response.json()["id"]
    before_bundle_apply = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    )
    applied = delegate_client.post(
        f"/api/v1/users/{target.id}/permission-bundles/{bundle_id}:apply"
    )
    assert applied.status_code == 403
    assert applied.json()["error"]["details"] == ["project.create"]
    db_session.expire_all()
    assert (
        list(
            db_session.scalars(
                select(UserModulePermission).where(
                    UserModulePermission.user_id == target.id
                )
            )
        )
        == before_bundle_apply
    )
    assert delegate_client.get("/api/v1/permission-bundles").json() == {
        "items": [],
        "next_cursor": None,
    }


def test_delegate_cannot_query_or_change_admin_module_permissions(
    db_session, make_client
):
    admin = _admin(db_session, "ADM-TGT-SYS")
    non_system_admin = _user(db_session, "admin-target-non-system")
    non_system_admin.is_admin = True
    delegate = _user(db_session, "admin-target-delegate")
    db_session.add(
        UserModuleDelegation(user_id=delegate.id, module="template")
    )
    db_session.commit()
    admin_client = _client_for(admin, db_session, make_client)
    delegate_client = _client_for(delegate, db_session, make_client)

    bundle_response = admin_client.post(
        "/api/v1/permission-bundles",
        json={"name": "Template access", "permission_codes": ["template.use"]},
    )
    assert bundle_response.status_code == 201, bundle_response.text
    bundle_id = bundle_response.json()["id"]

    visible_users = delegate_client.get("/api/v1/module-delegate/users")
    assert visible_users.status_code == 200
    visible_ids = {item["id"] for item in visible_users.json()["items"]}
    assert str(admin.id) not in visible_ids
    assert str(non_system_admin.id) not in visible_ids

    for target in (admin, non_system_admin):
        baseline = delegate_client.get(
            f"/api/v1/users/{target.id}/effective-access"
            f"?project_id={UUID(int=0)}"
        )
        assert baseline.status_code == 403

        before_permissions = list(
            db_session.scalars(
                select(UserModulePermission).where(
                    UserModulePermission.user_id == target.id
                )
            )
        )
        before_delegations = list(
            db_session.scalars(
                select(UserModuleDelegation).where(
                    UserModuleDelegation.user_id == target.id
                )
            )
        )
        before_audit = list(
            db_session.scalars(
                select(AuditLog).where(AuditLog.entity_id == target.id)
            )
        )

        denied_responses = [
            delegate_client.get(
                f"/api/v1/users/{target.id}/module-permissions"
            ),
            delegate_client.get(
                f"/api/v1/users/{target.id}/module-permissions/"
                "template.use/revoke-impact"
            ),
            delegate_client.put(
                f"/api/v1/users/{target.id}/module-permissions/template.use"
            ),
            delegate_client.delete(
                f"/api/v1/users/{target.id}/module-permissions/template.use"
            ),
            delegate_client.post(
                f"/api/v1/users/{target.id}/permission-bundles/"
                f"{bundle_id}:apply"
            ),
        ]

        for response in denied_responses:
            assert response.status_code == 403
            assert response.json() == baseline.json()

        db_session.expire_all()
        assert (
            list(
                db_session.scalars(
                    select(UserModulePermission).where(
                        UserModulePermission.user_id == target.id
                    )
                )
            )
            == before_permissions
        )
        assert (
            list(
                db_session.scalars(
                    select(UserModuleDelegation).where(
                        UserModuleDelegation.user_id == target.id
                    )
                )
            )
            == before_delegations
        )
        assert (
            list(
                db_session.scalars(
                    select(AuditLog).where(AuditLog.entity_id == target.id)
                )
            )
            == before_audit
        )

    assert (
        admin_client.get(
            f"/api/v1/users/{admin.id}/module-permissions"
        ).status_code
        == 200
    )


def test_module_delegation_and_bundle_crud_are_admin_only(
    db_session, make_client
):
    admin = _admin(db_session, "BUNDLE-ADMIN")
    delegate = _user(db_session, "bundle-delegate")
    target = _user(db_session, "bundle-target")
    db_session.commit()
    admin_client = _client_for(admin, db_session, make_client)
    delegate_client = _client_for(delegate, db_session, make_client)

    assert (
        admin_client.put(
            f"/api/v1/users/{delegate.id}/module-delegations/template"
        ).status_code
        == 204
    )
    assert (
        admin_client.put(
            f"/api/v1/users/{delegate.id}/module-delegations/template"
        ).status_code
        == 204
    )
    delegations = list(
        db_session.scalars(
            select(UserModuleDelegation).where(
                UserModuleDelegation.user_id == delegate.id
            )
        )
    )
    assert [item.module for item in delegations] == ["template"]
    assert (
        delegate_client.put(
            f"/api/v1/users/{target.id}/module-delegations/template"
        ).status_code
        == 403
    )

    invalid = admin_client.put(
        f"/api/v1/users/{delegate.id}/module-delegations/unknown"
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == (
        "module_delegation.module_invalid"
    )
    assert (
        admin_client.delete(
            f"/api/v1/users/{delegate.id}/module-delegations/template"
        ).status_code
        == 204
    )
    assert (
        admin_client.delete(
            f"/api/v1/users/{delegate.id}/module-delegations/template"
        ).status_code
        == 204
    )
    delegation_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type.in_(
                    [
                        "module_delegation.granted",
                        "module_delegation.revoked",
                    ]
                ),
                AuditLog.entity_id == delegate.id,
            )
        )
    )
    assert len(delegation_events) == 2
    assert {event.event_type for event in delegation_events} == {
        "module_delegation.granted",
        "module_delegation.revoked",
    }
    assert (
        admin_client.put(
            f"/api/v1/users/{delegate.id}/module-delegations/template"
        ).status_code
        == 204
    )

    created = admin_client.post(
        "/api/v1/permission-bundles",
        json={
            "name": "Template readers",
            "permission_codes": ["template.use"],
        },
    )
    assert created.status_code == 201, created.text
    bundle_id = created.json()["id"]
    project_bundle = admin_client.post(
        "/api/v1/permission-bundles",
        json={"name": "Project users", "permission_codes": ["project.use"]},
    )
    assert project_bundle.status_code == 201, project_bundle.text
    delegate_bundles = delegate_client.get("/api/v1/permission-bundles")
    assert delegate_bundles.status_code == 200
    assert [item["id"] for item in delegate_bundles.json()["items"]] == [
        bundle_id
    ]
    admin_bundles = admin_client.get("/api/v1/permission-bundles")
    assert len(admin_bundles.json()["items"]) == 2
    delegate_apply = delegate_client.post(
        f"/api/v1/users/{target.id}/permission-bundles/{bundle_id}:apply"
    )
    assert delegate_apply.status_code == 200, delegate_apply.text
    assert delegate_apply.json() == {
        "user_id": str(target.id),
        "granted_codes": ["template.use"],
    }
    db_session.expire_all()
    template_grant = db_session.scalar(
        select(UserModulePermission).where(
            UserModulePermission.user_id == target.id,
            UserModulePermission.permission_code == "template.use",
        )
    )
    assert template_grant is not None
    assert template_grant.source == "bundle"
    duplicate = admin_client.post(
        "/api/v1/permission-bundles",
        json={"name": "template readers", "permission_codes": []},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == (
        "permission_bundle.name_conflict"
    )
    update = admin_client.patch(
        f"/api/v1/permission-bundles/{bundle_id}",
        json={"permission_codes": ["template.use", "template.manage"]},
    )
    assert update.status_code == 200, update.text
    assert update.json()["permission_codes"] == [
        "template.manage",
        "template.use",
    ]
    applied = admin_client.post(
        f"/api/v1/users/{target.id}/permission-bundles/{bundle_id}:apply"
    )
    assert applied.status_code == 200, applied.text
    assert applied.json() == {
        "user_id": str(target.id),
        "granted_codes": ["template.manage"],
    }
    repeated_apply = admin_client.post(
        f"/api/v1/users/{target.id}/permission-bundles/{bundle_id}:apply"
    )
    assert repeated_apply.json() == {
        "user_id": str(target.id),
        "granted_codes": [],
    }
    apply_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "permission_bundle.applied",
                AuditLog.entity_id == UUID(bundle_id),
            )
        )
    )
    assert len(apply_events) == 2
    assert (
        admin_client.delete(
            f"/api/v1/permission-bundles/{bundle_id}"
        ).status_code
        == 204
    )
    assert db_session.get(PermissionBundle, UUID(bundle_id)) is None
    for event_name in (
        "permission_bundle.created",
        "permission_bundle.updated",
        "permission_bundle.deleted",
    ):
        events = list(
            db_session.scalars(
                select(AuditLog).where(
                    AuditLog.event_type == event_name,
                    AuditLog.entity_id == UUID(bundle_id),
                )
            )
        )
        assert len(events) == 1
    db_session.expire_all()
    assert {
        row.permission_code
        for row in db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == target.id
            )
        )
    } == {"template.manage", "template.use"}


def test_external_grant_rejection_and_revoke_impact_are_read_only(
    db_session, make_client
):
    admin = _admin(db_session, "EXTPERM-ADM")
    external = _user(db_session, "external-target", external=True)
    internal = _user(db_session, "impact-target")
    project = create_project(
        db_session,
        project_code="IMPACT-581",
        name="撤回影響工程",
        client_name="測試業主",
        site_location="測試地點",
    )
    manager_role = create_role(
        db_session,
        name="撤回影響管理角色",
        permission_codes=["project_member.manage"],
    )
    member = add_project_member(
        db_session,
        project_id=project.id,
        user_id=internal.id,
        role_ids=[manager_role.id],
        actor_user_id=admin.id,
    )
    db_session.commit()
    client = _client_for(admin, db_session, make_client)

    external_use_url = (
        f"/api/v1/users/{external.id}/module-permissions/template.use"
    )
    assert client.put(external_use_url).status_code == 204
    rejected = client.put(
        f"/api/v1/users/{external.id}/module-permissions/template.manage"
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == (
        "module_permission.external_not_allowed"
    )
    db_session.expire_all()
    external_rows = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == external.id
            )
        )
    )
    assert [(row.permission_code, row.source) for row in external_rows] == [
        ("template.use", "manual")
    ]
    assert (
        db_session.scalar(
            select(AuditLog.id).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == external.id,
            )
        )
        is not None
    )

    assert (
        client.put(
            f"/api/v1/users/{internal.id}/module-permissions/project.use"
        ).status_code
        == 204
    )
    before = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == internal.id
            )
        )
    )
    impact = client.get(
        f"/api/v1/users/{internal.id}/module-permissions/project.use/"
        "revoke-impact"
    )
    assert impact.status_code == 200, impact.text
    assert impact.json() == {
        "membership_count": 1,
        "projects": [{"id": str(project.id), "name": project.name}],
        "projects_becoming_unmanaged": [
            {"id": str(project.id), "name": project.name}
        ],
    }
    db_session.expire_all()
    impact_rows = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == internal.id
            )
        )
    )
    assert [(row.permission_code, row.source) for row in impact_rows] == [
        (row.permission_code, row.source) for row in before
    ]
    assert (
        client.delete(
            f"/api/v1/users/{internal.id}/module-permissions/project.use"
        ).status_code
        == 204
    )
    db_session.expire_all()
    after = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == internal.id
            )
        )
    )
    assert after == []
    stored_member = db_session.get(ProjectMember, member.id)
    assert stored_member is not None
    assert [item.role_id for item in stored_member.role_assignments] == [
        manager_role.id
    ]


def test_invalid_codes_missing_users_and_self_grant_are_rejected(
    db_session, make_client
):
    admin = _admin(db_session, "MOD-ERROR-ADMIN")
    delegate = _user(db_session, "self-delegate")
    db_session.add(
        UserModuleDelegation(user_id=delegate.id, module="template")
    )
    db_session.commit()
    admin_client = _client_for(admin, db_session, make_client)
    delegate_client = _client_for(delegate, db_session, make_client)

    unknown = admin_client.put(
        f"/api/v1/users/{delegate.id}/module-permissions/not.registered"
    )
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == (
        "module_permission.code_invalid"
    )
    project_code = admin_client.put(
        f"/api/v1/users/{delegate.id}/module-permissions/project.read"
    )
    assert project_code.status_code == 422
    assert project_code.json()["error"]["code"] == (
        "module_permission.code_invalid"
    )
    missing = admin_client.get(
        "/api/v1/users/00000000-0000-0000-0000-000000000000/module-permissions"
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "resource.not_found"

    before = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == delegate.id
            )
        )
    )
    self_grant = delegate_client.put(
        f"/api/v1/users/{delegate.id}/module-permissions/template.use"
    )
    assert self_grant.status_code == 403
    db_session.expire_all()
    after = list(
        db_session.scalars(
            select(UserModulePermission).where(
                UserModulePermission.user_id == delegate.id
            )
        )
    )
    assert after == before
    denied_events = list(
        db_session.scalars(
            select(AuditLog).where(
                AuditLog.event_type == "module_permission.grant_denied",
                AuditLog.entity_id == delegate.id,
            )
        )
    )
    assert len(denied_events) == 1
