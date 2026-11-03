"""FEV-AC01、AC07～AC09、AC12、AC28～AC30：真實照片上傳 API。"""

import hashlib
import io
import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier, Event
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Evidence,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
    TaskInspectionItem,
    TaskSnapshotPoint,
    UserModulePermission,
)
from app.storage import LocalStorage
from tests.api.test_inspection_planning_api import (
    _dispatched_field_task,
    _planning_world,
)


def _jpeg() -> bytes:
    image = Image.new("RGB", (1200, 800), (40, 90, 130))
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def _upload(
    world, task_id, item_id, point_id, image, key, *, client=None, **changes
):
    data = {
        "sha256": hashlib.sha256(image).hexdigest(),
        "item_id": str(item_id),
        "is_overview": "false",
        "point_ids": (
            [str(value) for value in point_id]
            if isinstance(point_id, (list, tuple))
            else [str(point_id)]
        ),
        "capture_source": "camera",
    }
    data.update(changes)
    return (client or world["field"]).post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        headers={"Idempotency-Key": str(key)},
        data=data,
        files={"file": ("field.jpg", image, "image/jpeg")},
    )


def test_upload_writes_two_variants_and_replays_by_full_fingerprint(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    plan = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "照片上傳"},
    )
    assert plan.status_code == 201, plan.text
    task = world["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "示範任務",
            "item_ids": [
                str(world["item"].id),
                str(world["item_two"].id),
            ],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert task.status_code == 201, task.text
    plan_id, task_id = plan.json()["id"], task.json()["id"]
    assert (
        world["admin"]
        .post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
        .status_code
        == 200
    )
    started = world["field"].post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id),
            TaskInspectionItem.project_inspection_item_id == world["item"].id,
        )
    )
    assert item is not None
    # Read the current snapshot explicitly; point ids are stable source ids.
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None

    image = _jpeg()
    denied_reader = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        client=world["reader"],
    )
    assert denied_reader.status_code == 403
    assert denied_reader.json()["error"]["code"] == "permission.denied"
    denied_outsider = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        client=world["outsider"],
    )
    assert denied_outsider.status_code == 403
    assert denied_outsider.json()["error"]["code"] == "permission.denied"
    key = uuid4()
    from starlette import formparsers

    spools = []
    original_spooled_file = tempfile.SpooledTemporaryFile

    def record_spool(*args, **kwargs):
        spool = original_spooled_file(*args, **kwargs)
        spools.append(spool)
        return spool

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", record_spool)
    response = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        capture_source="library",
    )
    assert response.status_code == 201, response.text
    assert spools and all(spool.closed for spool in spools)
    body = response.json()
    assert body["capture_source"] == "library"
    assert body["layer_render"]["render_state"] == "applied"
    assert set(body["variants"]) == {"field", "office"}
    assert "storage_key" not in response.text
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is not None
    )
    photo = db_session.scalar(
        select(Evidence).where(Evidence.upload_key == key)
    )
    assert photo is not None
    assert photo.capture_source == "library"
    assert body["labels"] == photo.label_source
    assert photo.uploader_snapshot["name_zh"] == world["field_user"].name_zh
    assert (
        len(
            list(
                db_session.scalars(
                    select(EvidenceVariant).where(
                        EvidenceVariant.evidence_id == photo.id
                    )
                )
            )
        )
        == 2
    )
    stored_keys = set(LocalStorage(storage_root).iter_keys())
    assert len(stored_keys) == 2
    assert stored_keys == {
        variant.storage_key
        for variant in db_session.scalars(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == photo.id
            )
        )
    }
    assert {path.name for path in storage_root.iterdir()} == {
        str(key) for key in stored_keys
    }

    replay = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        capture_source="library",
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == body["id"]
    assert set(LocalStorage(storage_root).iter_keys()) == stored_keys

    conflict = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        capture_source="camera",
    )
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "evidence.idempotency_conflict"
    changed_caption = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        caption="不同註記",
        capture_source="library",
    )
    assert changed_caption.status_code == 409
    invalid_caption_replay = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        caption="超長註記" * 126,
        capture_source="library",
    )
    assert invalid_caption_replay.status_code == 409
    invalid_json_replay = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        point_ids="not-json",
        capture_source="library",
    )
    assert invalid_json_replay.status_code == 409
    changed_layer = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        layer=json.dumps({"enabled": False}),
        capture_source="library",
    )
    assert changed_layer.status_code == 409
    changed = Image.new("RGB", (1200, 800), (200, 10, 10))
    changed_output = io.BytesIO()
    changed.save(changed_output, "JPEG", quality=90)
    different_image = changed_output.getvalue()
    changed_content = _upload(
        world,
        task_id,
        item.id,
        point_id,
        different_image,
        key,
        capture_source="library",
    )
    assert changed_content.status_code == 409
    second_item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id),
            TaskInspectionItem.project_inspection_item_id
            == world["item_two"].id,
        )
    )
    assert second_item is not None
    second_snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == second_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert second_snapshot is not None
    second_point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == second_snapshot.id
        )
    )
    assert second_point_id is not None
    changed_item = _upload(
        world,
        task_id,
        second_item.id,
        second_point_id,
        image,
        key,
        capture_source="library",
    )
    assert changed_item.status_code == 409
    extra_point_id = uuid4()
    db_session.add(
        TaskSnapshotPoint(
            snapshot_id=snapshot.id,
            source_point_id=extra_point_id,
            sequence=2,
            title="另一項次",
            instruction="同修訂項次",
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
        )
    )
    db_session.commit()
    changed_points = _upload(
        world,
        task_id,
        item.id,
        [point_id, extra_point_id],
        image,
        key,
        capture_source="library",
    )
    assert changed_points.status_code == 409

    task = db_session.get(InspectionTask, UUID(task_id))
    plan = db_session.get(InspectionPlan, UUID(plan_id))
    assert task is not None and plan is not None
    task.status = "COMPLETED"
    db_session.commit()
    completed_replay = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        capture_source="library",
    )
    assert completed_replay.status_code == 200
    assert completed_replay.json()["id"] == body["id"]

    photo.deleted_by = world["field_user"].id
    photo.deleted_at = datetime.now(UTC)
    db_session.commit()
    deleted_replay = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        key,
        capture_source="library",
    )
    assert deleted_replay.status_code == 409
    assert deleted_replay.json()["error"]["code"] == "evidence.photo_deleted"

    plan.is_archived = True
    db_session.commit()
    archived = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        capture_source="library",
    )
    assert archived.status_code == 409
    assert archived.json()["error"]["code"] == "inspection_plan.archived"


