"""Contract tests for AUT-R18's route access-level declarations
(AUT-AC16) and AUT-R23's shared error-code registry (AUT-AC22).
"""

from fastapi import FastAPI

from app.api.errors import (
    ErrorCode,
    build_error_code_descriptions,
    register_error_handlers,
)
from app.auth.access import (
    PUBLIC_ROUTES,
    declared_public_routes,
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


def test_aut_ac16_public_routes_are_exactly_health_login_and_logout() -> None:
    """AUT-AC16: the routes declared 公開 on the real application are
    exactly the health check, login and logout -- nothing more,
    nothing less.
    """
    app = create_app()

    assert declared_public_routes(app) == PUBLIC_ROUTES
    assert PUBLIC_ROUTES == frozenset(
        {
            ("GET", "/api/v1/health"),
            ("POST", "/api/v1/auth/login"),
            ("POST", "/api/v1/auth/logout"),
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
