"""Project and project-member management API (DOM-R25, DOM-R40-R44)."""

from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import require_admin, require_project_permission
from app.auth.dependencies import get_db
from app.models import Company, Project, ProjectMember, Role, User
from app.services.project_members import (
    add_project_member,
    list_project_members,
    remove_project_member,
    set_project_member_roles,
)
from app.services.projects import (
    InvalidProjectFieldError,
    ProjectUnchangedError,
    create_project,
    find_projects_by_code,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])
_PROJECT_MEMBER_ACCESS = Depends(
    require_project_permission("project_member.manage")
)


class ProjectWarning(BaseModel):
    code: Literal["project_code.duplicate"]


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_code: str
    name: str
    client_name: str
    site_location: str
    planned_start_date: date | None
    planned_completion_date: date | None
    warnings: list[ProjectWarning] = Field(default_factory=list)


class CreateProjectRequest(BaseModel):
    project_code: str
    name: str
    client_name: str
    site_location: str
    planned_start_date: date | None = None
    planned_completion_date: date | None = None


class UpdateProjectRequest(BaseModel):
    project_code: str | None = None
    name: str | None = None
    client_name: str | None = None
    site_location: str | None = None
    planned_start_date: date | None = None
    planned_completion_date: date | None = None


class AddProjectMemberRequest(BaseModel):
    user_id: UUID
    role_ids: list[UUID] = Field(default_factory=list)


class SetProjectMemberRolesRequest(BaseModel):
    role_ids: list[UUID]


class ProjectMemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    username: str
    role_ids: list[UUID]


class ProjectMemberDetailResponse(ProjectMemberResponse):
    """A listed member with the user fields the management page shows."""

    name_zh: str | None
    email: str | None
    company_id: UUID | None
    company_name: str | None
    is_active: bool


def _get_project(db: Session, project_id: UUID) -> Project:
    project = db.get(Project, project_id)
    if project is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return project


def _get_member(db: Session, project_id: UUID, user_id: UUID) -> ProjectMember:
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    if member is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return member


def _project_response(project: Project, is_duplicate: bool) -> ProjectResponse:
    warnings = (
        [ProjectWarning(code="project_code.duplicate")] if is_duplicate else []
    )
    return ProjectResponse(
        id=project.id,
        project_code=project.project_code,
        name=project.name,
        client_name=project.client_name,
        site_location=project.site_location,
        planned_start_date=project.planned_start_date,
        planned_completion_date=project.planned_completion_date,
        warnings=warnings,
    )


def _single_project_response(db: Session, project: Project) -> ProjectResponse:
    duplicates = find_projects_by_code(db, project.project_code)
    return _project_response(project, len(duplicates) > 1)


