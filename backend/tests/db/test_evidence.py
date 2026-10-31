"""FEV-AC01、AC19、AC32：migration、約束與來源追溯，雙資料庫共用。"""

import io
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import LargeBinary, func, inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.cli.check_evidence_storage import orphan_keys
from app.db.engine import create_engine_from_settings
from app.models import (
    Evidence,
    EvidencePointLink,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
    User,
)
from app.storage import LocalStorage
from tests.db.conftest import create_root_user_with_company

_CONFIG = Path(__file__).resolve().parents[2] / "alembic.ini"
_PARENT = "d717a4c9e201"
_HEAD = "e790a1b2c3d4"
_TABLES = {"evidence", "evidence_variants", "evidence_point_links"}


@pytest.fixture
def world(db_url):
    command.upgrade(Config(str(_CONFIG)), "head")
    engine = create_engine_from_settings(db_url)
    with Session(engine) as session:
        actor = create_root_user_with_company(session, "FEV790")
        audit = dict(created_by=actor.id, updated_by=actor.id)
        project = Project(
            project_code="FEV790",
            name="工程",
            client_name="業主",
            site_location="工地",
            **audit,
        )
        session.add(project)
        session.flush()
        plan = InspectionPlan(project_id=project.id, name="計畫", **audit)
        item = ProjectInspectionItem(
            project_id=project.id,
            sequence=1,
            title="項目",
            instruction="說明",
            source_template_name="範本",
            applied_at=project.created_at,
            **audit,
        )
        session.add_all([plan, item])
        session.flush()
        task = InspectionTask(
            project_id=project.id, plan_id=plan.id, name="任務", **audit
        )
        session.add(task)
        session.flush()
        detail = TaskInspectionItem(
            project_id=project.id,
            task_id=task.id,
            project_inspection_item_id=item.id,
            **audit,
        )
        session.add(detail)
        session.flush()
        snapshot = TaskRequirementSnapshot(
            task_inspection_item_id=detail.id,
            revision=1,
            source_standard_revision=1,
            title="拍攝時標題",
            instruction="說明",
            source_template_name="範本",
            **audit,
        )
        session.add(snapshot)
        session.flush()
        point = TaskSnapshotPoint(
            snapshot_id=snapshot.id,
            source_point_id=uuid4(),
            sequence=1,
            title="項次",
            instruction="檢查",
            **audit,
        )
        session.add(point)
        session.commit()
        yield session, actor, project, plan, task, detail, snapshot, point
    engine.dispose()


def _photo(world, **overrides):
    session, actor, project, _, task, detail, _, _ = world
    values = dict(
        project_id=project.id,
        task_id=task.id,
        task_inspection_item_id=detail.id,
        snapshot_revision=1,
        upload_key=uuid4(),
        request_fingerprint="a" * 64,
        is_overview=False,
        caption="照片說明",
        captured_at=datetime(2026, 10, 31, tzinfo=UTC),
        uploader_snapshot=dict(
            name_zh=actor.name_zh,
            company_name="拍攝單位",
            department=actor.department,
            is_external_collaborator=False,
        ),
        label_source=dict(
            project_name=project.name,
            item_title="拍攝時標題",
            location="A區／北側",
            uploader_name=actor.name_zh,
            uploaded_at="2026-10-31T00:00:00+00:00",
        ),
        created_by=actor.id,
        updated_by=actor.id,
    )
    values.update(overrides)
    photo = Evidence(**values)
    session.add(photo)
    session.flush()
    return photo


def _variant(world, photo, **overrides):
    _, actor, *_ = world
    values = dict(
        evidence_id=photo.id,
        variant_type="FIELD",
        storage_key=uuid4(),
        content_type="image/jpeg",
        byte_size=10,
        sha256="b" * 64,
        width=800,
        height=600,
        edit_params={"rotation": 0},
        created_by=actor.id,
        updated_by=actor.id,
    )
    values.update(overrides)
    return EvidenceVariant(**values)


