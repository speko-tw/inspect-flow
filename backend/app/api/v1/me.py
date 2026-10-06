"""Endpoints about the logged-in user's own data (#290)."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.access import is_admin_or_system_role, require_login_access
from app.auth.dependencies import get_db
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    SystemRoleCode,
    User,
)

router = APIRouter(prefix="/me", tags=["me"])


class MyProjectResponse(BaseModel):
    """One project the current user takes part in, with the names of
    the roles the user holds in it (empty when the member has none).
    """

    id: UUID
    project_code: str
    name: str
    client_name: str
    site_location: str
    planned_start_date: date | None
    planned_completion_date: date | None
    role_names: list[str]


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
            )
        )
    return result


class MyPermissionsResponse(BaseModel):
    """What the current user may do across projects (#482)."""

    can_manage_templates: bool


@router.get("/permissions", response_model=MyPermissionsResponse)
def get_my_permissions(
    user: User = Depends(require_login_access),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> MyPermissionsResponse:
    """``can_manage_templates`` is true for Admin and for a holder of
    the fixed ``template_admin`` system role -- the same check that
    guards saving a project item as a template and listing all
    projects (TPL-R09).
    """
    return MyPermissionsResponse(
        can_manage_templates=is_admin_or_system_role(
            db, user, SystemRoleCode.TEMPLATE_ADMIN
        )
    )
