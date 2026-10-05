"""Database-backed project workflow summary (Issue #446)."""

from typing import TypedDict
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    InspectionPlan,
    InspectionTask,
    ProjectInspectionItem,
    ProjectMember,
    ProjectZone,
    TaskInspectionItem,
)


class WorkflowStep(TypedDict):
    code: str
    count: int


class ProjectWorkflowSummary(TypedDict):
    member_count: int
    inspection_item_count: int
    zone_count: int
    plan_count: int
    task_counts: dict[str, int]
    pending_reinspection_task_count: int
    next_steps: list[WorkflowStep]


def get_project_workflow_summary(
    session: Session,
    *,
    project_id: UUID,
    can_read_drafts: bool,
    can_read_tasks: bool,
) -> ProjectWorkflowSummary:
    """Return project counts using SQL aggregates, scoped to one project."""
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

    task_counts = {
        "DRAFT": 0,
        "PENDING": 0,
        "IN_PROGRESS": 0,
        "COMPLETED": 0,
        "CANCELLED": 0,
    }
    pending_reinspection_count = 0
    if can_read_tasks:
        task_filters = [InspectionTask.project_id == project_id]
        if not can_read_drafts:
            task_filters.append(InspectionTask.status != "DRAFT")
        rows = session.execute(
            select(InspectionTask.status, func.count(InspectionTask.id))
            .where(*task_filters)
            .group_by(InspectionTask.status)
        ).all()
        task_counts.update({status: count for status, count in rows})
        pending_reinspection_count = (
            session.scalar(
                select(func.count(func.distinct(TaskInspectionItem.task_id)))
                .join(
                    InspectionTask,
                    InspectionTask.id == TaskInspectionItem.task_id,
                )
                .where(
                    *task_filters,
                    TaskInspectionItem.needs_reinspection.is_(True),
                )
            )
            or 0
        )

    next_steps: list[WorkflowStep] = [
        {"code": "add_members", "count": member_count},
        {"code": "add_inspection_items", "count": item_count},
        {"code": "create_plan", "count": plan_count},
        {"code": "dispatch_draft_tasks", "count": task_counts["DRAFT"]},
        {
            "code": "complete_reinspection",
            "count": pending_reinspection_count,
        },
    ]
    return {
        "member_count": member_count,
        "inspection_item_count": item_count,
        "zone_count": zone_count,
        "plan_count": plan_count,
        "task_counts": task_counts,
        "pending_reinspection_task_count": pending_reinspection_count,
        "next_steps": next_steps,
    }
