"""Admin 有效權限唯讀查詢 API（ADM-R45、ADM-AC46）。"""

from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from app.auth.access import AccessLevel, iter_route_access
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.main import create_app
from app.models import User, UserModuleDelegation, UserModulePermission
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.module_permissions import (
    apply_permission_bundle,
    create_permission_bundle,
    grant_module_permission,
    revoke_module_permission,
)
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


def _admin(db_session) -> User:
    user = create_root_user_with_company(db_session, "ACCESS-702")
    user.username = "admin"
    user.company_id = None
    user.employee_no = None
    user.department = None
    user.location = None
    user.name_en = None
    user.name_zh = None
    user.email = None
    user.is_admin = True
    user.is_system = True
    return user


def _project(db_session):
    return create_project(
        db_session,
        project_code="ACCESS-702",
        name="權限診斷工程",
        client_name="測試業主",
        site_location="測試地點",
    )


def _member(db_session, project, user, role_ids, actor):
    return add_project_member(
        db_session,
        project_id=project.id,
        user_id=user.id,
        role_ids=role_ids,
        actor_user_id=actor.id,
    )


def _url(user_id: UUID, project_id: UUID) -> str:
    return f"/api/v1/users/{user_id}/effective-access?project_id={project_id}"


def test_effective_access_route_uses_delegate_declaration() -> None:
    routes = {
        (item.method, item.path): item.declaration.level
        for item in iter_route_access(create_app())
        if item.declaration is not None
    }
    assert (
        routes[("GET", "/api/v1/users/{user_id}/effective-access")]
        == AccessLevel.MODULE_DELEGATE_REQUIRED
    )


