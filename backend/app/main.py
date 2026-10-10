"""FastAPI application factory."""

import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.api.errors import register_error_handlers
from app.api.v1.audit_logs import router as audit_logs_router
from app.api.v1.auth import router as auth_router
from app.api.v1.companies import router as companies_router
from app.api.v1.health import router as health_router
from app.api.v1.inspection_planning import router as inspection_planning_router
from app.api.v1.me import router as me_router
from app.api.v1.project_inspection_items import (
    router as project_inspection_items_router,
)
from app.api.v1.projects import router as projects_router
from app.api.v1.roles import router as roles_router
from app.api.v1.setup import router as setup_router
from app.api.v1.system_role_assignments import (
    router as system_role_assignments_router,
)
from app.api.v1.template_library import (
    category_router,
    system_router,
    template_router,
)
from app.api.v1.users import router as users_router
from app.api.v1.version import router as version_router
from app.auth.dependencies import bind_request_scope
from app.auth.settings import validate_auth_settings
from app.version import release_identity

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.propagate = False


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

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("%s", release_identity())
        yield

    app = FastAPI(
        dependencies=[Depends(bind_request_scope)], lifespan=lifespan
    )
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(version_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(audit_logs_router, prefix="/api/v1")
    app.include_router(me_router, prefix="/api/v1")
    app.include_router(projects_router, prefix="/api/v1")
    app.include_router(project_inspection_items_router, prefix="/api/v1")
    app.include_router(inspection_planning_router, prefix="/api/v1")
    app.include_router(roles_router, prefix="/api/v1")
    app.include_router(setup_router, prefix="/api/v1")
    app.include_router(users_router, prefix="/api/v1")
    app.include_router(companies_router, prefix="/api/v1")
    app.include_router(system_role_assignments_router, prefix="/api/v1")
    app.include_router(category_router, prefix="/api/v1")
    app.include_router(system_router, prefix="/api/v1")
    app.include_router(template_router, prefix="/api/v1")
    return app


app = create_app()
