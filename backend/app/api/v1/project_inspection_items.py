"""Project inspection item operations (TPL T4 and T6 API support)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import page
from app.api.time_format import format_utc
from app.api.v1.template_library import (
    template_item_detail,
    template_write_call,
)
from app.auth.access import (
    is_admin_or_system_role,
    require_admin_or_system_role,
    require_login_access,
    require_project_permission,
)
from app.auth.dependencies import get_db
from app.models import (
    Project,
    ProjectInspectionItem,
    SystemRoleCode,
    User,
)
from app.services.inspection_details import (
    project_inspection_item_details,
)
from app.services.permissions import calculate_effective_access
from app.services.project_templates import (
    DuplicateProjectItemError,
    apply_template,
    create_template_from_project_item,
)

router = APIRouter(prefix="/projects", tags=["project-inspection-items"])
_TEMPLATE_WRITE = Depends(
    require_admin_or_system_role(SystemRoleCode.TEMPLATE_ADMIN)
)


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
    try:
        result = apply_template(
            db,
            project_id=project_id,
            template_id=template_id,
            system_id=system_id,
        )
    except DuplicateProjectItemError as exc:
        raise APIError(
            ErrorCode.PROJECT_INSPECTION_ITEM_DUPLICATE_NAME,
            409,
            details=exc.names,
        ) from exc
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
    item = template_write_call(
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
    if not is_admin_or_system_role(db, user, SystemRoleCode.TEMPLATE_ADMIN):
        # 使用中央計算結果判斷成員資格，避免專案端點自行查 ProjectMember。
        access = calculate_effective_access(
            db, user_id=user.id, project_id=project_id
        )
        if project_id not in access.project_memberships:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    elif db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)

    return page(
        db,
        ProjectInspectionItem,
        cursor=cursor,
        limit=limit,
        filters=(ProjectInspectionItem.project_id == project_id,),
        serialize_batch=lambda items: project_inspection_item_details(
            db, items
        ),
    )