def test_admin_sources_diagnostics_revocation_and_implicit_access(
    db_session, make_client
):
    admin = _admin(db_session)
    target = _user(db_session, "access-target")
    admin_target = _user(db_session, "access-admin-target")
    admin_target.is_admin = True
    external = _user(db_session, "external-target", external=True)
    project = _project(db_session)
    role = create_role(
        db_session,
        name="權限診斷角色",
        permission_codes=[
            "inspection_task.read",
            "project_member.manage",
        ],
    )
    for user in (target, admin_target):
        _member(db_session, project, user, [role.id], admin)
    _member(db_session, project, external, [], admin)
    grant_module_permission(
        db_session,
        actor=admin,
        user=target,
        permission_code="project.create",
    )
    bundle = create_permission_bundle(
        db_session,
        actor=admin,
        name="診斷用組合",
        permission_codes=["inspection.use", "template.manage"],
    )
    apply_permission_bundle(
        db_session, actor=admin, user=target, bundle=bundle
    )
    db_session.commit()
    client = _client_for(admin, db_session, make_client)

    response = client.get(_url(target.id, project.id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert {
        (item["code"], item["source"]) for item in body["module_permissions"]
    } == {
        ("inspection.use", "combination"),
        ("project.create", "direct"),
        ("project.use", "implied"),
        ("template.manage", "combination"),
        ("template.use", "implied"),
    }
    assert body["project_roles"] == [
        {
            "id": str(role.id),
            "name": role.name,
            "permission_codes": [
                "inspection_task.read",
                "project_member.manage",
            ],
        }
    ]
    assert {
        item["action"]: item["allowed"] for item in body["diagnostics"]
    } == {
        "task_list": True,
        "create_project": True,
        "manage_template_library": True,
        "manage_project_members": True,
    }
    assert all(item["missing_codes"] == [] for item in body["diagnostics"])

    revoke_module_permission(
        db_session,
        actor=admin,
        user=target,
        permission_code="inspection.use",
    )
    db_session.commit()
    task = next(
        item
        for item in client.get(_url(target.id, project.id)).json()[
            "diagnostics"
        ]
        if item["action"] == "task_list"
    )
    assert task["allowed"] is False
    assert task["missing_layers"] == ["module"]
    assert task["missing_codes"] == ["inspection.use"]
    assert "inspection_task.read" in {
        code
        for role_data in client.get(_url(target.id, project.id)).json()[
            "project_roles"
        ]
        for code in role_data["permission_codes"]
    }

    implicit = client.get(_url(admin_target.id, project.id))
    assert implicit.status_code == 200
    implicit_body = implicit.json()
    expected_codes = {
        code.value
        for code in PermissionCode
        if permission_code_scope(code.value) == "module"
    }
    assert {
        item["code"] for item in implicit_body["module_permissions"]
    } == expected_codes
    assert {
        item["source"] for item in implicit_body["module_permissions"]
    } == {"admin_implicit"}
    assert all(item["allowed"] for item in implicit_body["diagnostics"])
    admin_target.is_active = False
    db_session.commit()
    assert (
        client.get(_url(admin_target.id, project.id)).json()["user"][
            "is_active"
        ]
        is False
    )

    external_response = client.get(_url(external.id, project.id))
    assert external_response.status_code == 200
    assert external_response.json()["module_permissions"] == []
    assert external_response.json()["project_roles"] == []
    assert all(
        not item["allowed"] for item in external_response.json()["diagnostics"]
    )
    assert {
        item["action"]: item["missing_codes"]
        for item in external_response.json()["diagnostics"]
    } == {
        "task_list": ["inspection.use", "inspection_task.read"],
        "create_project": ["project.create"],
        "manage_template_library": ["template.manage"],
        "manage_project_members": [
            "project.use",
            "project_member.manage",
        ],
    }


def test_delegate_scope_and_resource_errors(db_session, make_client):
    admin = _admin(db_session)
    project_delegate = _user(db_session, "project-delegate")
    inspection_delegate = _user(db_session, "inspection-delegate")
    template_delegate = _user(db_session, "template-delegate")
    ordinary = _user(db_session, "ordinary-user")
    target = _user(db_session, "scope-target")
    admin_target = _user(db_session, "scope-admin-target")
    admin_target.is_admin = True
    nonmember = _user(db_session, "nonmember-target")
    project = _project(db_session)
    role = create_role(
        db_session,
        name="範圍診斷角色",
        permission_codes=["project_member.manage"],
    )
    _member(db_session, project, target, [role.id], admin)
    _member(db_session, project, project_delegate, [], admin)
    _member(db_session, project, admin_target, [], admin)
    db_session.add_all(
        [
            UserModuleDelegation(
                user_id=project_delegate.id,
                module="project",
            ),
            UserModuleDelegation(
                user_id=inspection_delegate.id,
                module="inspection",
            ),
            UserModuleDelegation(
                user_id=template_delegate.id,
                module="template",
            ),
        ]
    )
    for code, source in (
        ("project.use", "manual"),
        ("project.create", "manual"),
        ("template.use", "manual"),
        ("template.manage", "manual"),
    ):
        db_session.add(
            UserModulePermission(
                user_id=target.id,
                permission_code=code,
                source=source,
            )
        )
    db_session.commit()

    project_client = _client_for(project_delegate, db_session, make_client)
    project_body = project_client.get(_url(target.id, project.id)).json()
    assert "project_roles" not in project_body
    assert {item["module"] for item in project_body["module_permissions"]} == {
        "project"
    }
    assert {item["action"] for item in project_body["diagnostics"]} == {
        "create_project",
        "manage_project_members",
    }
    assert all(item["allowed"] for item in project_body["diagnostics"])

    inspection_client = _client_for(
        inspection_delegate, db_session, make_client
    )
    inspection_body = inspection_client.get(_url(target.id, project.id)).json()
    assert "project_roles" not in inspection_body
    assert inspection_body["module_permissions"] == []
    assert {item["action"] for item in inspection_body["diagnostics"]} == {
        "task_list"
    }
    assert inspection_body["diagnostics"][0]["missing_codes"] == [
        "inspection.use",
        "inspection_task.read",
    ]

    template_client = _client_for(template_delegate, db_session, make_client)
    template_body = template_client.get(_url(target.id, project.id)).json()
    assert "project_roles" not in template_body
    assert {
        item["module"] for item in template_body["module_permissions"]
    } == {"template"}
    assert {item["action"] for item in template_body["diagnostics"]} == {
        "manage_template_library"
    }
    assert template_body["diagnostics"][0]["allowed"] is True

    denied = _client_for(ordinary, db_session, make_client).get(
        _url(target.id, project.id)
    )
    assert denied.status_code == 403
    admin_client = _client_for(admin, db_session, make_client)
    admin_target_response = admin_client.get(_url(admin_target.id, project.id))
    assert admin_target_response.status_code == 200
    assert admin_target_response.json()["user"]["is_admin"] is True
    self_response = project_client.get(_url(project_delegate.id, project.id))
    assert self_response.status_code == 200
    assert self_response.json()["user"]["is_admin"] is False
    denied_admin_target = project_client.get(_url(admin_target.id, project.id))
    assert denied_admin_target.status_code == 403
    assert denied_admin_target.json() == denied.json()
    assert "is_admin" not in denied_admin_target.text
    unlisted_admin = _user(db_session, "unlisted-admin-target")
    unlisted_admin.is_admin = True
    db_session.commit()
    denied_unlisted_admin = project_client.get(
        _url(unlisted_admin.id, project.id)
    )
    assert denied_unlisted_admin.status_code == 403
    assert denied_unlisted_admin.json() == denied.json()
    assert "is_admin" not in denied_unlisted_admin.text
    assert admin_client.get(_url(nonmember.id, project.id)).status_code == 404
    assert admin_client.get(_url(UUID(int=0), project.id)).status_code == 404
    assert admin_client.get(_url(target.id, uuid4())).status_code == 404
