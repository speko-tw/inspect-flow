"""Project inspection item operations (TPL T4)."""

from uuid import UUID

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.time_format import format_utc
from app.auth.access import require_project_permission
from app.auth.dependencies import get_db
from app.models import Project
from app.services.project_templates import apply_template

router = APIRouter(prefix="/projects", tags=["project-inspection-items"])


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
