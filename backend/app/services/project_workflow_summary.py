"""Database-backed project workflow summary (Issue #446)."""

from typing import Literal, TypedDict, cast
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectZone,
    TaskInspectionItem,
)
from app.permission_codes import (
    PermissionCode,
    permission_code_module,
    permission_code_scope,
)
from app.services.inspection_planning import (
    PlanningError,
    inspection_task_visibility_filters,
)
from app.services.operator import get_current_operator
from app.services.permissions import calculate_effective_access
from app.services.project_member_counts import count_active_project_members

TaskStatus = Literal[
    "DRAFT", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"
]


class TaskCounts(TypedDict):
    """提供固定狀態欄位，讓零筆狀態也有可預期的摘要格式。"""

    DRAFT: int
    PENDING: int
    IN_PROGRESS: int
    COMPLETED: int
    CANCELLED: int


class WorkflowStep(TypedDict):
    """攜帶下一步的數量及待辦判斷，避免前端各自推算。"""

    code: str
    count: int
    pending: bool


class WorkflowProjectIdentity(TypedDict):
    """讓只有摘要讀取權限的成員仍可辨認目前專案。"""

    id: UUID
    project_code: str
    name: str
    company_role: str


class ProjectWorkflowSummary(TypedDict):
    """提供專案首頁所需的可見計數、有效權限與流程建議。"""

    project: WorkflowProjectIdentity
    viewer_permission_codes: list[str]
    can_apply_templates: bool
    member_count: int
    inspection_item_count: int
    zone_count: int
    plan_count: int
    task_counts: TaskCounts
    task_counts_visible: bool
    pending_reinspection_task_count: int
    draft_tasks_missing_assignee: int
    primary_step: str | None
    next_steps: list[WorkflowStep]


