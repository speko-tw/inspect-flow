"""Contract tests for AUT-R18's route access-level declarations
(AUT-AC16) and AUT-R23's shared error-code registry (AUT-AC22).
"""

from fastapi import APIRouter, Depends, FastAPI

from app.api.errors import (
    ErrorCode,
    build_error_code_descriptions,
    register_error_handlers,
)
from app.auth.access import (
    PUBLIC,
    PUBLIC_ROUTES,
    AccessLevel,
    declared_public_routes,
    iter_route_access,
    require_admin,
    undeclared_routes,
)
from app.main import create_app
from tests.contract.test_error_envelope import DOT_NAMESPACE_RE


def test_aut_ac16_every_business_route_has_exactly_one_declaration() -> None:
    """AUT-AC16: every business route mounted on the real
    application (the same scope API-AC01 walks) carries exactly one
    access-level declaration.
    """
    app = create_app()

    assert undeclared_routes(app) == []


def test_aut_ac16_public_routes_match_the_registered_allowlist() -> None:
    """AUT-AC16: the routes declared 公開 on the real application are
    exactly the registered health, login, logout and first-setup routes.
    """
    app = create_app()

    assert declared_public_routes(app) == PUBLIC_ROUTES
    assert PUBLIC_ROUTES == frozenset(
        {
            ("GET", "/api/v1/health"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
            ("GET", "/api/v1/setup/status"),
            ("POST", "/api/v1/setup/admin-password"),
        }
    )


def test_aut_ac16_an_undeclared_route_fails_and_names_its_path() -> None:
    """AUT-AC16: a route mounted with no access-level declaration at
    all fails the check, and the failure names that route's method
    and path.
    """
    app = FastAPI()
    register_error_handlers(app)

    @app.get("/api/v1/test/undeclared-probe")
    def undeclared_probe() -> dict[str, bool]:
        return {"ok": True}

    assert undeclared_routes(app) == ["GET /api/v1/test/undeclared-probe"]


def test_aut_ac16_admin_at_include_level_uncovers_declaration() -> None:
    """AUT-AC16 (reviewer regression): a route that declares 公開 at
    the route level, then gets an Admin check pinned on via
    ``app.include_router(..., dependencies=[...])``, must be treated
    as *not* declared -- two access-level markers now apply to the
    same route, even though the original ``APIRoute``'s own
    ``.dependant`` only ever saw the route-level one (the
    include-level one never reaches it; see
    ``app/auth/access.py``'s module docstring).
    """
    router = APIRouter()

    @router.get("/api/v1/test/public-then-admin-gated", dependencies=[PUBLIC])
    def public_then_admin_gated() -> dict[str, bool]:
        return {"ok": True}

    app = FastAPI()
    app.include_router(router, dependencies=[Depends(require_admin)])

    assert "GET /api/v1/test/public-then-admin-gated" in undeclared_routes(app)
    assert (
        "GET",
        "/api/v1/test/public-then-admin-gated",
    ) not in declared_public_routes(app)


def test_aut_ac16_include_level_dependency_alone_counts_as_declared() -> None:
    """AUT-AC16 (reviewer regression): a route with no dependency of
    its own, mounted via ``app.include_router(..., dependencies=
    [Depends(require_admin)])``, is recognized as declaring 需
    Admin -- a declaration living entirely at the include level still
    counts.
    """
    router = APIRouter()

    @router.get("/api/v1/test/admin-only-via-include")
    def admin_only_via_include() -> dict[str, bool]:
        return {"ok": True}

    app = FastAPI()
    app.include_router(router, dependencies=[Depends(require_admin)])

    infos = [
        info
        for info in iter_route_access(app)
        if info.path == "/api/v1/test/admin-only-via-include"
    ]
    assert len(infos) == 1
    assert infos[0].declaration is not None
    assert infos[0].declaration.level is AccessLevel.ADMIN_REQUIRED


def test_issue_275_routes_declare_the_specified_access_levels() -> None:
    app = create_app()
    routes = {
        (info.method, info.path): info.declaration
        for info in iter_route_access(app)
        if info.path.startswith("/api/v1/projects")
    }
    admin_routes = {
        ("GET", "/api/v1/projects/{project_id}"),
        ("POST", "/api/v1/projects"),
        ("PATCH", "/api/v1/projects/{project_id}"),
    }
    template_admin_list = ("GET", "/api/v1/projects")
    member_routes = {
        ("GET", "/api/v1/projects/{project_id}/members"),
        ("POST", "/api/v1/projects/{project_id}/members"),
        (
            "PUT",
            "/api/v1/projects/{project_id}/members/{user_id}/roles",
        ),
        ("DELETE", "/api/v1/projects/{project_id}/members/{user_id}"),
    }
    apply_template = (
        "POST",
        "/api/v1/projects/{project_id}/inspection-items:apply-template",
    )

    assert set(routes) == admin_routes | member_routes | {
        template_admin_list,
        apply_template,
    }
    for route in admin_routes:
        declaration = routes[route]
        assert declaration is not None
        assert declaration.level is AccessLevel.ADMIN_REQUIRED
    declaration = routes[template_admin_list]
    assert declaration is not None
    assert declaration.level is AccessLevel.ADMIN_OR_SYSTEM_ROLE
    assert declaration.permission_code == "template_admin"
    for route in member_routes:
        declaration = routes[route]
        assert declaration is not None
        assert declaration.level is AccessLevel.PROJECT_PERMISSION
        assert declaration.permission_code == "project_member.manage"
    declaration = routes[apply_template]
    assert declaration is not None
    assert declaration.level is AccessLevel.PROJECT_PERMISSION
    assert declaration.permission_code == "project_inspection_item.edit"


def test_system_role_assignment_routes_require_admin() -> None:
    app = create_app()
    routes = {
        (info.method, info.path): info.declaration
        for info in iter_route_access(app)
        if info.path.startswith("/api/v1/system-role-assignments/")
    }
    expected = {
        (
            "PUT",
            "/api/v1/system-role-assignments/template_admin/{user_id}",
        ),
        (
            "DELETE",
            "/api/v1/system-role-assignments/template_admin/{user_id}",
        ),
    }

    assert set(routes) == expected
    for route in expected:
        declaration = routes[route]
        assert declaration is not None
        assert declaration.level is AccessLevel.ADMIN_REQUIRED


def test_template_library_routes_declare_read_and_write_access() -> None:
    app = create_app()
    routes = {
        (info.method, info.path): info.declaration
        for info in iter_route_access(app)
        if info.path.startswith(
            (
                "/api/v1/template-categories",
                "/api/v1/template-systems",
                "/api/v1/templates",
            )
        )
    }
    assert len(routes) == 15
    for (method, _path), declaration in routes.items():
        assert declaration is not None
        if method == "GET":
            assert declaration.level is (
                AccessLevel.SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION
            )
            assert declaration.system_role_code == "template_admin"
            assert (
                declaration.permission_code == "project_inspection_item.edit"
            )
        else:
            assert declaration.level is AccessLevel.SYSTEM_ROLE_REQUIRED
            assert declaration.permission_code == "template_admin"


def test_aut_ac22_error_code_registry_has_the_three_access_codes() -> None:
    """AUT-AC22: ``auth.not_authenticated``,
    ``auth.invalid_credentials`` and ``permission.denied`` are all
    registered in the shared ``ErrorCode`` enum and its generated
    description table, and every code in it follows the
    dot-namespace pattern (API-AC09).
    """
    descriptions = build_error_code_descriptions(ErrorCode)

    for member in (
        ErrorCode.AUTH_NOT_AUTHENTICATED,
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        ErrorCode.PERMISSION_DENIED,
    ):
        assert member.value in descriptions

    for code in descriptions:
        assert DOT_NAMESPACE_RE.match(code)


def test_issue_290_my_projects_route_requires_login() -> None:
    app = create_app()
    declarations = {
        (info.method, info.path): info.declaration
        for info in iter_route_access(app)
        if info.path.startswith("/api/v1/me")
    }

    assert set(declarations) == {("GET", "/api/v1/me/projects")}
    declaration = declarations[("GET", "/api/v1/me/projects")]
    assert declaration is not None
    assert declaration.level is AccessLevel.LOGIN_REQUIRED
