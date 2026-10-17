"""提供 ADM-R01～ADM-R06 的唯讀 Dashboard 彙總。"""

from uuid import UUID

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import APIError, ErrorCode
from app.api.pagination import ilike_contains, page_by_text_key
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    User,
)
from app.services.permissions import calculate_effective_access

_ALL_PROGRESS = "all_project_progress.read"
_TASK_READ = "inspection_task.read"
_INSPECTION_USE = "inspection.use"


def _visible_project_ids(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID | None = None,
) -> tuple[bool, set[UUID]]:
    """依 ADM-R06 回傳全域範圍或通過兩層權限的專案。"""
    access = calculate_effective_access(
        session, user_id=user_id, project_id=project_id
    )
    if not access.is_active:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    if project_id is not None and session.get(Project, project_id) is None:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    if access.is_admin or _ALL_PROGRESS in access.module_permissions:
        return True, set()
    if project_id is not None:
        allowed = (
            _TASK_READ in access.project_permissions
            and _INSPECTION_USE in access.module_permissions
        )
        if not allowed:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return False, {project_id}
    visible = {
        key
        for key, codes in access.project_permissions_by_project.items()
        if _TASK_READ in codes and _INSPECTION_USE in access.module_permissions
    }
    return False, visible


def _task_counts(
    session: Session,
    *,
    project_ids: set[UUID] | None,
) -> dict[str, int | float]:
    """依 ADM-R02～04 計算目前工作量與歷史完成率。"""
    today_active = (
        InspectionPlan.is_archived.is_(False)
    ) & InspectionTask.status.in_(("PENDING", "IN_PROGRESS"))
    denominator = InspectionTask.status.in_(
        ("PENDING", "IN_PROGRESS", "COMPLETED")
    )
    statement = select(
        func.count(
            case((today_active & (InspectionTask.status == "PENDING"), 1))
        ),
        func.count(
            case(
                (
                    today_active & (InspectionTask.status == "IN_PROGRESS"),
                    1,
                )
            )
        ),
        func.count(case((InspectionTask.status == "COMPLETED", 1))),
        func.count(case((denominator, 1))),
    ).join(
        InspectionPlan,
        InspectionPlan.id == InspectionTask.plan_id,
    )
    if project_ids is not None:
        if not project_ids:
            return {
                "pending_count": 0,
                "in_progress_count": 0,
                "completed_count": 0,
                "completion_denominator_count": 0,
                "completion_rate": 0.0,
            }
        statement = statement.where(InspectionTask.project_id.in_(project_ids))
    pending, in_progress, completed, total = session.execute(statement).one()
    return {
        "pending_count": pending,
        "in_progress_count": in_progress,
        "completed_count": completed,
        "completion_denominator_count": total,
        "completion_rate": completed / total if total else 0.0,
    }


def get_dashboard_summary(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID | None,
) -> dict[str, int | float]:
    """依授權範圍計算 Dashboard 摘要數值。"""
    all_projects, project_ids = _visible_project_ids(
        session, user_id=user_id, project_id=project_id
    )
    if project_id is None and not all_projects:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    if project_id is not None and not all_projects:
        project_ids = {project_id}
    scoped_ids = (
        {project_id}
        if project_id is not None
        else None
        if all_projects
        else project_ids
    )
    counts = _task_counts(session, project_ids=scoped_ids)
    counts.pop("completion_denominator_count")
    return counts


def list_dashboard_projects(
    session: Session,
    *,
    user_id: UUID,
    cursor: str | None,
    limit: int,
    query: str | None,
) -> dict[str, object]:
    """依專案名稱與 UUID 穩定分頁回傳專案進度。"""
    all_projects, project_ids = _visible_project_ids(session, user_id=user_id)
    filters = []
    if not all_projects:
        if not project_ids:
            return {"items": [], "next_cursor": None}
        filters.append(Project.id.in_(project_ids))
    if query:
        filters.append(
            or_(
                ilike_contains(Project.name, query),
                ilike_contains(Project.project_code, query),
            )
        )
    result = page_by_text_key(
        session,
        Project,
        sort_key=Project.name,
        key_name="name",
        cursor=cursor,
        limit=limit,
        serialize=lambda project: {
            "project_id": project.id,
            "name": project.name,
        },
        filters=filters,
    )
    items = result["items"]
    if not items:
        return result
    ids = {item["project_id"] for item in items}
    grouped = session.execute(
        select(
            InspectionTask.project_id,
            func.count(
                case(
                    (
                        InspectionPlan.is_archived.is_(False)
                        & (InspectionTask.status == "PENDING"),
                        1,
                    )
                )
            ),
            func.count(
                case(
                    (
                        InspectionPlan.is_archived.is_(False)
                        & (InspectionTask.status == "IN_PROGRESS"),
                        1,
                    )
                )
            ),
            func.count(case((InspectionTask.status == "COMPLETED", 1))),
            func.count(
                case(
                    (
                        InspectionTask.status.in_(
                            ("PENDING", "IN_PROGRESS", "COMPLETED")
                        ),
                        1,
                    )
                )
            ),
        )
        .join(
            InspectionPlan,
            InspectionPlan.id == InspectionTask.plan_id,
        )
        .where(InspectionTask.project_id.in_(ids))
        .group_by(InspectionTask.project_id)
    ).all()
    totals = {row[0]: row[1:] for row in grouped}
    for item in items:
        pending, in_progress, completed, denominator = totals.get(
            item["project_id"], (0, 0, 0, 0)
        )
        item.update(
            pending_count=pending,
            in_progress_count=in_progress,
            completed_count=completed,
            completion_denominator_count=denominator,
            completion_rate=completed / denominator if denominator else 0.0,
        )
    return result


