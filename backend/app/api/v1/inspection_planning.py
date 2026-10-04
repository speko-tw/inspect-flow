"""Inspection planning API (IP-R01 through IP-R10)."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import page
from app.api.v1.project_inspection_items import _project_item_detail
from app.api.v1.template_library import PointBody
from app.auth.access import require_login_access, require_project_permission
from app.auth.dependencies import get_db
from app.db.base import uuid7
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectMember,
    ProjectNumericStandard,
    ProjectTextStandard,
    ProjectZone,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotMeasurementField,
    TaskSnapshotNumericStandard,
    TaskSnapshotPoint,
    TaskSnapshotTextStandard,
    User,
)
from app.services.inspection_planning import (
    PlanningError,
    archive_inspection_plan,
    assign_inspection_task,
    cancel_inspection_task,
    complete_inspection_task,
    create_inspection_plan,
    create_inspection_task,
    create_project_zone,
    delete_draft_inspection_task,
    delete_project_zone,
    dispatch_inspection_task,
    get_inspection_plan,
    get_inspection_task,
    list_inspection_plans,
    list_inspection_tasks,
    rename_inspection_plan,
    rename_project_zone,
    restore_inspection_task,
    start_inspection_task,
    update_project_item_usage,
    update_task_location,
)
from app.services.operator import get_current_operator
from app.services.permissions import effective_permissions

router = APIRouter(
    tags=["inspection-planning"],
)
_db_dependency: Any = Depends(get_db)
_login_dependency: Any = Depends(require_login_access)


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NameBody(StrictBody):
    name: str = Field(min_length=1, max_length=128)


class TaskCreateBody(StrictBody):
    item_ids: list[UUID] = Field(min_length=1)
    zone_id: UUID | None = None
    location_text: str | None = Field(default=None, max_length=256)
    suggested_assignee_id: UUID | None = None


class AssignBody(StrictBody):
    assignee_id: UUID | None


class CancelBody(StrictBody):
    reason: str = ""


class LocationBody(StrictBody):
    zone_id: UUID | None
    location_text: str | None = Field(max_length=256)


class ProjectItemPatchBody(StrictBody):
    title: str | None = Field(default=None, min_length=1)
    instruction: str | None = None
    inspection_points: list[PointBody] | None = None
    reinspect: bool | None = None


def _call(function, *args, **kwargs):
    try:
        return function(*args, **kwargs)
    except PlanningError as exc:
        response = _planning_error_response(exc.code)
        if response is None:
            raise
        raise APIError(response[0], response[1]) from exc


def _planning_error_response(
    error_code: str,
) -> tuple[ErrorCode, int] | None:
    namespace, separator, detail = error_code.partition(".")
    if not separator:
        return None
    if namespace == "authorization" and detail == "forbidden":
        return ErrorCode.PERMISSION_DENIED, 403
    if namespace == "project_inspection_item":
        if detail == "revision_not_increased":
            return ErrorCode.REQUEST_VALIDATION_FAILED, 422
        if detail == "not_found":
            return ErrorCode.RESOURCE_NOT_FOUND, 404
    try:
        code = ErrorCode(error_code)
    except ValueError:
        return None
    if detail == "not_found":
        status_code = 404
    elif detail in {
        "archived",
        "invalid_transition",
        "location_locked",
        "name_conflict",
        "in_use",
    }:
        status_code = 409
    else:
        status_code = 422
    return code, status_code


def _zone(db: Session, zone_id: UUID | None) -> dict[str, Any] | None:
    if zone_id is None:
        return None
    zone = db.get(ProjectZone, zone_id)
    return {"id": zone.id, "name": zone.name} if zone else None


def _task_summary(db: Session, task: InspectionTask) -> dict[str, Any]:
    items = db.scalars(
        select(TaskInspectionItem)
        .where(TaskInspectionItem.task_id == task.id)
        .order_by(TaskInspectionItem.created_at, TaskInspectionItem.id)
    ).all()
    details = []
    for association in items:
        snapshots = db.scalars(
            select(TaskRequirementSnapshot)
            .where(
                TaskRequirementSnapshot.task_inspection_item_id
                == association.id
            )
            .order_by(TaskRequirementSnapshot.revision)
        ).all()
        current = next((row for row in snapshots if row.is_current), None)
        details.append(
            {
                "id": association.project_inspection_item_id,
                "status": association.item_status,
                "needs_reinspection": association.needs_reinspection,
                "snapshots": [_snapshot(db, row) for row in snapshots],
                "current_snapshot": _snapshot(db, current)
                if current
                else None,
            }
        )
    assignee = db.get(User, task.assignee_id) if task.assignee_id else None
    return {
        "id": task.id,
        "project_id": task.project_id,
        "plan_id": task.plan_id,
        "status": task.status,
        "zone_id": task.zone_id,
        "zone": _zone(db, task.zone_id),
        "location_text": task.location_text,
        "assignee_id": task.assignee_id,
        "assignee": _person(assignee) if assignee else None,
        "started_by": task.started_by,
        "completed_by": task.completed_by,
        "cancellation_reason": task.cancellation_reason,
        "cancelled_from": task.cancelled_from_status,
        "items": details,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
    }


def _person(user: User) -> dict[str, Any]:
    return {"id": user.id, "username": user.username, "name_zh": user.name_zh}


def _snapshot(
    db: Session, snapshot: TaskRequirementSnapshot
) -> dict[str, Any]:
    points = db.scalars(
        select(TaskSnapshotPoint)
        .where(TaskSnapshotPoint.snapshot_id == snapshot.id)
        .order_by(TaskSnapshotPoint.sequence, TaskSnapshotPoint.id)
    ).all()
    rendered = []
    for point in points:
        text = db.scalar(
            select(TaskSnapshotTextStandard).where(
                TaskSnapshotTextStandard.point_id == point.id
            )
        )
        numeric = db.scalar(
            select(TaskSnapshotNumericStandard).where(
                TaskSnapshotNumericStandard.point_id == point.id
            )
        )
        fields = db.scalars(
            select(TaskSnapshotMeasurementField).where(
                TaskSnapshotMeasurementField.point_id == point.id
            )
        ).all()
        evidence = db.scalars(
            select(TaskSnapshotEvidenceRequirement).where(
                TaskSnapshotEvidenceRequirement.point_id == point.id
            )
        ).all()
        rendered.append(
            {
                "sequence": point.sequence,
                "title": point.title,
                "instruction": point.instruction,
                "text_standard": {"text": text.text} if text else None,
                "numeric_standard": {
                    "value": numeric.value,
                    "condition": numeric.condition,
                    "unit": numeric.unit,
                    "tolerance": numeric.tolerance,
                    "range_form": numeric.range_form,
                    "lower_bound": numeric.lower_bound,
                    "upper_bound": numeric.upper_bound,
                    "measurement_field_id": (
                        numeric.source_measurement_field_id
                    ),
                }
                if numeric
                else None,
                "measurement_fields": [
                    {
                        "id": f.source_field_id,
                        "name": f.name,
                        "field_type": f.field_type,
                        "unit": f.unit,
                    }
                    for f in fields
                ],
                "evidence_requirements": [
                    {
                        "evidence_type": e.evidence_type,
                        "required": e.required,
                        "min_count": e.min_count,
                        "max_count": e.max_count,
                    }
                    for e in evidence
                ],
            }
        )
    return {
        "revision": snapshot.revision,
        "source_standard_revision": snapshot.source_standard_revision,
        "title": snapshot.title,
        "instruction": snapshot.instruction,
        "source_template_name": snapshot.source_template_name,
        "is_current": snapshot.is_current,
        "superseded_reason": snapshot.superseded_reason,
        "superseded_at": snapshot.superseded_at.isoformat()
        if snapshot.superseded_at
        else None,
        "inspection_points": rendered,
    }


def _plan_summary(
    db: Session, plan: InspectionPlan, *, with_tasks: bool = False
) -> dict[str, Any]:
    result = {
        "id": plan.id,
        "project_id": plan.project_id,
        "name": plan.name,
        "status": "ARCHIVED" if plan.is_archived else plan.status,
        "archived": plan.is_archived,
        "created_at": plan.created_at.isoformat(),
        "updated_at": plan.updated_at.isoformat(),
    }
    if with_tasks:
        tasks = list(
            db.scalars(
                select(InspectionTask)
                .where(InspectionTask.plan_id == plan.id)
                .order_by(InspectionTask.created_at, InspectionTask.id)
            ).all()
        )
        result["tasks"] = [_task_summary(db, task) for task in tasks]
    return result


def _one_plan(db: Session, plan_id: UUID) -> InspectionPlan:
    plan = db.get(InspectionPlan, plan_id)
    if plan is None:
        _call(get_inspection_plan, db, plan_id=plan_id)
        raise APIError(ErrorCode.INSPECTION_PLAN_NOT_FOUND, 404)
    return plan


def _one_task(db: Session, task_id: UUID) -> InspectionTask:
    task = db.get(InspectionTask, task_id)
    if task is None:
        _call(get_inspection_task, db, task_id=task_id)
        raise APIError(ErrorCode.INSPECTION_TASK_NOT_FOUND, 404)
    return task


@router.get(
    "/projects/{project_id}/inspection-plans",
    dependencies=[Depends(require_login_access)],
)
def plans(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
):
    _project_exists(db, project_id)
    _call(list_inspection_plans, db, project_id=project_id)
    return page(
        db,
        InspectionPlan,
        cursor=cursor,
        limit=limit,
        filters=(InspectionPlan.project_id == project_id,),
        serialize=lambda row: _plan_summary(db, row),
    )


@router.post(
    "/projects/{project_id}/inspection-plans",
    status_code=201,
    dependencies=[Depends(require_login_access)],
)
def create_plan(
    project_id: UUID, body: NameBody, db: Session = _db_dependency
):
    _project_exists(db, project_id)
    row = _call(
        create_inspection_plan, db, project_id=project_id, name=body.name
    )
    return _plan_summary(db, row)


@router.get("/projects/{project_id}/zones")
def zones(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
    _user: User = _login_dependency,
):
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    # inspection_plan.read also grants names needed to display its Plans.
    permissions = effective_permissions(
        db, user_id=_user.id, project_id=project_id
    )
    if (
        not _user.is_admin
        and not {"project_zone.read", "inspection_plan.read"} & permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    return page(
        db,
        ProjectZone,
        cursor=cursor,
        limit=limit,
        filters=(ProjectZone.project_id == project_id,),
        serialize=lambda z: {
            "id": z.id,
            "project_id": z.project_id,
            "name": z.name,
        },
    )


@router.post(
    "/projects/{project_id}/zones",
    status_code=201,
    dependencies=[Depends(require_project_permission("project_zone.manage"))],
)
def add_zone(project_id: UUID, body: NameBody, db: Session = _db_dependency):
    return _zone_response(
        _call(create_project_zone, db, project_id=project_id, name=body.name),
        include_project=True,
    )


@router.patch(
    "/projects/{project_id}/zones/{zone_id}",
    dependencies=[Depends(require_project_permission("project_zone.manage"))],
)
def patch_zone(
    project_id: UUID,
    zone_id: UUID,
    body: NameBody,
    db: Session = _db_dependency,
):
    zone = db.scalar(
        select(ProjectZone).where(
            ProjectZone.id == zone_id, ProjectZone.project_id == project_id
        )
    )
    if zone is None:
        raise APIError(ErrorCode.PROJECT_ZONE_NOT_FOUND, 404)
    return _zone_response(
        _call(rename_project_zone, db, zone, name=body.name),
        include_project=True,
    )


def _zone_response(zone: ProjectZone, *, include_project: bool = False):
    result = {"id": zone.id, "name": zone.name}
    if include_project:
        result["project_id"] = zone.project_id
    return result


@router.delete(
    "/projects/{project_id}/zones/{zone_id}",
    status_code=204,
    dependencies=[Depends(require_project_permission("project_zone.manage"))],
)
def remove_zone(project_id: UUID, zone_id: UUID, db: Session = _db_dependency):
    zone = db.scalar(
        select(ProjectZone).where(
            ProjectZone.id == zone_id, ProjectZone.project_id == project_id
        )
    )
    if zone is None:
        raise APIError(ErrorCode.PROJECT_ZONE_NOT_FOUND, 404)
    _call(delete_project_zone, db, zone)


@router.get(
    "/inspection-plans/{plan_id}",
    dependencies=[Depends(require_login_access)],
)
def get_plan(plan_id: UUID, db: Session = _db_dependency):
    row = _call(get_inspection_plan, db, plan_id=plan_id)
    return _plan_summary(db, row, with_tasks=True)


@router.patch(
    "/inspection-plans/{plan_id}",
    dependencies=[Depends(require_login_access)],
)
def patch_plan(plan_id: UUID, body: NameBody, db: Session = _db_dependency):
    row = _one_plan(db, plan_id)
    return _plan_summary(
        db, _call(rename_inspection_plan, db, row, name=body.name)
    )


@router.post(
    "/inspection-plans/{plan_id}/tasks",
    status_code=201,
    dependencies=[Depends(require_login_access)],
)
def add_task(
    plan_id: UUID, body: TaskCreateBody, db: Session = _db_dependency
):
    plan = _one_plan(db, plan_id)
    task = _call(
        create_inspection_task,
        db,
        plan=plan,
        project_inspection_item_ids=body.item_ids,
        zone_id=body.zone_id,
        location_text=body.location_text,
        assignee_id=body.suggested_assignee_id,
    )
    return _task_summary(db, task)


@router.get(
    "/inspection-plans/{plan_id}/tasks",
    dependencies=[Depends(require_login_access)],
)
def plan_tasks(
    plan_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
):
    plan = _call(get_inspection_plan, db, plan_id=plan_id)
    return page(
        db,
        InspectionTask,
        cursor=cursor,
        limit=limit,
        filters=(InspectionTask.plan_id == plan.id,),
        serialize=lambda row: _task_summary(db, row),
    )


@router.get(
    "/projects/{project_id}/inspection-tasks",
    dependencies=[Depends(require_login_access)],
)
def project_tasks(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
):
    _project_exists(db, project_id)
    tasks = _call(list_inspection_tasks, db, project_id=project_id)
    ids = [task.id for task in tasks]
    return page(
        db,
        InspectionTask,
        cursor=cursor,
        limit=limit,
        filters=(InspectionTask.id.in_(ids),),
        serialize=lambda row: _task_summary(db, row),
    )


@router.get(
    "/projects/{project_id}/inspection-items/{project_inspection_item_id}/tasks",
    dependencies=[
        Depends(
            require_project_permission(
                "project_inspection_item.edit", param_name="project_id"
            )
        )
    ],
)
def item_tasks(
    project_id: UUID,
    project_inspection_item_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
):
    _project_exists(db, project_id)
    item = db.scalar(
        select(ProjectInspectionItem).where(
            ProjectInspectionItem.id == project_inspection_item_id,
            ProjectInspectionItem.project_id == project_id,
        )
    )
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    task_ids = select(TaskInspectionItem.task_id).where(
        TaskInspectionItem.project_inspection_item_id == item.id
    )
    return page(
        db,
        InspectionTask,
        cursor=cursor,
        limit=limit,
        filters=(
            InspectionTask.project_id == project_id,
            InspectionTask.id.in_(task_ids),
        ),
        serialize=lambda row: _impact_summary(db, row),
    )


def _impact_summary(db: Session, task: InspectionTask):
    plan = db.get(InspectionPlan, task.plan_id)
    summary = _task_summary(db, task)
    summary.update(
        {
            "plan_name": plan.name if plan else None,
            "plan_archived": bool(plan and plan.is_archived),
            "has_result": False,
        }
    )
    return summary


@router.get("/projects/{project_id}/inspection-task-assignees")
def assignees(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
    _user: User = _login_dependency,
):
    _project_exists(db, project_id)
    permissions = effective_permissions(
        db, user_id=_user.id, project_id=project_id
    )
    if (
        not _user.is_admin
        and not {"inspection_task.create", "inspection_task.assign"}
        & permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    members = db.scalars(
        select(ProjectMember).where(ProjectMember.project_id == project_id)
    ).all()
    result = []
    for member in members:
        person = db.get(User, member.user_id)
        if person is None or person.is_admin:
            continue
        if "inspection_task.inspect" in effective_permissions(
            db, user_id=person.id, project_id=project_id
        ):
            result.append(_person(person))
    candidate_ids = [person["id"] for person in result]
    return page(
        db,
        User,
        cursor=cursor,
        limit=limit,
        filters=(User.id.in_(candidate_ids),),
        serialize=_person,
    )


@router.post(
    "/inspection-tasks/{task_id}:dispatch",
    dependencies=[Depends(require_login_access)],
)
def dispatch(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(dispatch_inspection_task, db, task))


@router.post(
    "/inspection-tasks/{task_id}:assign",
    dependencies=[Depends(require_login_access)],
)
def assign(task_id: UUID, body: AssignBody, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(
        db,
        _call(assign_inspection_task, db, task, assignee_id=body.assignee_id),
    )


@router.post(
    "/inspection-tasks/{task_id}:start",
    dependencies=[Depends(require_login_access)],
)
def start(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(start_inspection_task, db, task))


@router.post(
    "/inspection-tasks/{task_id}:complete",
    dependencies=[Depends(require_login_access)],
)
def complete(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(complete_inspection_task, db, task))


@router.delete(
    "/inspection-tasks/{task_id}",
    status_code=204,
    dependencies=[Depends(require_login_access)],
)
def delete_task(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    _call(delete_draft_inspection_task, db, task)


@router.post(
    "/inspection-tasks/{task_id}:cancel",
    dependencies=[Depends(require_login_access)],
)
def cancel(
    task_id: UUID,
    body: CancelBody | None = None,
    db: Session = _db_dependency,
):
    if body is None or not body.reason.strip():
        raise APIError(ErrorCode.INSPECTION_TASK_REASON_REQUIRED, 422)
    task = _one_task(db, task_id)
    return _task_summary(
        db,
        _call(
            cancel_inspection_task,
            db,
            task,
            reason=body.reason,
        ),
    )


@router.post(
    "/inspection-tasks/{task_id}:restore",
    dependencies=[Depends(require_login_access)],
)
def restore(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(restore_inspection_task, db, task))


@router.patch(
    "/inspection-tasks/{task_id}",
    dependencies=[Depends(require_login_access)],
)
def patch_task(
    task_id: UUID, body: LocationBody, db: Session = _db_dependency
):
    task = _one_task(db, task_id)
    return _task_summary(
        db,
        _call(
            update_task_location,
            db,
            task,
            zone_id=body.zone_id,
            location_text=body.location_text,
        ),
    )


@router.get(
    "/inspection-tasks/{task_id}",
    dependencies=[Depends(require_login_access)],
)
def get_task(task_id: UUID, db: Session = _db_dependency):
    return _task_summary(db, _call(get_inspection_task, db, task_id=task_id))


@router.post(
    "/inspection-plans/{plan_id}:archive",
    dependencies=[Depends(require_login_access)],
)
def archive(plan_id: UUID, db: Session = _db_dependency):
    plan = _one_plan(db, plan_id)
    return _plan_summary(
        db, _call(archive_inspection_plan, db, plan, archived=True)
    )


@router.post(
    "/inspection-plans/{plan_id}:unarchive",
    dependencies=[Depends(require_login_access)],
)
def unarchive(plan_id: UUID, db: Session = _db_dependency):
    plan = _one_plan(db, plan_id)
    return _plan_summary(
        db, _call(archive_inspection_plan, db, plan, archived=False)
    )


def _project_exists(db: Session, project_id: UUID) -> None:
    if db.get(Project, project_id) is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)


@router.patch(
    "/projects/{project_id}/inspection-items/{project_inspection_item_id}",
    dependencies=[
        Depends(
            require_project_permission(
                "project_inspection_item.edit", param_name="project_id"
            )
        )
    ],
)
def patch_project_item(
    project_id: UUID,
    project_inspection_item_id: UUID,
    body: ProjectItemPatchBody,
    db: Session = _db_dependency,
):
    item = db.scalar(
        select(ProjectInspectionItem).where(
            ProjectInspectionItem.id == project_inspection_item_id,
            ProjectInspectionItem.project_id == project_id,
        )
    )
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    associations = db.scalars(
        select(TaskInspectionItem).where(
            TaskInspectionItem.project_inspection_item_id == item.id
        )
    ).all()
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
    old_status = {}
    for association in associations:
        task = db.get(InspectionTask, association.task_id)
        if task is not None:
            old_status[association.task_id] = task.status
    if body.title is not None:
        if not body.title.strip():
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        item.title = body.title.strip()
    if body.instruction is not None:
        item.instruction = body.instruction
    if body.inspection_points is not None:
        _replace_project_points(db, item, body.inspection_points)
    item.standard_revision += 1
    _call(
        update_project_item_usage,
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
    result = _project_item_detail(db, item)
    affected = []
    for association in associations:
        task = db.get(InspectionTask, association.task_id)
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


def _replace_project_points(
    db: Session, item: ProjectInspectionItem, points: list[PointBody]
) -> None:
    old_points = db.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id == item.id
        )
    ).all()
    for point in old_points:
        db.delete(point)
    db.flush()
    for source in points:
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
        field_map: dict[UUID, UUID] = {}
        for source_field in source.measurement_fields:
            field_id = uuid7()
            field_map[source_field.client_id] = field_id
            db.add(
                ProjectMeasurementField(
                    id=field_id,
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    name=source_field.name,
                    field_type=source_field.field_type,
                    unit=source_field.unit,
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
            )
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
            field_id = field_map.get(standard.measurement_field_client_id)
            if field_id is None:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            field = next(
                row
                for row in source.measurement_fields
                if row.client_id == standard.measurement_field_client_id
            )
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
                    measurement_field_type=field.field_type,
                    measurement_field_unit=field.unit or "",
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
    db.flush()
