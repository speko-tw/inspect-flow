"""Service behavior for inspection planning (IP-AC03--IP-AC11)."""

import uuid

import pytest
from sqlalchemy import func, select

from app.models import (
    AuditLog,
    InspectionPlan,
    InspectionTask,
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectMember,
    ProjectMemberRole,
    ProjectTextStandard,
    ProjectZone,
    Role,
    RolePermission,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotMeasurementField,
    TaskSnapshotPoint,
    TaskSnapshotTextStandard,
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
    derive_plan_status,
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
from app.services.projects import create_project
from tests.db.conftest import create_root_user_with_company


def _project(session, operator, suffix="A"):
    return create_project(
        session,
        project_code=f"PLAN-{suffix}",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
    )


def _grant(session, operator, project, *codes, user=None):
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
        user_id=(user or operator).id,
        created_by=operator.id,
        updated_by=operator.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    session.add(member)
    session.flush()
    return role


def _add_member(session, operator, project, user):
    member = ProjectMember(
        project_id=project.id,
        user_id=user.id,
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(member)
    session.flush()
    return member


def _source_item(session, operator, project, title="項目 A", sequence=1):
    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=sequence,
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
        "inspection_plan.read",
        "inspection_plan.manage",
        "inspection_plan.archive",
        "inspection_plan.unarchive",
        "inspection_task.manage",
        "inspection_task.create",
        "inspection_task.read",
        "inspection_task.assign",
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
    zone_name = "  北側  "
    zone_args = {"project_id": project.id, "name": zone_name}
    zone = create_project_zone(session, **zone_args)
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
        select(AuditLog).where(AuditLog.entity_id == zone.id)
    ).all()
    assert [event.event_type for event in events] == [
        "project_zone.created",
        "project_zone.updated",
    ]
    assert events[0].created_by == operator.id
    assert [event.project_id for event in events] == [project.id, project.id]
    assert events[0].after == {"project_id": str(project.id), "name": "北側"}
    assert events[1].before == {"name": "北側"}
    assert events[1].after == {"name": "南側"}


def test_zone_without_task_can_be_deleted(session, operator):
    project = _project(session, operator, "ZONEDEL")
    _grant(session, operator, project, "project_zone.manage")
    zone_name = "待刪分區"
    zone = create_project_zone(session, project_id=project.id, name=zone_name)
    delete_project_zone(session, zone)
    assert session.get(ProjectZone, zone.id) is None
    deleted = session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "project_zone.deleted",
            AuditLog.entity_id == zone.id,
        )
    )
    assert deleted is not None
    assert deleted.project_id == project.id


def test_zone_name_uses_trim_casefold_and_length_boundary(session, operator):
    project = _project(session, operator, "ZONECASE")
    _grant(session, operator, project, "project_zone.manage")
    zone = create_project_zone(session, project_id=project.id, name="  North ")
    with pytest.raises(PlanningError) as duplicate:
        create_project_zone(session, project_id=project.id, name="north")
    assert duplicate.value.code == "project_zone.name_conflict"

    max_zone = create_project_zone(
        session, project_id=project.id, name="x" * 128
    )
    assert len(max_zone.name) == 128
    with pytest.raises(PlanningError) as too_long:
        create_project_zone(session, project_id=project.id, name="x" * 129)
    assert too_long.value.code == "project_zone.invalid_name"
    assert zone.name == "North"


def test_read_permissions_hide_drafts_and_reject_unauthorized(
    session, operator, monkeypatch
):
    project = _project(session, operator, "READ")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="權限查詢"
    )
    source = _source_item(session, operator, project)
    draft = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    reader = create_root_user_with_company(session, "READ001")
    reader.is_system = False
    with monkeypatch.context() as scoped:
        scoped.setattr(
            "app.services.inspection_planning.get_current_operator",
            lambda _: reader,
        )
        with pytest.raises(PlanningError) as forbidden:
            list_inspection_plans(session, project_id=project.id)
        assert forbidden.value.code == "authorization.forbidden"

        _grant(
            session,
            operator,
            project,
            "inspection_task.inspect",
            user=reader,
        )
        assert list_inspection_tasks(session, project_id=project.id) == []
        with pytest.raises(PlanningError) as hidden:
            get_inspection_task(session, task_id=draft.id)
        assert hidden.value.code == "inspection_task.not_found"
        scoped.setattr(
            "app.services.inspection_planning.get_current_operator",
            lambda _: operator,
        )
        dispatch_inspection_task(session, draft)
        scoped.setattr(
            "app.services.inspection_planning.get_current_operator",
            lambda _: reader,
        )
        assert list_inspection_tasks(session, project_id=project.id) == [draft]


