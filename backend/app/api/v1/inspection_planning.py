"""Inspection planning API (IP-R01 through IP-R10)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.limits import (
    ITEM_IDS_MAX,
    LOCATION_TEXT_MAX,
    LONG_TEXT_MAX,
    MEASUREMENT_FIELDS_MAX,
    PLANNING_NAME_MAX,
    POINTS_MAX,
    TITLE_MAX,
)
from app.api.pagination import encode_page_cursor, page, page_cursor_key
from app.api.time_format import format_utc
from app.api.v1.template_library import (
    MeasurementFieldBody,
    NumericStandardBody,
    PointBody,
)
from app.auth.access import (
    require_admin_or_any_project_permission,
    require_login_access,
    require_project_permission,
)
from app.auth.dependencies import get_db, require_login
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
    ProjectMemberRole,
    ProjectNumericStandard,
    ProjectTextStandard,
    ProjectZone,
    RolePermission,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotMeasurementField,
    TaskSnapshotNumericStandard,
    TaskSnapshotPoint,
    TaskSnapshotTextStandard,
    User,
)
from app.services.batch_load import load_by_id, load_grouped
from app.services.inspection_details import project_inspection_item_detail
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
    field_inspection_task_filters,
    get_field_inspection_task,
    get_inspection_plan,
    get_inspection_task,
    inspection_task_list_filters,
    inspection_task_visibility_filters,
    list_inspection_plans,
    rename_inspection_plan,
    rename_project_zone,
    restore_inspection_task,
    start_inspection_task,
    update_project_item_usage,
    update_task_location,
)
from app.services.operator import get_current_operator
from app.services.permissions import effective_permissions
from app.services.template_library import (
    InvalidTemplateError,
    validate_template_structure,
)

router = APIRouter(
    tags=["inspection-planning"],
)
_db_dependency: Any = Depends(get_db)
_login_dependency: Any = Depends(require_login_access)


class StrictBody(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NameBody(StrictBody):
    name: str = Field(max_length=PLANNING_NAME_MAX)


class TaskCreateBody(StrictBody):
    item_ids: list[UUID] = Field(max_length=ITEM_IDS_MAX)
    zone_id: UUID | None = None
    location_text: str | None = Field(
        default=None, max_length=LOCATION_TEXT_MAX
    )
    suggested_assignee_id: UUID | None = None


class AssignBody(StrictBody):
    assignee_id: UUID | None


class CancelBody(StrictBody):
    reason: str = Field(default="", max_length=LONG_TEXT_MAX)


class LocationBody(StrictBody):
    zone_id: UUID | None
    location_text: str | None = Field(max_length=LOCATION_TEXT_MAX)


class ProjectNumericStandardBody(NumericStandardBody):
    measurement_field_client_id: UUID | None = None


class ProjectMeasurementFieldBody(MeasurementFieldBody):
    id: UUID | None = None
    client_id: UUID | None = None


class ProjectPointBody(PointBody):
    id: UUID | None = None
    numeric_standard: ProjectNumericStandardBody | None = None
    measurement_fields: list[ProjectMeasurementFieldBody] = Field(
        default_factory=list, max_length=MEASUREMENT_FIELDS_MAX
    )


class ProjectItemPatchBody(StrictBody):
    title: str | None = Field(default=None, min_length=1, max_length=TITLE_MAX)
    instruction: str | None = Field(default=None, max_length=LONG_TEXT_MAX)
    inspection_points: list[ProjectPointBody] | None = Field(
        default=None, max_length=POINTS_MAX
    )
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
    if detail == "not_found":
        return ErrorCode.RESOURCE_NOT_FOUND, 404
    if namespace == "authorization" and detail == "forbidden":
        return ErrorCode.PERMISSION_DENIED, 403
    if namespace == "project_inspection_item":
        if detail == "revision_not_increased":
            return ErrorCode.REQUEST_VALIDATION_FAILED, 422
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


def _is_project_member(
    db: Session, *, user_id: UUID, project_id: UUID
) -> bool:
    return (
        db.scalar(
            select(ProjectMember.id).where(
                ProjectMember.project_id == project_id,
                ProjectMember.user_id == user_id,
            )
        )
        is not None
    )


def _resource_permission(resource_type: str, permission: str):
    def check(
        request: Request,
        db: Session = Depends(get_db),  # noqa: B008
        user: User = Depends(require_login),  # noqa: B008
    ) -> User:
        model = InspectionPlan if resource_type == "plan" else InspectionTask
        parameter = "plan_id" if resource_type == "plan" else "task_id"
        resource_id = request.path_params.get(parameter)
        try:
            parsed_id = UUID(str(resource_id))
        except ValueError as exc:
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc
        resource = db.get(model, parsed_id)
        if resource is None:
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
        if user.is_admin:
            return user
        if not _is_project_member(
            db, user_id=user.id, project_id=resource.project_id
        ):
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
        permissions = effective_permissions(
            db, user_id=user.id, project_id=resource.project_id
        )
        if permission not in permissions:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return check


def _task_read_permission():
    def check(
        task_id: UUID,
        db: Session = Depends(get_db),  # noqa: B008
        user: User = Depends(require_login),  # noqa: B008
    ) -> User:
        task = db.get(InspectionTask, task_id)
        if task is None:
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
        permissions = effective_permissions(
            db, user_id=user.id, project_id=task.project_id
        )
        if (
            not user.is_admin
            and not {
                "inspection_task.read",
                "inspection_task.inspect",
            }
            & permissions
        ):
            if not _is_project_member(
                db, user_id=user.id, project_id=task.project_id
            ):
                raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        if (
            not user.is_admin
            and task.status == "DRAFT"
            and "inspection_task.read" not in permissions
        ):
            raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
        return user

    return check


def _zone(db: Session, zone_id: UUID | None) -> dict[str, Any] | None:
    if zone_id is None:
        return None
    zone = db.get(ProjectZone, zone_id)
    return {"id": zone.id, "name": zone.name} if zone else None


def _task_summary(db: Session, task: InspectionTask) -> dict[str, Any]:
    return _task_summaries(db, [task])[0]


def _task_summaries(
    db: Session, tasks: Sequence[InspectionTask]
) -> list[dict[str, Any]]:
    """Serialize tasks with a fixed number of batched queries (#462)."""
    associations = load_grouped(
        db,
        TaskInspectionItem.task_id,
        [task.id for task in tasks],
        TaskInspectionItem.created_at,
        TaskInspectionItem.id,
    )
    snapshots = load_grouped(
        db,
        TaskRequirementSnapshot.task_inspection_item_id,
        [row.id for rows in associations.values() for row in rows],
        TaskRequirementSnapshot.revision,
        TaskRequirementSnapshot.id,
    )
    rendered = _render_snapshots(
        db, [row for rows in snapshots.values() for row in rows]
    )
    assignees = load_by_id(
        db,
        User,
        [task.assignee_id for task in tasks if task.assignee_id is not None],
    )
    zones = load_by_id(
        db,
        ProjectZone,
        [task.zone_id for task in tasks if task.zone_id is not None],
    )
    result = []
    for task in tasks:
        details = []
        for association in associations.get(task.id, ()):
            rows = snapshots.get(association.id, ())
            current = next((row for row in rows if row.is_current), None)
            details.append(
                {
                    "id": association.project_inspection_item_id,
                    "status": association.item_status,
                    "needs_reinspection": association.needs_reinspection,
                    "snapshots": [rendered[row.id] for row in rows],
                    "current_snapshot": rendered[current.id]
                    if current
                    else None,
                }
            )
        assignee = assignees.get(task.assignee_id)
        zone = zones.get(task.zone_id)
        result.append(
            {
                "id": task.id,
                "project_id": task.project_id,
                "plan_id": task.plan_id,
                "status": task.status,
                "zone_id": task.zone_id,
                "zone": {"id": zone.id, "name": zone.name} if zone else None,
                "location_text": task.location_text,
                "assignee_id": task.assignee_id,
                "assignee": _person(assignee) if assignee else None,
                "started_by": task.started_by,
                "completed_by": task.completed_by,
                "cancellation_reason": task.cancellation_reason,
                "cancelled_from": task.cancelled_from_status,
                "dispatched_at": (
                    format_utc(task.dispatched_at)
                    if task.dispatched_at is not None
                    else None
                ),
                "items": details,
                "created_at": task.created_at.isoformat(),
                "updated_at": task.updated_at.isoformat(),
            }
        )
    return result


def _field_task_summary(
    db: Session,
    task: InspectionTask,
    *,
    detail: bool,
    viewer_id: UUID | None = None,
) -> dict[str, Any]:
    project = db.get(Project, task.project_id)
    assignee = db.get(User, task.assignee_id) if task.assignee_id else None
    result: dict[str, Any] = {
        "id": task.id,
        "project_id": task.project_id,
        "project_name": project.name if project else None,
        "status": task.status,
        "dispatched_at": (
            format_utc(task.dispatched_at)
            if task.dispatched_at is not None
            else None
        ),
        "location": {
            "zone_name": (_zone(db, task.zone_id) or {}).get("name"),
            "location_text": task.location_text,
        },
        "suggested_assignee": (
            {"name_zh": assignee.name_zh} if assignee else None
        ),
    }
    if not detail:
        return result
    # Display names only: no account fields, and no ids that let the
    # client guess who a person is. ``is_me`` lets the viewer tell
    # "you" apart without comparing names.
    if assignee is not None and result["suggested_assignee"] is not None:
        result["suggested_assignee"]["is_me"] = assignee.id == viewer_id
    starter = db.get(User, task.started_by) if task.started_by else None
    result["started_by"] = (
        {"name_zh": starter.name_zh, "is_me": starter.id == viewer_id}
        if starter
        else None
    )
    result["cancellation_reason"] = (
        task.cancellation_reason if task.status == "CANCELLED" else None
    )
    summary = _task_summary(db, task)
    result["items"] = []
    for item in summary["items"]:
        current = item["current_snapshot"]
        if current is None:
            continue
        points = []
        for point in current["inspection_points"]:
            numeric = point["numeric_standard"]
            points.append(
                {
                    "sequence": point["sequence"],
                    "title": point["title"],
                    "instruction": point["instruction"],
                    "text_standard": point["text_standard"],
                    "numeric_standard": numeric,
                    "measurement_fields": [
                        {
                            key: field[key]
                            for key in (
                                "id",
                                "name",
                                "field_type",
                                "unit",
                            )
                        }
                        for field in point["measurement_fields"]
                    ],
                    "evidence_requirements": point["evidence_requirements"],
                }
            )
        result["items"].append(
            {
                "title": current["title"],
                "instruction": current["instruction"],
                "inspection_points": points,
            }
        )
    return result


def _person(user: User) -> dict[str, Any]:
    return {"id": user.id, "username": user.username, "name_zh": user.name_zh}


def _render_snapshots(
    db: Session, snapshots: Sequence[TaskRequirementSnapshot]
) -> dict[UUID, dict[str, Any]]:
    """Render snapshots keyed by id, loading child rows in batches."""
    points = load_grouped(
        db,
        TaskSnapshotPoint.snapshot_id,
        [snapshot.id for snapshot in snapshots],
        TaskSnapshotPoint.sequence,
        TaskSnapshotPoint.id,
    )
    point_ids = [row.id for rows in points.values() for row in rows]
    texts = load_grouped(db, TaskSnapshotTextStandard.point_id, point_ids)
    numerics = load_grouped(
        db, TaskSnapshotNumericStandard.point_id, point_ids
    )
    fields = load_grouped(
        db,
        TaskSnapshotMeasurementField.point_id,
        point_ids,
        TaskSnapshotMeasurementField.sort_order,
        TaskSnapshotMeasurementField.id,
    )
    evidences = load_grouped(
        db,
        TaskSnapshotEvidenceRequirement.point_id,
        point_ids,
        TaskSnapshotEvidenceRequirement.id,
    )
    result: dict[UUID, dict[str, Any]] = {}
    for snapshot in snapshots:
        rendered = []
        for point in points.get(snapshot.id, ()):
            text = next(iter(texts.get(point.id, ())), None)
            numeric = next(iter(numerics.get(point.id, ())), None)
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
                        for f in fields.get(point.id, ())
                    ],
                    "evidence_requirements": [
                        {
                            "evidence_type": e.evidence_type,
                            "required": e.required,
                            "min_count": e.min_count,
                            "max_count": e.max_count,
                        }
                        for e in evidences.get(point.id, ())
                    ],
                }
            )
        result[snapshot.id] = {
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
    return result


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
                .where(
                    InspectionTask.plan_id == plan.id,
                    *inspection_task_visibility_filters(
                        db, project_id=plan.project_id
                    ),
                )
                .order_by(InspectionTask.created_at, InspectionTask.id)
            ).all()
        )
        result["tasks"] = _task_summaries(db, tasks)
    return result


