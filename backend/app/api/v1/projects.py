"""Project and project-member management API (DOM-R25, DOM-R40-R44)."""

from collections.abc import Sequence
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.batch import (
    MAX_BATCH_ITEMS,
    BatchLimitedRequest,
    require_batch_size,
)
from app.api.errors import APIError, ErrorCode, FieldErrorCode
from app.api.pagination import ilike_contains, page, page_by_text_key
from app.auth.access import (
    require_login_access,
    require_module_permission,
    require_project_permission,
)
from app.auth.dependencies import get_db
from app.company_roles import DEFAULT_COMPANY_ROLE
from app.models import (
    Company,
    Project,
    ProjectMember,
    Role,
    RolePermission,
    User,
)
from app.services.account_status import effectively_active_user_clause
from app.services.inspection_planning import PlanningError
from app.services.module_permissions import (
    ExternalRoleAssignmentError,
    InactiveProjectMemberError,
    InvalidCreatorRoleUserError,
    LastProjectManagerError,
    RoleNotAssignableError,
    SelfRoleChangeError,
    query_people_access,
)
from app.services.permissions import calculate_effective_access
from app.services.project_members import (
    add_project_member,
    list_project_members,
    remove_project_member,
    set_project_member_roles,
)
from app.services.project_workflow_summary import get_project_workflow_summary
from app.services.projects import (
    COMPANY_ROLE_REASON_MAX_LENGTH,
    CompanyRoleReasonRequiredError,
    CompanyRoleReasonTooLongError,
    InvalidCompanyRoleError,
    InvalidProjectFieldError,
    ProjectUnchangedError,
    count_active_project_members,
    create_project,
    find_projects_by_code,
    update_project,
)

router = APIRouter(prefix="/projects", tags=["projects"])
_PROJECT_PLANNING_READ_ACCESS = Depends(
    require_project_permission("project.read"), scope="function"
)
_PROJECT_UPDATE_ACCESS = require_project_permission("project.update")
_PROJECT_MEMBER_ACCESS = Depends(
    require_project_permission(
        "project_member.manage", uuid_path_params=("user_id",)
    ),
    scope="function",
)
_PROJECT_CREATE_ACCESS = require_module_permission("project.create")


class ProjectWarning(BaseModel):
    code: Literal["project_code.duplicate"]


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    project_code: str
    name: str
    client_name: str
    site_location: str
    # DOM-R76：本公司在這個案子的角色（登記表的值）。
    company_role: str
    planned_start_date: date | None
    planned_completion_date: date | None
    warnings: list[ProjectWarning] = Field(default_factory=list)


class ProjectListItemResponse(ProjectResponse):
    """ADM-AC09 專案清單列出的欄位與啟用成員數。"""

    member_count: int


class ProjectPlanningResponse(BaseModel):
    id: UUID
    project_code: str
    name: str
    company_role: str
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
    # IP-R11、ADM-R41：專案首頁顯示本公司角色，免另呼叫專案詳情。
    company_role: str


class ProjectWorkflowSummaryResponse(BaseModel):
    project: WorkflowProjectIdentity
    viewer_permission_codes: list[str]
    can_apply_templates: bool
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
    items: list[ProjectListItemResponse]
    next_cursor: str | None


class CreateProjectRequest(BaseModel):
    project_code: str
    name: str
    client_name: str
    site_location: str
    # DOM-R76：省略為 contractor；帶 null 或未登記的值回 422。
    company_role: str | None = DEFAULT_COMPANY_ROLE
    planned_start_date: date | None = None
    planned_completion_date: date | None = None
    creator_role_user_id: UUID | None = None


def _strip_reason(value: object) -> object:
    """非字串原樣交給 Pydantic 報型別錯誤；字串先去除前後空白。"""
    return value.strip() if isinstance(value, str) else value


class UpdateProjectRequest(BaseModel):
    project_code: str | None = None
    name: str | None = None
    client_name: str | None = None
    site_location: str | None = None
    company_role: str | None = None
    # DOM-R76：改角色必填原因。先去除前後空白再套長度上限，所以：
    # - 全空白的原因不論多長，都變成空字串、由 Service 回專用錯誤碼
    #   ``project.company_role_reason_required``，不會被長度上限先擋成
    #   一般驗證錯誤；
    # - 去空白後超過 256 字元由 Pydantic 回帶欄位指標的 422
    #   （``/company_role_change_reason``），錯誤顯示在原因欄旁（ADM-R28）。
    company_role_change_reason: Annotated[
        str | None, BeforeValidator(_strip_reason)
    ] = Field(default=None, max_length=COMPANY_ROLE_REASON_MAX_LENGTH)
    planned_start_date: date | None = None
    planned_completion_date: date | None = None


