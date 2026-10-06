"""Endpoints about the logged-in user's own data (#290)."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.access import require_login_access
from app.auth.dependencies import get_db
from app.models import Project, ProjectMember, ProjectMemberRole, Role, User
from app.services.access_summary import (
    OFFICE_PERMISSION_CODES,
    permission_codes_by_project,
)

router = APIRouter(prefix="/me", tags=["me"])


class MyProjectResponse(BaseModel):
    """One project the current user takes part in, with the names of
    the roles the user holds in it (empty when the member has none).
    ``has_office_access`` is true when the user holds at least one
    office permission code in the project (#480); the office project
    list shows only those projects.
    """

    id: UUID
    project_code: str
    name: str
    client_name: str
    site_location: str
    planned_start_date: date | None
    planned_completion_date: date | None
    role_names: list[str]
    has_office_access: bool


@router.get("/projects", response_model=list[MyProjectResponse])
def list_my_projects(
    user: User = Depends(require_login_access),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> list[MyProjectResponse]:
    """Projects the current user is a member of (DOM-R25), ordered by
    project code, name, then id. Not paginated: one person's project
    count is small.
    """
    rows = db.execute(
        select(Project, ProjectMember.id)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(ProjectMember.user_id == user.id)
        .order_by(Project.project_code, Project.name, Project.id)
    ).all()
    codes_by_project = permission_codes_by_project(db, user_id=user.id)
    result: list[MyProjectResponse] = []
    for project, member_id in rows:
        role_names = db.scalars(
            select(Role.name)
            .join(ProjectMemberRole, ProjectMemberRole.role_id == Role.id)
            .where(ProjectMemberRole.project_member_id == member_id)
            .order_by(Role.name, Role.id)
        ).all()
        result.append(
            MyProjectResponse(
                id=project.id,
                project_code=project.project_code,
                name=project.name,
                client_name=project.client_name,
                site_location=project.site_location,
                planned_start_date=project.planned_start_date,
                planned_completion_date=project.planned_completion_date,
                role_names=list(role_names),
                has_office_access=bool(
                    codes_by_project.get(project.id, frozenset())
                    & OFFICE_PERMISSION_CODES
                ),
            )
        )
    return result