def test_other_uploader_cannot_replay_existing_idempotency_key(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "他人冪等鍵", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()
    key = uuid4()
    first = _upload(world, task_id, item.id, point_id, image, key)
    assert first.status_code == 201, first.text

    other = world["field_two"].post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        headers={"Idempotency-Key": str(key)},
        data={
            "sha256": hashlib.sha256(image).hexdigest(),
            "item_id": str(item.id),
            "is_overview": "false",
            "point_ids": [str(point_id)],
            "capture_source": "camera",
        },
        files={"file": ("field.jpg", image, "image/jpeg")},
    )
    assert other.status_code == 409
    assert other.json()["error"]["code"] == ("evidence.idempotency_conflict")
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_upload_capture_source_and_captured_at_contract(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "來源時間契約", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()
    invalid_source = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        capture_source="scanner",
    )
    assert invalid_source.status_code == 422
    assert invalid_source.json()["error"]["code"] == (
        "request.validation_failed"
    )
    invalid_time = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        captured_at="not-a-timestamp",
    )
    assert invalid_time.status_code == 422
    assert invalid_time.json()["error"]["code"] == (
        "request.validation_failed"
    )
    future_time = "2126-11-02T04:00:00+00:00"
    accepted = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        capture_source="library",
        captured_at=future_time,
    )
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()["captured_at"] == "2126-11-02T04:00:00Z"
    photo = db_session.scalar(
        select(Evidence).where(Evidence.task_id == UUID(task_id))
    )
    assert photo is not None
    assert photo.capture_source == "library"
    assert photo.captured_at.isoformat() == "2126-11-02T04:00:00+00:00"

    missing_source = world["field"].post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        headers={"Idempotency-Key": str(uuid4())},
        data={
            "sha256": hashlib.sha256(image).hexdigest(),
            "item_id": str(item.id),
            "is_overview": "false",
            "point_ids": [str(point_id)],
        },
        files={"file": ("field.jpg", image, "image/jpeg")},
    )
    assert missing_source.status_code == 422