def test_upgrade_downgrade_preserves_existing_rows(db_url):
    cfg = Config(str(_CONFIG))
    command.upgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    with Session(engine) as session:
        user = create_root_user_with_company(session, "FEVMIG")
        session.commit()
        user_id = user.id
    before = set(inspect(engine).get_table_names())
    command.upgrade(cfg, _HEAD)
    assert set(inspect(engine).get_table_names()) == before | _TABLES
    for name in _TABLES:
        columns = inspect(engine).get_columns(name)
        assert not any(isinstance(c["type"], LargeBinary) for c in columns)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Evidence)) == 0
        # 查原有 users，證明升級不只是在空資料庫上成功。
        assert session.get(User, user_id) is not None
    command.downgrade(cfg, _PARENT)
    assert set(inspect(engine).get_table_names()) == before
    with Session(engine) as session:
        assert session.get(User, user_id) is not None
    command.upgrade(cfg, "head")
    assert _TABLES <= set(inspect(engine).get_table_names())
    engine.dispose()


def test_two_versions_trace_to_original_snapshot_and_stable_metadata(world):
    session, actor, project, plan, task, detail, snapshot, point = world
    photo = _photo(world)
    field = _variant(world, photo)
    office = _variant(
        world,
        photo,
        variant_type="OFFICE",
        edit_params={"brightness": 10},
        label_rule={"timezone": "Asia/Taipei", "version": "initial"},
    )
    session.add_all(
        [
            field,
            office,
            EvidencePointLink(
                evidence_id=photo.id,
                source_point_id=point.source_point_id,
                created_by=actor.id,
                updated_by=actor.id,
            ),
        ]
    )
    session.commit()
    photo_id = photo.id
    actor.name_zh = "新姓名"
    project.name = "新工程名稱"
    session.commit()
    session.expire_all()
    traced = session.execute(
        select(
            EvidenceVariant,
            Evidence,
            TaskRequirementSnapshot,
            TaskInspectionItem,
            InspectionTask,
            InspectionPlan,
            Project,
        )
        .join(Evidence, Evidence.id == EvidenceVariant.evidence_id)
        .join(
            TaskRequirementSnapshot,
            (
                TaskRequirementSnapshot.task_inspection_item_id
                == Evidence.task_inspection_item_id
            )
            & (TaskRequirementSnapshot.revision == Evidence.snapshot_revision),
        )
        .join(
            TaskInspectionItem,
            TaskInspectionItem.id == Evidence.task_inspection_item_id,
        )
        .join(InspectionTask, InspectionTask.id == Evidence.task_id)
        .join(InspectionPlan, InspectionPlan.id == InspectionTask.plan_id)
        .join(Project, Project.id == Evidence.project_id)
        .where(EvidenceVariant.id == office.id)
    ).one()
    assert [row.id for row in traced] == [
        office.id,
        photo_id,
        snapshot.id,
        detail.id,
        task.id,
        plan.id,
        project.id,
    ]
    assert session.scalar(select(func.count()).select_from(Evidence)) == 1
    assert (
        session.scalar(select(func.count()).select_from(EvidenceVariant)) == 2
    )
    assert photo.uploader_snapshot["name_zh"] != actor.name_zh
    assert photo.label_source == dict(
        project_name="工程",
        item_title="拍攝時標題",
        location="A區／北側",
        uploader_name=photo.uploader_snapshot["name_zh"],
        uploaded_at="2026-10-31T00:00:00+00:00",
    )
    assert field.sha256 == "b" * 64
    assert field.edit_params == {"rotation": 0}
    assert office.edit_params == {"brightness": 10}
    assert photo.captured_at is not None
    assert photo.captured_at.tzinfo == UTC


@pytest.mark.parametrize(
    "changes",
    [
        {"caption": "字" * 501},
        {"snapshot_revision": 999},
        {"task_id": uuid4()},
        {"project_id": uuid4()},
        {"task_inspection_item_id": uuid4()},
        {"request_fingerprint": "short"},
        {"deleted_at": datetime(2026, 1, 1, tzinfo=UTC)},
        {"deleted_by": uuid4()},
        {"void_reason": "STANDARD_CHANGED"},
        {"voided_at": datetime(2026, 1, 1, tzinfo=UTC)},
        {
            "voided_at": datetime(2026, 1, 1, tzinfo=UTC),
            "void_reason": "OTHER",
        },
    ],
)
def test_photo_constraints(world, changes):
    with pytest.raises(IntegrityError):
        _photo(world, **changes)
    world[0].rollback()


