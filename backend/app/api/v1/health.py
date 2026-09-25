"""Health check endpoint."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def get_health() -> dict[str, str]:
    """Report service status.

    Does not read any environment variable or configuration
    value, so the response can never leak a secret.
    """
    return {"status": "ok"}