def test_upload_requires_project_inspect_and_inspection_module_access(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "上傳權限", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()

    for client in (world["reader"], world["outsider"], world["plain"]):
        denied = _upload(
            world,
            task_id,
            item.id,
            point_id,
            image,
            uuid4(),
            client=client,
        )
        assert denied.status_code == 403
        assert denied.json()["error"]["code"] == "permission.denied"

    malformed_body = world["reader"].post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        content=b"not multipart",
        headers={
            "Content-Type": "multipart/form-data",
            "Idempotency-Key": str(uuid4()),
        },
    )
    assert malformed_body.status_code == 403

    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES", "1024")
    from starlette import formparsers

    spools = []
    original_spooled_file = tempfile.SpooledTemporaryFile

    def record_spool(*args, **kwargs):
        spool = original_spooled_file(*args, **kwargs)
        spools.append(spool)
        return spool

    monkeypatch.setattr(formparsers, "SpooledTemporaryFile", record_spool)
    oversized = _upload(
        world, task_id, item.id, point_id, b"x" * 4096, uuid4()
    )
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "evidence.file_too_large"
    assert spools and all(spool.closed for spool in spools)

    db_session.query(UserModulePermission).filter_by(
        user_id=world["field_user"].id,
        permission_code="inspection.use",
    ).delete()
    db_session.commit()
    missing_module = _upload(world, task_id, item.id, point_id, image, uuid4())
    assert missing_module.status_code == 403
    assert missing_module.json()["error"]["code"] == "permission.denied"
    assert not storage_root.exists()


