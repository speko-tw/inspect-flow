"""集中執行 Plan、Task 與分區的權限及狀態規則。"""

import uuid
from collections.abc import Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.api.errors import APIError, ErrorCode
from app.company_roles import company_role_inspection_level
from app.db.base import uuid7
from app.db.clock import utc_now
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectNumericStandard,
    ProjectTextStandard,
    ProjectZone,
    TaskInspectionItem,
    TaskRequirementSnapshot,
)
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.audit import (
    AuditEventKind,
    record_audit_event,
    register_audit_event,
)
from app.services.inspection_details import project_inspection_item_detail
from app.services.operator import get_current_operator
from app.services.permissions import (
    calculate_effective_access,
)
from app.services.template_library import (
    InvalidTemplateError,
    validate_template_structure,
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
        "inspection_task.renamed",
        "inspection_task",
        AuditEventKind.UPDATED,
        ("name",),
    ),
    (
        "inspection_task.items_updated",
        "inspection_task",
        AuditEventKind.UPDATED,
        ("items",),
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
    """依 AUT-R19 回傳 Admin 全權限或查核模組可使用的專案權限。"""
    operator = get_current_operator(session)
    access = calculate_effective_access(
        session, user_id=operator.id, project_id=project_id
    )
    if access.is_admin:
        return frozenset(
            code.value
            for code in PermissionCode
            if permission_code_scope(code.value) == "project"
        )
    # 依 AUT-R19，inspection.use 是查核專案內動作的總開關。
    if "inspection.use" not in access.module_permissions:
        return frozenset()
    return access.project_permissions


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
    # 中央權限快照同時保留無角色成員身分，避免本服務直接查人員與成員表。
    access = calculate_effective_access(
        session, user_id=assignee_id, project_id=project_id
    )
    if (
        project_id not in access.project_memberships
        or not access.is_active
        or access.is_admin
        or "inspection_task.inspect" not in access.project_permissions
        or "inspection.use" not in access.module_permissions
    ):
        raise PlanningError("inspection_task.invalid_assignee")


def _lock_project_items_for_snapshot(
    session: Session,
    *,
    project_id: uuid.UUID,
    item_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    """依 IP-R03 先鎖來源項目再鎖 Plan，避免快照讀到舊標準。

    項目編輯會先鎖來源項目、再鎖其 Plan；此處沿用相同的鎖順序（#555），
    讓快照複製得以序列化，避免 Plan 與項目之間發生死結。

    以下情況會拒絕建立（IP-R02、IP-R14）：
    - ``item_ids`` 為空：``inspection_task.items_required``。
    - 任一項目不屬於該專案或不存在：
      ``inspection_task.invalid_project_item``。
    - 任一項目沒有任何點位：``inspection_task.item_without_points``。
    """
    from app.models import ProjectInspectionItem, ProjectInspectionPoint

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
    source_ids_with_points = set(
        session.scalars(
            select(ProjectInspectionPoint.project_inspection_item_id).where(
                ProjectInspectionPoint.project_inspection_item_id.in_(
                    unique_ids
                )
            )
        ).all()
    )
    # IP-R14：先鎖住來源項目再查點位，避免與項目 PATCH 並行時建立空快照。
    if source_ids_with_points != set(unique_ids):
        raise PlanningError("inspection_task.item_without_points")
    return unique_ids


def _current_inspection_level(session: Session, project_id: uuid.UUID) -> str:
    """IP-R16：取專案**當下**的 ``company_role`` 對應的檢查層級。

    以共享鎖讀取專案列：與改角色的 PATCH 並行時，兩邊會序列化，
    新任務不會帶入剛被取代的舊層級。這裡排在 Plan 鎖之後，維持
    「來源項目 → Plan → 專案」的取鎖順序。
    """
    role = session.scalar(
        select(Project.company_role)
        .where(Project.id == project_id)
        .with_for_update(read=True)
        .execution_options(populate_existing=True)
    )
    level = company_role_inspection_level(role) if role else None
    if level is None:
        # 登記表在 ORM 寫入前就擋下未登記的角色（DOM-R76），正常不會到這。
        raise RuntimeError(
            f"Project {project_id} has no registered inspection level"
        )
    return level


def create_inspection_task(
    session: Session,
    *,
    plan: InspectionPlan,
    name: str,
    project_inspection_item_ids: list[uuid.UUID],
    zone_id: uuid.UUID | None = None,
    location_text: str | None = None,
    assignee_id: uuid.UUID | None = None,
) -> InspectionTask:
    """依 IP-R02 建立多項目 DRAFT Task；名稱與來源無效時拒絕。"""
    operator_id = _require_permission(
        session, plan.project_id, "inspection_task.create"
    )
    normalized_name = _validate_task_name(name)
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
        name=normalized_name,
        location_text=normalized_location,
        inspection_level=_current_inspection_level(
            session, locked_plan.project_id
        ),
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


def _validate_task_name(name: str) -> str:
    """依 IP-R17 將任務名稱 trim 後限制為 1～128 字元。"""
    normalized = name.strip()
    if not normalized or len(normalized) > 128:
        raise PlanningError("inspection_task.invalid_name")
    return normalized


def rename_inspection_task(
    session: Session,
    task: InspectionTask,
    *,
    name: str,
) -> InspectionTask:
    """依 IP-R17 修改未完成任務名稱並留下修改前後值。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.manage"
    )
    normalized = _validate_task_name(name)
    plan, locked_task = _lock_plan_and_task(session, task.id)
    if plan is not None and plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if plan is None or locked_task.status not in {
        "DRAFT",
        "PENDING",
        "IN_PROGRESS",
    }:
        raise PlanningError("inspection_task.invalid_transition")
    before = locked_task.name
    if before == normalized:
        # 名稱未變等於沒有修改：不動 updated_by／updated_at，也不寫稽核，
        # 避免不同操作者的空改名被誤記為最後修改人（IP-R17）。
        return locked_task
    locked_task.name = normalized
    locked_task.updated_by = operator_id
    session.flush()
    record_audit_event(
        session,
        "inspection_task.renamed",
        entity_id=locked_task.id,
        project_id=locked_task.project_id,
        before={"name": before},
        after={"name": normalized},
    )
    return locked_task


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
    """依 IP-R09 隱藏現場不可見的 DRAFT Task。"""
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
    has_inspection_use = "inspection.use" in access.module_permissions
    if project_id is None:
        permissioned_projects = set()
        for (
            member_project_id,
            permissions,
        ) in access.project_permissions_by_project.items():
            if has_inspection_use and "inspection_task.inspect" in permissions:
                permissioned_projects.add(member_project_id)
    else:
        permissioned_projects = (
            {project_id}
            if has_inspection_use
            and "inspection_task.inspect" in access.project_permissions
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
) -> InspectionTask:
    """讀取現場任務；不存在、DRAFT 或無專案權限均隱藏。"""
    task = session.get(InspectionTask, task_id)
    if task is None or task.status == "DRAFT":
        raise PlanningError("inspection_task.not_found")
    access = calculate_effective_access(
        session, user_id=user_id, project_id=task.project_id
    )
    if not access.is_admin and (
        task.project_id not in access.project_memberships
        or "inspection.use" not in access.module_permissions
        or "inspection_task.inspect" not in access.project_permissions
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


def _ensure_draft_task_editable(
    plan: InspectionPlan | None, task: InspectionTask
) -> None:
    """依 IP-R20 檢查 Plan 未封存且 Task 仍為 DRAFT；封存優先。"""
    if plan is None or plan.is_archived:
        raise PlanningError("inspection_plan.archived")
    if task.status != "DRAFT":
        raise PlanningError("inspection_task.invalid_transition")


def update_draft_task_items(
    session: Session,
    task: InspectionTask,
    *,
    item_ids: list[uuid.UUID],
) -> InspectionTask:
    """依 IP-R20 僅重建未派出 Task 的項目與快照。"""
    operator_id = _require_permission(
        session, task.project_id, "inspection_task.manage"
    )
    task_reference = session.get(InspectionTask, task.id)
    if task_reference is None:
        raise PlanningError("inspection_task.not_found")
    # 規格要求先判斷 Plan 與 Task 狀態、再驗證項目；入口先做無鎖預檢，
    # 讓封存 Plan 或已派出 Task 送壞項目時也穩定回 409。鎖後會再複檢。
    _ensure_draft_task_editable(
        session.get(InspectionPlan, task_reference.plan_id), task_reference
    )
    if not item_ids:
        raise PlanningError("inspection_task.items_required")
    if len(item_ids) > 200 or len(set(item_ids)) != len(item_ids):
        raise PlanningError("request.validation_failed")

    # 鎖序為來源項目 → Plan → Task，與建立任務及修改來源項目相同，
    # 重建快照才不會讀到併發修改前的標準（#555）。
    _lock_project_items_for_snapshot(
        session, project_id=task.project_id, item_ids=item_ids
    )
    plan = _lock_plan(session, task_reference.plan_id)
    locked_task = _lock_task(session, task.id)
    if plan is None or locked_task is None:
        raise PlanningError("inspection_task.not_found")
    # 取得鎖前的預檢可能已過時，鎖後必須複檢。
    _ensure_draft_task_editable(plan, locked_task)

    # 等鎖期間同一 Task 的項目可能已被其他請求取代，舊項目集合一律
    # 在持鎖後重讀，稽核的 before 與是否有變動才會正確。
    old_items = session.scalars(
        select(TaskInspectionItem)
        .where(TaskInspectionItem.task_id == locked_task.id)
        .order_by(TaskInspectionItem.created_at, TaskInspectionItem.id)
        .execution_options(populate_existing=True)
    ).all()
    old_ids = [row.project_inspection_item_id for row in old_items]
    # 集合相同就不重建：DRAFT 的快照由 IP-R04 隨來源項目修改同步，
    # 內容必已是最新；重建只會換掉 id 並留下沒有意義的稽核。
    if set(old_ids) == set(item_ids):
        return locked_task

    titles = dict(
        session.execute(
            select(ProjectInspectionItem.id, ProjectInspectionItem.title)
            .where(ProjectInspectionItem.id.in_(set(old_ids) | set(item_ids)))
            .execution_options(populate_existing=True)
        ).all()
    )
    # 稽核欄位用 {項目 id: 名稱} 對照：ALG-R10 會把 list 排序，元素是
    # dict 時無法比較；對照表既保留 id 與名稱，也不依賴順序。
    before_items = {str(item_id): titles[item_id] for item_id in old_ids}
    after_items = {str(item_id): titles[item_id] for item_id in item_ids}
    # DRAFT 沒有結果，舊 Snapshot 不保留；資料庫 FK cascade 會一併
    # 清除其下的點位、標準與證據需求，避免留下過期快照。
    for row in old_items:
        session.delete(row)
    session.flush()
    from app.services.inspection_planning_snapshots import create_task_items

    create_task_items(
        session,
        task=locked_task,
        project_inspection_item_ids=item_ids,
        operator_id=operator_id,
    )
    locked_task.updated_by = operator_id
    # 同一人連續修改時 updated_by 不變，onupdate 不會觸發，故顯式更新。
    locked_task.updated_at = utc_now()
    session.flush()
    record_audit_event(
        session,
        "inspection_task.items_updated",
        entity_id=locked_task.id,
        project_id=locked_task.project_id,
        before={"items": before_items},
        after={"items": after_items},
    )
    return locked_task


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
    access = calculate_effective_access(
        session, user_id=operator.id, project_id=task.project_id
    )
    if not access.is_admin and (
        "inspection.use" not in access.module_permissions
        or "inspection_task.inspect" not in access.project_permissions
    ):
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
    access = calculate_effective_access(
        session, user_id=operator.id, project_id=task.project_id
    )
    if not access.is_admin and (
        "inspection.use" not in access.module_permissions
        or "inspection_task.inspect" not in access.project_permissions
    ):
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
    from app.services.inspection_planning_snapshots import (
        load_task_item_refresh_context,
        refresh_task_item,
    )

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
        # 來源項目已先鎖定；再依 Plan、Task、項目明細的固定順序
        # 取得寫鎖，避免與建立 Task 的快照交易死鎖（IP-R03、#555）。
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
    refreshable_items = [
        task_item
        for task_item in task_items
        if (
            (task := task_by_id.get(task_item.task_id)) is not None
            and task.plan_id in plan_by_id
            and task.status != "CANCELLED"
        )
    ]
    # 同一來源的標準與目前快照只讀一次，避免關聯 Task 數推高 SELECT。
    refresh_context = load_task_item_refresh_context(
        session, task_items=refreshable_items, source_item=source
    )
    plans_to_refresh: dict[uuid.UUID, InspectionPlan] = {}
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
            context=refresh_context,
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
        plans_to_refresh[plan.id] = plan
    # 同一 Plan 的多個受影響 Task 共用一次狀態重算，避免重複載入整份計畫。
    for plan_id in sorted(plans_to_refresh):
        _refresh_plan_status(session, plans_to_refresh[plan_id])
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
    "edit_project_inspection_item",
    "rename_inspection_task",
    "rename_project_zone",
    "restore_inspection_task",
    "start_inspection_task",
    "update_project_item_usage",
    "update_draft_task_items",
    "update_task_location",
]


def edit_project_inspection_item(
    db: Session,
    *,
    project_id: UUID,
    project_inspection_item_id: UUID,
    body: Any,
):
    """依 KD-55 修改專案項目；無變更時不建立新修訂或稽核。"""
    # 依 IP-R03（#555），先鎖來源項目，再由服務層鎖 Plan／Task；
    # 建立 Task 也遵守此順序，快照不會跨越標準修訂邊界。
    item = db.scalar(
        select(ProjectInspectionItem)
        .where(
            ProjectInspectionItem.id == project_inspection_item_id,
            ProjectInspectionItem.project_id == project_id,
        )
        .with_for_update(key_share=True)
        .execution_options(populate_existing=True)
    )
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    associations = db.scalars(
        select(TaskInspectionItem).where(
            TaskInspectionItem.project_inspection_item_id == item.id
        )
    ).all()
    if body.inspection_points is not None:
        # reinspect=None 不會啟用結構鎖，先回報完整結構錯誤欄位。
        _validate_project_points(
            db,
            item,
            body.inspection_points,
            has_tasks=bool(associations),
            reinspect=body.reinspect,
        )
    if _project_item_patch_matches_current(db, item, body):
        result = project_inspection_item_detail(db, item)
        result["affected_tasks"] = []
        result["reinspection_selected"] = body.reinspect
        return result
    if associations and body.reinspect is None:
        raise APIError(
            ErrorCode.PROJECT_ITEM_REINSPECTION_CHOICE_REQUIRED, 422
        )

    before_data = {
        "title": item.title,
        "instruction": item.instruction,
        "standard_revision": item.standard_revision,
    }
    operator_id = get_current_operator(db).id
    item.updated_by = operator_id
    task_ids = {association.task_id for association in associations}
    tasks_by_id = (
        {
            task.id: task
            for task in db.scalars(
                select(InspectionTask).where(InspectionTask.id.in_(task_ids))
            ).all()
        }
        if task_ids
        else {}
    )
    old_status = {
        task_id: task.status for task_id, task in tasks_by_id.items()
    }
    if body.title is not None:
        if not body.title.strip():
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        item.title = body.title.strip()
    if body.instruction is not None:
        item.instruction = body.instruction
    if body.inspection_points is not None:
        _replace_project_points(db, item, body.inspection_points)
    item.standard_revision += 1
    update_project_item_usage(
        db,
        item_id=item.id,
        before_data=before_data,
        reinspection_required=bool(body.reinspect),
        after_data={
            "title": item.title,
            "instruction": item.instruction,
            "standard_revision": item.standard_revision,
        },
    )
    db.flush()
    result = project_inspection_item_detail(db, item)
    affected = []
    for association in associations:
        task = tasks_by_id.get(association.task_id)
        if task is None:
            continue
        prior = old_status[task.id]
        if prior == "CANCELLED":
            action = "apply_current_standard_on_restore"
        elif prior == "DRAFT":
            action = "draft_updated"
        elif prior == "COMPLETED" and task.status == "IN_PROGRESS":
            action = "returned_to_in_progress"
        elif association.needs_reinspection:
            action = "needs_reinspection"
        else:
            action = "updated"
        affected.append(
            {
                "task_id": task.id,
                "prior_status": prior,
                "status": task.status,
                "action": action,
                "needs_reinspection": association.needs_reinspection,
            }
        )
    result["affected_tasks"] = affected
    result["reinspection_selected"] = body.reinspect
    return result


def _project_item_patch_matches_current(
    db: Session, item: ProjectInspectionItem, body: Any
) -> bool:
    """判斷 PATCH 是否只重送目前內容，避免產生空白修訂。"""
    if body.reinspect is not None:
        return False
    if body.title is not None and body.title.strip() != item.title:
        return False
    if body.instruction is not None and body.instruction != item.instruction:
        return False
    if body.inspection_points is None:
        return True

    current_points = project_inspection_item_detail(db, item)[
        "inspection_points"
    ]
    if len(body.inspection_points) != len(current_points):
        return False
    for requested, current in zip(
        body.inspection_points, current_points, strict=True
    ):
        if (
            requested.id != current["id"]
            or requested.sequence != current["sequence"]
            or requested.title != current["title"]
            or requested.instruction != current["instruction"]
        ):
            return False

        text_standard = requested.text_standard
        current_text = current["text_standard"]
        if (text_standard is None) != (current_text is None):
            return False
        if (
            text_standard is not None
            and text_standard.text != current_text["text"]
        ):
            return False

        fields = current["measurement_fields"]
        requested_fields = requested.measurement_fields
        if len(requested_fields) != len(fields):
            return False
        if any(
            field.id != existing["id"]
            or field.name != existing["name"]
            or field.field_type != existing["field_type"]
            or field.unit != existing["unit"]
            for field, existing in zip(requested_fields, fields, strict=True)
        ):
            return False

        numeric = requested.numeric_standard
        current_numeric = current["numeric_standard"]
        if (numeric is None) != (current_numeric is None):
            return False
        if numeric is not None:
            bound_field = next(
                (
                    field.id
                    for field in requested_fields
                    if numeric.measurement_field_client_id
                    in {field.id, field.client_id}
                ),
                None,
            )
            if bound_field != current_numeric["measurement_field_id"]:
                return False
            if numeric.model_dump(exclude={"measurement_field_client_id"}) != {
                key: current_numeric[key]
                for key in (
                    "value",
                    "condition",
                    "unit",
                    "tolerance",
                    "range_form",
                    "lower_bound",
                    "upper_bound",
                )
            }:
                return False

        requested_evidence = requested.evidence_requirements
        current_evidence = current["evidence_requirements"]
        if len(requested_evidence) != len(current_evidence):
            return False
        if any(
            required.min_count != existing["min_count"]
            for required, existing in zip(
                requested_evidence, current_evidence, strict=True
            )
        ):
            return False
    return True


def _validate_project_points(
    db: Session,
    item: ProjectInspectionItem,
    points: list[Any],
    *,
    has_tasks: bool,
    reinspect: bool | None,
) -> None:
    """依 IP-R13、IP-R14 先驗證完整結構，再動任何資料列。

    有 Task 使用此項目且選擇不重查（`reinspect=false`）時，一律視為結構
    變更而拒絕（422）：增減項次或實測欄位、改欄位類型、照片需求張數、
    判定標準種類（數值／文字／無）、數值標準綁定的欄位與單位。草稿專用
    的修改前端送 `reinspect=true`，依 IP-R04 在同一 Task 更新 Snapshot。
    有任何 Task 使用時不得把項次清空（422）。
    """
    existing_points = db.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id == item.id
        )
    ).all()
    existing_point_ids = {point.id for point in existing_points}
    existing_fields = db.scalars(
        select(ProjectMeasurementField).where(
            ProjectMeasurementField.project_inspection_item_id == item.id
        )
    ).all()
    fields_by_point: dict[UUID, dict[UUID, ProjectMeasurementField]] = {}
    for field in existing_fields:
        fields_by_point.setdefault(field.inspection_point_id, {})[field.id] = (
            field
        )
    numeric_by_point = {
        row.inspection_point_id: row
        for row in db.scalars(
            select(ProjectNumericStandard).where(
                ProjectNumericStandard.project_inspection_item_id == item.id
            )
        ).all()
    }
    text_point_ids = set(
        db.scalars(
            select(ProjectTextStandard.inspection_point_id).where(
                ProjectTextStandard.project_inspection_item_id == item.id
            )
        ).all()
    )

    # 鎖結構路徑要逐點比對照片張數；整批先查，避免每點各打一次 DB
    # （N+1，#643）。只有該路徑會用到，其餘情況不多花一次查詢。
    min_count_by_point: dict[UUID, int] = {}
    if has_tasks and reinspect is False:
        min_count_by_point = {
            row.inspection_point_id: row.min_count
            for row in db.execute(
                select(
                    ProjectEvidenceRequirement.inspection_point_id,
                    ProjectEvidenceRequirement.min_count,
                ).where(
                    ProjectEvidenceRequirement.project_inspection_item_id
                    == item.id
                )
            )
        }

    point_identities: list[UUID | None] = []
    normalized_points = []
    seen_point_ids: set[UUID] = set()
    for point in points:
        point_id = point.id
        if has_tasks and reinspect is False and point_id is None:
            raise APIError(
                ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
            )
        if point.id is not None and point.id not in existing_point_ids:
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        if point_id is not None and point_id in seen_point_ids:
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        if point_id is not None:
            seen_point_ids.add(point_id)
        point_identities.append(point_id)
        existing_fields_for_point = (
            fields_by_point.get(point_id, {}) if point_id is not None else {}
        )
        seen_field_ids: set[UUID] = set()
        seen_field_client_ids: set[UUID] = set()
        identity_owner: dict[UUID, int] = {}
        for index, field in enumerate(point.measurement_fields):
            field_id = field.id
            if (
                field.id is not None
                and field.id not in existing_fields_for_point
            ):
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            if field_id is not None and field_id in seen_field_ids:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            if field_id is not None:
                seen_field_ids.add(field_id)
            if field.client_id in seen_field_client_ids:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            seen_field_client_ids.add(field.client_id)
            for token in (field.id, field.client_id):
                if token is None:
                    continue
                owner = identity_owner.setdefault(token, index)
                if owner != index:
                    raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

        normalized = point.model_dump()
        normalized_points.append(normalized)

    try:
        validate_template_structure({"inspection_points": normalized_points})
    except InvalidTemplateError as exc:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            fields=[
                {"path": field.path, "code": field.code}
                for field in exc.fields
            ],
        ) from exc

    if has_tasks and not points:
        raise APIError(ErrorCode.PROJECT_INSPECTION_ITEM_POINTS_REQUIRED, 422)
    if has_tasks and reinspect is False:
        if set(point_identities) != existing_point_ids:
            raise APIError(
                ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
            )
        for point, point_id in zip(points, point_identities, strict=True):
            assert point_id is not None
            old_fields = fields_by_point.get(point_id, {})
            old_numeric = numeric_by_point.get(point_id)
            if (point.numeric_standard is not None) != (
                old_numeric is not None
            ):
                raise APIError(
                    ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
                )
            if (point.text_standard is not None) != (
                point_id in text_point_ids
            ):
                raise APIError(
                    ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
                )
            old_photo_count = min_count_by_point.get(point_id)
            if (
                len(point.evidence_requirements) != 1
                or point.evidence_requirements[0].min_count != old_photo_count
            ):
                raise APIError(
                    ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
                )
            provided_field_ids = [
                field.id for field in point.measurement_fields
            ]
            if any(field_id is None for field_id in provided_field_ids):
                raise APIError(
                    ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
                )
            if set(provided_field_ids) != set(old_fields):
                raise APIError(
                    ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
                )
            for field, field_id in zip(
                point.measurement_fields, provided_field_ids, strict=True
            ):
                assert field_id is not None
                existing = old_fields[field_id]
                if field.field_type != existing.field_type:
                    raise APIError(
                        ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED,
                        422,
                    )
                expected_unit = (
                    None
                    if old_numeric is not None
                    and old_numeric.measurement_field_id == field_id
                    else existing.unit
                )
                if field.unit != expected_unit:
                    raise APIError(
                        ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED,
                        422,
                    )
            if point.numeric_standard is not None:
                assert old_numeric is not None
                standard = point.numeric_standard
                bound_field_id = next(
                    (
                        field.id
                        for field in point.measurement_fields
                        if field.id == standard.measurement_field_client_id
                        or field.client_id
                        == standard.measurement_field_client_id
                    ),
                    None,
                )
                if (
                    standard.unit != old_numeric.unit
                    or bound_field_id != old_numeric.measurement_field_id
                ):
                    raise APIError(
                        ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED,
                        422,
                    )


def _replace_project_points(
    db: Session, item: ProjectInspectionItem, points: list[Any]
) -> None:
    # 依 IP-R13 保留傳入的項次與欄位 id，讓 Task 舊快照仍可追溯來源。
    old_points = db.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id == item.id
        )
    ).all()
    points_by_id = {point.id: point for point in old_points}
    old_fields = db.scalars(
        select(ProjectMeasurementField).where(
            ProjectMeasurementField.project_inspection_item_id == item.id
        )
    ).all()
    fields_by_point = {}
    for field in old_fields:
        fields_by_point.setdefault(field.inspection_point_id, {})[field.id] = (
            field
        )

    old_numeric = db.scalars(
        select(ProjectNumericStandard).where(
            ProjectNumericStandard.project_inspection_item_id == item.id
        )
    ).all()
    old_text = db.scalars(
        select(ProjectTextStandard).where(
            ProjectTextStandard.project_inspection_item_id == item.id
        )
    ).all()
    old_evidence = db.scalars(
        select(ProjectEvidenceRequirement).where(
            ProjectEvidenceRequirement.project_inspection_item_id == item.id
        )
    ).all()
    for row in [*old_numeric, *old_text, *old_evidence]:
        db.delete(row)
    db.flush()
    # 暫置負序號以避開同一項目內的 unique sequence 衝突；
    # 等新順序寫入後再完成結構替換。
    for index, point in enumerate(old_points, start=1):
        point.sequence = -index
    db.flush()

    retained_point_ids: set[UUID] = set()
    for source in points:
        point_identity = source.id
        point = (
            points_by_id.get(point_identity)
            if point_identity is not None
            else None
        )
        if point is None:
            point = ProjectInspectionPoint(
                project_inspection_item_id=item.id,
                sequence=source.sequence,
                title=source.title,
                instruction=source.instruction,
                created_by=item.updated_by,
                updated_by=item.updated_by,
            )
            db.add(point)
            db.flush()
        else:
            point.sequence = source.sequence
            point.title = source.title
            point.instruction = source.instruction
            point.updated_by = item.updated_by
        retained_point_ids.add(point.id)

        field_map: dict[UUID, UUID] = {}
        existing_fields = fields_by_point.get(point.id, {})
        retained_field_ids: set[UUID] = set()
        field_units: dict[UUID, str | None] = {}
        numeric = source.numeric_standard
        bound_client_id = (
            numeric.measurement_field_client_id
            if numeric is not None
            else None
        )
        for index, source_field in enumerate(source.measurement_fields):
            field_identity = source_field.id
            field = (
                existing_fields.get(field_identity)
                if field_identity is not None
                else None
            )
            unit = source_field.unit
            if source_field.client_id == bound_client_id:
                assert numeric is not None
                unit = numeric.unit
            if field is None:
                field = ProjectMeasurementField(
                    id=uuid7(),
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    name=source_field.name,
                    field_type=source_field.field_type,
                    unit=unit,
                    sort_order=index,
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
                db.add(field)
            else:
                field.name = source_field.name
                field.field_type = source_field.field_type
                field.unit = unit
                field.sort_order = index
                field.updated_by = item.updated_by
            retained_field_ids.add(field.id)
            field_map[source_field.client_id] = field.id
            field_units[source_field.client_id] = unit

        for field_id, field in existing_fields.items():
            if field_id not in retained_field_ids:
                db.delete(field)
        db.flush()

        if source.text_standard is not None:
            db.add(
                ProjectTextStandard(
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    text=source.text_standard.text,
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
            )
        if source.numeric_standard is not None:
            standard = source.numeric_standard
            field_identity = standard.measurement_field_client_id
            field_id = field_map.get(field_identity)
            if field_id is None:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            db.add(
                ProjectNumericStandard(
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    value=standard.value,
                    condition=standard.condition,
                    unit=standard.unit,
                    tolerance=standard.tolerance,
                    range_form=standard.range_form,
                    lower_bound=standard.lower_bound,
                    upper_bound=standard.upper_bound,
                    measurement_field_id=field_id,
                    measurement_field_type=next(
                        row.field_type
                        for row in source.measurement_fields
                        if row.client_id == field_identity
                    ),
                    measurement_field_unit=field_units[field_identity] or "",
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
            )
        for requirement in source.evidence_requirements:
            db.add(
                ProjectEvidenceRequirement(
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    evidence_type="photo",
                    required=True,
                    min_count=requirement.min_count,
                    max_count=None,
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
            )

    for point in old_points:
        if point.id not in retained_point_ids:
            db.delete(point)
    db.flush()
