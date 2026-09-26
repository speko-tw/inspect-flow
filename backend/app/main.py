"""FastAPI application factory."""

from fastapi import Depends, FastAPI

from app.api.errors import register_error_handlers
from app.api.v1.auth import router as auth_router
from app.api.v1.health import router as health_router
from app.auth.dependencies import bind_request_scope


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
    app = FastAPI(dependencies=[Depends(bind_request_scope)])
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    return app


app = create_app()
