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
    ProjectMember,
    ProjectZone,
    TaskInspectionItem,
)
from app.services.inspection_planning import (
    PlanningError,
    inspection_task_visibility_filters,
    project_permissions_for,
)
from app.services.operator import get_current_operator

TaskStatus = Literal[
    "DRAFT", "PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"
]


class TaskCounts(TypedDict):
    DRAFT: int
    PENDING: int
    IN_PROGRESS: int
    COMPLETED: int
    CANCELLED: int


class WorkflowStep(TypedDict):
    code: str
    count: int
    pending: bool


class WorkflowProjectIdentity(TypedDict):
    id: UUID
    project_code: str
    name: str


class ProjectWorkflowSummary(TypedDict):
    project: WorkflowProjectIdentity
    viewer_permission_codes: list[str]
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
    """Return visible project counts using SQL aggregates."""
    permissions = project_permissions_for(session, project_id)
    is_admin = get_current_operator(session).is_admin
    readable_permissions = {
        "inspection_plan.read",
        "project_zone.read",
        "inspection_task.read",
        "inspection_task.inspect",
    }
    if not is_admin and not readable_permissions.intersection(permissions):
        raise PlanningError("authorization.forbidden")

    project = session.get(Project, project_id)
    if project is None:
        raise PlanningError("resource.not_found")

    member_count = (
        session.scalar(
            select(func.count(ProjectMember.id)).where(
                ProjectMember.project_id == project_id
            )
        )
        or 0
    )
    item_count = (
        session.scalar(
            select(func.count(ProjectInspectionItem.id)).where(
                ProjectInspectionItem.project_id == project_id
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
    task_counts_visible = is_admin or bool(
        {"inspection_task.read", "inspection_task.inspect"}.intersection(
            permissions
        )
    )
    pending_reinspection_count = 0
    draft_tasks_missing_assignee = 0
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
        },
        "viewer_permission_codes": sorted(permissions),
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
