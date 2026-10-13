"""Endpoints about the logged-in user's own data (#290)."""

from collections import defaultdict
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
    INSPECTION_OFFICE_PERMISSION_CODES,
    PROJECT_OFFICE_PERMISSION_CODES,
)
from app.services.permissions import calculate_effective_access

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
    access = calculate_effective_access(db, user_id=user.id)
    codes_by_project = access.project_permissions_by_project
    role_names_by_member: dict[UUID, list[str]] = defaultdict(list)
    if rows:
        member_ids = [member_id for _, member_id in rows]
        # 一次載入所有成員的角色，避免專案數增加時逐筆查詢造成 N+1
        # （#529）。
        role_rows = db.execute(
            select(ProjectMemberRole.project_member_id, Role.name)
            .join(Role, ProjectMemberRole.role_id == Role.id)
            .where(ProjectMemberRole.project_member_id.in_(member_ids))
            .order_by(
                ProjectMemberRole.project_member_id,
                Role.name,
                Role.id,
            )
        ).all()
        for member_id, role_name in role_rows:
            role_names_by_member[member_id].append(role_name)

    result: list[MyProjectResponse] = []
    for project, member_id in rows:
        project_codes = codes_by_project.get(project.id, frozenset())
        result.append(
            MyProjectResponse(
                id=project.id,
                project_code=project.project_code,
                name=project.name,
                client_name=project.client_name,
                site_location=project.site_location,
                planned_start_date=project.planned_start_date,
                planned_completion_date=project.planned_completion_date,
                role_names=role_names_by_member[member_id],
                has_office_access=bool(
                    project_codes
                    & (
                        PROJECT_OFFICE_PERMISSION_CODES
                        | INSPECTION_OFFICE_PERMISSION_CODES
                    )
                ),
            )
        )
    return result