def test_stale_snapshot_point_is_requirement_changed_but_unknown_is_invalid(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "舊修訂上傳", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    old_snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert old_snapshot is not None
    old_point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == old_snapshot.id
        )
    )
    assert old_point_id is not None
    old_snapshot.is_current = False
    old_snapshot.superseded_reason = "STANDARD_CHANGED"
    old_snapshot.superseded_at = datetime.now(UTC)
    new_snapshot = TaskRequirementSnapshot(
        task_inspection_item_id=item.id,
        revision=old_snapshot.revision + 1,
        source_standard_revision=old_snapshot.source_standard_revision + 1,
        title=old_snapshot.title,
        instruction=old_snapshot.instruction,
        source_template_name=old_snapshot.source_template_name,
        is_current=True,
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
    )
    db_session.add(new_snapshot)
    db_session.flush()
    current_point_id = uuid4()
    db_session.add(
        TaskSnapshotPoint(
            snapshot_id=new_snapshot.id,
            source_point_id=current_point_id,
            sequence=1,
            title="新項次",
            instruction="新標準",
            created_by=world["admin_user"].id,
            updated_by=world["admin_user"].id,
        )
    )
    db_session.commit()

    image = _jpeg()
    stale = _upload(world, task_id, item.id, old_point_id, image, uuid4())
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == ("evidence.requirement_changed")
    unknown = _upload(world, task_id, item.id, uuid4(), image, uuid4())
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "evidence.invalid_target"
    current = _upload(
        world, task_id, item.id, current_point_id, image, uuid4()
    )
    assert current.status_code == 201, current.text
    saved = db_session.scalar(
        select(Evidence).where(Evidence.task_id == UUID(task_id))
    )
    assert saved is not None
    assert saved.snapshot_revision == new_snapshot.revision
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_parallel_identical_uploads_create_only_one_photo(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "並行冪等上傳", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()
    key = uuid4()
    barrier = Barrier(2)
    from app.auth.sessions import SESSION_COOKIE_NAME

    second_client = make_client()
    second_client.cookies.set(
        SESSION_COOKIE_NAME,
        world["field"].cookies.get(SESSION_COOKIE_NAME),
    )
    clients = (world["field"], second_client)

    def send_upload(client):
        barrier.wait(timeout=15)
        return _upload(
            world,
            task_id,
            item.id,
            point_id,
            image,
            key,
            client=client,
        )

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [
                executor.submit(send_upload, client) for client in clients
            ]
            responses = [future.result(timeout=30) for future in futures]
    finally:
        second_client.close()
    assert sorted(response.status_code for response in responses) == [200, 201]
    assert len({response.json()["id"] for response in responses}) == 1
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is not None
    )
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_upload_revalidates_snapshot_changed_while_request_waits(
    db_session, engine, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "上傳與重查交錯", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    old_snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert old_snapshot is not None
    old_point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == old_snapshot.id
        )
    )
    assert old_point_id is not None
    request_waiting = Event()
    release_request = Event()

    def pause_before_item_lock(
        _connection, _cursor, statement, _parameters, _context, _many
    ):
        if not request_waiting.is_set():
            request_waiting.set()
            if not release_request.wait(timeout=15):
                raise TimeoutError("test did not release upload request")

    from sqlalchemy.engine import Engine as SQLAlchemyEngine

    event.listen(
        SQLAlchemyEngine, "before_cursor_execute", pause_before_item_lock
    )
    image = _jpeg()
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                _upload, world, task_id, item.id, old_point_id, image, uuid4()
            )
            assert request_waiting.wait(timeout=15)
            changed = world["admin"].patch(
                f"/api/v1/projects/{world['project'].id}/inspection-items/"
                f"{world['item'].id}",
                json={
                    "inspection_points": [
                        {
                            "sequence": 1,
                            "title": "重查後項次",
                            "instruction": "重查後標準",
                            "text_standard": {"text": "已更新標準"},
                            "measurement_fields": [],
                            "evidence_requirements": [{"min_count": 1}],
                        }
                    ],
                    "reinspect": True,
                },
            )
            assert changed.status_code == 200, changed.text
            new_point_id = UUID(changed.json()["inspection_points"][0]["id"])
            assert new_point_id != old_point_id
            release_request.set()
            response = future.result(timeout=20)
    finally:
        release_request.set()
        event.remove(
            SQLAlchemyEngine, "before_cursor_execute", pause_before_item_lock
        )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == ("evidence.requirement_changed")
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )
    assert not storage_root.exists()


