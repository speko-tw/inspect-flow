"""Project inspection item operations (TPL T4 and T6 API support)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.limits import TITLE_MAX
from app.api.pagination import page
from app.api.time_format import format_utc
from app.api.v1.template_library import (
    template_item_detail,
    template_write_call,
)
from app.auth.access import (
    require_login_access,
    require_module_and_project_permission,
    require_module_permission,
)
from app.auth.dependencies import get_db
from app.models import (
    Project,
    ProjectInspectionItem,
    User,
)
from app.services.inspection_details import (
    project_inspection_item_list_details,
)
from app.services.permissions import calculate_effective_access
from app.services.project_templates import (
    DuplicateProjectItemError,
    apply_template,
    create_template_from_project_item,
)

router = APIRouter(prefix="/projects", tags=["project-inspection-items"])
_TEMPLATE_WRITE = Depends(
    require_module_permission("template.manage"),
    scope="function",
)


class ApplyTemplateRequest(BaseModel):
    """限制請求只能從單一範本或系統套用，避免來源歧義。"""

    model_config = ConfigDict(extra="forbid")

    template_id: UUID | None = None
    system_id: UUID | None = None

    def selected_source(self) -> tuple[UUID | None, UUID | None]:
        """要求恰好一種來源；同時提供或都缺少時回 422。"""
        if (self.template_id is None) == (self.system_id is None):
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        return self.template_id, self.system_id


class AppliedItemResponse(BaseModel):
    """回傳專案副本與來源資訊，供辨認套用後的項目。"""

    id: UUID
    project_id: UUID
    source_template_name: str
    source_category_name: str | None
    source_system_name: str | None
    applied_at: str


class CreateTemplateFromProjectRequest(BaseModel):
    """指定欲存為範本的專案項目、目標系統及可選名稱。"""

    model_config = ConfigDict(extra="forbid")

    project_inspection_item_id: UUID
    system_id: UUID
    name: str | None = Field(default=None, max_length=TITLE_MAX)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, name: str | None) -> str | None:
        """保留既有欄位規則，並拒絕裁剪後的空白名稱。"""
        if name is None:
            return None
        normalized = name.strip()
        if not normalized:
            raise ValueError("name cannot be blank")
        return normalized


@router.post(
    "/{project_id}/inspection-items:apply-template",
    response_model=list[AppliedItemResponse],
    status_code=201,
    dependencies=[
        Depends(
            require_module_and_project_permission(
                "template.use", "project_inspection_item.edit"
            ),
            scope="function",
        ),
    ],
)
def apply_template_to_project(
    project_id: UUID,
    body: ApplyTemplateRequest,
    response: Response,
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> list[dict[str, object]]:
    """依 KD-47 複製範本到專案；不存在或名稱重複時拒絕。"""
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
            ErrorCode.PROJECT_INSPECTION_ITEM_INACTIVE_NAME
            if exc.inactive
            else ErrorCode.PROJECT_INSPECTION_ITEM_DUPLICATE_NAME,
            409,
            details=exc.names,
        ) from exc
    if result is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    # 空系統沒有建立資源，回 200 空清單，讓前端可區分套用成功與無項目。
    if system_id is not None and not result:
        response.status_code = 200
    return [
        {
            "id": item.id,
            "project_id": item.project_id,
            "source_template_name": item.source_template_name,
            "source_category_name": item.source_category_name,
            "source_system_name": item.source_system_name,
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
    db: Session = Depends(get_db, scope="function"),  # noqa
) -> dict:
    """將專案項目存回範本庫；缺管理權限或來源不存在時拒絕。"""
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    item = template_write_call(
        create_template_from_project_item,
        db,
        project_id,
        body.project_inspection_item_id,
        body.system_id,
        body.name,
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
    active_only: bool = False,
    db: Session = Depends(get_db, scope="function"),  # noqa
    user: User = Depends(require_login_access, scope="function"),  # noqa
) -> dict:
    """依 TPL-R09 允許專案成員或範本管理者讀取查核項目。"""
    access = calculate_effective_access(
        db, user_id=user.id, project_id=project_id
    )
    if (
        not access.is_admin
        and "template.manage" not in access.module_permissions
        and project_id not in access.project_memberships
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    can_edit_items = access.is_admin or (
        "inspection.use" in access.module_permissions
        and "project_inspection_item.edit"
        in access.project_permissions_by_project.get(project_id, frozenset())
    )

    return page(
        db,
        ProjectInspectionItem,
        cursor=cursor,
        limit=limit,
        filters=(ProjectInspectionItem.project_id == project_id,)
        + (
            (ProjectInspectionItem.is_active.is_(True),) if active_only else ()
        ),
        serialize_batch=lambda items: project_inspection_item_list_details(
            db, items, include_task_count=can_edit_items
        ),
    )
