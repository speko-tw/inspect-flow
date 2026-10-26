"""提供 ADM-R01～ADM-R06 的後台進度查詢 API。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.access import (
    require_login_access,
    require_module_or_any_project_permission,
)
from app.auth.dependencies import get_db
from app.models import User
from app.services.admin_dashboard import (
    get_dashboard_summary,
    get_dashboard_task,
    list_dashboard_engineers,
    list_dashboard_projects,
    list_dashboard_tasks,
)

router = APIRouter(
    prefix="/admin/dashboard",
    tags=["admin-dashboard"],
)
_DASHBOARD_ACCESS = require_module_or_any_project_permission(
    "all_project_progress.read", "inspection_task.read"
)
_DB_DEPENDENCY = Depends(get_db, scope="function")
_ACCESS_DEPENDENCY = Depends(_DASHBOARD_ACCESS, scope="function")
_LOGIN_DEPENDENCY = Depends(require_login_access, scope="function")


class SummaryResponse(BaseModel):
    """ADM-R01：回傳指定範圍的待辦、進行中與完成進度。"""

    pending_count: int
    in_progress_count: int
    completed_count: int
    completion_rate: float


class DashboardProjectItem(BaseModel):
    """ADM-R04：回傳專案進度及完成率分母。"""

    project_id: UUID
    name: str
    pending_count: int
    in_progress_count: int
    completed_count: int
    completion_denominator_count: int
    completion_rate: float


class DashboardProjectList(BaseModel):
    """ADM-R04：提供具穩定游標的專案進度清單。"""

    items: list[DashboardProjectItem]
    next_cursor: str | None


class DashboardEngineerItem(BaseModel):
    """ADM-R05：分開呈現任務的指派、開始及完成人員。"""

    user_id: UUID
    username: str
    name_zh: str | None
    assigned_pending_count: int
    assigned_in_progress_count: int
    completed_by_count: int
    started_in_progress_count: int


class DashboardEngineerList(BaseModel):
    """ADM-R05：提供具穩定游標的工程師工作量清單。"""

    items: list[DashboardEngineerItem]
    next_cursor: str | None


class DashboardTaskLocation(BaseModel):
    """ADM-AC05：任務所在的專案分區與補充地點。"""

    zone_name: str | None
    location_text: str | None


class DashboardTaskAssignee(BaseModel):
    """ADM-AC05：任務的建議指派人最小識別欄位。"""

    user_id: UUID
    name_zh: str | None
    is_active: bool


class DashboardTaskItem(BaseModel):
    """ADM-AC05：只回傳全部進度檢視允許的任務欄位。"""

    task_id: UUID
    status: str
    plan_archived: bool
    location: DashboardTaskLocation
    suggested_assignee: DashboardTaskAssignee | None


class DashboardTaskList(BaseModel):
    """提供依建立時間與 ID 穩定分頁的唯讀任務清單。"""

    items: list[DashboardTaskItem]
    next_cursor: str | None


@router.get("/summary", response_model=SummaryResponse)
def dashboard_summary(
    project_id: UUID | None = None,
    db: Session = _DB_DEPENDENCY,
    user: User = _ACCESS_DEPENDENCY,
) -> SummaryResponse:
    """依 ADM-R02～04 回傳可存取範圍的 Dashboard 摘要。"""
    result = get_dashboard_summary(db, user_id=user.id, project_id=project_id)
    return SummaryResponse.model_validate(result)


@router.get("/projects", response_model=DashboardProjectList)
def dashboard_projects(
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    q: Annotated[str | None, Query(max_length=128)] = None,
    db: Session = _DB_DEPENDENCY,
    user: User = _ACCESS_DEPENDENCY,
) -> DashboardProjectList:
    """依 ADM-R04 列出呼叫者可查看的專案進度。"""
    result = list_dashboard_projects(
        db,
        user_id=user.id,
        cursor=cursor,
        limit=limit,
        query=q,
    )
    return DashboardProjectList.model_validate(result)


@router.get("/engineers", response_model=DashboardEngineerList)
def dashboard_engineers(
    project_id: UUID | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    q: Annotated[str | None, Query(max_length=254)] = None,
    db: Session = _DB_DEPENDENCY,
    user: User = _ACCESS_DEPENDENCY,
) -> DashboardEngineerList:
    """依 ADM-R05 分開統計指派者、開始者與完成者工作量。"""
    result = list_dashboard_engineers(
        db,
        user_id=user.id,
        project_id=project_id,
        cursor=cursor,
        limit=limit,
        query=q,
    )
    return DashboardEngineerList.model_validate(result)


@router.get("/projects/{project_id}/tasks", response_model=DashboardTaskList)
def dashboard_tasks(
    project_id: UUID,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    db: Session = _DB_DEPENDENCY,
    user: User = _LOGIN_DEPENDENCY,
) -> DashboardTaskList:
    """依 ADM-R06 列出專案的四項白名單任務進度。"""
    result = list_dashboard_tasks(
        db,
        user_id=user.id,
        project_id=project_id,
        cursor=cursor,
        limit=limit,
    )
    return DashboardTaskList.model_validate(result)


@router.get(
    "/projects/{project_id}/tasks/{task_id}",
    response_model=DashboardTaskItem,
)
def dashboard_task(
    project_id: UUID,
    task_id: UUID,
    db: Session = _DB_DEPENDENCY,
    user: User = _LOGIN_DEPENDENCY,
) -> DashboardTaskItem:
    """依 ADM-AC05 回傳單一任務的四項白名單欄位。"""
    result = get_dashboard_task(
        db,
        user_id=user.id,
        project_id=project_id,
        task_id=task_id,
    )
    return DashboardTaskItem.model_validate(result)