def _one_plan(db: Session, plan_id: UUID) -> InspectionPlan:
    plan = db.get(InspectionPlan, plan_id)
    if plan is None:
        _call(get_inspection_plan, db, plan_id=plan_id)
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return plan


def _one_task(db: Session, task_id: UUID) -> InspectionTask:
    task = db.get(InspectionTask, task_id)
    if task is None:
        _call(get_inspection_task, db, task_id=task_id)
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return task


@router.get(
    "/projects/{project_id}/inspection-plans",
    dependencies=[
        Depends(require_project_permission("inspection_plan.read")),
    ],
)
def plans(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
):
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
    dependencies=[
        Depends(require_project_permission("inspection_plan.create")),
    ],
)
def create_plan(
    project_id: UUID, body: NameBody, db: Session = _db_dependency
):
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
    # inspection_plan.read also grants names needed to display its Plans.
    permissions = effective_permissions(
        db, user_id=_user.id, project_id=project_id
    )
    if (
        not _user.is_admin
        and not {"project_zone.read", "inspection_plan.read"} & permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    _project_exists(db, project_id)
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
    dependencies=[
        Depends(
            require_project_permission(
                "project_zone.manage", uuid_path_params=("zone_id",)
            )
        )
    ],
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
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
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
    dependencies=[
        Depends(
            require_project_permission(
                "project_zone.manage", uuid_path_params=("zone_id",)
            )
        )
    ],
)
def remove_zone(project_id: UUID, zone_id: UUID, db: Session = _db_dependency):
    zone = db.scalar(
        select(ProjectZone).where(
            ProjectZone.id == zone_id, ProjectZone.project_id == project_id
        )
    )
    if zone is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    _call(delete_project_zone, db, zone)