def test_task_upload_key_unique_and_caption_boundary(world):
    session, *_ = world
    photo = _photo(world, caption="字" * 500)
    session.commit()
    with pytest.raises(IntegrityError):
        _photo(world, upload_key=photo.upload_key)
    session.rollback()


@pytest.mark.parametrize(
    "changes",
    [
        {"variant_type": "RAW"},
        {"content_type": "image/png"},
        {"width": 0},
        {"height": -1},
        {"byte_size": 0},
        {"sha256": "short"},
        {"evidence_id": uuid4()},
        {"label_rule": {"version": "x"}},
        {"edited_at": datetime(2026, 1, 1, tzinfo=UTC)},
    ],
)
def test_variant_constraints(world, changes):
    session, *_ = world
    photo = _photo(world)
    session.commit()
    session.add(_variant(world, photo, **changes))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


@pytest.mark.parametrize("duplicate", ["variant_type", "storage_key"])
def test_duplicate_variant_and_storage_key_rejected(world, duplicate):
    session, *_ = world
    photo = _photo(world)
    field = _variant(world, photo)
    session.add(field)
    session.commit()
    changes = {duplicate: getattr(field, duplicate)}
    if duplicate == "storage_key":
        changes["variant_type"] = "OFFICE"
    session.add(_variant(world, photo, **changes))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_links_unique_and_retained_after_soft_delete(world):
    session, actor, *_, point = world
    photo = _photo(world)
    values = dict(
        evidence_id=photo.id,
        source_point_id=point.source_point_id,
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add(EvidencePointLink(**values))
    session.commit()
    session.add(EvidencePointLink(**values))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()
    session.execute(
        update(Evidence)
        .where(Evidence.id == photo.id)
        .values(
            deleted_at=datetime(2026, 1, 1, tzinfo=UTC),
            deleted_by=actor.id,
        )
    )
    session.commit()
    assert (
        session.scalar(select(func.count()).select_from(EvidencePointLink))
        == 1
    )


def test_orphan_inventory_keeps_references_for_deleted_photos(world, tmp_path):
    session, actor, *_ = world
    storage = LocalStorage(tmp_path / "photos")
    referenced = storage.save(io.BytesIO(b"field"))
    orphan = storage.save(io.BytesIO(b"uncommitted office"))
    photo = _photo(
        world, deleted_by=actor.id, deleted_at=datetime(2026, 1, 1, tzinfo=UTC)
    )
    session.add(_variant(world, photo, storage_key=referenced))
    session.commit()
    before = {p.name: p.read_bytes() for p in storage.root.iterdir()}
    assert list(orphan_keys(session, storage)) == [orphan]
    assert {p.name: p.read_bytes() for p in storage.root.iterdir()} == before
    assert session.scalar(select(func.count()).select_from(Evidence)) == 1


def test_orphan_cli_reports_real_files_and_forbids_database_writes(
    world, tmp_path, monkeypatch, capsys
):
    from sqlalchemy.exc import DBAPIError

    from app.cli.check_evidence_storage import _readonly_engine, main

    session, *_ = world
    photo = _photo(world)
    session.commit()
    storage = LocalStorage(tmp_path / "cli-photos")
    key = storage.save(io.BytesIO(b"orphan"))
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage.root))
    assert main() == 0
    assert capsys.readouterr().out == f"{key}\norphan files: 1\n"
    assert list(storage.iter_keys()) == [key]
    engine = _readonly_engine()
    try:
        with engine.connect() as connection:
            assert connection.scalar(select(func.count(Evidence.id))) == 1
            with pytest.raises(DBAPIError):
                connection.execute(
                    update(Evidence)
                    .where(Evidence.id == photo.id)
                    .values(caption="must not write")
                )
    finally:
        engine.dispose()
    session.expire_all()
    assert photo.caption == "照片說明"


@pytest.mark.sqlite_only
def test_orphan_cli_does_not_create_missing_database(tmp_path, monkeypatch):
    from sqlalchemy.exc import OperationalError

    from app.cli.check_evidence_storage import main

    missing = tmp_path / "not-created" / "missing.db"
    monkeypatch.setenv("INSPECTFLOW_DATABASE_URL", f"sqlite:///{missing}")
    monkeypatch.setenv(
        "INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path / "photos")
    )
    with pytest.raises(OperationalError):
        main()
    assert not missing.parent.exists()
    assert not (tmp_path / "photos").exists()
