"""集中執行 Plan、Task 與分區的權限及狀態規則。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.db.clock import utc_now
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItemChange,
    ProjectMember,
    ProjectZone,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    User,
)
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.audit import (
    AuditEventKind,
    record_audit_event,
    register_audit_event,
)
from app.services.operator import get_current_operator
from app.services.permissions import (
    calculate_effective_access,
    effective_permissions,
)


class PlanningError(ValueError):
    """表示規劃操作違反權限或領域規則，供 API 轉成穩定錯誤碼。"""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


# ALG-R24：下列分區、Task 與查核項目各屬單一專案；即使修改內容
# 沒有 project_id，也須保留所屬專案。
for _event, _entity, _kind, _fields in (
    (
        "project_zone.created",
        "project_zone",
        AuditEventKind.CREATED,
        ("project_id", "name"),
    ),
    (
        "project_zone.updated",
        "project_zone",
        AuditEventKind.UPDATED,
        ("name",),
    ),
    (
        "project_zone.deleted",
        "project_zone",
        AuditEventKind.DELETED,
        ("project_id", "name"),
    ),
    (
        "inspection_task.deleted",
        "inspection_task",
        AuditEventKind.DELETED,
        ("project_id", "status", "item_count"),
    ),
    (
        "inspection_task.cancelled",
        "inspection_task",
        AuditEventKind.UPDATED,
        ("status", "cancellation_reason"),
    ),
    (
        "inspection_task.restored",
        "inspection_task",
        AuditEventKind.UPDATED,
        ("status",),
    ),
    (
        "inspection_task.location_updated",
        "inspection_task",
        AuditEventKind.UPDATED,
        ("zone_id", "location_text"),
    ),
    (
        "project_inspection_item.updated",
        "project_inspection_item",
        AuditEventKind.UPDATED,
        ("title", "instruction", "reinspection_required"),
    ),
):
    register_audit_event(
        _event,
        entity_type=_entity,
        kind=_kind,
        fields=_fields,
        project_scoped=True,
        always_recorded=("reinspection_required",)
        if _event == "project_inspection_item.updated"
        else (),
        nullable_fields=("reinspection_required",)
        if _event == "project_inspection_item.updated"
        else ("zone_id", "location_text")
        if _event == "inspection_task.location_updated"
        else (),
    )


def _require_permission(
    session: Session, project_id: uuid.UUID, permission: str
) -> uuid.UUID:
    operator = get_current_operator(session)
    permissions = _project_permissions(session, project_id)
    if permission not in permissions:
        raise PlanningError("authorization.forbidden")
    return operator.id


def project_permissions_for(
    session: Session, project_id: uuid.UUID
) -> frozenset[str]:
    """取得操作者在專案內的有效權限；Admin 依 KD-69 取得所有專案權限。"""
    operator = get_current_operator(session)
    if operator.is_admin:
        return frozenset(
            code.value
            for code in PermissionCode
            if permission_code_scope(code.value) == "project"
        )
    return effective_permissions(
        session, user_id=operator.id, project_id=project_id
    )


def _project_permissions(
    session: Session, project_id: uuid.UUID
) -> frozenset[str]:
    return project_permissions_for(session, project_id)


def _lock_plan(session: Session, plan_id: uuid.UUID) -> InspectionPlan | None:
    return session.scalar(
        select(InspectionPlan)
        .where(InspectionPlan.id == plan_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _lock_task(session: Session, task_id: uuid.UUID) -> InspectionTask | None:
    return session.scalar(
        select(InspectionTask)
        .where(InspectionTask.id == task_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )


def _lock_plan_and_task(
    session: Session, task_id: uuid.UUID
) -> tuple[InspectionPlan | None, InspectionTask]:
    # 先鎖 Plan 再鎖 Task，與 _refresh_plan_status 及項目修改同序，
    # 避免並行轉換死鎖（#555）。
    task_reference = session.get(InspectionTask, task_id)
    if task_reference is None:
        raise PlanningError("inspection_task.not_found")
    plan = _lock_plan(session, task_reference.plan_id)
    task = _lock_task(session, task_id)
    if task is None:
        raise PlanningError("inspection_task.not_found")
    return plan, task


def create_project_zone(
    session: Session, *, project_id: uuid.UUID, name: str
) -> ProjectZone:
    """建立專案分區；無權限、專案不存在或名稱無效／衝突時拒絕。"""
    operator_id = _require_permission(
        session, project_id, "project_zone.manage"
    )
    if session.get(Project, project_id) is None:
        raise PlanningError("project.not_found")
    normalized = name.strip()
    if not normalized or len(normalized) > 128:
        raise PlanningError("project_zone.invalid_name")
    conflict = session.scalar(
        select(ProjectZone.id).where(
            ProjectZone.project_id == project_id,
            ProjectZone.name_key == normalized.casefold(),
        )
    )
    if conflict is not None:
        raise PlanningError("project_zone.name_conflict")
    zone = ProjectZone(
        project_id=project_id,
        name=normalized,
        created_by=operator_id,
        updated_by=operator_id,
    )
    session.add(zone)
    session.flush()
    record_audit_event(
        session,
        "project_zone.created",
        entity_id=zone.id,
        project_id=zone.project_id,
        before=None,
        after={"project_id": str(project_id), "name": zone.name},
    )
    return zone


def rename_project_zone(
    session: Session, zone: ProjectZone, *, name: str
) -> ProjectZone:
    """更名分區；無權限或同專案名稱無效／衝突時拒絕。"""
    operator_id = _require_permission(
        session, zone.project_id, "project_zone.manage"
    )
    normalized = name.strip()
    if not normalized or len(normalized) > 128:
        raise PlanningError("project_zone.invalid_name")
    conflict = session.scalar(
        select(ProjectZone.id).where(
            ProjectZone.project_id == zone.project_id,
            ProjectZone.name_key == normalized.casefold(),
            ProjectZone.id != zone.id,
        )
    )
    if conflict is not None:
        raise PlanningError("project_zone.name_conflict")
    before = zone.name
    zone.name = normalized
    zone.updated_by = operator_id
    session.flush()
    if before != zone.name:
        record_audit_event(
            session,
            "project_zone.updated",
            entity_id=zone.id,
            project_id=zone.project_id,
            before={"name": before},
            after={"name": zone.name},
        )
    return zone


def delete_project_zone(session: Session, zone: ProjectZone) -> None:
    """刪除未被 Task 引用的分區；引用中依 IP-R10 拒絕。"""
    _require_permission(session, zone.project_id, "project_zone.manage")
    if (
        session.scalar(
            select(InspectionTask.id)
            .where(InspectionTask.zone_id == zone.id)
            .limit(1)
        )
        is not None
    ):
        raise PlanningError("project_zone.in_use")
    data = {"project_id": str(zone.project_id), "name": zone.name}
    zone_id = zone.id
    session.delete(zone)
    session.flush()
    record_audit_event(
        session,
        "project_zone.deleted",
        entity_id=zone_id,
        project_id=zone.project_id,
        before=data,
        after=None,
    )


def create_inspection_plan(
    session: Session, *, project_id: uuid.UUID, name: str
) -> InspectionPlan:
    """建立 DRAFT Plan；無權限、專案不存在或名稱無效時拒絕。"""
    operator_id = _require_permission(
        session, project_id, "inspection_plan.create"
    )
    if session.get(Project, project_id) is None:
        raise PlanningError("project.not_found")
    try:
        plan = InspectionPlan(
            project_id=project_id,
            name=name,
            created_by=operator_id,
            updated_by=operator_id,
        )
    except ValueError as exc:
        raise PlanningError("inspection_plan.invalid_name") from exc
    session.add(plan)
    session.flush()
    return plan


def list_inspection_plans(
    session: Session, *, project_id: uuid.UUID
) -> list[InspectionPlan]:
    """讀取專案 Plan；缺少 inspection_plan.read 時拒絕。"""
    _require_permission(session, project_id, "inspection_plan.read")
    return list(
        session.scalars(
            select(InspectionPlan)
            .where(InspectionPlan.project_id == project_id)
            .order_by(InspectionPlan.created_at, InspectionPlan.id)
        ).all()
    )


def get_inspection_plan(
    session: Session, *, plan_id: uuid.UUID
) -> InspectionPlan:
    """取得 Plan；不存在或缺少專案讀取權限時拒絕。"""
    plan = session.get(InspectionPlan, plan_id)
    if plan is None:
        raise PlanningError("inspection_plan.not_found")
    _require_permission(session, plan.project_id, "inspection_plan.read")
    return plan


def rename_inspection_plan(
    session: Session, plan: InspectionPlan, *, name: str
) -> InspectionPlan:
    """修改 Plan 名稱；依 KD-56 拒絕封存中的 Plan。"""
    operator_id = _require_permission(
        session, plan.project_id, "inspection_plan.manage"
    )
    locked_plan = _lock_plan(session, plan.id)
    if locked_plan is None or locked_plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    try:
        locked_plan.name = name
    except ValueError as exc:
        raise PlanningError("inspection_plan.invalid_name") from exc
    locked_plan.updated_by = operator_id
    session.flush()
    return locked_plan


def derive_plan_status(task_statuses: Sequence[str]) -> str:
    """依 KD-56 衍生 Plan 有效狀態；DRAFT Task 阻止完成。"""
    if not task_statuses:
        return "DRAFT"
    active = [status for status in task_statuses if status != "CANCELLED"]
    if not active:
        return "CANCELLED"
    if all(status == "COMPLETED" for status in active):
        return "COMPLETED"
    if any(status != "DRAFT" for status in active):
        return "IN_PROGRESS"
    return "DRAFT"


def _refresh_plan_status(session: Session, plan: InspectionPlan) -> None:
    # 依 KD-56 衍生狀態前先鎖定所有 Task，避免併發轉換覆寫結果。
    locked_plan = _lock_plan(session, plan.id)
    if locked_plan is None:
        raise PlanningError("inspection_plan.not_found")
    tasks = session.scalars(
        select(InspectionTask)
        .where(InspectionTask.plan_id == locked_plan.id)
        .order_by(InspectionTask.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).all()
    locked_plan.status = derive_plan_status([task.status for task in tasks])
    locked_plan.updated_by = get_current_operator(session).id
    session.flush()


def _validate_location(
    session: Session,
    *,
    project_id: uuid.UUID,
    zone_id: uuid.UUID | None,
    location_text: str | None,
) -> str | None:
    # 依 IP-R10，專案一旦建立分區，Task 必須選同專案分區。
    normalized = location_text.strip() if location_text is not None else None
    normalized = normalized or None
    if normalized is not None and len(normalized) > 256:
        raise PlanningError("inspection_task.invalid_location")
    zone_ids = session.scalars(
        select(ProjectZone.id).where(ProjectZone.project_id == project_id)
    ).all()
    if zone_ids:
        if zone_id is None or zone_id not in zone_ids:
            raise PlanningError("inspection_task.invalid_zone")
    elif zone_id is not None:
        raise PlanningError("inspection_task.invalid_zone")
    return normalized


def _validate_assignee(
    session: Session,
    *,
    project_id: uuid.UUID,
    assignee_id: uuid.UUID | None,
) -> None:
    if assignee_id is None:
        return
    member = session.scalar(
        select(ProjectMember.id).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == assignee_id,
        )
    )
    permissions = effective_permissions(
        session, user_id=assignee_id, project_id=project_id
    )
    assignee = session.get(User, assignee_id)
    if (
        member is None
        or assignee is None
        or assignee.is_admin
        or "inspection_task.inspect" not in permissions
    ):
        raise PlanningError("inspection_task.invalid_assignee")


def _lock_project_items_for_snapshot(
    session: Session,
    *,
    project_id: uuid.UUID,
    item_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """依 IP-R03 先鎖來源項目再鎖 Plan，避免快照讀到舊標準。

    #555 固定與項目修改相同的鎖順序，避免並行建立與修改時死鎖。
    無來源項目或來源跨專案時拒絕。
    """
    from app.models import ProjectInspectionItem

    unique_ids = list(dict.fromkeys(item_ids))
    if not unique_ids:
        raise PlanningError("inspection_task.items_required")
    sources = session.scalars(
        select(ProjectInspectionItem)
        .where(
            ProjectInspectionItem.project_id == project_id,
            ProjectInspectionItem.id.in_(unique_ids),
        )
        .order_by(ProjectInspectionItem.id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    ).all()
    if {source.id for source in sources} != set(unique_ids):
        raise PlanningError("inspection_task.invalid_project_item")
    return unique_ids


def create_inspection_task(
    session: Session,
    *,
    plan: InspectionPlan,
    project_inspection_item_ids: list[uuid.UUID],
    zone_id: uuid.UUID | None = None,
    location_text: str | None = None,
    assignee_id: uuid.UUID | None = None,
) -> InspectionTask:
    """依 IP-R02 建立多項目 DRAFT Task；無效來源時拒絕。"""
    operator_id = _require_permission(
        session, plan.project_id, "inspection_task.create"
    )
    project_inspection_item_ids = _lock_project_items_for_snapshot(
        session,
        project_id=plan.project_id,
        item_ids=project_inspection_item_ids,
    )
    locked_plan = _lock_plan(session, plan.id)
    if locked_plan is None or locked_plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    _validate_assignee(
        session,
        project_id=locked_plan.project_id,
        assignee_id=assignee_id,
    )
    normalized_location = _validate_location(
        session,
        project_id=locked_plan.project_id,
        zone_id=zone_id,
        location_text=location_text,
    )
    task = InspectionTask(
        plan_id=locked_plan.id,
        project_id=locked_plan.project_id,
        zone_id=zone_id,
        location_text=normalized_location,
        assignee_id=assignee_id,
        created_by=operator_id,
        updated_by=operator_id,
    )
    session.add(task)
    session.flush()
    from app.services.inspection_planning_snapshots import create_task_items

    create_task_items(
        session,
        task=task,
        project_inspection_item_ids=project_inspection_item_ids,
        operator_id=operator_id,
    )
    _refresh_plan_status(session, locked_plan)
    return task


def list_inspection_tasks(
    session: Session,
    *,
    project_id: uuid.UUID,
    plan_id: uuid.UUID | None = None,
) -> list[InspectionTask]:
    """列出可見 Task；依 IP-R09 隱藏現場不可見的 DRAFT。"""
    filters = inspection_task_list_filters(session, project_id=project_id)
    statement = select(InspectionTask).where(*filters)
    if plan_id is not None:
        statement = statement.where(InspectionTask.plan_id == plan_id)
    return list(
        session.scalars(
            statement.order_by(InspectionTask.created_at, InspectionTask.id)
        ).all()
    )


def inspection_task_visibility_filters(
    session: Session, *, project_id: uuid.UUID
) -> tuple[ColumnElement[bool], ...]:
    """依 IP-R09 在資料庫層排除現場不可見的 DRAFT Task。"""
    permissions = _project_permissions(session, project_id)
    filters: list[ColumnElement[bool]] = [
        InspectionTask.project_id == project_id
    ]
    if "inspection_task.read" not in permissions:
        filters.append(InspectionTask.status != "DRAFT")
    return tuple(filters)


def inspection_task_list_filters(
    session: Session, *, project_id: uuid.UUID
) -> tuple[ColumnElement[bool], ...]:
    """建立專案 Task 篩選；無讀取或現場權限時拒絕。"""
    permissions = _project_permissions(session, project_id)
    if not {"inspection_task.read", "inspection_task.inspect"} & permissions:
        raise PlanningError("authorization.forbidden")
    return inspection_task_visibility_filters(session, project_id=project_id)


def get_inspection_task(
    session: Session, *, task_id: uuid.UUID
) -> InspectionTask:
    """讀取 Task；依 IP-R09 對現場隱藏 DRAFT。"""
    task = session.get(InspectionTask, task_id)
    if task is None:
        raise PlanningError("inspection_task.not_found")
    permissions = _project_permissions(session, task.project_id)
    if not {"inspection_task.read", "inspection_task.inspect"} & permissions:
        raise PlanningError("authorization.forbidden")
    if task.status == "DRAFT" and "inspection_task.read" not in permissions:
        raise PlanningError("inspection_task.not_found")
    return task


def field_inspection_task_filters(
    session: Session,
    *,
    user_id: uuid.UUID,
    is_admin: bool,
    assigned_to_me: bool,
    project_id: uuid.UUID | None = None,
    status: str | None = None,
) -> tuple[ColumnElement[bool], ...]:
    """建立現場任務篩選；無可查核專案時拒絕。"""
    access = calculate_effective_access(
        session, user_id=user_id, project_id=project_id
    )
    is_admin = access.is_admin
    if project_id is None:
        permissioned_projects = set()
        for (
            member_project_id,
            permissions,
        ) in access.project_permissions_by_project.items():
            if "inspection_task.inspect" in permissions:
                permissioned_projects.add(member_project_id)
    else:
        permissioned_projects = (
            {project_id}
            if "inspection_task.inspect" in access.project_permissions
            else set()
        )
    if not is_admin:
        if not permissioned_projects:
            raise PlanningError("authorization.forbidden")

    if project_id is not None:
        if is_admin:
            project_filter = InspectionTask.project_id == project_id
        else:
            project_filter = InspectionTask.project_id.in_(
                permissioned_projects
            )
    elif not is_admin:
        project_filter = InspectionTask.project_id.in_(permissioned_projects)
    else:
        project_filter = None
    filters: list[ColumnElement[bool]] = [
        InspectionTask.status.in_(("PENDING", "IN_PROGRESS")),
    ]
    if project_filter is not None:
        filters.append(project_filter)
    if status is not None:
        filters.append(InspectionTask.status == status)
    if assigned_to_me:
        filters.append(InspectionTask.assignee_id == user_id)
    filters.append(InspectionTask.dispatched_at.is_not(None))
    return tuple(filters)


def get_field_inspection_task(
    session: Session,
    *,
    task_id: uuid.UUID,
    user_id: uuid.UUID,
    is_admin: bool,
) -> InspectionTask:
    """讀取現場任務；不存在、DRAFT 或無專案權限均隱藏。"""
    task = session.get(InspectionTask, task_id)
    if task is None or task.status == "DRAFT":
        raise PlanningError("inspection_task.not_found")
    if not is_admin and "inspection_task.inspect" not in effective_permissions(
        session, user_id=user_id, project_id=task.project_id
    ):
        raise PlanningError("inspection_task.not_found")
    return task


def assign_inspection_task(
    session: Session,
    task: InspectionTask,
    *,
    assignee_id: uuid.UUID | None,
) -> InspectionTask:
    """設定建議指派人；封存 Plan 或無效候選人時拒絕。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.assign"
    )
    plan, locked_task = _lock_plan_and_task(session, task.id)
    if plan is None or plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    _validate_assignee(
        session,
        project_id=locked_task.project_id,
        assignee_id=assignee_id,
    )
    locked_task.assignee_id = assignee_id
    locked_task.updated_by = operator_id
    session.flush()
    return locked_task


