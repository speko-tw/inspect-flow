"""Project inspection item operations (TPL T4 and T6 API support)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.time_format import format_utc
from app.api.v1.template_library import (
    _cursor_key,
    _encode_cursor,
    _write_call,
    template_item_detail,
)
from app.auth.access import (
    require_login_access,
    require_project_permission,
    require_system_role,
)
from app.auth.dependencies import get_db
from app.models import (
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectMember,
    ProjectNumericStandard,
    ProjectTextStandard,
    SystemRoleAssignment,
    SystemRoleCode,
    User,
)
from app.services.inspection_details import inspection_points_detail
from app.services.project_templates import (
    apply_template,
    create_template_from_project_item,
)

router = APIRouter(prefix="/projects", tags=["project-inspection-items"])
_TEMPLATE_WRITE = Depends(require_system_role(SystemRoleCode.TEMPLATE_ADMIN))


class ApplyTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    template_id: UUID | None = None
    system_id: UUID | None = None

    def selected_source(self) -> tuple[UUID | None, UUID | None]:
        if (self.template_id is None) == (self.system_id is None):
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        return self.template_id, self.system_id


class AppliedItemResponse(BaseModel):
    id: UUID
    project_id: UUID
    source_template_name: str
    applied_at: str


class CreateTemplateFromProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_inspection_item_id: UUID
    system_id: UUID


def _project_item_detail(db: Session, item: ProjectInspectionItem) -> dict:
    points = db.scalars(
        select(ProjectInspectionPoint)
        .where(ProjectInspectionPoint.project_inspection_item_id == item.id)
        .order_by(ProjectInspectionPoint.sequence, ProjectInspectionPoint.id)
    ).all()
    return {
        "id": item.id,
        "project_id": item.project_id,
        "sequence": item.sequence,
        "title": item.title,
        "instruction": item.instruction,
        "source_template_name": item.source_template_name,
        "applied_at": format_utc(item.applied_at),
        "inspection_points": inspection_points_detail(
            db,
            points,
            measurement_field_model=ProjectMeasurementField,
            text_standard_model=ProjectTextStandard,
            numeric_standard_model=ProjectNumericStandard,
            evidence_requirement_model=ProjectEvidenceRequirement,
        ),
    }


def _can_read_all_projects(db: Session, user: User) -> bool:
    if user.is_admin:
        return True
    return (
        db.scalar(
            select(SystemRoleAssignment.id).where(
                SystemRoleAssignment.user_id == user.id,
                SystemRoleAssignment.role_code
                == SystemRoleCode.TEMPLATE_ADMIN.value,
            )
        )
        is not None
    )


@router.post(
    "/{project_id}/inspection-items:apply-template",
    response_model=list[AppliedItemResponse],
    status_code=201,
    dependencies=[
        Depends(require_project_permission("project_inspection_item.edit"))
    ],
)
def apply_template_to_project(
    project_id: UUID,
    body: ApplyTemplateRequest,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008
) -> list[dict[str, object]]:
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    template_id, system_id = body.selected_source()
    result = apply_template(
        db,
        project_id=project_id,
        template_id=template_id,
        system_id=system_id,
    )
    if result is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    if system_id is not None and not result:
        response.status_code = 200
    return [
        {
            "id": item.id,
            "project_id": item.project_id,
            "source_template_name": item.source_template_name,
            "applied_at": format_utc(item.applied_at),
        }
        for item in result
    ]


@router.post(
    "/{project_id}/templates",
    status_code=201,
    dependencies=[_TEMPLATE_WRITE],
)
def save_project_item_as_template(
    project_id: UUID,
    body: CreateTemplateFromProjectRequest,
    db: Session = Depends(get_db),  # noqa: B008
) -> dict:
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    item = _write_call(
        create_template_from_project_item,
        db,
        project_id,
        body.project_inspection_item_id,
        body.system_id,
    )
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return template_item_detail(db, item)


@router.get(
    "/{project_id}/inspection-items",
)
def list_project_inspection_items(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),  # noqa: B008
    user: User = Depends(require_login_access),  # noqa: B008
) -> dict:
    if not _can_read_all_projects(db, user):
        membership = db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user.id,
            )
        )
        if membership is None:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    elif db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)

    key = _cursor_key(cursor)
    statement = select(ProjectInspectionItem).where(
        ProjectInspectionItem.project_id == project_id
    )
    if key is not None:
        statement = statement.where(
            (ProjectInspectionItem.created_at > key[0])
            | (
                (ProjectInspectionItem.created_at == key[0])
                & (ProjectInspectionItem.id > key[1])
            )
        )
    rows = db.scalars(
        statement.order_by(
            ProjectInspectionItem.created_at, ProjectInspectionItem.id
        ).limit(limit + 1)
    ).all()
    page = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = page[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)
    return {
        "items": [_project_item_detail(db, item) for item in page],
        "next_cursor": next_cursor,
    }