def test_second_variant_storage_failure_cleans_first_file_and_database(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "儲存失敗清理", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    original_save = LocalStorage.save
    calls = 0

    def fail_second_save(storage, source):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("simulated OFFICE storage failure")
        return original_save(storage, source)

    monkeypatch.setattr(LocalStorage, "save", fail_second_save)
    content = _jpeg()
    with pytest.raises(OSError, match="simulated OFFICE storage failure"):
        world["field"].post(
            f"/api/v1/inspection-tasks/{task_id}/photos",
            headers={"Idempotency-Key": str(uuid4())},
            data={
                "sha256": hashlib.sha256(content).hexdigest(),
                "item_id": str(item.id),
                "is_overview": "false",
                "point_ids": [str(point_id)],
                "capture_source": "camera",
            },
            files={"file": ("field.jpg", content, "image/jpeg")},
        )
    assert calls == 2
    assert list(storage_root.iterdir()) == []
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )

    original_flush = Session.flush
    injected = False

    def fail_evidence_flush(session, objects=None):
        nonlocal injected
        if any(isinstance(value, Evidence) for value in session.new):
            injected = True
            raise IntegrityError(
                "simulated evidence constraint", {}, ValueError("constraint")
            )
        return original_flush(session, objects)

    monkeypatch.setattr(Session, "flush", fail_evidence_flush)
    with pytest.raises(IntegrityError, match="simulated evidence constraint"):
        _upload(world, task_id, item.id, point_id, content, uuid4())
    assert injected
    assert list(storage_root.iterdir()) == []
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )
    monkeypatch.setattr(Session, "flush", original_flush)

    monkeypatch.setattr(LocalStorage, "save", original_save)
    from app.services import evidence as evidence_service

    def fail_response(*_args, **_kwargs):
        raise RuntimeError("simulated response refresh failure")

    monkeypatch.setattr(evidence_service, "_response", fail_response)
    with pytest.raises(
        RuntimeError, match="simulated response refresh failure"
    ):
        _upload(
            world,
            task_id,
            item.id,
            point_id,
            _jpeg(),
            uuid4(),
        )
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is not None
    )
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_upload_rejects_bad_content_and_hash_without_files(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "內容驗證", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None

    def post(content: bytes, *, sha: str | None = None, key=None):
        return world["field"].post(
            f"/api/v1/inspection-tasks/{task_id}/photos",
            headers={"Idempotency-Key": str(key or uuid4())},
            data={
                "sha256": sha or hashlib.sha256(content).hexdigest(),
                "item_id": str(item.id),
                "is_overview": "false",
                "point_ids": [str(point_id)],
                "capture_source": "camera",
            },
            files={"file": ("field.jpg", content, "image/jpeg")},
        )

    valid = _jpeg()
    mismatch = post(valid, sha="0" * 64)
    assert mismatch.status_code == 422
    assert mismatch.json()["error"]["code"] == ("evidence.sha256_mismatch")
    png_output = io.BytesIO()
    Image.new("RGB", (20, 20), (0, 0, 0)).save(png_output, "PNG")
    invalid_format = post(png_output.getvalue())
    assert invalid_format.status_code == 422
    assert invalid_format.json()["error"]["code"] == ("evidence.invalid_image")
    assert invalid_format.json()["error"]["details"] == ["format"]
    corrupt = post(b"not a JPEG")
    assert corrupt.status_code == 422
    assert corrupt.json()["error"]["code"] == "evidence.invalid_image"

    assert corrupt.json()["error"]["details"] == ["decode"]
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES", "128")
    oversized = post(valid)
    assert oversized.status_code == 413
    assert oversized.json()["error"]["code"] == "evidence.file_too_large"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES", "31457280")
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_DECODE_PIXELS", "100")
    over_pixels = post(valid)
    assert over_pixels.status_code == 422
    assert over_pixels.json()["error"]["code"] == "evidence.invalid_image"
    assert over_pixels.json()["error"]["details"] == ["pixels"]
    assert not storage_root.exists()
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )


