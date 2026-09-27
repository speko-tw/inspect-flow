"""Health check endpoint."""

from fastapi import APIRouter

from app.auth.access import PUBLIC

router = APIRouter()


@router.get("/health", dependencies=[PUBLIC])
def get_health() -> dict[str, str]:
    """Report service status.

    Does not read any environment variable or configuration
    value, so the response can never leak a secret.
    """
    return {"status": "ok"}
