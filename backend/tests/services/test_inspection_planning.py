"""Service behavior for inspection planning (IP-AC03--IP-AC11)."""

import uuid

import pytest
from sqlalchemy import select

from app.models import (
    AuditLog,
    InspectionTask,
    ProjectInspectionItem,
    ProjectMember,
    ProjectMemberRole,
    ProjectZone,
    Role,
    RolePermission,
    TaskInspectionItem,
    TaskRequirementSnapshot,
)
from app.services.inspection_planning import (
    PlanningError,
    archive_inspection_plan,
    cancel_inspection_task,
    complete_inspection_task,
    create_inspection_plan,
    create_inspection_task,
    create_project_zone,
    delete_draft_inspection_task,
    delete_project_zone,
    derive_plan_status,
    dispatch_inspection_task,
    rename_project_zone,
    restore_inspection_task,
    start_inspection_task,
    update_project_item_usage,
    update_task_location,
)
from app.services.projects import create_project


def _project(session, operator, suffix="A"):
    return create_project(
        session,
        project_code=f"PLAN-{suffix}",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
    )


def _grant(session, operator, project, *codes):
    role = Role(
        name=f"planning-{uuid.uuid4().hex[:8]}",
        created_by=operator.id,
        updated_by=operator.id,
        permission_codes=[RolePermission(code=code) for code in codes],
    )
    session.add(role)
    session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=operator.id,
        created_by=operator.id,
        updated_by=operator.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    session.add(member)
    session.flush()
    return role


def _source_item(session, operator, project, title="項目 A"):
    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title=title,
        instruction="檢查內容 A",
        source_template_name="示範範本",
        applied_at=operator.created_at,
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(item)
    session.flush()
    return item


def _planning_codes():
    return (
        "project_zone.manage",
        "inspection_plan.create",
        "inspection_plan.manage",
        "inspection_plan.archive",
        "inspection_plan.unarchive",
        "inspection_task.manage",
        "inspection_task.create",
        "inspection_task.dispatch",
        "inspection_task.delete_draft",
        "inspection_task.cancel",
        "inspection_task.inspect",
        "project_inspection_item.edit",
    )


class TestDerivedPlanStatus:
    @pytest.mark.parametrize(
        ("statuses", "expected"),
        [
            ([], "DRAFT"),
            (["DRAFT"], "DRAFT"),
            (["DRAFT", "CANCELLED"], "DRAFT"),
            (["PENDING"], "IN_PROGRESS"),
            (["COMPLETED"], "COMPLETED"),
            (["COMPLETED", "CANCELLED"], "COMPLETED"),
            (["CANCELLED"], "CANCELLED"),
            (["CANCELLED", "CANCELLED"], "CANCELLED"),
            (["COMPLETED", "DRAFT"], "IN_PROGRESS"),
        ],
    )
    def test_status_table(self, statuses, expected):
        assert derive_plan_status(statuses) == expected


def test_project_zone_normalization_audit_and_referenced_delete(
    session, operator
):
    project = _project(session, operator, "ZONE")
    _grant(session, operator, project, *_planning_codes())
    zone = create_project_zone(session, project_id=project.id, name="  北側  ")
    assert zone.name == "北側"
    with pytest.raises(PlanningError) as conflict:
        create_project_zone(session, project_id=project.id, name="北側")
    assert conflict.value.code == "project_zone.name_conflict"

    rename_project_zone(session, zone, name="南側")
    plan = create_inspection_plan(
        session, project_id=project.id, name="分區計畫"
    )
    item = _source_item(session, operator, project)
    task = create_inspection_task(
        session,
        plan=plan,
        project_inspection_item_ids=[item.id],
        zone_id=zone.id,
    )
    with pytest.raises(PlanningError) as in_use:
        delete_project_zone(session, zone)
    assert in_use.value.code == "project_zone.in_use"
    assert session.get(ProjectZone, zone.id) is zone
    assert task.zone_id == zone.id
    events = session.scalars(
        select(AuditLog.event_type).where(AuditLog.entity_id == zone.id)
    ).all()
    assert events == ["project_zone.created", "project_zone.updated"]


def test_zone_without_task_can_be_deleted(session, operator):
    project = _project(session, operator, "ZONEDEL")
    _grant(session, operator, project, "project_zone.manage")
    zone = create_project_zone(session, project_id=project.id, name="待刪分區")
    delete_project_zone(session, zone)
    assert session.get(ProjectZone, zone.id) is None
    assert (
        session.scalar(
            select(AuditLog.id).where(
                AuditLog.event_type == "project_zone.deleted",
                AuditLog.entity_id == zone.id,
            )
        )
        is not None
    )