def test_tiny_valid_jpeg_is_saved_when_layer_cannot_fit(
    db_session, make_client, monkeypatch, tmp_path
):
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "極小照片", world["field_user"].id
    )
    started = world["field"].post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None

    image = Image.new("RGB", (100, 100), (50, 80, 100))
    output = io.BytesIO()
    image.save(output, "JPEG")
    content = output.getvalue()
    response = _upload(world, task_id, item.id, point_id, content, uuid4())
    assert response.status_code == 201, response.text
    assert response.json()["layer_render"]["render_state"] == (
        "omitted_too_small"
    )
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_ac13_admin_passes_and_task_reader_cannot_upload(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC13：測試 upload 對 U2 與 Admin 的兩端授權界線。"""
    from app.models import (
        ProjectMember,
        ProjectMemberRole,
        Role,
        RolePermission,
        TaskRequirementSnapshot,
    )

    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "AC13 U2 與 Admin", world["field_user"].id
    )
    started = world["field"].post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert started.status_code == 200, started.text
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None

    reader_role = Role(
        name=f"FEV U2 task reader {uuid4()}",
        created_by=world["admin_user"].id,
        updated_by=world["admin_user"].id,
        permission_codes=[RolePermission(code="inspection_task.read")],
    )
    db_session.add(reader_role)
    db_session.flush()
    plain_member = db_session.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == world["project"].id,
            ProjectMember.user_id == world["plain_user"].id,
        )
    )
    assert plain_member is not None
    plain_member.role_assignments.append(
        ProjectMemberRole(role_id=reader_role.id)
    )
    db_session.commit()

    image = _jpeg()
    denied = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        client=world["plain"],
    )
    assert denied.status_code == 403
    assert denied.json()["error"]["code"] == "permission.denied"
    assert not storage_root.exists()

    admin_upload = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        client=world["admin"],
    )
    assert admin_upload.status_code == 201, admin_upload.text
    assert set(admin_upload.json()["variants"]) == {"field", "office"}


def test_ac05_invalid_upload_targets_leave_no_rows_or_files(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC05：所有非法項目與項次目標皆拒絕且不落地。"""
    from app.models import TaskRequirementSnapshot

    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    plan = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "AC05 目標矩陣"},
    )
    assert plan.status_code == 201, plan.text
    created = world["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "AC05 多項目任務",
            "item_ids": [str(world["item"].id), str(world["item_two"].id)],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    assert (
        world["admin"]
        .post(f"/api/v1/inspection-tasks/{task_id}:dispatch")
        .status_code
        == 200
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    items = list(
        db_session.scalars(
            select(TaskInspectionItem)
            .where(TaskInspectionItem.task_id == UUID(task_id))
            .order_by(TaskInspectionItem.project_inspection_item_id)
        )
    )
    assert len(items) == 2
    other_plan = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": "AC05 另一任務"},
    )
    assert other_plan.status_code == 201, other_plan.text
    other_task = world["admin"].post(
        f"/api/v1/inspection-plans/{other_plan.json()['id']}/tasks",
        json={
            "name": "AC05 外部目標任務",
            "item_ids": [str(world["item_two"].id)],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert other_task.status_code == 201, other_task.text
    other_task_id = UUID(other_task.json()["id"])
    other_task_item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == other_task_id
        )
    )
    assert other_task_item is not None

    def first_point(item):
        snapshot = db_session.scalar(
            select(TaskRequirementSnapshot).where(
                TaskRequirementSnapshot.task_inspection_item_id == item.id,
                TaskRequirementSnapshot.is_current.is_(True),
            )
        )
        assert snapshot is not None
        point = db_session.scalar(
            select(TaskSnapshotPoint.source_point_id).where(
                TaskSnapshotPoint.snapshot_id == snapshot.id
            )
        )
        assert point is not None
        return point

    point_a, point_b = first_point(items[0]), first_point(items[1])
    image = _jpeg()
    invalid_requests = (
        (items[0].id, [], False),
        (items[0].id, [point_a], True),
        (items[0].id, [point_b], False),
        (other_task_item.id, [point_a], False),
    )
    for target_item, points, overview in invalid_requests:
        response = _upload(
            world,
            task_id,
            target_item,
            points,
            image,
            uuid4(),
            is_overview=str(overview).lower(),
        )
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "evidence.invalid_target"
        assert (
            db_session.scalar(
                select(Evidence).where(Evidence.task_id == UUID(task_id))
            )
            is None
        )
        assert not storage_root.exists()


def test_ac06_caption_boundary_is_persisted_and_overflow_is_rejected(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC06：500 字元可保存，超過上限不建立照片或檔案。"""
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "AC06 註記界線", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()
    caption = "說明" * 250
    accepted = _upload(
        world, task_id, item.id, point_id, image, uuid4(), caption=caption
    )
    assert accepted.status_code == 201, accepted.text
    saved = db_session.scalar(
        select(Evidence).where(Evidence.task_id == UUID(task_id))
    )
    assert saved is not None and saved.caption == caption

    overflow = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        caption="說明" * 251,
    )
    assert overflow.status_code == 422
    assert overflow.json()["error"]["code"] == "request.validation_failed"
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        ).id
        == saved.id
    )
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2


def test_ac12_new_upload_checks_draft_and_locked_task_states(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC12：DRAFT 隱藏優先，其他鎖定狀態拒絕新照片。"""
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "AC12 狀態矩陣", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    task = db_session.get(InspectionTask, UUID(task_id))
    assert task is not None
    image = _jpeg()

    task.status = "DRAFT"
    db_session.commit()
    draft = world["field"].post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        headers={"Idempotency-Key": str(uuid4())},
        data={"point_ids": "not-json", "capture_source": "invalid"},
        files={"file": ("field.jpg", image, "image/jpeg")},
    )
    assert draft.status_code == 404

    task.status = "PENDING"
    db_session.commit()
    pending = _upload(
        world, task_id, world["item"].id, uuid4(), image, uuid4()
    )
    assert pending.status_code == 409, pending.text
    assert pending.json()["error"]["code"] == "evidence.task_locked"

    cancelled = world["admin"].post(
        f"/api/v1/inspection-tasks/{task_id}:cancel",
        json={"reason": "AC12 測試取消"},
    )
    assert cancelled.status_code == 200, cancelled.text
    cancelled_upload = _upload(
        world, task_id, world["item"].id, uuid4(), image, uuid4()
    )
    assert cancelled_upload.status_code == 409, cancelled_upload.text
    assert cancelled_upload.json()["error"]["code"] == ("evidence.task_locked")

    restored = world["admin"].post(
        f"/api/v1/inspection-tasks/{task_id}:restore"
    )
    assert restored.status_code == 200, restored.text
    task.status = "COMPLETED"
    db_session.commit()
    completed = _upload(
        world, task_id, world["item"].id, uuid4(), image, uuid4()
    )
    assert completed.status_code == 409, completed.text
    assert completed.json()["error"]["code"] == "evidence.task_locked"
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )
    assert not storage_root.exists()