class AddProjectMemberRequest(BaseModel):
    user_id: UUID
    role_ids: list[UUID] = Field(default_factory=list, max_length=64)


class SetProjectMemberRolesRequest(BaseModel):
    role_ids: list[UUID] = Field(max_length=64)


class BatchProjectMemberRoleItem(BaseModel):
    user_id: UUID
    role_ids: list[UUID] = Field(max_length=64)


class BatchProjectMemberRolesRequest(BatchLimitedRequest):
    items: list[BatchProjectMemberRoleItem] = Field(max_length=MAX_BATCH_ITEMS)


class ProjectMemberResponse(BaseModel):
    id: UUID
    user_id: UUID
    username: str
    role_ids: list[UUID]


class BatchProjectMemberRolesResponse(BaseModel):
    items: list[ProjectMemberResponse]


class ModuleStatusResponse(BaseModel):
    """只呈現專案與查核模組的可使用狀態（ADM-R26）。"""

    project_use: bool
    inspection_use: bool


class ProjectMemberDetailResponse(ProjectMemberResponse):
    """A listed member with the user fields the management page shows."""

    # 與 role_ids 同序。建立者角色等不可指派的角色不在可指派清單，
    # 前端無法自行對名；由後端直接附上，成員頁才不會顯示未知角色。
    role_names: list[str]
    name_zh: str | None
    email: str | None
    company_id: UUID | None
    company_name: str | None
    is_active: bool
    is_effectively_active: bool
    is_external_collaborator: bool
    module_status: ModuleStatusResponse


class MemberCandidateResponse(BaseModel):
    """可加入專案的人員及成員選擇畫面需要的最小欄位。"""

    id: UUID
    username: str
    name_zh: str | None
    company_name: str | None
    is_external_collaborator: bool
    module_status: ModuleStatusResponse


class MemberCandidateListResponse(BaseModel):
    items: list[MemberCandidateResponse]
    next_cursor: str | None


class AssignableRoleResponse(BaseModel):
    """A role that can be assigned; codes feed the plain-language text."""

    id: UUID
    name: str
    permission_codes: list[str]
    is_external_allowed: bool


class AssignableRoleListResponse(BaseModel):
    items: list[AssignableRoleResponse]
    next_cursor: str | None


def _company_role_field_error(exc: InvalidProjectFieldError) -> APIError:
    """把角色相關的欄位錯誤指到對應欄位（ADM-R28、API-R10）。

    前端據此把訊息放在角色欄或原因欄旁；其他欄位錯誤仍維持整體
    驗證失敗，不猜測位置。
    """
    if isinstance(exc, CompanyRoleReasonTooLongError):
        path, code = "/company_role_change_reason", FieldErrorCode.TOO_LONG
    else:
        path, code = "/company_role", FieldErrorCode.INVALID
    return APIError(
        ErrorCode.REQUEST_VALIDATION_FAILED,
        422,
        fields=[{"path": path, "code": code.value}],
    )


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
        company_role=project.company_role,
        planned_start_date=project.planned_start_date,
        planned_completion_date=project.planned_completion_date,
        warnings=warnings,
    )


def _project_list_responses(
    db: Session,
    projects: Sequence[Project],
    duplicate_codes: set[str],
) -> list[ProjectListItemResponse]:
    counts = count_active_project_members(
        db, {project.id for project in projects}
    )
    return [
        ProjectListItemResponse(
            **_project_response(
                project, project.project_code in duplicate_codes
            ).model_dump(),
            member_count=counts[project.id],
        )
        for project in projects
    ]


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
    member: ProjectMember,
    user: User,
    company: Company | None,
    is_effectively_active: bool,
    module_permissions: frozenset[str],
) -> ProjectMemberDetailResponse:
    ordered_assignments = sorted(
        member.role_assignments, key=lambda assignment: assignment.role_id
    )
    return ProjectMemberDetailResponse(
        id=member.id,
        user_id=user.id,
        username=user.username,
        role_ids=[a.role_id for a in ordered_assignments],
        role_names=[a.role.name for a in ordered_assignments],
        name_zh=user.name_zh,
        email=user.email,
        company_id=user.company_id,
        company_name=company.name if company is not None else None,
        is_active=user.is_active,
        is_effectively_active=is_effectively_active,
        is_external_collaborator=user.is_external_collaborator,
        module_status=_module_status(module_permissions),
    )


