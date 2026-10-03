"""FastAPI application factory."""

from fastapi import Depends, FastAPI

from app.api.errors import register_error_handlers
from app.api.v1.auth import router as auth_router
from app.api.v1.companies import router as companies_router
from app.api.v1.health import router as health_router
from app.api.v1.me import router as me_router
from app.api.v1.projects import router as projects_router
from app.api.v1.roles import router as roles_router
from app.api.v1.setup import router as setup_router
from app.api.v1.system_role_assignments import (
    router as system_role_assignments_router,
)
from app.api.v1.users import router as users_router
from app.auth.dependencies import bind_request_scope
from app.auth.settings import validate_auth_settings


def create_app() -> FastAPI:
    """Build and configure the FastAPI application.

    Every route runs with ``Depends(bind_request_scope)`` applied at
    the app level (rather than each router/route declaring it), so a
    route that forgets to depend on it -- directly or through
    ``require_login`` -- cannot happen: T5's ``get_current_operator``
    would otherwise treat such a route as "not a request" and fall
    back to the built-in ``admin`` instead of rejecting an
    unauthenticated write (AUT-R09).
    """
    validate_auth_settings()
    app = FastAPI(dependencies=[Depends(bind_request_scope)])
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(me_router, prefix="/api/v1")
    app.include_router(projects_router, prefix="/api/v1")
    app.include_router(roles_router, prefix="/api/v1")
    app.include_router(setup_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    app.include_router(companies_router, prefix="/api/v1")
    app.include_router(system_role_assignments_router, prefix="/api/v1")
    return app


app = create_app()