def update_task_location(
    session: Session,
    task: InspectionTask,
    *,
    zone_id: uuid.UUID | None,
    location_text: str | None,
) -> InspectionTask:
    """依 IP-R10 更新 Task 地點；封存或狀態已鎖定時拒絕。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.manage"
    )
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status not in {"DRAFT", "PENDING", "IN_PROGRESS"}:
        raise PlanningError("inspection_task.location_locked")
    normalized = _validate_location(
        session,
        project_id=task.project_id,
        zone_id=zone_id,
        location_text=location_text,
    )
    before: dict[str, object] = {}
    after: dict[str, object] = {}
    if task.zone_id != zone_id:
        before["zone_id"] = task.zone_id
        after["zone_id"] = zone_id
    if task.location_text != normalized:
        before["location_text"] = task.location_text
        after["location_text"] = normalized
    task.zone_id = zone_id
    task.location_text = normalized
    task.updated_by = operator_id
    session.flush()
    if before:
        record_audit_event(
            session,
            "inspection_task.location_updated",
            entity_id=task.id,
            project_id=task.project_id,
            before=before,
            after=after,
        )
    return task


def dispatch_inspection_task(
    session: Session, task: InspectionTask
) -> InspectionTask:
    """依 IP-R09 派出 DRAFT Task；封存或非草稿時拒絕。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.dispatch"
    )
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status != "DRAFT":
        raise PlanningError("inspection_task.invalid_transition")
    task.status = "PENDING"
    if task.dispatched_at is None:
        task.dispatched_at = utc_now()
    task.updated_by = operator_id
    session.flush()
    _refresh_plan_status(session, plan)
    return task


