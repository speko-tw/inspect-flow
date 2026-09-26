"""FastAPI application factory."""

from fastapi import FastAPI

from app.api.errors import register_error_handlers
from app.api.v1.auth import router as auth_router
from app.api.v1.health import router as health_router


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(health_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    return app


app = create_app()