def test_plan_manage_and_assignee_must_be_project_members(session, operator):
    project = _project(session, operator, "ASSIGN")
    _grant(session, operator, project, *_planning_codes())
    assignee = create_root_user_with_company(session, "ASSIGN001")
    _grant(
        session,
        operator,
        project,
        "inspection_task.inspect",
        user=assignee,
    )
    plan = create_inspection_plan(
        session, project_id=project.id, name="初始名稱"
    )
    assert get_inspection_plan(session, plan_id=plan.id) is plan
    rename_inspection_plan(session, plan, name="  調整名稱  ")
    assert plan.name == "調整名稱"
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    assign_inspection_task(session, task, assignee_id=assignee.id)
    assert task.assignee_id == assignee.id
    with pytest.raises(PlanningError) as invalid:
        assign_inspection_task(session, task, assignee_id=uuid.uuid4())
    assert invalid.value.code == "inspection_task.invalid_assignee"


def test_non_assignee_with_inspection_permission_can_start_task(
    session, operator, monkeypatch
):
    project = _project(session, operator, "NONASSIGNEE")
    _grant(session, operator, project, *_planning_codes())
    inspector = create_root_user_with_company(session, "INSPECT01")
    assignee = create_root_user_with_company(session, "ASSIGNED01")
    _grant(
        session,
        operator,
        project,
        "inspection_task.inspect",
        user=inspector,
    )
    _grant(
        session,
        operator,
        project,
        "inspection_task.inspect",
        user=assignee,
    )
    plan = create_inspection_plan(
        session, project_id=project.id, name="指派不排他"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    assign_inspection_task(session, task, assignee_id=assignee.id)
    dispatch_inspection_task(session, task)

    monkeypatch.setattr(
        "app.services.inspection_planning.get_current_operator",
        lambda _: inspector,
    )
    start_inspection_task(session, task)

    assert task.status == "IN_PROGRESS"
    assert task.assignee_id == assignee.id
    assert task.started_by == inspector.id
    assert task.started_at is not None


def test_task_lock_queries_follow_plan_then_task_order(
    session, operator, monkeypatch
):
    project = _project(session, operator, "LOCKORDER")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="鎖定順序"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    original_scalar = session.scalar
    locked_entities = []

    def capture_scalar(statement, *args, **kwargs):
        if statement._for_update_arg is not None:
            locked_entities.append(statement.column_descriptions[0]["entity"])
        return original_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(session, "scalar", capture_scalar)
    dispatch_inspection_task(session, task)
    assert locked_entities == [InspectionPlan, InspectionTask, InspectionPlan]


def test_task_creation_locks_source_item_before_plan(
    session, operator, monkeypatch
):
    project = _project(session, operator, "CREATELOCKORDER")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="建立任務鎖定順序"
    )
    source = _source_item(session, operator, project)
    original_scalars = session.scalars
    original_scalar = session.scalar
    locked_entities = []

    def capture_lock(statement):
        if statement._for_update_arg is not None:
            locked_entities.append(
                (
                    statement.column_descriptions[0]["entity"],
                    statement._for_update_arg.read,
                )
            )

    def capture_scalars(statement, *args, **kwargs):
        capture_lock(statement)
        return original_scalars(statement, *args, **kwargs)

    def capture_scalar(statement, *args, **kwargs):
        capture_lock(statement)
        return original_scalar(statement, *args, **kwargs)

    monkeypatch.setattr(session, "scalars", capture_scalars)
    monkeypatch.setattr(session, "scalar", capture_scalar)
    create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )

    assert locked_entities[:2] == [
        (ProjectInspectionItem, True),
        (InspectionPlan, False),
    ]