def delete_draft_inspection_task(
    session: Session, task: InspectionTask
) -> None:
    """依 IP-R07 刪除未派 Task；封存或已派出時拒絕。"""
    _require_permission(
        session, task.project_id, "inspection_task.delete_draft"
    )
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status != "DRAFT":
        raise PlanningError("inspection_task.invalid_transition")
    item_count = (
        session.scalar(
            select(func.count())
            .select_from(TaskInspectionItem)
            .where(TaskInspectionItem.task_id == task.id)
        )
        or 0
    )
    task_id = task.id
    before = {
        "project_id": str(task.project_id),
        "status": task.status,
        "item_count": item_count,
    }
    session.delete(task)
    session.flush()
    record_audit_event(
        session,
        "inspection_task.deleted",
        entity_id=task_id,
        project_id=task.project_id,
        before=before,
        after=None,
    )
    _refresh_plan_status(session, plan)


def cancel_inspection_task(
    session: Session, task: InspectionTask, *, reason: str
) -> InspectionTask:
    """依 IP-R07 取消已派出且未完成的 Task；封存、狀態或原因無效時拒絕。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.cancel"
    )
    plan, task = _lock_plan_and_task(session, task.id)
    normalized = reason.strip()
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status not in {"PENDING", "IN_PROGRESS"}:
        raise PlanningError("inspection_task.invalid_transition")
    if not normalized:
        raise PlanningError("inspection_task.reason_required")
    before_status = task.status
    task.cancelled_from_status = before_status
    task.cancellation_reason = normalized
    task.status = "CANCELLED"
    task.updated_by = operator_id
    session.flush()
    record_audit_event(
        session,
        "inspection_task.cancelled",
        entity_id=task.id,
        project_id=task.project_id,
        before={"status": before_status},
        after={"status": "CANCELLED", "cancellation_reason": normalized},
    )
    _refresh_plan_status(session, plan)
    return task


def restore_inspection_task(
    session: Session, task: InspectionTask
) -> InspectionTask:
    """依 IP-R07 恢復 Task；封存或非取消狀態時拒絕。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.cancel"
    )
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status != "CANCELLED":
        raise PlanningError("inspection_task.invalid_transition")
    restored = task.cancelled_from_status
    if restored not in {"PENDING", "IN_PROGRESS"}:
        raise PlanningError("inspection_task.invalid_transition")
    before_status = task.status
    from app.models import ProjectInspectionItem
    from app.services.inspection_planning_snapshots import refresh_task_item

    # 依 IP-R07，取消期間不改快照；恢復時依修訂紀錄辨別
    # KD-55 的重查與文字更正，保留受影響項目的歷史。
    task_items = session.scalars(
        select(TaskInspectionItem)
        .where(TaskInspectionItem.task_id == task.id)
        .order_by(TaskInspectionItem.id)
        .with_for_update()
    ).all()
    for task_item in task_items:
        snapshot_revision = session.scalar(
            select(
                func.max(TaskRequirementSnapshot.source_standard_revision)
            ).where(
                TaskRequirementSnapshot.task_inspection_item_id
                == task_item.id,
                TaskRequirementSnapshot.is_current.is_(True),
            )
        )
        source_item = session.get(
            ProjectInspectionItem, task_item.project_inspection_item_id
        )
        if source_item is None or snapshot_revision is None:
            continue
        if snapshot_revision >= source_item.standard_revision:
            continue
        changes = session.scalars(
            select(ProjectInspectionItemChange)
            .where(
                ProjectInspectionItemChange.project_inspection_item_id
                == source_item.id,
                ProjectInspectionItemChange.after_revision > snapshot_revision,
            )
            .order_by(ProjectInspectionItemChange.after_revision)
        ).all()
        refresh_task_item(
            session,
            task_item=task_item,
            source_item=source_item,
            operator_id=operator_id,
            superseded_reason=(
                "STANDARD_CHANGED"
                if any(change.reinspection_required for change in changes)
                else "TEXT_CORRECTED"
            ),
        )
        if (
            any(change.reinspection_required for change in changes)
            and task_item.item_status == "COMPLETED"
        ):
            task_item.needs_reinspection = True
        task_item.updated_by = operator_id
    task.status = restored
    task.cancelled_from_status = None
    task.cancellation_reason = None
    task.updated_by = operator_id
    session.flush()
    record_audit_event(
        session,
        "inspection_task.restored",
        entity_id=task.id,
        project_id=task.project_id,
        before={"status": before_status},
        after={"status": restored},
    )
    _refresh_plan_status(session, plan)
    return task


