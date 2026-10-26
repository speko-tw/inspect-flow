"""提供 ADM-R01～ADM-R06 的唯讀 Dashboard 彙總。"""

from uuid import UUID

from sqlalchemy import case, func, literal, or_, select, union_all
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import APIError, ErrorCode
from app.api.pagination import ilike_contains, page, page_by_text_key
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectZone,
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
    # 不存在的專案與沒有權限的專案同樣回 403，呼叫端無法分辨。
    if project_id is not None and session.get(Project, project_id) is None:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    # ADM-R06：全部專案範圍只看 all_project_progress.read（Admin
    # 放行），不需要查核模組「可使用」；專案權限不得擴大成這個範圍。
    if access.is_admin or _ALL_PROGRESS in access.module_permissions:
        return True, set()
    # 其餘人員逐專案要「看專案進度與工作量」專案權限，並具查核模組
    # 「可使用」才算可見（ADM-R06、AUT-R19）。
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
    # ADM-R02：待開始／進行中只計非封存 Plan，且不依日期篩選。
    today_active = (
        InspectionPlan.is_archived.is_(False)
    ) & InspectionTask.status.in_(("PENDING", "IN_PROGRESS"))
    # ADM-R03：完成率分母是非取消且已派出的任務；完成數與分母都不
    # 排除封存 Plan（ADM-R04 的歷史口徑），與上面的目前工作量不同。
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
        # 沒有任何可見專案時直接回 0，不必查詢。
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
    # ADM-R06：沒有 all_project_progress.read 的人只能看指定專案的
    # 總覽，不指定專案（全部專案範圍）一律 403。
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
    # 非全域範圍只列通過 ADM-R06 兩層檢查的專案；一個都沒有就不查。
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
    # 先分頁取得專案，再只對這一頁的專案一次彙總任務數，避免逐專案
    # 各查一次；沒有任務的專案在下方補 0。
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
    # ADM-R05：「派給誰」、「誰開始」、「誰查的」是三種歸屬，分開
    # 統計；先找出在範圍內任一種歸屬出現的人，再分頁、再逐種計數。
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
        # ADM-R51：只比對回應看得到的欄位，避免用 q 反推 email、工號等
        # 沒有顯示的個資。
        filters.append(
            or_(
                ilike_contains(User.username, query),
                ilike_contains(User.name_zh, query),
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
    assigned_counts = (
        select(
            InspectionTask.assignee_id.label("user_id"),
            func.sum(
                case((InspectionTask.status == "PENDING", 1), else_=0)
            ).label("assigned_pending_count"),
            func.sum(
                case(
                    (InspectionTask.status == "IN_PROGRESS", 1),
                    else_=0,
                )
            ).label("assigned_in_progress_count"),
            literal(0).label("completed_by_count"),
            literal(0).label("started_in_progress_count"),
        )
        .join(
            InspectionPlan,
            InspectionPlan.id == InspectionTask.plan_id,
        )
        .where(
            InspectionTask.assignee_id.in_(ids),
            InspectionTask.status.in_(("PENDING", "IN_PROGRESS")),
            InspectionPlan.is_archived.is_(False),
            *project_filter,
        )
        .group_by(InspectionTask.assignee_id)
    )
    started_counts = (
        select(
            InspectionTask.started_by.label("user_id"),
            literal(0).label("assigned_pending_count"),
            literal(0).label("assigned_in_progress_count"),
            literal(0).label("completed_by_count"),
            func.count().label("started_in_progress_count"),
        )
        .join(
            InspectionPlan,
            InspectionPlan.id == InspectionTask.plan_id,
        )
        .where(
            InspectionTask.started_by.in_(ids),
            InspectionTask.status == "IN_PROGRESS",
            InspectionPlan.is_archived.is_(False),
            *project_filter,
        )
        .group_by(InspectionTask.started_by)
    )
    completed_counts = (
        select(
            InspectionTask.completed_by.label("user_id"),
            literal(0).label("assigned_pending_count"),
            literal(0).label("assigned_in_progress_count"),
            func.count().label("completed_by_count"),
            literal(0).label("started_in_progress_count"),
        )
        .join(
            InspectionPlan,
            InspectionPlan.id == InspectionTask.plan_id,
        )
        .where(
            InspectionTask.completed_by.in_(ids),
            InspectionTask.status == "COMPLETED",
            *project_filter,
        )
        .group_by(InspectionTask.completed_by)
    )
    # 三種計數各自一條查詢，缺的欄位補 0 後 union，最後依人加總，
    # 如此三個數字不會混成單一數字（ADM-R05）。
    workload_rows = union_all(
        assigned_counts, started_counts, completed_counts
    ).subquery()
    workload = session.execute(
        select(
            workload_rows.c.user_id,
            func.sum(workload_rows.c.assigned_pending_count),
            func.sum(workload_rows.c.assigned_in_progress_count),
            func.sum(workload_rows.c.completed_by_count),
            func.sum(workload_rows.c.started_in_progress_count),
        ).group_by(workload_rows.c.user_id)
    ).all()
    counts = {
        user_id: {
            "assigned_pending_count": pending,
            "assigned_in_progress_count": in_progress,
            "completed_by_count": completed,
            "started_in_progress_count": started,
        }
        for user_id, pending, in_progress, completed, started in workload
    }
    for item in result["items"]:
        item.update(
            counts.get(
                item["user_id"],
                {
                    "assigned_pending_count": 0,
                    "assigned_in_progress_count": 0,
                    "completed_by_count": 0,
                    "started_in_progress_count": 0,
                },
            )
        )
    return result


def _require_all_progress_access(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID,
) -> None:
    """依 ADM-R06 驗證全部進度權限及專案存在。

    任務明細只要 all_project_progress.read（Admin 放行），不另需
    查核模組「可使用」；專案權限不能取代它。
    """
    access = calculate_effective_access(
        session, user_id=user_id, project_id=project_id
    )
    if not access.is_active or not (
        access.is_admin or _ALL_PROGRESS in access.module_permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    if session.get(Project, project_id) is None:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)


def _dashboard_task_item(
    task: InspectionTask,
    *,
    zone: ProjectZone | None,
    assignee: User | None,
    plan_archived: bool,
) -> dict[str, object]:
    """序列化 ADM-AC05 的任務白名單欄位。

    只輸出清單、狀態、地點、建議指派四項（ADM-R06）；總覽、明細頁
    與 API 都經過這個函式，新增欄位前須先確認不是照片或查核結果。
    """
    # 分區必須與 Task 同專案（DOM-R58）；不一致時不輸出分區名稱。
    if zone is not None and zone.project_id != task.project_id:
        zone = None
    return {
        "task_id": task.id,
        "status": task.status,
        "plan_archived": plan_archived,
        "location": {
            "zone_name": zone.name if zone is not None else None,
            "location_text": task.location_text,
        },
        "suggested_assignee": (
            {
                "user_id": assignee.id,
                "name_zh": assignee.name_zh,
                "is_active": assignee.is_active,
            }
            if assignee is not None
            else None
        ),
    }


def list_dashboard_tasks(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    cursor: str | None,
    limit: int,
) -> dict[str, object]:
    """依 ADM-R06 回傳專案任務進度與穩定游標。"""
    _require_all_progress_access(
        session, user_id=user_id, project_id=project_id
    )
    result = page(
        session,
        InspectionTask,
        cursor=cursor,
        limit=limit,
        serialize=lambda task: task,
        filters=(
            InspectionTask.project_id == project_id,
            # ADM-R51：草稿只給內業，總覽與摘要計數一致不列入。
            InspectionTask.status != "DRAFT",
        ),
    )
    tasks = result["items"]
    task_rows = tasks
    # 以下三組都是整頁一次批次讀取，分區再限定同專案。
    zone_ids = {task.zone_id for task in task_rows if task.zone_id is not None}
    assignee_ids = {
        task.assignee_id for task in task_rows if task.assignee_id is not None
    }
    zones = (
        {
            zone.id: zone
            for zone in session.scalars(
                select(ProjectZone).where(
                    ProjectZone.project_id == project_id,
                    ProjectZone.id.in_(zone_ids),
                )
            ).all()
        }
        if zone_ids
        else {}
    )
    assignees = (
        {
            user.id: user
            for user in session.scalars(
                select(User).where(User.id.in_(assignee_ids))
            ).all()
        }
        if assignee_ids
        else {}
    )
    # IP-R12：批次讀取封存狀態，提醒判斷不得引入逐任務查詢。
    plans = (
        {
            plan.id: plan
            for plan in session.scalars(
                select(InspectionPlan).where(
                    InspectionPlan.id.in_({task.plan_id for task in task_rows})
                )
            ).all()
        }
        if task_rows
        else {}
    )
    result["items"] = [
        _dashboard_task_item(
            task,
            zone=zones.get(task.zone_id),
            assignee=assignees.get(task.assignee_id),
            plan_archived=plans[task.plan_id].is_archived,
        )
        for task in task_rows
    ]
    return result


def get_dashboard_task(
    session: Session,
    *,
    user_id: UUID,
    project_id: UUID,
    task_id: UUID,
) -> dict[str, object]:
    """依 ADM-AC05 讀取單一專案任務，並隱藏跨專案 ID。"""
    _require_all_progress_access(
        session, user_id=user_id, project_id=project_id
    )
    task = session.scalar(
        select(InspectionTask).where(
            InspectionTask.id == task_id,
            InspectionTask.project_id == project_id,
            # ADM-R51：草稿任務視同不存在（404）。
            InspectionTask.status != "DRAFT",
        )
    )
    if task is None:
        raise APIError(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    zone = (
        session.get(ProjectZone, task.zone_id)
        if task.zone_id is not None
        else None
    )
    assignee = (
        session.get(User, task.assignee_id)
        if task.assignee_id is not None
        else None
    )
    plan = session.get(InspectionPlan, task.plan_id)
    return _dashboard_task_item(
        task,
        zone=zone,
        assignee=assignee,
        plan_archived=bool(plan and plan.is_archived),
    )
