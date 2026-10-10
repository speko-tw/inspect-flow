"""Schema acceptance for inspection-planning T1 on both databases."""

import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Barrier, BrokenBarrierError
from typing import cast

import pytest
from alembic.config import Config
from sqlalchemy import Engine, func, insert, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    ProjectInspectionPoint,
    ProjectMember,
    ProjectMemberRole,
    ProjectZone,
    Role,
    RolePermission,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotMeasurementField,
    TaskSnapshotNumericStandard,
    TaskSnapshotPoint,
    TaskSnapshotTextStandard,
)
from tests.db.conftest import create_root_user_with_company

_ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


@pytest.fixture
def session(db_url: str) -> Generator[Session, None, None]:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as result:
            yield result
    finally:
        engine.dispose()
        dispose_engine()


@pytest.fixture
def actor(session: Session):
    result = create_root_user_with_company(session, "IP359")
    session.commit()
    return result


def _audit(actor) -> dict:
    return {"created_by": actor.id, "updated_by": actor.id}


def _project(session: Session, actor, code: str) -> Project:
    result = Project(
        project_code=code,
        name=f"示範工程 {code}",
        client_name="示範業主",
        site_location="示範工地",
        **_audit(actor),
    )
    session.add(result)
    session.flush()
    return result


def _item(session: Session, actor, project: Project, title: str):
    result = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title=title,
        instruction="檢查安裝",
        source_template_name="示範範本",
        applied_at=project.created_at,
        **_audit(actor),
    )
    session.add(result)
    session.flush()
    return result


def _plan(session: Session, actor, project: Project):
    result = InspectionPlan(
        project_id=project.id, name="週查核", **_audit(actor)
    )
    session.add(result)
    session.flush()
    return result


def _task(session: Session, actor, plan, zone=None):
    result = InspectionTask(
        plan_id=plan.id,
        project_id=plan.project_id,
        zone_id=zone.id if zone else None,
        location_text="北側",
        **_audit(actor),
    )
    session.add(result)
    session.flush()
    return result


def test_ip_ac02_dom_ac51_task_accepts_multiple_project_items(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-ONE")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    first = _item(session, actor, project, "管線")
    second = _item(session, actor, project, "閥件")
    for item in (first, second):
        session.add(
            TaskInspectionItem(
                task_id=task.id,
                project_id=project.id,
                project_inspection_item_id=item.id,
                **_audit(actor),
            )
        )
    session.commit()

    assert task.status == "DRAFT"
    assert plan.status == "DRAFT"
    links = session.scalars(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task.id)
    ).all()
    assert {row.project_inspection_item_id for row in links} == {
        first.id,
        second.id,
    }