def start_inspection_task(
    session: Session, task: InspectionTask
) -> InspectionTask:
    """開始待辦 Task；無查核權限、封存或狀態不符時拒絕。"""
    operator = get_current_operator(session)
    permissions = effective_permissions(
        session, user_id=operator.id, project_id=task.project_id
    )
    if "inspection_task.inspect" not in permissions:
        raise PlanningError("authorization.forbidden")
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status != "PENDING":
        raise PlanningError("inspection_task.invalid_transition")
    task.status = "IN_PROGRESS"
    task.started_by = operator.id
    task.started_at = utc_now()
    task.updated_by = operator.id
    session.flush()
    _refresh_plan_status(session, plan)
    return task


def complete_inspection_task(
    session: Session, task: InspectionTask
) -> InspectionTask:
    """完成進行中 Task；依 IP-R06 拒絕仍待重查的項目。"""
    operator = get_current_operator(session)
    permissions = effective_permissions(
        session, user_id=operator.id, project_id=task.project_id
    )
    if "inspection_task.inspect" not in permissions:
        raise PlanningError("authorization.forbidden")
    plan, task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or task.status != "IN_PROGRESS":
        raise PlanningError("inspection_task.invalid_transition")
    items = session.scalars(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    ).all()
    if any(item.needs_reinspection for item in items):
        raise PlanningError("inspection_task.items_incomplete")
    task.status = "COMPLETED"
    task.completed_by = operator.id
    task.completed_at = utc_now()
    task.updated_by = operator.id
    session.flush()
    _refresh_plan_status(session, plan)
    return task