def test_task_snapshot_location_state_and_restore_audit(session, operator):
    project = _project(session, operator, "TASK")
    _grant(session, operator, project, *_planning_codes())
    zone = create_project_zone(session, project_id=project.id, name="第一區")
    plan = create_inspection_plan(
        session, project_id=project.id, name="計畫一"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session,
        plan=plan,
        project_inspection_item_ids=[source.id],
        zone_id=zone.id,
        location_text="  樁號 10  ",
    )
    snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id
            == session.scalar(
                select(TaskInspectionItem.id).where(
                    TaskInspectionItem.task_id == task.id
                )
            )
        )
    )
    assert snapshot is not None
    assert snapshot.title == "項目 A"
    assert task.location_text == "樁號 10"

    update_task_location(
        session, task, zone_id=zone.id, location_text="樁號 11"
    )
    dispatch_inspection_task(session, task)
    assert task.status == "PENDING"
    start_inspection_task(session, task)
    assert task.status == "IN_PROGRESS"
    cancel_inspection_task(session, task, reason="天候因素")
    assert task.status == "CANCELLED"
    restore_inspection_task(session, task)
    assert task.status == "IN_PROGRESS"
    assert task.cancellation_reason is None
    event_types = session.scalars(
        select(AuditLog.event_type).where(AuditLog.entity_id == task.id)
    ).all()
    assert "inspection_task.location_updated" in event_types
    assert "inspection_task.cancelled" in event_types
    assert "inspection_task.restored" in event_types


def test_task_creation_requires_zone_only_when_project_has_zones(
    session, operator
):
    project = _project(session, operator, "LOC")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="無分區計畫"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session,
        plan=plan,
        project_inspection_item_ids=[source.id],
        location_text="補充位置",
    )
    assert task.zone_id is None
    assert task.location_text == "補充位置"

    create_project_zone(session, project_id=project.id, name="已有分區")
    with pytest.raises(PlanningError) as required:
        create_inspection_task(
            session,
            plan=plan,
            project_inspection_item_ids=[source.id],
        )
    assert required.value.code == "inspection_task.invalid_zone"


def test_cross_project_zone_is_rejected(session, operator):
    project_a = _project(session, operator, "CROSSA")
    project_b = _project(session, operator, "CROSSB")
    _grant(session, operator, project_a, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project_a.id, name="跨專案"
    )
    item = _source_item(session, operator, project_a)
    zone_b = ProjectZone(
        project_id=project_b.id,
        name="外部區",
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(zone_b)
    session.flush()
    with pytest.raises(PlanningError) as invalid:
        create_inspection_task(
            session,
            plan=plan,
            project_inspection_item_ids=[item.id],
            zone_id=zone_b.id,
        )
    assert invalid.value.code == "inspection_task.invalid_zone"


def test_completed_task_blocked_by_reinspection_and_kd55_reopens(
    session, operator
):
    project = _project(session, operator, "KD55")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="重查計畫"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task.status = "COMPLETED"
    plan.status = "COMPLETED"
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    task_item.item_status = "COMPLETED"

    source.title = "項目 A 修改"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"title": "項目 A", "instruction": "檢查內容 A"},
        reinspection_required=True,
    )
    assert task.status == "IN_PROGRESS"
    assert plan.status == "IN_PROGRESS"
    assert task_item.needs_reinspection is True
    with pytest.raises(PlanningError) as blocked:
        complete_inspection_task(session, task)
        assert blocked.value.code == "inspection_task.items_incomplete"


def test_no_reinspection_updates_snapshot_without_task_status_change(
    session, operator
):
    project = _project(session, operator, "TEXTFIX")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="文字修正"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task.status = "IN_PROGRESS"
    source.instruction = "更新內容"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"title": "項目 A", "instruction": "檢查內容 A"},
        reinspection_required=False,
    )
    assert task.status == "IN_PROGRESS"
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    assert task_item.needs_reinspection is False
    snapshots = session.scalars(
        select(TaskRequirementSnapshot)
        .where(TaskRequirementSnapshot.task_inspection_item_id == task_item.id)
        .order_by(TaskRequirementSnapshot.revision)
    ).all()
    assert len(snapshots) == 2
    assert snapshots[0].is_current is False
    assert snapshots[0].superseded_reason == "TEXT_CORRECTED"
    assert snapshots[1].is_current is True
    assert snapshots[1].instruction == "更新內容"


def test_draft_kd55_replaces_snapshot_without_retaining_history(
    session, operator
):
    project = _project(session, operator, "DRAFTFIX")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="草稿標準更新"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    source.title = "草稿新項目"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"title": "項目 A", "instruction": "檢查內容 A"},
        reinspection_required=True,
    )
    snapshots = session.scalars(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id
        )
    ).all()
    assert len(snapshots) == 1
    assert snapshots[0].is_current is True
    assert snapshots[0].title == "草稿新項目"
    assert task.status == "DRAFT"
    assert task_item.needs_reinspection is False


def test_archived_plan_locks_task_changes_and_unarchive_rederives(
    session, operator
):
    project = _project(session, operator, "ARCHIVE")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="封存計畫"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    dispatch_inspection_task(session, task)
    archive_inspection_plan(session, plan, archived=True)
    with pytest.raises(PlanningError) as locked:
        dispatch_inspection_task(session, task)
    assert locked.value.code == "inspection_task.invalid_transition"
    plan.status = "COMPLETED"
    archive_inspection_plan(session, plan, archived=False)
    assert plan.status == "IN_PROGRESS"


def test_draft_task_hard_delete_is_audited_and_plan_rederived(
    session, operator
):
    project = _project(session, operator, "DELETE")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="草稿刪除"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_id = task.id
    delete_draft_inspection_task(session, task)
    assert session.get(InspectionTask, task_id) is None
    assert plan.status == "DRAFT"
    event = session.scalar(
        select(AuditLog).where(
            AuditLog.entity_id == task_id,
            AuditLog.event_type == "inspection_task.deleted",
        )
    )
    assert event is not None