@router.get(
    "/inspection-plans/{plan_id}",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_plan.read")),
    ],
)
def get_plan(plan_id: UUID, db: Session = _db_dependency):
    row = _call(get_inspection_plan, db, plan_id=plan_id)
    return _plan_summary(db, row, with_tasks=True)


@router.patch(
    "/inspection-plans/{plan_id}",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_plan.manage")),
    ],
)
def patch_plan(plan_id: UUID, body: NameBody, db: Session = _db_dependency):
    row = _one_plan(db, plan_id)
    return _plan_summary(
        db, _call(rename_inspection_plan, db, row, name=body.name)
    )


@router.post(
    "/inspection-plans/{plan_id}/tasks",
    status_code=201,
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_task.create")),
    ],
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
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_plan.read")),
    ],
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
        filters=(
            InspectionTask.plan_id == plan.id,
            *inspection_task_visibility_filters(
                db, project_id=plan.project_id
            ),
        ),
        serialize_batch=lambda rows: _task_summaries(db, rows),
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
    filters = _call(inspection_task_list_filters, db, project_id=project_id)
    _project_exists(db, project_id)
    return page(
        db,
        InspectionTask,
        cursor=cursor,
        limit=limit,
        filters=filters,
        serialize_batch=lambda rows: _task_summaries(db, rows),
    )


