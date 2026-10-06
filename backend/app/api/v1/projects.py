"""Project and project-member management API (DOM-R25, DOM-R40-R44)."""

from collections.abc import Sequence
from datetime import date
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import ilike_contains, page, page_by_text_key
from app.auth.access import (
    require_admin,
    require_admin_or_system_role,
    require_login_access,
    require_project_permission,
)
from app.auth.dependencies import get_db
from app.models import (
    Company,
    Project,
    ProjectMember,
    Role,
    RolePermission,
    SystemRoleCode,
    User,
)
from app.services.inspection_planning import PlanningError
from app.services.project_members import (
    add_project_member,
    list_project_members,
    remove_project_member,
    set_project_member_roles,
)
from app.services.project_workflow_summary import get_project_workflow_summary
from app.services.projects import (
    InvalidProjectFieldError,
    ProjectUnchangedError,
    create_project,
    find_projects_by_code,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])
_PROJECT_PLANNING_READ_ACCESS = Depends(
    require_project_permission("inspection_plan.read")
)
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


class ProjectPlanningResponse(BaseModel):
    id: UUID
    project_code: str
    name: str
    planned_start_date: date | None
    planned_completion_date: date | None


class WorkflowCount(BaseModel):
    code: str
    count: int
    pending: bool


class WorkflowTaskCounts(BaseModel):
    DRAFT: int
    PENDING: int
    IN_PROGRESS: int
    COMPLETED: int
    CANCELLED: int


class WorkflowProjectIdentity(BaseModel):
    id: UUID
    project_code: str
    name: str


class ProjectWorkflowSummaryResponse(BaseModel):
    project: WorkflowProjectIdentity
    viewer_permission_codes: list[str]
    member_count: int
    inspection_item_count: int
    zone_count: int
    plan_count: int
    task_counts: WorkflowTaskCounts
    task_counts_visible: bool
    pending_reinspection_task_count: int
    draft_tasks_missing_assignee: int
    primary_step: str | None
    next_steps: list[WorkflowCount]


class ProjectListResponse(BaseModel):
    items: list[ProjectResponse]
    next_cursor: str | None


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


class MemberCandidateResponse(BaseModel):
    """A user who can be added to the project (display fields only)."""

    id: UUID
    username: str
    name_zh: str | None


class MemberCandidateListResponse(BaseModel):
    items: list[MemberCandidateResponse]
    next_cursor: str | None


class AssignableRoleResponse(BaseModel):
    """A role that can be assigned; codes feed the plain-language text."""

    id: UUID
    name: str
    permission_codes: list[str]


class AssignableRoleListResponse(BaseModel):
    items: list[AssignableRoleResponse]
    next_cursor: str | None


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


def _require_roles(role_ids: list[UUID]) -> None:
    """ADM-R20: the API never creates or leaves a roleless member."""
    if not role_ids:
        raise APIError(ErrorCode.PROJECT_MEMBER_ROLES_REQUIRED, 422)


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
    response_model=ProjectListResponse,
    dependencies=[
        Depends(require_admin_or_system_role(SystemRoleCode.TEMPLATE_ADMIN))
    ],
)
def list_projects(
    q: str | None = Query(default=None, max_length=256),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),  # noqa: B008
) -> ProjectListResponse:
    filters = []
    query = (q or "").strip()
    if query:
        filters.append(
            or_(
                ilike_contains(Project.name, query),
                ilike_contains(Project.project_code, query),
            )
        )
    duplicate_codes = set(
        db.scalars(
            select(Project.project_code)
            .group_by(Project.project_code)
            .having(func.count(Project.id) > 1)
        )
    )
    result = page_by_text_key(
        db,
        Project,
        sort_key=Project.name,
        key_name="name",
        cursor=cursor,
        limit=limit,
        serialize=lambda project: _project_response(
            project, project.project_code in duplicate_codes
        ),
        filters=filters,
    )
    return ProjectListResponse(**result)


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
    user: User = _PROJECT_PLANNING_READ_ACCESS,
) -> ProjectResponse | ProjectPlanningResponse:
    project = _get_project(db, project_id)
    if user.is_admin:
        return _single_project_response(db, project)
    return ProjectPlanningResponse(
        id=project.id,
        project_code=project.project_code,
        name=project.name,
        planned_start_date=project.planned_start_date,
        planned_completion_date=project.planned_completion_date,
    )


