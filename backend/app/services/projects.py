"""Read-only Project lookup for duplicate-code warnings (DOM-R42)."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Project


def find_projects_by_code(
    session: Session, project_code: str
) -> Sequence[Project]:
    """Return every project with this code without changing rows."""
    with session.no_autoflush:
        return session.scalars(
            select(Project).where(Project.project_code == project_code)
        ).all()