def _member_candidate_responses(
    db: Session, users: Sequence[User]
) -> list[MemberCandidateResponse]:
    """批次組裝候選人的顯示欄位，避免逐筆查詢公司與模組權限。"""
    user_ids = {user.id for user in users}
    company_ids = {user.company_id for user in users if user.company_id}
    companies = {
        company.id: company.name
        for company in db.scalars(
            select(Company).where(Company.id.in_(company_ids))
        )
    }
    access_by_user = query_people_access(db, user_ids=user_ids)
    return [
        MemberCandidateResponse(
            id=user.id,
            username=user.username,
            name_zh=user.name_zh,
            company_name=(
                companies.get(user.company_id) if user.company_id else None
            ),
            is_external_collaborator=user.is_external_collaborator,
            module_status=_module_status(
                access_by_user[user.id].module_permissions
            ),
        )
        for user in users
    ]


def _module_status(codes: frozenset[str]) -> ModuleStatusResponse:
    return ModuleStatusResponse(
        project_use="project.use" in codes,
        inspection_use="inspection.use" in codes,
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
        Depends(
            require_module_permission("template.manage"),
            scope="function",
        )
    ],
)
def list_projects(
    q: str | None = Query(default=None, max_length=256),
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db, scope="function"),  # noqa
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
        serialize_batch=lambda projects: _project_list_responses(
            db, projects, duplicate_codes
        ),
        filters=filters,
    )
    return ProjectListResponse(**result)


@router.get("/{project_id}")
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    user: User = _PROJECT_PLANNING_READ_ACCESS,
) -> ProjectResponse | ProjectPlanningResponse:
    """回傳專案基本資料；有有效修改權者可讀完整欄位（DOM-R66）。"""
    project = _get_project(db, project_id)
    access = calculate_effective_access(
        db, user_id=user.id, project_id=project.id
    )
    if user.is_admin or (
        "project.update" in access.project_permissions
        and "project.use" in access.module_permissions
    ):
        return _single_project_response(db, project)
    return ProjectPlanningResponse(
        id=project.id,
        project_code=project.project_code,
        name=project.name,
        company_role=project.company_role,
        planned_start_date=project.planned_start_date,
        planned_completion_date=project.planned_completion_date,
    )


@router.get(
    "/{project_id}/workflow-summary",
    response_model=ProjectWorkflowSummaryResponse,
)
def get_workflow_summary(
    project_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    user: User = Depends(require_login_access, scope="function"),  # noqa
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
        can_apply_templates=summary["can_apply_templates"],
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
)
def add_project(
    body: CreateProjectRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
    caller: User = Depends(_PROJECT_CREATE_ACCESS, scope="function"),  # noqa
) -> ProjectResponse:
    if "creator_role_user_id" in body.model_fields_set and not caller.is_admin:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        project = create_project(db, **body.model_dump())
    except InvalidCreatorRoleUserError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    except ExternalRoleAssignmentError as exc:
        raise APIError(
            ErrorCode.PROJECT_EXTERNAL_ROLE_NOT_ALLOWED, 422
        ) from exc
    except InvalidCompanyRoleError as exc:
        raise _company_role_field_error(exc) from exc
    except InvalidProjectFieldError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    return _single_project_response(db, project)


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    dependencies=[Depends(_PROJECT_UPDATE_ACCESS, scope="function")],
)
def edit_project(
    project_id: UUID,
    body: UpdateProjectRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> ProjectResponse:
    """修改有有效專案權限的專案並記錄變更（DOM-R66）。"""
    project = _get_project(db, project_id)
    fields = body.model_dump(exclude_unset=True)
    if any(
        fields.get(field, "set") is None
        for field in (
            "project_code",
            "name",
            "client_name",
            "site_location",
            "company_role",
        )
    ):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    try:
        update_project(db, project, **fields)
    except CompanyRoleReasonRequiredError as exc:
        raise APIError(
            ErrorCode.PROJECT_COMPANY_ROLE_REASON_REQUIRED, 422
        ) from exc
    except (InvalidCompanyRoleError, CompanyRoleReasonTooLongError) as exc:
        raise _company_role_field_error(exc) from exc
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
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> list[ProjectMemberDetailResponse]:
    """List a project's members (not paginated; the count is small)."""
    _get_project(db, project_id)
    members = list_project_members(db, project_id)
    if not members:
        return []
    user_rows = db.execute(
        select(
            User,
            Company,
            effectively_active_user_clause().label("is_effectively_active"),
        )
        .outerjoin(Company, Company.id == User.company_id)
        .where(User.id.in_(member.user_id for member in members))
    ).all()
    users = {
        user.id: (user, company, is_effectively_active)
        for user, company, is_effectively_active in user_rows
    }
    if any(member.user_id not in users for member in members):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    access_by_user = query_people_access(
        db, user_ids={member.user_id for member in members}
    )
    return [
        _member_detail_response(
            member,
            *users[member.user_id],
            access_by_user[member.user_id].module_permissions,
        )
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
    q: str | None = Query(default=None, max_length=128),
    db: Session = Depends(get_db, scope="function"),  # noqa
    user: User = _PROJECT_MEMBER_ACCESS,
) -> MemberCandidateListResponse:
    """列出啟用、非系統帳號且尚未加入專案的人員，包含跨公司候選人。"""
    _get_project(db, project_id)
    filters = [
        User.is_active.is_(True),
        User.is_system.is_(False),
        ~exists().where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == User.id,
        ),
    ]
    if q:
        filters.append(
            or_(
                ilike_contains(User.username, q),
                ilike_contains(User.name_zh, q),
            )
        )
    result = page_by_text_key(
        db,
        User,
        sort_key=User.username,
        key_name="username",
        cursor=cursor,
        limit=limit,
        serialize_batch=lambda rows: _member_candidate_responses(db, rows),
        filters=filters,
    )
    return MemberCandidateListResponse(**result)