def test_snapshot_child_rows_copy_source_and_remain_immutable(
    session, operator
):
    project = _project(session, operator, "SNAPCHILD")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="子表快照"
    )
    source = _source_item(session, operator, project)
    point = ProjectInspectionPoint(
        project_inspection_item_id=source.id,
        sequence=1,
        title="測點原名",
        instruction="測點原說明",
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(point)
    session.flush()
    session.add_all(
        [
            ProjectMeasurementField(
                inspection_point_id=point.id,
                project_inspection_item_id=source.id,
                name=name,
                field_type="text",
                sort_order=sort_order,
                created_by=operator.id,
                updated_by=operator.id,
            )
            for sort_order, name in enumerate(("第一欄", "第二欄", "第三欄"))
        ]
    )
    session.flush()
    standard = ProjectTextStandard(
        inspection_point_id=point.id,
        project_inspection_item_id=source.id,
        text="文字標準原文",
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(standard)
    session.flush()
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id
        )
    )
    assert snapshot is not None
    snapshot_point = session.scalar(
        select(TaskSnapshotPoint).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert snapshot_point is not None
    snapshot_text = session.scalar(
        select(TaskSnapshotTextStandard).where(
            TaskSnapshotTextStandard.point_id == snapshot_point.id
        )
    )
    assert snapshot_text is not None
    assert snapshot_point.title == "測點原名"
    assert snapshot_text.text == "文字標準原文"
    snapshot_fields = session.scalars(
        select(TaskSnapshotMeasurementField)
        .where(TaskSnapshotMeasurementField.point_id == snapshot_point.id)
        .order_by(TaskSnapshotMeasurementField.sort_order)
    ).all()
    assert [field.name for field in snapshot_fields] == [
        "第一欄",
        "第二欄",
        "第三欄",
    ]

    dispatch_inspection_task(session, task)
    point.title = "測點新名"
    standard.text = "文字標準新文"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"standard_revision": 1},
        reinspection_required=False,
    )
    assert snapshot_point.title == "測點原名"
    assert snapshot_text.text == "文字標準原文"


def test_task_snapshot_location_state_and_restore_audit(session, operator):
    project = _project(session, operator, "TASK")
    _grant(session, operator, project, *_planning_codes())
    zone_name = "第一區"
    zone = create_project_zone(session, project_id=project.id, name=zone_name)
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
    events = session.scalars(
        select(AuditLog).where(AuditLog.entity_id == task.id)
    ).all()
    event_types = [event.event_type for event in events]
    assert "inspection_task.location_updated" in event_types
    assert "inspection_task.cancelled" in event_types
    assert "inspection_task.restored" in event_types
    assert all(event.project_id == project.id for event in events)
    assert all(
        "project_id" not in (payload or {})
        for event in events
        for payload in (event.before, event.after)
    )


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


def test_location_and_cancellation_guards_cover_terminal_and_archived_states(
    session, operator
):
    project = _project(session, operator, "LOCLOCK")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="地點狀態限制"
    )
    source = _source_item(session, operator, project)
    completed = create_inspection_task(
        session,
        plan=plan,
        project_inspection_item_ids=[source.id],
        location_text="  ",
    )
    assert completed.location_text is None
    with pytest.raises(PlanningError) as draft_cancel:
        cancel_inspection_task(session, completed, reason="草稿不可取消")
    assert draft_cancel.value.code == "inspection_task.invalid_transition"
    with pytest.raises(PlanningError) as empty_reason:
        cancel_inspection_task(session, completed, reason="   ")
    assert empty_reason.value.code == "inspection_task.invalid_transition"

    dispatch_inspection_task(session, completed)
    start_inspection_task(session, completed)
    complete_inspection_task(session, completed)
    with pytest.raises(PlanningError) as completed_location:
        update_task_location(
            session,
            completed,
            zone_id=None,
            location_text="完成後不可改",
        )
    assert completed_location.value.code == "inspection_task.location_locked"
    with pytest.raises(PlanningError) as completed_cancel:
        cancel_inspection_task(session, completed, reason="已完成")
    assert completed_cancel.value.code == "inspection_task.invalid_transition"

    cancelled = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    dispatch_inspection_task(session, cancelled)
    cancel_inspection_task(session, cancelled, reason="取消驗證")
    with pytest.raises(PlanningError) as cancelled_location:
        update_task_location(
            session,
            cancelled,
            zone_id=None,
            location_text="取消後不可改",
        )
    assert cancelled_location.value.code == "inspection_task.location_locked"
    restore_inspection_task(session, cancelled)

    archived = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    archive_inspection_plan(session, plan, archived=True)
    with pytest.raises(PlanningError) as archived_location:
        update_task_location(
            session, archived, zone_id=None, location_text="封存後不可改"
        )
    assert archived_location.value.code == "inspection_plan.archived"


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
    dispatch_inspection_task(session, task)
    start_inspection_task(session, task)
    complete_inspection_task(session, task)
    assert task.started_by == operator.id
    assert task.completed_by == operator.id
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    assert task_item.item_status == "PENDING"

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
    assert task_item.needs_reinspection is False
    assert task.completed_by is None
    complete_inspection_task(session, task)
    assert task.status == "COMPLETED"