@router.get(
    "/{project_id}/workflow-summary",
    response_model=ProjectWorkflowSummaryResponse,
)
def get_workflow_summary(
    project_id: UUID,
    db: Session = Depends(get_db),  # noqa: B008
    user: User = Depends(require_login_access),  # noqa: B008
) -> ProjectWorkflowSummaryResponse:
    """Return aggregate workflow counts to members with project read access."""
    if user.is_admin:
        _get_project(db, project_id)
    try:
        summary = get_project_workflow_summary(
            db,
            project_id=project_id,
        )
    except PlanningError as exc:
        if exc.code == "authorization.forbidden":
            raise APIError(ErrorCode.PERMISSION_DENIED, 403) from exc
        if exc.code == ErrorCode.RESOURCE_NOT_FOUND.value:
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404) from exc
        raise
    return ProjectWorkflowSummaryResponse(
        project=WorkflowProjectIdentity(**summary["project"]),
        viewer_permission_codes=summary["viewer_permission_codes"],
        member_count=summary["member_count"],
        inspection_item_count=summary["inspection_item_count"],
        zone_count=summary["zone_count"],
        plan_count=summary["plan_count"],
        task_counts=WorkflowTaskCounts(**summary["task_counts"]),
        task_counts_visible=summary["task_counts_visible"],
        pending_reinspection_task_count=(
            summary["pending_reinspection_task_count"]
        ),
        draft_tasks_missing_assignee=summary["draft_tasks_missing_assignee"],
        primary_step=summary["primary_step"],
        next_steps=[WorkflowCount(**step) for step in summary["next_steps"]],
    )


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


@router.get(
    "/{project_id}/member-candidates",
    response_model=MemberCandidateListResponse,
)
def list_member_candidates(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),  # noqa: B008
    user: User = _PROJECT_MEMBER_ACCESS,
) -> MemberCandidateListResponse:
    """List users who can still join the project.

    Active, non-system users who are not yet members. A non-Admin
    caller only sees users of their own company (nobody when the
    caller has no company); Admin sees every company.
    """
    _get_project(db, project_id)
    filters = [
        User.is_active.is_(True),
        User.is_system.is_(False),
        ~exists().where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == User.id,
        ),
    ]
    if not user.is_admin:
        if user.company_id is None:
            return MemberCandidateListResponse(items=[], next_cursor=None)
        filters.append(User.company_id == user.company_id)
    result = page_by_text_key(
        db,
        User,
        sort_key=User.username,
        key_name="username",
        cursor=cursor,
        limit=limit,
        serialize=lambda row: MemberCandidateResponse(
            id=row.id, username=row.username, name_zh=row.name_zh
        ),
        filters=filters,
    )
    return MemberCandidateListResponse(**result)


@router.get(
    "/{project_id}/assignable-roles",
    response_model=AssignableRoleListResponse,
    dependencies=[_PROJECT_MEMBER_ACCESS],
)
def list_assignable_roles(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),  # noqa: B008
) -> AssignableRoleListResponse:
    """List the roles that can be assigned to project members.

    Roles are system-wide (DOM-R19), so every role is assignable; this
    only exposes the fields the member page needs, one extra query per
    page for the permission codes.
    """
    _get_project(db, project_id)

    def render(roles: Sequence[Role]) -> list[AssignableRoleResponse]:
        codes: dict[UUID, list[str]] = {role.id: [] for role in roles}
        if codes:
            rows = db.execute(
                select(RolePermission.role_id, RolePermission.code)
                .where(RolePermission.role_id.in_(codes))
                .order_by(RolePermission.code)
            )
            for role_id, code in rows:
                codes[role_id].append(code)
        return [
            AssignableRoleResponse(
                id=role.id, name=role.name, permission_codes=codes[role.id]
            )
            for role in roles
        ]

    result = page(
        db,
        Role,
        cursor=cursor,
        limit=limit,
        serialize_batch=render,
    )
    return AssignableRoleListResponse(**result)


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=201,
)
def add_member(
    project_id: UUID,
    body: AddProjectMemberRequest,
    db: Session = Depends(get_db),  # noqa: B008
    caller: User = _PROJECT_MEMBER_ACCESS,
) -> ProjectMemberResponse:
    _get_project(db, project_id)
    user = db.get(User, body.user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    # Same rule as member-candidates: a non-Admin caller can only add
    # people of their own company (nobody without a company).
    if not caller.is_admin and (
        caller.company_id is None or user.company_id != caller.company_id
    ):
        raise APIError(ErrorCode.PROJECT_MEMBER_COMPANY_MISMATCH, 422)
    _require_roles(body.role_ids)
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
    _require_roles(body.role_ids)
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