def test_dom_ac51_plan_fk_rejects_missing_and_cross_project_plan(
    session: Session, actor
) -> None:
    first_project = _project(session, actor, "IP-PL1")
    second_project = _project(session, actor, "IP-PL2")
    first_plan = _plan(session, actor, first_project)
    second_plan = _plan(session, actor, second_project)
    first_task = _task(session, actor, first_plan)
    second_task = _task(session, actor, second_plan)
    session.commit()
    loaded_first = session.get(InspectionTask, first_task.id)
    loaded_second = session.get(InspectionTask, second_task.id)
    assert loaded_first is not None and loaded_second is not None
    assert loaded_first.plan_id == first_plan.id
    assert loaded_second.plan_id == second_plan.id

    for plan_id, project_id in (
        (uuid.uuid4(), first_project.id),
        (first_plan.id, second_project.id),
    ):
        session.add(
            InspectionTask(
                plan_id=plan_id,
                project_id=project_id,
                **_audit(actor),
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_ip_ac03_ac04_ac05_snapshots_preserve_versions_and_structure(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-SNAP")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    source = _item(session, actor, project, "初版")
    link = TaskInspectionItem(
        task_id=task.id,
        project_id=project.id,
        project_inspection_item_id=source.id,
        **_audit(actor),
    )
    session.add(link)
    session.flush()
    old = TaskRequirementSnapshot(
        task_inspection_item_id=link.id,
        revision=1,
        source_standard_revision=1,
        title="初版",
        instruction="原需求",
        source_template_name=source.source_template_name,
        is_current=False,
        superseded_reason="STANDARD_CHANGED",
        superseded_at=project.created_at,
        **_audit(actor),
    )
    new = TaskRequirementSnapshot(
        task_inspection_item_id=link.id,
        revision=2,
        source_standard_revision=2,
        title="新版",
        instruction="新需求",
        source_template_name=source.source_template_name,
        is_current=True,
        **_audit(actor),
    )
    session.add_all([old, new])
    session.flush()
    point = TaskSnapshotPoint(
        snapshot_id=old.id,
        source_point_id=source.id,
        sequence=1,
        title="查核點",
        instruction="舊標準",
        **_audit(actor),
    )
    session.add(point)
    session.flush()
    field_id = uuid.uuid4()
    session.add_all(
        [
            TaskSnapshotTextStandard(
                point_id=point.id, text="符合圖說", **_audit(actor)
            ),
            TaskSnapshotMeasurementField(
                point_id=point.id,
                source_field_id=field_id,
                name="壓力",
                field_type="number",
                unit="kPa",
                **_audit(actor),
            ),
            TaskSnapshotEvidenceRequirement(
                point_id=point.id,
                evidence_type="photo",
                required=True,
                min_count=1,
                **_audit(actor),
            ),
        ]
    )
    session.flush()
    session.add(
        TaskSnapshotNumericStandard(
            point_id=point.id,
            value="200",
            condition=">=",
            unit="kPa",
            source_measurement_field_id=field_id,
            measurement_field_unit="kPa",
            **_audit(actor),
        )
    )
    assert source.standard_revision == 1
    source.title = "目前專案名稱"
    source.standard_revision = 2
    session.add(
        ProjectInspectionItemChange(
            project_inspection_item_id=source.id,
            before_revision=1,
            after_revision=2,
            reinspection_required=True,
            before_data={"title": "初版"},
            after_data={"title": "目前專案名稱"},
            **_audit(actor),
        )
    )
    session.commit()
    session.expire_all()

    snapshots = session.scalars(
        select(TaskRequirementSnapshot)
        .where(TaskRequirementSnapshot.task_inspection_item_id == link.id)
        .order_by(TaskRequirementSnapshot.revision)
    ).all()
    assert [(row.title, row.is_current) for row in snapshots] == [
        ("初版", False),
        ("新版", True),
    ]
    assert (
        session.scalar(
            select(TaskSnapshotPoint.title).where(
                TaskSnapshotPoint.snapshot_id == old.id
            )
        )
        == "查核點"
    )
    assert session.scalar(select(ProjectInspectionItem.title)) == (
        "目前專案名稱"
    )
    assert (
        session.scalar(
            select(TaskSnapshotTextStandard.text).where(
                TaskSnapshotTextStandard.point_id == point.id
            )
        )
        == "符合圖說"
    )
    assert (
        session.scalar(
            select(TaskSnapshotNumericStandard.value).where(
                TaskSnapshotNumericStandard.point_id == point.id
            )
        )
        == "200"
    )
    assert (
        session.scalar(
            select(TaskSnapshotMeasurementField.unit).where(
                TaskSnapshotMeasurementField.point_id == point.id
            )
        )
        == "kPa"
    )
    assert (
        session.scalar(
            select(TaskSnapshotEvidenceRequirement.min_count).where(
                TaskSnapshotEvidenceRequirement.point_id == point.id
            )
        )
        == 1
    )


def test_ip_ac11_dom_ac53_zone_name_and_project_fk(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-ZONE")
    other = _project(session, actor, "IP-OTHER")
    zone = ProjectZone(project_id=project.id, name=" Straße ", **_audit(actor))
    other_zone = ProjectZone(project_id=other.id, name="南側", **_audit(actor))
    session.add_all([zone, other_zone])
    session.commit()
    assert zone.name == "Straße"
    assert zone.name_key == "strasse"
    with pytest.raises(ValueError):
        ProjectZone(project_id=project.id, name="   ", **_audit(actor))

    session.add(
        ProjectZone(project_id=project.id, name="STRASSE", **_audit(actor))
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    zone.name = " 新分區 "
    session.commit()
    assert zone.name == "新分區"
    assert zone.name_key == "新分區"

    plan = _plan(session, actor, project)
    session.add(
        InspectionTask(
            plan_id=plan.id,
            project_id=project.id,
            zone_id=other_zone.id,
            **_audit(actor),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    plan = _plan(session, actor, project)
    _task(session, actor, plan, zone)
    session.commit()
    session.delete(zone)
    with pytest.raises(IntegrityError):
        session.flush()


def test_ip_ac02_ac04_project_and_snapshot_constraints(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-LINK")
    other = _project(session, actor, "IP-FOREIGN")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    own_item = _item(session, actor, project, "本專案")
    foreign_item = _item(session, actor, other, "其他專案")
    link = TaskInspectionItem(
        task_id=task.id,
        project_id=project.id,
        project_inspection_item_id=own_item.id,
        **_audit(actor),
    )
    session.add(link)
    session.commit()

    session.add(
        TaskInspectionItem(
            task_id=task.id,
            project_id=project.id,
            project_inspection_item_id=foreign_item.id,
            **_audit(actor),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    session.add(
        TaskInspectionItem(
            task_id=task.id,
            project_id=project.id,
            project_inspection_item_id=own_item.id,
            **_audit(actor),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    plan.status = "INVALID"
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()

    common = {
        "task_inspection_item_id": link.id,
        "source_standard_revision": 1,
        "title": "原需求",
        "instruction": "原說明",
        "source_template_name": "來源範本",
        **_audit(actor),
    }
    session.add(TaskRequirementSnapshot(revision=1, **common))
    session.commit()
    session.add(TaskRequirementSnapshot(revision=2, **common))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_plan_name_and_task_item_status_checks(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-CHECK")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    item = _item(session, actor, project, "約束項目")
    session.commit()

    with pytest.raises(ValueError):
        InspectionPlan(project_id=project.id, name=" ", **_audit(actor))
    with pytest.raises(ValueError):
        InspectionPlan(project_id=project.id, name="x" * 129, **_audit(actor))
    with pytest.raises(IntegrityError):
        session.execute(
            insert(InspectionPlan).values(
                project_id=project.id,
                name="   ",
                **_audit(actor),
            )
        )
    session.rollback()

    session.add(
        TaskInspectionItem(
            task_id=task.id,
            project_id=project.id,
            project_inspection_item_id=item.id,
            item_status="INVALID",
            **_audit(actor),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_task_status_and_cancellation_checks(session: Session, actor) -> None:
    project = _project(session, actor, "IP-CANCEL")
    plan = _plan(session, actor, project)
    session.commit()
    invalid = (
        {"status": "INVALID"},
        {"status": "DRAFT", "cancelled_from_status": "INVALID"},
        {"status": "CANCELLED", "cancelled_from_status": "PENDING"},
        {"status": "CANCELLED", "cancellation_reason": "原因"},
        {
            "status": "CANCELLED",
            "cancelled_from_status": "PENDING",
            "cancellation_reason": "",
        },
        {
            "status": "CANCELLED",
            "cancelled_from_status": "IN_PROGRESS",
            "cancellation_reason": "   ",
        },
        {"status": "DRAFT", "cancellation_reason": "不應有原因"},
    )
    for overrides in invalid:
        session.add(
            InspectionTask(
                plan_id=plan.id,
                project_id=project.id,
                **overrides,
                **_audit(actor),
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_snapshot_current_and_superseded_checks(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-HISTORY")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    item = _item(session, actor, project, "歷史項目")
    link = TaskInspectionItem(
        task_id=task.id,
        project_id=project.id,
        project_inspection_item_id=item.id,
        **_audit(actor),
    )
    session.add(link)
    session.commit()
    now = datetime.now(UTC)
    invalid = (
        {"is_current": True, "superseded_reason": "STANDARD_CHANGED"},
        {"is_current": True, "superseded_at": now},
        {"is_current": False},
        {"is_current": False, "superseded_reason": "STANDARD_CHANGED"},
        {"is_current": False, "superseded_at": now},
        {
            "is_current": False,
            "superseded_reason": "INVALID",
            "superseded_at": now,
        },
    )
    for revision, overrides in enumerate(invalid, start=1):
        session.add(
            TaskRequirementSnapshot(
                task_inspection_item_id=link.id,
                revision=revision,
                source_standard_revision=1,
                title="原需求",
                instruction="原說明",
                source_template_name="來源範本",
                **overrides,
                **_audit(actor),
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()


def test_snapshot_numeric_field_and_evidence_checks(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-NUMERIC")
    plan = _plan(session, actor, project)
    task = _task(session, actor, plan)
    item = _item(session, actor, project, "數值項目")
    link = TaskInspectionItem(
        task_id=task.id,
        project_id=project.id,
        project_inspection_item_id=item.id,
        **_audit(actor),
    )
    session.add(link)
    session.flush()
    snapshot = TaskRequirementSnapshot(
        task_inspection_item_id=link.id,
        revision=1,
        source_standard_revision=1,
        title="數值項目",
        instruction="測量壓力",
        source_template_name="來源範本",
        **_audit(actor),
    )
    session.add(snapshot)
    session.flush()
    point = TaskSnapshotPoint(
        snapshot_id=snapshot.id,
        source_point_id=uuid.uuid4(),
        sequence=1,
        title="壓力",
        instruction="量測",
        **_audit(actor),
    )
    session.add(point)
    session.flush()
    field = TaskSnapshotMeasurementField(
        point_id=point.id,
        source_field_id=uuid.uuid4(),
        name="壓力",
        field_type="number",
        unit="kPa",
        **_audit(actor),
    )
    evidence = TaskSnapshotEvidenceRequirement(
        point_id=point.id,
        evidence_type="photo",
        required=True,
        min_count=1,
        **_audit(actor),
    )
    session.add_all([field, evidence])
    session.flush()
    numeric = TaskSnapshotNumericStandard(
        point_id=point.id,
        value="200",
        condition=">=",
        unit="kPa",
        source_measurement_field_id=field.source_field_id,
        measurement_field_unit="kPa",
        **_audit(actor),
    )
    session.add(numeric)
    session.commit()

    for obj, attr, value in (
        (numeric, "condition", "INVALID"),
        (numeric, "measurement_field_type", "text"),
        (numeric, "unit", "Pa"),
        (numeric, "measurement_field_unit", "Pa"),
        (field, "field_type", "INVALID"),
        (field, "unit", None),
        (evidence, "evidence_type", "video"),
        (evidence, "min_count", 0),
        (evidence, "max_count", 2),
    ):
        setattr(obj, attr, value)
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()

    other_point = TaskSnapshotPoint(
        snapshot_id=snapshot.id,
        source_point_id=uuid.uuid4(),
        sequence=2,
        title="另一項次",
        instruction="量測",
        **_audit(actor),
    )
    session.add(other_point)
    session.commit()
    session.add(
        TaskSnapshotNumericStandard(
            point_id=other_point.id,
            value="100",
            condition=">=",
            unit="kPa",
            source_measurement_field_id=field.source_field_id,
            measurement_field_unit="kPa",
            **_audit(actor),
        )
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_project_item_change_revision_unique_and_optional_choice(
    session: Session, actor
) -> None:
    project = _project(session, actor, "IP-CHANGE")
    item = _item(session, actor, project, "尚未使用")
    session.commit()
    common = {
        "project_inspection_item_id": item.id,
        "before_revision": 1,
        "after_revision": 2,
        "before_data": {"title": "舊"},
        "after_data": {"title": "新"},
        **_audit(actor),
    }
    session.add(ProjectInspectionItemChange(**common))
    session.commit()
    assert (
        session.scalar(
            select(ProjectInspectionItemChange.reinspection_required)
        )
        is None
    )
    session.add(
        ProjectInspectionItemChange(reinspection_required=True, **common)
    )
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_ip_ac02_ac04_ac11_schema_constraints_and_round_trip(
    session: Session, actor, db_url: str
) -> None:
    project = _project(session, actor, "IP-MIGRATE")
    item = _item(session, actor, project, "既有項目")
    point = ProjectInspectionPoint(
        project_inspection_item_id=item.id,
        sequence=1,
        title="既有項次",
        instruction="既有需求",
        **_audit(actor),
    )
    session.add(point)
    session.commit()
    item_id = item.id.hex
    point_id = point.id.hex
    engine = cast(Engine, session.get_bind())
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert {
        "inspection_plans",
        "inspection_tasks",
        "project_zones",
        "task_inspection_items",
        "task_requirement_snapshots",
        "task_snapshot_points",
        "project_inspection_item_changes",
    } <= tables
    assert "zone_id" not in {
        col["name"]
        for col in inspector.get_columns("task_requirement_snapshots")
    }
    assert "location_text" not in {
        col["name"]
        for col in inspector.get_columns("task_requirement_snapshots")
    }
    assert "has_defect" not in {
        col["name"] for col in inspector.get_columns("inspection_tasks")
    }
    session.close()
    command.downgrade(Config(str(_ALEMBIC_INI)), "a8356e4c12b0")
    inspector = inspect(engine)
    assert "inspection_plans" not in inspector.get_table_names()
    with engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT title FROM project_inspection_items WHERE id = :id"
                ),
                {"id": item_id},
            ).scalar_one()
            == "既有項目"
        )
        assert (
            connection.execute(
                text(
                    "SELECT title FROM project_inspection_points "
                    "WHERE id = :id"
                ),
                {"id": point_id},
            ).scalar_one()
            == "既有項次"
        )
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    assert "inspection_plans" in inspect(engine).get_table_names()
    with engine.connect() as connection:
        assert (
            connection.execute(
                text(
                    "SELECT standard_revision FROM project_inspection_items "
                    "WHERE id = :id"
                ),
                {"id": item_id},
            ).scalar_one()
            == 1
        )


def test_postgres_concurrent_completion_derives_completed_plan(
    session: Session, request: pytest.FixtureRequest, monkeypatch
) -> None:
    """Two live PostgreSQL transactions complete the final Tasks together."""
    if request.config.getoption("--db-backend") != "postgresql":
        pytest.skip("requires the PostgreSQL backend and independent sessions")

    from types import SimpleNamespace

    from app.services.inspection_planning import complete_inspection_task
    from tests.db.conftest import make_system_admin

    actor = create_root_user_with_company(session, "IP406RACE")
    make_system_admin(actor)
    project = _project(session, actor, "IP406RACE")
    role = Role(
        name="planning-406-concurrent-inspect",
        created_by=actor.id,
        updated_by=actor.id,
        permission_codes=[RolePermission(code="inspection_task.inspect")],
    )
    session.add(role)
    session.flush()
    member = ProjectMember(
        project_id=project.id,
        user_id=actor.id,
        created_by=actor.id,
        updated_by=actor.id,
        role_assignments=[ProjectMemberRole(role_id=role.id)],
    )
    session.add(member)
    plan = InspectionPlan(
        project_id=project.id,
        name="並發完成",
        status="IN_PROGRESS",
        **_audit(actor),
    )
    session.add(plan)
    session.flush()
    tasks = [
        InspectionTask(
            project_id=project.id,
            plan_id=plan.id,
            status="IN_PROGRESS",
            started_by=actor.id,
            **_audit(actor),
        )
        for _ in range(2)
    ]
    session.add_all(tasks)
    session.commit()

    actor_stub = SimpleNamespace(id=actor.id)
    monkeypatch.setattr(
        "app.services.inspection_planning.get_current_operator",
        lambda _: actor_stub,
    )
    engine = session.get_bind()
    plan_id = plan.id
    task_ids = [task.id for task in tasks]
    ready = Barrier(3)
    backend_pids: list[int] = []

    def complete(task_id):
        with Session(engine) as worker_session:
            with worker_session.begin():
                worker_session.execute(text("SET LOCAL lock_timeout = '5s'"))
                worker_session.execute(
                    text("SET LOCAL statement_timeout = '10s'")
                )
                backend_pid = worker_session.scalar(
                    select(func.pg_backend_pid())
                )
                assert backend_pid is not None
                backend_pids.append(backend_pid)
                task = worker_session.get(InspectionTask, task_id)
                assert task is not None
                ready.wait(timeout=5)
                complete_inspection_task(worker_session, task)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(complete, task_id) for task_id in task_ids]
        barrier_error: BrokenBarrierError | None = None
        try:
            ready.wait(timeout=5)
        except BrokenBarrierError as exc:
            barrier_error = exc
        worker_errors: list[Exception] = []
        for future in futures:
            try:
                future.result(timeout=15)
            except Exception as exc:
                worker_errors.append(exc)

        if worker_errors:
            worker_error = next(
                (
                    error
                    for error in worker_errors
                    if not isinstance(error, BrokenBarrierError)
                ),
                worker_errors[0],
            )
            raise worker_error
        if barrier_error is not None:
            raise barrier_error

    assert len(set(backend_pids)) == 2
    session.expire_all()
    persisted_plan = session.get(InspectionPlan, plan_id)
    assert persisted_plan is not None
    assert persisted_plan.status == "COMPLETED"
    assert set(
        session.scalars(
            select(InspectionTask.status).where(
                InspectionTask.plan_id == plan_id
            )
        ).all()
    ) == {"COMPLETED"}