def test_cancelled_task_adopts_current_snapshot_only_on_restore(
    session, operator
):
    project = _project(session, operator, "CANCELKD55")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="取消中的標準更新"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    original = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id
        )
    )
    assert original is not None
    dispatch_inspection_task(session, task)
    cancel_inspection_task(session, task, reason="等待修訂標準")
    source.instruction = "取消期間的新標準"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"instruction": "檢查內容 A"},
        reinspection_required=True,
    )
    assert task.status == "CANCELLED"
    assert task_item.needs_reinspection is False
    assert original.is_current is True

    restore_inspection_task(session, task)
    snapshots = session.scalars(
        select(TaskRequirementSnapshot)
        .where(TaskRequirementSnapshot.task_inspection_item_id == task_item.id)
        .order_by(TaskRequirementSnapshot.revision)
    ).all()
    assert task.status == "PENDING"
    assert len(snapshots) == 2
    assert snapshots[0].is_current is False
    assert snapshots[0].instruction == "檢查內容 A"
    assert snapshots[1].is_current is True
    assert snapshots[1].instruction == "取消期間的新標準"
    assert task_item.needs_reinspection is False


def test_cancelled_completed_item_is_marked_on_restore(session, operator):
    project = _project(session, operator, "CANCELRESULT")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="取消結果更新"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    dispatch_inspection_task(session, task)
    start_inspection_task(session, task)
    task_item.item_status = "COMPLETED"
    cancel_inspection_task(session, task, reason="補充測試")
    source.instruction = "更新後的查核標準"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"instruction": "檢查內容 A"},
        reinspection_required=True,
    )
    assert task.status == "CANCELLED"
    assert task_item.needs_reinspection is False
    restore_inspection_task(session, task)
    assert task.status == "IN_PROGRESS"
    assert task_item.needs_reinspection is True


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
    dispatch_inspection_task(session, task)
    start_inspection_task(session, task)
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
    assert locked.value.code == "inspection_plan.archived"
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
    assert event.project_id == project.id


def test_new_draft_task_rederives_cancelled_plan(session, operator):
    project = _project(session, operator, "CANCELPLAN")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="取消計畫重算"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    dispatch_inspection_task(session, task)
    cancel_inspection_task(session, task, reason="結束當前批次")
    assert plan.status == "CANCELLED"

    create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    assert plan.status == "DRAFT"


def test_archived_plan_rejects_item_change_without_audit_or_snapshot_write(
    session, operator
):
    project = _project(session, operator, "ARCHKD55")
    _grant(session, operator, project, *_planning_codes())
    plan = create_inspection_plan(
        session, project_id=project.id, name="封存中的標準更新"
    )
    source = _source_item(session, operator, project)
    task = create_inspection_task(
        session, plan=plan, project_inspection_item_ids=[source.id]
    )
    task_item = session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    )
    assert task_item is not None
    archive_inspection_plan(session, plan, archived=True)
    session.commit()
    snapshot_ids = set(
        session.scalars(
            select(TaskRequirementSnapshot.id).where(
                TaskRequirementSnapshot.task_inspection_item_id == task_item.id
            )
        ).all()
    )
    source.instruction = "封存後的內容"
    source.standard_revision = 2
    with pytest.raises(PlanningError) as rejected:
        update_project_item_usage(
            session,
            item_id=source.id,
            before_data={"instruction": "檢查內容 A"},
            reinspection_required=True,
        )
    assert rejected.value.code == "inspection_plan.archived"
    assert (
        session.scalar(
            select(func.count())
            .select_from(ProjectInspectionItemChange)
            .where(
                ProjectInspectionItemChange.project_inspection_item_id
                == source.id
            )
        )
        == 0
    )
    assert (
        set(
            session.scalars(
                select(TaskRequirementSnapshot.id).where(
                    TaskRequirementSnapshot.task_inspection_item_id
                    == task_item.id
                )
            ).all()
        )
        == snapshot_ids
    )
    assert (
        session.scalars(
            select(AuditLog.id).where(
                AuditLog.entity_id == source.id,
                AuditLog.event_type == "project_inspection_item.updated",
            )
        ).all()
        == []
    )

    session.rollback()
    plan = session.get(InspectionPlan, plan.id)
    source = session.get(ProjectInspectionItem, source.id)
    assert plan is not None and source is not None

    archive_inspection_plan(session, plan, archived=False)
    session.commit()
    source = session.get(ProjectInspectionItem, source.id)
    assert source is not None
    source.instruction = "取消封存後的新內容"
    source.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=source.id,
        before_data={"title": "項目 A", "instruction": "檢查內容 A"},
        reinspection_required=True,
    )
    session.flush()

    current_snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert current_snapshot is not None
    assert current_snapshot.instruction == "取消封存後的新內容"
    assert current_snapshot.source_standard_revision == 2
    assert (
        session.scalar(
            select(func.count())
            .select_from(ProjectInspectionItemChange)
            .where(
                ProjectInspectionItemChange.project_inspection_item_id
                == source.id
            )
        )
        == 1
    )
    events = session.scalars(
        select(AuditLog).where(
            AuditLog.entity_id == source.id,
            AuditLog.event_type == "project_inspection_item.updated",
        )
    ).all()
    assert len(events) == 1
    assert events[0].project_id == project.id
    assert "project_id" not in (events[0].before or {})
    assert "project_id" not in (events[0].after or {})
    assert events[0].after == {
        "instruction": "取消封存後的新內容",
        "reinspection_required": True,
    }