def archive_inspection_plan(
    session: Session, plan: InspectionPlan, *, archived: bool
) -> InspectionPlan:
    """切換 Plan 封存；無權限或 Plan 不存在時拒絕。"""
    operator_id = _require_permission(
        session,
        plan.project_id,
        "inspection_plan.archive" if archived else "inspection_plan.unarchive",
    )
    locked_plan = _lock_plan(session, plan.id)
    if locked_plan is None:
        raise PlanningError("inspection_plan.not_found")
    locked_plan.is_archived = archived
    locked_plan.updated_by = operator_id
    session.flush()
    if not archived:
        _refresh_plan_status(session, locked_plan)
    return locked_plan


def update_project_item_usage(
    session: Session,
    *,
    item_id: uuid.UUID,
    before_data: dict[str, object],
    reinspection_required: bool,
    after_data: dict[str, object] | None = None,
) -> None:
    """依 KD-55 更新使用此項目的 Task 快照與項目級重查狀態。

    呼叫端須先於同一交易修改來源項目；修訂未遞增或 Plan 封存時拒絕。
    """
    from app.models import ProjectInspectionItem
    from app.services.inspection_planning_snapshots import refresh_task_item

    with session.no_autoflush:
        source = session.get(ProjectInspectionItem, item_id)
        if source is None:
            raise PlanningError("project_inspection_item.not_found")
        operator_id = _require_permission(
            session, source.project_id, "project_inspection_item.edit"
        )
        supplied_revision = before_data.get("standard_revision")
        before_revision = (
            supplied_revision
            if isinstance(supplied_revision, int)
            else source.standard_revision - 1
        )
        if source.standard_revision <= before_revision:
            raise PlanningError(
                "project_inspection_item.revision_not_increased"
            )
        task_items = session.scalars(
            select(TaskInspectionItem)
            .where(TaskInspectionItem.project_inspection_item_id == item_id)
            .order_by(TaskInspectionItem.task_id, TaskInspectionItem.id)
        ).all()
        task_ids = sorted({task_item.task_id for task_item in task_items})
        tasks = (
            session.scalars(
                select(InspectionTask)
                .where(InspectionTask.id.in_(task_ids))
                .order_by(InspectionTask.plan_id, InspectionTask.id)
            ).all()
            if task_ids
            else []
        )
        # 依 IP-R03（#555），來源項目由 API 先鎖，這裡依 Plan、Task、項目明細
        # 的固定順序取得寫鎖，避免與建立 Task 的快照交易死鎖。
        plan_ids = sorted({task.plan_id for task in tasks})
        plans = (
            session.scalars(
                select(InspectionPlan)
                .where(InspectionPlan.id.in_(plan_ids))
                .order_by(InspectionPlan.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
            if plan_ids
            else []
        )
        plan_by_id = {plan.id: plan for plan in plans}
        if any(plan.is_archived for plan in plans):
            raise PlanningError("inspection_plan.archived")
        locked_tasks = (
            session.scalars(
                select(InspectionTask)
                .where(InspectionTask.id.in_(task_ids))
                .order_by(InspectionTask.plan_id, InspectionTask.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()
            if task_ids
            else []
        )
        task_by_id = {task.id: task for task in locked_tasks}
        task_item_ids = [task_item.id for task_item in task_items]
        if task_item_ids:
            task_items = session.scalars(
                select(TaskInspectionItem)
                .where(TaskInspectionItem.id.in_(task_item_ids))
                .order_by(TaskInspectionItem.task_id, TaskInspectionItem.id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).all()

    session.add(
        ProjectInspectionItemChange(
            project_inspection_item_id=item_id,
            before_revision=before_revision,
            after_revision=source.standard_revision,
            reinspection_required=reinspection_required,
            before_data=before_data,
            after_data=after_data
            or {
                "title": source.title,
                "instruction": source.instruction,
                "standard_revision": source.standard_revision,
            },
            created_by=operator_id,
            updated_by=operator_id,
        )
    )
    for task_item in task_items:
        task = task_by_id.get(task_item.task_id)
        plan = plan_by_id.get(task.plan_id) if task else None
        if task is None or plan is None:
            continue
        # 依 IP-R07，取消中的 Task 到恢復時才套用目前標準。
        if task.status == "CANCELLED":
            continue
        refresh_task_item(
            session,
            task_item=task_item,
            source_item=source,
            operator_id=operator_id,
            superseded_reason=(
                "STANDARD_CHANGED"
                if reinspection_required
                else "TEXT_CORRECTED"
            ),
            retain_history=task.status != "DRAFT",
        )
        # 依 IP-R04，選「要」時已有結果的項目標待重查；
        # COMPLETED Task 退回 IN_PROGRESS（IP-R08 的明確例外）。
        # DRAFT 原位更新，不標待重查。
        if task.status == "DRAFT":
            task_item.needs_reinspection = False
        elif reinspection_required:
            if task_item.item_status == "COMPLETED":
                task_item.needs_reinspection = True
            if task.status == "COMPLETED":
                task.status = "IN_PROGRESS"
                task.completed_by = None
                task.completed_at = None
        elif not reinspection_required:
            task_item.needs_reinspection = False
        task_item.updated_by = operator_id
        task.updated_by = operator_id
        _refresh_plan_status(session, plan)
    before: dict[str, str | bool | None] = {
        "reinspection_required": None,
    }
    after: dict[str, str | bool | None] = {
        "reinspection_required": reinspection_required,
    }
    if before_data.get("title") != source.title:
        before["title"] = str(before_data.get("title", ""))
        after["title"] = source.title
    if before_data.get("instruction") != source.instruction:
        before["instruction"] = str(before_data.get("instruction", ""))
        after["instruction"] = source.instruction
    record_audit_event(
        session,
        "project_inspection_item.updated",
        entity_id=item_id,
        project_id=source.project_id,
        before=before,
        after=after,
    )
    session.flush()


__all__ = [
    "PlanningError",
    "archive_inspection_plan",
    "cancel_inspection_task",
    "complete_inspection_task",
    "create_inspection_plan",
    "create_inspection_task",
    "create_project_zone",
    "delete_draft_inspection_task",
    "delete_project_zone",
    "derive_plan_status",
    "dispatch_inspection_task",
    "rename_project_zone",
    "restore_inspection_task",
    "start_inspection_task",
    "update_project_item_usage",
    "update_task_location",
]
