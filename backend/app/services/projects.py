"""Project write and lookup entry points (DOM-R14, DOM-R40-R44)."""

from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Project
from app.services import UNSET, _Unset
from app.services.operator import get_current_operator


class InvalidProjectFieldError(ValueError):
    """A submitted Project field failed model validation."""


class ProjectUnchangedError(ValueError):
    """An update contained no Project fields."""


def create_project(
    session: Session,
    *,
    project_code: str,
    name: str,
    client_name: str,
    site_location: str,
    planned_start_date: date | None = None,
    planned_completion_date: date | None = None,
) -> Project:
    """Create a Project and fill its audit operator fields (DOM-R14)."""
    fields: dict[str, object] = {
        "project_code": project_code,
        "name": name,
        "client_name": client_name,
        "site_location": site_location,
    }
    operator = get_current_operator(session)
    try:
        project = Project(
            **fields,
            planned_start_date=planned_start_date,
            planned_completion_date=planned_completion_date,
            created_by=operator.id,
            updated_by=operator.id,
        )
    except ValueError as exc:
        raise InvalidProjectFieldError from exc
    session.add(project)
    session.flush()
    return project


def update_project(
    session: Session,
    project: Project,
    *,
    project_code: str | _Unset = UNSET,
    name: str | _Unset = UNSET,
    client_name: str | _Unset = UNSET,
    site_location: str | _Unset = UNSET,
    planned_start_date: date | None | _Unset = UNSET,
    planned_completion_date: date | None | _Unset = UNSET,
) -> Project:
    """Update provided Project fields after validating all strings."""
    fields: dict[str, object] = {
        field: value
        for field, value in {
            "project_code": project_code,
            "name": name,
            "client_name": client_name,
            "site_location": site_location,
        }.items()
        if value is not UNSET
    }
    dates: dict[str, date | None] = {
        field: value
        for field, value in {
            "planned_start_date": planned_start_date,
            "planned_completion_date": planned_completion_date,
        }.items()
        if value is not UNSET
    }
    if not fields and not dates:
        raise ProjectUnchangedError("No Project fields were provided")
    operator = get_current_operator(session)
    fields.update(dates)
    candidate_values: dict[str, object] = {
        "project_code": project.project_code,
        "name": project.name,
        "client_name": project.client_name,
        "site_location": project.site_location,
        "planned_start_date": project.planned_start_date,
        "planned_completion_date": project.planned_completion_date,
        "created_by": project.created_by,
        "updated_by": project.updated_by,
    }
    candidate_values.update(fields)
    try:
        Project(**candidate_values)
    except ValueError as exc:
        raise InvalidProjectFieldError from exc
    for field, value in fields.items():
        setattr(project, field, value)
    project.updated_by = operator.id
    session.flush()
    return project


def find_projects_by_code(
    session: Session, project_code: str
) -> Sequence[Project]:
    """Return every project with this code without changing rows."""
    with session.no_autoflush:
        return session.scalars(
            select(Project).where(Project.project_code == project_code)
        ).all()


__all__ = [
    "InvalidProjectFieldError",
    "ProjectUnchangedError",
    "create_project",
    "find_projects_by_code",
    "update_project",
]
