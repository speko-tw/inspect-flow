"""Public release version endpoint."""

from fastapi import APIRouter

from app.auth.access import PUBLIC
from app.version import get_commit, get_version

router = APIRouter()


@router.get("/version", dependencies=[PUBLIC])
def get_release_version() -> dict[str, str | None]:
    """Return only the release version and optional source commit."""
    return {"version": get_version(), "commit": get_commit()}