def list_dashboard_engineers(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID | None,
    cursor: str | None,
    limit: int,
    query: str | None,
) -> dict[str, object]:
    """分開統計指派者、開始者與完成者的任務數。"""
    all_projects, project_ids = _visible_project_ids(
        session, user_id=user_id, project_id=project_id
    )
    if project_id is None and not all_projects:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    scope_ids = (
        {project_id}
        if project_id is not None
        else None
        if all_projects
        else project_ids
    )
    project_filter: list[ColumnElement[bool]] = []
    if scope_ids is not None:
        project_filter.append(InspectionTask.project_id.in_(scope_ids))
    user_ids = (
        select(InspectionTask.assignee_id.label("user_id"))
        .join(InspectionPlan, InspectionPlan.id == InspectionTask.plan_id)
        .where(
            InspectionTask.status.in_(("PENDING", "IN_PROGRESS")),
            InspectionPlan.is_archived.is_(False),
            InspectionTask.assignee_id.is_not(None),
            *project_filter,
        )
    )
    started_ids = (
        select(InspectionTask.started_by.label("user_id"))
        .join(InspectionPlan, InspectionPlan.id == InspectionTask.plan_id)
        .where(
            InspectionTask.status == "IN_PROGRESS",
            InspectionPlan.is_archived.is_(False),
            InspectionTask.started_by.is_not(None),
            *project_filter,
        )
    )
    completed_ids = select(InspectionTask.completed_by.label("user_id")).where(
        InspectionTask.status == "COMPLETED",
        InspectionTask.completed_by.is_not(None),
        *project_filter,
    )
    people = user_ids.union(started_ids, completed_ids).subquery()
    filters: list[ColumnElement[bool]] = [
        User.id.in_(select(people.c.user_id))
    ]
    if query:
        filters.append(
            or_(
                ilike_contains(User.username, query),
                ilike_contains(User.name_zh, query),
                ilike_contains(User.name_en, query),
                ilike_contains(User.email, query),
                ilike_contains(User.employee_no, query),
            )
        )
    result = page_by_text_key(
        session,
        User,
        sort_key=User.username,
        key_name="username",
        cursor=cursor,
        limit=limit,
        serialize=lambda user: {
            "user_id": user.id,
            "username": user.username,
            "name_zh": user.name_zh,
        },
        filters=filters,
    )
    ids = {item["user_id"] for item in result["items"]}
    if not ids:
        return result
    aggregates = session.execute(
        select(
            InspectionTask.assignee_id,
            InspectionTask.started_by,
            InspectionTask.completed_by,
            InspectionTask.status,
            InspectionPlan.is_archived,
        )
        .join(
            InspectionPlan,
            InspectionPlan.id == InspectionTask.plan_id,
        )
        .where(
            or_(
                InspectionTask.assignee_id.in_(ids),
                InspectionTask.started_by.in_(ids),
                InspectionTask.completed_by.in_(ids),
            ),
            *project_filter,
        )
    ).all()
    counts = {
        identifier: {
            "assigned_pending_count": 0,
            "assigned_in_progress_count": 0,
            "completed_by_count": 0,
            "started_in_progress_count": 0,
        }
        for identifier in ids
    }
    for assignee, starter, completer, status, archived in aggregates:
        if assignee in counts and not archived:
            if status == "PENDING":
                counts[assignee]["assigned_pending_count"] += 1
            elif status == "IN_PROGRESS":
                counts[assignee]["assigned_in_progress_count"] += 1
        if starter in counts and status == "IN_PROGRESS" and not archived:
            counts[starter]["started_in_progress_count"] += 1
        if completer in counts and status == "COMPLETED":
            counts[completer]["completed_by_count"] += 1
    for item in result["items"]:
        item.update(counts[item["user_id"]])
    return result