def test_ac35_field_layer_contract_and_ac38_capture_source_validation(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC35/38：現場圖層白名單與來源必填／列舉。"""
    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "AC35 AC38 上傳欄位", world["field_user"].id
    )
    assert (
        world["field"]
        .post(f"/api/v1/inspection-tasks/{task_id}:start")
        .status_code
        == 200
    )
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    assert item is not None
    from app.models import TaskRequirementSnapshot

    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    point_id = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    assert point_id is not None
    image = _jpeg()
    accepted = _upload(
        world,
        task_id,
        item.id,
        point_id,
        image,
        uuid4(),
        layer=json.dumps({"enabled": False, "corner": "top_right"}),
        capture_source="camera",
    )
    assert accepted.status_code == 201, accepted.text
    photo = db_session.scalar(
        select(Evidence).where(Evidence.task_id == UUID(task_id))
    )
    assert photo is not None
    assert photo.capture_source == "camera"
    assert photo.label_layer["enabled"] is False
    assert photo.label_layer["corner"] == "top_right"
    original_id = photo.id

    for layer in (
        {"size": "large"},
        {"overrides": {"project_name": "偽造"}},
        {"offset_x": 0.5},
        {"enabled": "false"},
    ):
        invalid = _upload(
            world,
            task_id,
            item.id,
            point_id,
            image,
            uuid4(),
            layer=json.dumps(layer),
            capture_source="camera",
        )
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "request.validation_failed"
        assert (
            db_session.scalar(
                select(Evidence).where(Evidence.task_id == UUID(task_id))
            ).id
            == original_id
        )

    missing = world["field"].post(
        f"/api/v1/inspection-tasks/{task_id}/photos",
        headers={"Idempotency-Key": str(uuid4())},
        data={
            "sha256": hashlib.sha256(image).hexdigest(),
            "item_id": str(item.id),
            "is_overview": "false",
            "point_ids": [str(point_id)],
        },
        files={"file": ("field.jpg", image, "image/jpeg")},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "request.validation_failed"
    assert (
        db_session.scalar(
            select(Evidence).where(Evidence.task_id == UUID(task_id))
        ).id
        == original_id
    )
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2
    assert len(list(LocalStorage(storage_root).iter_keys())) == 2