def test_item_change_refreshes_every_plan_using_item_only(session, operator):
    project = _project(session, operator, "MULTIPLAN")
    _grant(session, operator, project, *_planning_codes())
    first_plan = create_inspection_plan(
        session, project_id=project.id, name="共用項次計畫一"
    )
    second_plan = create_inspection_plan(
        session, project_id=project.id, name="共用項次計畫二"
    )
    shared = _source_item(session, operator, project, title="共用項次")
    unrelated = _source_item(
        session, operator, project, title="不相關項次", sequence=2
    )
    first_task = create_inspection_task(
        session,
        plan=first_plan,
        project_inspection_item_ids=[shared.id],
    )
    second_task = create_inspection_task(
        session,
        plan=second_plan,
        project_inspection_item_ids=[shared.id],
    )
    unrelated_task = create_inspection_task(
        session,
        plan=second_plan,
        project_inspection_item_ids=[unrelated.id],
    )
    for task in (first_task, second_task, unrelated_task):
        dispatch_inspection_task(session, task)
    start_inspection_task(session, second_task)
    complete_inspection_task(session, second_task)

    shared_links = session.scalars(
        select(TaskInspectionItem).where(
            TaskInspectionItem.project_inspection_item_id == shared.id
        )
    ).all()
    shared_link_ids = {link.id for link in shared_links}
    old_snapshot_ids = set(
        session.scalars(
            select(TaskRequirementSnapshot.id).where(
                TaskRequirementSnapshot.task_inspection_item_id.in_(
                    shared_link_ids
                )
            )
        ).all()
    )
    unrelated_link = session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == unrelated_task.id
        )
    )
    assert unrelated_link is not None
    unrelated_snapshot = session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id
            == unrelated_link.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert unrelated_snapshot is not None
    unrelated_snapshot_state = (
        unrelated_snapshot.id,
        unrelated_snapshot.revision,
        unrelated_snapshot.instruction,
        unrelated_snapshot.source_standard_revision,
    )

    shared.instruction = "跨計畫更新後的標準"
    shared.standard_revision = 2
    update_project_item_usage(
        session,
        item_id=shared.id,
        before_data={"instruction": "檢查內容 A"},
        reinspection_required=True,
    )

    refreshed = session.scalars(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id.in_(
                shared_link_ids
            )
        )
    ).all()
    assert len(refreshed) == 4
    current = [snapshot for snapshot in refreshed if snapshot.is_current]
    assert len(current) == 2
    assert {
        (snapshot.instruction, snapshot.source_standard_revision)
        for snapshot in current
    } == {("跨計畫更新後的標準", 2)}
    assert old_snapshot_ids <= {
        snapshot.id for snapshot in refreshed if not snapshot.is_current
    }
    assert first_task.status == "PENDING"
    assert second_task.status == "IN_PROGRESS"
    assert (
        unrelated_task.status,
        unrelated_snapshot.id,
        unrelated_snapshot.revision,
        unrelated_snapshot.instruction,
        unrelated_snapshot.source_standard_revision,
    ) == ("PENDING", *unrelated_snapshot_state)
    assert unrelated_snapshot.is_current is True
    change_count = session.scalar(
        select(func.count())
        .select_from(ProjectInspectionItemChange)
        .where(
            ProjectInspectionItemChange.project_inspection_item_id == shared.id
        )
    )
    assert change_count == 1
    audit_events = session.scalars(
        select(AuditLog).where(
            AuditLog.entity_id == shared.id,
            AuditLog.event_type == "project_inspection_item.updated",
        )
    ).all()
    assert len(audit_events) == 1
    assert audit_events[0].after["instruction"] == "跨計畫更新後的標準"
    assert audit_events[0].after["reinspection_required"] is True