@router.get(
    "/projects/{project_id}/inspection-items/"
    "{project_inspection_item_id}/tasks",
    dependencies=[
        Depends(
            require_project_permission(
                "project_inspection_item.edit",
                param_name="project_id",
                uuid_path_params=("project_inspection_item_id",),
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
        serialize_batch=lambda rows: _impact_summaries(db, rows),
    )


def _impact_summaries(db: Session, tasks: Sequence[InspectionTask]):
    plans = load_by_id(db, InspectionPlan, [task.plan_id for task in tasks])
    summaries = _task_summaries(db, tasks)
    for task, summary in zip(tasks, summaries, strict=True):
        plan = plans.get(task.plan_id)
        summary.update(
            {
                "plan_name": plan.name if plan else None,
                "plan_archived": bool(plan and plan.is_archived),
                # Results are not part of the inspection-planning API
                # before the 0.7.x result endpoints are introduced.
                "has_result": False,
            }
        )
    return summaries


@router.get("/projects/{project_id}/inspection-task-assignees")
def assignees(
    project_id: UUID,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    db: Session = _db_dependency,
    _user: User = _login_dependency,
):
    permissions = effective_permissions(
        db, user_id=_user.id, project_id=project_id
    )
    if (
        not _user.is_admin
        and not {"inspection_task.create", "inspection_task.assign"}
        & permissions
    ):
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    _project_exists(db, project_id)
    candidate_ids = (
        select(ProjectMember.user_id)
        .join(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .join(
            RolePermission,
            RolePermission.role_id == ProjectMemberRole.role_id,
        )
        .where(
            ProjectMember.project_id == project_id,
            RolePermission.code == "inspection_task.inspect",
        )
        .distinct()
    )
    return page(
        db,
        User,
        cursor=cursor,
        limit=limit,
        filters=(User.id.in_(candidate_ids), User.is_admin.is_(False)),
        serialize=_person,
    )


@router.post(
    "/inspection-tasks/{task_id}:dispatch",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.dispatch")),
    ],
)
def dispatch(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(dispatch_inspection_task, db, task))


@router.get(
    "/field/inspection-tasks",
    dependencies=[
        Depends(
            require_admin_or_any_project_permission("inspection_task.inspect")
        )
    ],
)
def field_inspection_tasks(
    assigned_to_me: bool = True,
    project_id: UUID | None = None,
    status: Literal["PENDING", "IN_PROGRESS"] | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = _db_dependency,
    user: User = Depends(require_login),  # noqa: B008
):
    try:
        filters = field_inspection_task_filters(
            db,
            user_id=user.id,
            is_admin=user.is_admin,
            assigned_to_me=assigned_to_me,
            project_id=project_id,
            status=status,
        )
    except PlanningError as exc:
        response = _planning_error_response(exc.code)
        if response is None:
            raise
        raise APIError(response[0], response[1]) from exc
    key = page_cursor_key(cursor)
    statement = select(InspectionTask).where(*filters)
    if key is not None:
        statement = statement.where(
            or_(
                InspectionTask.dispatched_at < key[0],
                and_(
                    InspectionTask.dispatched_at == key[0],
                    InspectionTask.id < key[1],
                ),
            )
        )
    page_rows = db.scalars(
        statement.order_by(
            InspectionTask.dispatched_at.desc().nulls_last(),
            InspectionTask.id.desc(),
        ).limit(limit + 1)
    ).all()
    items = page_rows[:limit]
    # Keep referenced rows alive in the identity map for the whole page.
    _projects = db.scalars(
        select(Project).where(
            Project.id.in_({task.project_id for task in items})
        )
    ).all()
    _assignees = db.scalars(
        select(User).where(
            User.id.in_(
                {
                    task.assignee_id
                    for task in items
                    if task.assignee_id is not None
                }
            )
        )
    ).all()
    _zones = db.scalars(
        select(ProjectZone).where(
            ProjectZone.id.in_(
                {task.zone_id for task in items if task.zone_id is not None}
            )
        )
    ).all()
    summaries: dict[UUID, tuple[str, int]] = {}
    if items:
        rows = db.execute(
            select(
                TaskInspectionItem.task_id,
                TaskInspectionItem.id,
                TaskRequirementSnapshot.title,
            )
            .join(
                TaskRequirementSnapshot,
                and_(
                    TaskRequirementSnapshot.task_inspection_item_id
                    == TaskInspectionItem.id,
                    TaskRequirementSnapshot.is_current.is_(True),
                ),
                isouter=True,
            )
            .where(
                TaskInspectionItem.task_id.in_([task.id for task in items]),
            )
            .order_by(
                TaskInspectionItem.task_id,
                TaskInspectionItem.created_at,
                TaskInspectionItem.id,
            )
        ).all()
        for task_id, _, title in rows:
            first, count = summaries.get(task_id, (title, 0))
            summaries[task_id] = (first, count + 1)
    next_cursor = None
    if len(page_rows) > limit:
        last = items[-1]
        if last.dispatched_at is None:
            raise APIError(ErrorCode.SERVER_INTERNAL_ERROR, 500)
        next_cursor = encode_page_cursor(last.dispatched_at, last.id)
    return {
        "items": [
            {
                **_field_task_summary(db, task, detail=False),
                "item_summary": {
                    "first_title": summaries.get(task.id, (None, 0))[0],
                    "item_count": summaries.get(task.id, (None, 0))[1],
                },
            }
            for task in items
        ],
        "next_cursor": next_cursor,
    }


@router.get(
    "/field/inspection-tasks/{task_id}",
    dependencies=[Depends(require_login_access)],
)
def field_inspection_task(
    task_id: UUID,
    db: Session = _db_dependency,
    user: User = Depends(require_login),  # noqa: B008
):
    task = _call(
        get_field_inspection_task,
        db,
        task_id=task_id,
        user_id=user.id,
        is_admin=user.is_admin,
    )
    return _field_task_summary(db, task, detail=True, viewer_id=user.id)


@router.post(
    "/inspection-tasks/{task_id}:assign",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.assign")),
    ],
)
def assign(task_id: UUID, body: AssignBody, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(
        db,
        _call(assign_inspection_task, db, task, assignee_id=body.assignee_id),
    )


@router.post(
    "/inspection-tasks/{task_id}:start",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.inspect")),
    ],
)
def start(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(start_inspection_task, db, task))


@router.post(
    "/inspection-tasks/{task_id}:complete",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.inspect")),
    ],
)
def complete(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(complete_inspection_task, db, task))


@router.delete(
    "/inspection-tasks/{task_id}",
    status_code=204,
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.delete_draft")),
    ],
)
def delete_task(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    _call(delete_draft_inspection_task, db, task)


@router.post(
    "/inspection-tasks/{task_id}:cancel",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.cancel")),
    ],
)
def cancel(
    task_id: UUID,
    body: CancelBody | None = None,
    db: Session = _db_dependency,
):
    task = _one_task(db, task_id)
    reason = body.reason if body is not None else ""
    return _task_summary(
        db,
        _call(
            cancel_inspection_task,
            db,
            task,
            reason=reason,
        ),
    )