def get_project_workflow_summary(
    session: Session,
    *,
    project_id: UUID,
) -> ProjectWorkflowSummary:
    """依 IP-R11 聚合可見資料，避免首頁載入完整任務集合。"""
    operator = get_current_operator(session)
    access = calculate_effective_access(
        session, user_id=operator.id, project_id=project_id
    )
    # IP-R11 回傳的碼供前端判斷入口，須反映模組可使用總開關。
    permissions = (
        frozenset(
            code.value
            for code in PermissionCode
            if permission_code_scope(code.value) == "project"
        )
        if access.is_admin
        else frozenset(
            code
            for code in access.project_permissions
            if (
                (module := permission_code_module(code)) is not None
                and f"{module}.use" in access.module_permissions
            )
        )
    )
    readable_permissions = {
        "project.read",
        "inspection_plan.read",
        "project_zone.read",
        "inspection_task.read",
        "inspection_task.inspect",
    }

    def can_read_project_code(code: str) -> bool:
        module = permission_code_module(code)
        return (
            code in permissions
            and f"{module}.use" in access.module_permissions
        )

    if not access.is_admin and not any(
        can_read_project_code(code) for code in readable_permissions
    ):
        raise PlanningError("authorization.forbidden")

    project = session.get(Project, project_id)
    if project is None:
        raise PlanningError("resource.not_found")

    member_count = count_active_project_members(session, {project_id})[
        project_id
    ]
    item_count = (
        session.scalar(
            select(func.count(ProjectInspectionItem.id)).where(
                ProjectInspectionItem.project_id == project_id,
                ProjectInspectionItem.is_active.is_(True),
            )
        )
        or 0
    )
    zone_count = (
        session.scalar(
            select(func.count(ProjectZone.id)).where(
                ProjectZone.project_id == project_id
            )
        )
        or 0
    )
    plan_count = (
        session.scalar(
            select(func.count(InspectionPlan.id)).where(
                InspectionPlan.project_id == project_id
            )
        )
        or 0
    )

    task_counts: TaskCounts = {
        "DRAFT": 0,
        "PENDING": 0,
        "IN_PROGRESS": 0,
        "COMPLETED": 0,
        "CANCELLED": 0,
    }
    task_counts_visible = access.is_admin or (
        "inspection.use" in access.module_permissions
        and bool(
            {"inspection_task.read", "inspection_task.inspect"}.intersection(
                permissions
            )
        )
    )
    pending_reinspection_count = 0
    draft_tasks_missing_assignee = 0
    # IP-R11：不可由零筆推斷是否有權；可見性另回旗標，查詢沿用清單規則。
    if task_counts_visible:
        visible_filters = inspection_task_visibility_filters(
            session, project_id=project_id
        )
        rows = session.execute(
            select(InspectionTask.status, func.count(InspectionTask.id))
            .where(*visible_filters)
            .group_by(InspectionTask.status)
        ).all()
        for status, count in rows:
            task_counts[cast(TaskStatus, status)] = count

        # IP-R11：封存計畫仍列入狀態數，但不能成為待派出的下一步。
        available_drafts = (
            select(InspectionTask.id)
            .join(
                InspectionPlan,
                InspectionPlan.id == InspectionTask.plan_id,
            )
            .where(
                *visible_filters,
                InspectionTask.status == "DRAFT",
                InspectionPlan.is_archived.is_(False),
            )
        )
        draft_count = (
            session.scalar(
                select(func.count()).select_from(available_drafts.subquery())
            )
            or 0
        )
        draft_tasks_missing_assignee = (
            session.scalar(
                select(func.count(InspectionTask.id))
                .join(
                    InspectionPlan,
                    InspectionPlan.id == InspectionTask.plan_id,
                )
                .where(
                    *visible_filters,
                    InspectionTask.status == "DRAFT",
                    InspectionTask.assignee_id.is_(None),
                    InspectionPlan.is_archived.is_(False),
                )
            )
            or 0
        )

        # IP-R11：同任務可能有多個待重查項目，只計一次任務。
        pending_reinspection_count = (
            session.scalar(
                select(func.count(func.distinct(TaskInspectionItem.task_id)))
                .join(
                    InspectionTask,
                    InspectionTask.id == TaskInspectionItem.task_id,
                )
                .join(
                    InspectionPlan,
                    InspectionPlan.id == InspectionTask.plan_id,
                )
                .where(
                    *visible_filters,
                    InspectionTask.status.in_(("PENDING", "IN_PROGRESS")),
                    TaskInspectionItem.needs_reinspection.is_(True),
                    InspectionPlan.is_archived.is_(False),
                )
            )
            or 0
        )
    else:
        draft_count = 0

    # IP-R11：準備工作以缺少資料為待辦，派出／重查則以尚有工作為待辦。
    step_data = (
        ("add_members", member_count, member_count == 0),
        ("add_inspection_items", item_count, item_count == 0),
        ("create_plan", plan_count, plan_count == 0),
        ("dispatch_draft_tasks", draft_count, draft_count > 0),
        (
            "complete_reinspection",
            pending_reinspection_count,
            pending_reinspection_count > 0,
        ),
    )
    next_steps: list[WorkflowStep] = [
        {"code": code, "count": count, "pending": pending}
        for code, count, pending in step_data
    ]
    primary_step = next(
        (step["code"] for step in next_steps if step["pending"]),
        None,
    )
    return {
        "project": {
            "id": project.id,
            "project_code": project.project_code,
            "name": project.name,
            "company_role": project.company_role,
        },
        "viewer_permission_codes": sorted(permissions),
        # TPL-R09：與套用端點共用有效模組及專案權限來源。
        "can_apply_templates": (
            access.is_admin
            or (
                "template.use" in access.module_permissions
                and "inspection.use" in access.module_permissions
                and "project_inspection_item.edit"
                in access.project_permissions
            )
        ),
        "member_count": member_count,
        "inspection_item_count": item_count,
        "zone_count": zone_count,
        "plan_count": plan_count,
        "task_counts": task_counts,
        "task_counts_visible": task_counts_visible,
        "pending_reinspection_task_count": pending_reinspection_count,
        "draft_tasks_missing_assignee": draft_tasks_missing_assignee,
        "primary_step": primary_step,
        "next_steps": next_steps,
    }