@router.get(
    "/{project_id}/assignable-roles",
    response_model=AssignableRoleListResponse,
)
def list_assignable_roles(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db, scope="function"),  # noqa
    _caller: User = _PROJECT_MEMBER_ACCESS,
) -> AssignableRoleListResponse:
    """List role definitions for the project member assignment UI.

    The dependency enforces project member management access before
    this function runs.
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
                id=role.id,
                name=role.name,
                permission_codes=codes[role.id],
                is_external_allowed=role.is_external_allowed,
            )
            for role in roles
        ]

    role_filters = [] if _caller.is_admin else [Role.is_assignable.is_(True)]
    result = page(
        db,
        Role,
        cursor=cursor,
        limit=limit,
        filters=role_filters,
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
    db: Session = Depends(get_db, scope="function"),  # noqa
    caller: User = _PROJECT_MEMBER_ACCESS,
) -> ProjectMemberResponse:
    _get_project(db, project_id)
    user = db.get(User, body.user_id)
    if user is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    if (
        db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
        is not None
    ):
        raise APIError(ErrorCode.PROJECT_MEMBER_CONFLICT, 409)
    role_ids = _checked_role_ids(db, body.role_ids)
    try:
        member = add_project_member(
            db,
            project_id=project_id,
            user_id=user.id,
            role_ids=role_ids,
            actor_user_id=caller.id,
        )
    except IntegrityError as exc:
        if not _member_conflict(exc):
            raise
        raise APIError(ErrorCode.PROJECT_MEMBER_CONFLICT, 409) from exc
    except ExternalRoleAssignmentError as exc:
        raise APIError(
            ErrorCode.PROJECT_EXTERNAL_ROLE_NOT_ALLOWED, 422
        ) from exc
    except RoleNotAssignableError as exc:
        raise APIError(ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE, 422) from exc
    except SelfRoleChangeError as exc:
        raise APIError(ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE, 422) from exc
    except InactiveProjectMemberError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    _require_roles(body.role_ids)
    return _member_response(db, member)


@router.put(
    "/{project_id}/members/{user_id}/roles",
    response_model=ProjectMemberResponse,
)
def edit_member_roles(
    project_id: UUID,
    user_id: UUID,
    body: SetProjectMemberRolesRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
    caller: User = _PROJECT_MEMBER_ACCESS,
) -> ProjectMemberResponse:
    member = _get_member(db, project_id, user_id)
    role_ids = _checked_role_ids(db, body.role_ids)
    try:
        set_project_member_roles(db, member, role_ids, actor_user_id=caller.id)
    except ExternalRoleAssignmentError as exc:
        raise APIError(
            ErrorCode.PROJECT_EXTERNAL_ROLE_NOT_ALLOWED, 422
        ) from exc
    except RoleNotAssignableError as exc:
        raise APIError(ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE, 422) from exc
    except SelfRoleChangeError as exc:
        raise APIError(ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE, 422) from exc
    except LastProjectManagerError as exc:
        raise APIError(ErrorCode.PROJECT_LAST_MANAGER, 422) from exc
    except InactiveProjectMemberError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
    _require_roles(body.role_ids)
    return _member_response(db, member)


@router.post(
    "/{project_id}/members:batch-roles",
    response_model=BatchProjectMemberRolesResponse,
)
def batch_edit_member_roles(
    project_id: UUID,
    body: BatchProjectMemberRolesRequest,
    db: Session = Depends(get_db, scope="function"),  # noqa
    caller: User = _PROJECT_MEMBER_ACCESS,
) -> BatchProjectMemberRolesResponse:
    """Replace selected member role sets atomically (ADM-R13)."""
    require_batch_size(len(body.items))
    _get_project(db, project_id)
    user_ids = [item.user_id for item in body.items]
    if not body.items or len(set(user_ids)) != len(user_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    for item in body.items:
        if len(set(item.role_ids)) != len(item.role_ids):
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        _require_roles(item.role_ids)

    members = list(
        db.scalars(
            select(ProjectMember)
            .options(selectinload(ProjectMember.role_assignments))
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id.in_(user_ids),
            )
            .order_by(ProjectMember.user_id)
            .with_for_update()
        )
    )
    members_by_user_id = {member.user_id: member for member in members}
    if set(members_by_user_id) != set(user_ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    role_ids = {role_id for item in body.items for role_id in item.role_ids}
    existing_role_ids = set(
        db.scalars(select(Role.id).where(Role.id.in_(role_ids))).all()
    )
    if existing_role_ids != role_ids:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    try:
        for item in sorted(body.items, key=lambda row: str(row.user_id)):
            set_project_member_roles(
                db,
                members_by_user_id[item.user_id],
                item.role_ids,
                actor_user_id=caller.id,
            )
    except ExternalRoleAssignmentError as exc:
        raise APIError(
            ErrorCode.PROJECT_EXTERNAL_ROLE_NOT_ALLOWED, 422
        ) from exc
    except RoleNotAssignableError as exc:
        raise APIError(ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE, 422) from exc
    except SelfRoleChangeError as exc:
        raise APIError(ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE, 422) from exc
    except LastProjectManagerError as exc:
        raise APIError(ErrorCode.PROJECT_LAST_MANAGER, 422) from exc
    except InactiveProjectMemberError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc

    updated_members = list(
        db.scalars(
            select(ProjectMember)
            .options(selectinload(ProjectMember.role_assignments))
            .where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id.in_(user_ids),
            )
        )
    )
    users = list(db.scalars(select(User).where(User.id.in_(user_ids))))
    usernames = {user.id: user.username for user in users}
    updated_by_user_id = {member.user_id: member for member in updated_members}
    return BatchProjectMemberRolesResponse(
        items=[
            ProjectMemberResponse(
                id=updated_by_user_id[user_id].id,
                user_id=user_id,
                username=usernames[user_id],
                role_ids=sorted(
                    assignment.role_id
                    for assignment in updated_by_user_id[
                        user_id
                    ].role_assignments
                ),
            )
            for user_id in user_ids
        ]
    )


@router.delete(
    "/{project_id}/members/{user_id}",
    status_code=204,
)
def remove_member(
    project_id: UUID,
    user_id: UUID,
    db: Session = Depends(get_db, scope="function"),  # noqa
    caller: User = _PROJECT_MEMBER_ACCESS,
) -> None:
    member = _get_member(db, project_id, user_id)
    try:
        remove_project_member(db, member, actor_user_id=caller.id)
    except RoleNotAssignableError as exc:
        raise APIError(ErrorCode.PROJECT_ROLE_NOT_ASSIGNABLE, 422) from exc
    except SelfRoleChangeError as exc:
        raise APIError(ErrorCode.PROJECT_MEMBER_SELF_ROLE_CHANGE, 422) from exc
    except LastProjectManagerError as exc:
        raise APIError(ErrorCode.PROJECT_LAST_MANAGER, 422) from exc


__all__ = ["router"]