@router.post(
    "/inspection-tasks/{task_id}:restore",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.cancel")),
    ],
)
def restore(task_id: UUID, db: Session = _db_dependency):
    task = _one_task(db, task_id)
    return _task_summary(db, _call(restore_inspection_task, db, task))


@router.patch(
    "/inspection-tasks/{task_id}",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("task", "inspection_task.manage")),
    ],
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
    dependencies=[
        Depends(require_login_access),
        Depends(_task_read_permission()),
    ],
)
def get_task(task_id: UUID, db: Session = _db_dependency):
    return _task_summary(db, _call(get_inspection_task, db, task_id=task_id))


@router.post(
    "/inspection-plans/{plan_id}:archive",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_plan.archive")),
    ],
)
def archive(plan_id: UUID, db: Session = _db_dependency):
    plan = _one_plan(db, plan_id)
    return _plan_summary(
        db, _call(archive_inspection_plan, db, plan, archived=True)
    )


@router.post(
    "/inspection-plans/{plan_id}:unarchive",
    dependencies=[
        Depends(require_login_access),
        Depends(_resource_permission("plan", "inspection_plan.unarchive")),
    ],
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
                "project_inspection_item.edit",
                param_name="project_id",
                uuid_path_params=("project_inspection_item_id",),
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
    if associations and body.reinspect is None:
        raise APIError(
            ErrorCode.PROJECT_ITEM_REINSPECTION_CHOICE_REQUIRED, 422
        )
    if body.inspection_points is not None:
        _validate_project_points(
            db,
            item,
            body.inspection_points,
            has_tasks=bool(associations),
            reinspect=body.reinspect,
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
    result = project_inspection_item_detail(db, item)
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


def _validate_project_points(
    db: Session,
    item: ProjectInspectionItem,
    points: list[ProjectPointBody],
    *,
    has_tasks: bool,
    reinspect: bool | None,
) -> None:
    """Apply the template structure rules before any row is touched."""
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
            if field.client_id is not None:
                if field.client_id in seen_field_client_ids:
                    raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
                seen_field_client_ids.add(field.client_id)
            for token in (field.id, field.client_id):
                if token is None:
                    continue
                owner = identity_owner.setdefault(token, index)
                if owner != index:
                    raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

        standard = point.numeric_standard
        if standard is None:
            bound_id = None
        else:
            bound_id = standard.measurement_field_client_id
        normalized = point.model_dump()
        normalized["measurement_fields"] = [
            {**field.model_dump(), "client_id": field.client_id}
            for field in point.measurement_fields
        ]
        if normalized["numeric_standard"] is not None:
            normalized["numeric_standard"]["measurement_field_client_id"] = (
                bound_id
            )
        normalized_points.append(normalized)

    try:
        validate_template_structure({"inspection_points": normalized_points})
    except InvalidTemplateError as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc

    if has_tasks and not points:
        raise APIError(ErrorCode.PROJECT_INSPECTION_ITEM_POINTS_REQUIRED, 422)
    if has_tasks and reinspect is False:
        if any(point_id is None for point_id in point_identities):
            raise APIError(
                ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
            )
        if set(point_identities) != existing_point_ids:
            raise APIError(
                ErrorCode.PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED, 422
            )
        for point, point_id in zip(points, point_identities, strict=True):
            assert point_id is not None
            old_fields = fields_by_point.get(point_id, {})
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


def _replace_project_points(
    db: Session, item: ProjectInspectionItem, points: list[ProjectPointBody]
) -> None:
    old_points = db.scalars(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id == item.id
        )
    ).all()
    points_by_id = {point.id: point for point in old_points}
    preserve_ids = any(point.id is not None for point in points)
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
    for index, point in enumerate(old_points, start=1):
        point.sequence = -index
    db.flush()

    retained_point_ids: set[UUID] = set()
    for source in points:
        point_identity = source.id
        point = (
            points_by_id.get(point_identity)
            if preserve_ids and point_identity is not None
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
        for index, source_field in enumerate(source.measurement_fields):
            field_identity = source_field.id
            field = (
                existing_fields.get(field_identity)
                if field_identity is not None
                else None
            )
            if field is None:
                field = ProjectMeasurementField(
                    id=uuid7(),
                    inspection_point_id=point.id,
                    project_inspection_item_id=item.id,
                    name=source_field.name,
                    field_type=source_field.field_type,
                    unit=source_field.unit,
                    sort_order=index,
                    created_by=item.updated_by,
                    updated_by=item.updated_by,
                )
                db.add(field)
            else:
                field.name = source_field.name
                field.field_type = source_field.field_type
                field.unit = source_field.unit
                field.sort_order = index
                field.updated_by = item.updated_by
            retained_field_ids.add(field.id)
            if field_identity is not None:
                field_map[field_identity] = field.id
            if source_field.client_id is not None:
                mapped = field_map.get(source_field.client_id)
                if mapped is not None and mapped != field.id:
                    raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
                field_map[source_field.client_id] = field.id

        for field_id, field in existing_fields.items():
            if field_id not in retained_field_ids:
                db.delete(field)

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
            field_id = (
                field_map.get(field_identity)
                if field_identity is not None
                else None
            )
            if field_id is None:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
            field = next(
                row
                for row in source.measurement_fields
                if row.client_id == field_identity or row.id == field_identity
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

    for point in old_points:
        if point.id not in retained_point_ids:
            db.delete(point)
    db.flush()
