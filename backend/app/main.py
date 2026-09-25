"""FastAPI application factory."""

from fastapi import FastAPI

from app.api.v1.health import router as health_router


def create_app() -> FastAPI:
    """Build and configure the FastAPI application."""
    app = FastAPI()
    app.include_router(health_router, prefix="/api/v1")
    return app


app = create_app()