def _member_response(
    db: Session, member: ProjectMember
) -> ProjectMemberResponse:
    user = db.get(User, member.user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return ProjectMemberResponse(
        id=member.id,
        user_id=user.id,
        username=user.username,
        role_ids=sorted(
            assignment.role_id for assignment in member.role_assignments
        ),
    )


def _member_detail_response(
    member: ProjectMember, user: User, company: Company | None
) -> ProjectMemberDetailResponse:
    return ProjectMemberDetailResponse(
        id=member.id,
        user_id=user.id,
        username=user.username,
        role_ids=sorted(
            assignment.role_id for assignment in member.role_assignments
        ),
        name_zh=user.name_zh,
        email=user.email,
        company_id=user.company_id,
        company_name=company.name if company is not None else None,
        is_active=user.is_active,
    )


def _checked_role_ids(db: Session, role_ids: list[UUID]) -> list[UUID]:
    if len(set(role_ids)) != len(role_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    roles = set(
        db.scalars(select(Role.id).where(Role.id.in_(set(role_ids)))).all()
    )
    if roles != set(role_ids):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return role_ids


def _member_conflict(exc: IntegrityError) -> bool:
    constraint = getattr(
        getattr(exc.orig, "diag", None), "constraint_name", None
    )
    details = str(exc.orig).lower()
    return constraint == "uq_project_members_project_id" or (
        "project_members.project_id, project_members.user_id" in details
    )


@router.get(
    "",
    response_model=list[ProjectResponse],
    dependencies=[Depends(require_admin)],
)
def list_projects(
    db: Session = Depends(get_db),  # noqa: B008
) -> list[ProjectResponse]:
    projects = db.scalars(
        select(Project).order_by(Project.name, Project.id)
    ).all()
    duplicate_codes = set(
        db.scalars(
            select(Project.project_code)
            .group_by(Project.project_code)
            .having(func.count(Project.id) > 1)
        )
    )
    return [
        _project_response(project, project.project_code in duplicate_codes)
        for project in projects
    ]


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
    dependencies=[Depends(require_admin)],
)
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectResponse:
    return _single_project_response(db, _get_project(db, project_id))


@router.post(
    "",
    response_model=ProjectResponse,
    status_code=201,
    dependencies=[Depends(require_admin)],
)
def add_project(
    body: CreateProjectRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectResponse:
    try:
        project = create_project(db, **body.model_dump())
    except InvalidProjectFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    return _single_project_response(db, project)


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    dependencies=[Depends(require_admin)],
)
def edit_project(
    project_id: UUID,
    body: UpdateProjectRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectResponse:
    project = _get_project(db, project_id)
    fields = body.model_dump(exclude_unset=True)
    if any(
        fields.get(field, "set") is None
        for field in (
            "project_code",
            "name",
            "client_name",
            "site_location",
        )
    ):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        update_project(db, project, **fields)
    except (InvalidProjectFieldError, ProjectUnchangedError) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    return _single_project_response(db, project)


@router.get(
    "/{project_id}/members",
    response_model=list[ProjectMemberDetailResponse],
    dependencies=[_PROJECT_MEMBER_ACCESS],
)
def list_members(
    project_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> list[ProjectMemberDetailResponse]:
    """List a project's members (not paginated; the count is small)."""
    _get_project(db, project_id)
    members = list_project_members(db, project_id)
    if not members:
        return []
    user_rows = db.execute(
        select(User, Company)
        .outerjoin(Company, Company.id == User.company_id)
        .where(User.id.in_(member.user_id for member in members))
    ).all()
    users = {user.id: (user, company) for user, company in user_rows}
    if any(member.user_id not in users for member in members):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return [
        _member_detail_response(member, *users[member.user_id])
        for member in members
    ]


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=201,
    dependencies=[_PROJECT_MEMBER_ACCESS],
)
def add_member(
    project_id: UUID,
    body: AddProjectMemberRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectMemberResponse:
    _get_project(db, project_id)
    user = db.get(User, body.user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    role_ids = _checked_role_ids(db, body.role_ids)
    try:
        member = add_project_member(
            db,
            project_id=project_id,
            user_id=user.id,
            role_ids=role_ids,
        )
    except IntegrityError as exc:
        if not _member_conflict(exc):
            raise
        raise APIError(ErrorCode.PROJECT_MEMBER_CONFLICT, 409) from exc
    return _member_response(db, member)


@router.put(
    "/{project_id}/members/{user_id}/roles",
    response_model=ProjectMemberResponse,
    dependencies=[_PROJECT_MEMBER_ACCESS],
)
def edit_member_roles(
    project_id: UUID,
    user_id: UUID,
    body: SetProjectMemberRolesRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectMemberResponse:
    member = _get_member(db, project_id, user_id)
    role_ids = _checked_role_ids(db, body.role_ids)
    set_project_member_roles(db, member, role_ids)
    return _member_response(db, member)


@router.delete(
    "/{project_id}/members/{user_id}",
    status_code=204,
    dependencies=[_PROJECT_MEMBER_ACCESS],
)
def remove_member(
    project_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
) -> None:
    member = _get_member(db, project_id, user_id)
    remove_project_member(db, member)


__all__ = ["router"]
