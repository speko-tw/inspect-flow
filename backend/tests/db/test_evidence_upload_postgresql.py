"""FEV-AC09/28：PostgreSQL API 冪等並行與快照行鎖驗收。"""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import (
    Evidence,
    ProjectInspectionItem,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
)

# Pytest runs these re-exported cases with this module's PostgreSQL fixtures.
from tests.api.test_evidence_upload import (
    test_ac05_invalid_upload_targets_leave_no_rows_or_files,
    test_ac06_caption_boundary_is_persisted_and_overflow_is_rejected,
    test_ac12_new_upload_checks_draft_and_locked_task_states,
    test_ac13_admin_passes_and_task_reader_cannot_upload,
    test_ac35_field_layer_contract_and_ac38_capture_source_validation,
    test_other_uploader_cannot_replay_existing_idempotency_key,
    test_parallel_identical_uploads_create_only_one_photo,
    test_second_variant_storage_failure_cleans_first_file_and_database,
    test_stale_snapshot_point_is_requirement_changed_but_unknown_is_invalid,
    test_tiny_valid_jpeg_is_saved_when_layer_cannot_fit,
    test_upload_capture_source_and_captured_at_contract,
    test_upload_rejects_bad_content_and_hash_without_files,
    test_upload_requires_project_inspect_and_inspection_module_access,
    test_upload_revalidates_snapshot_changed_while_request_waits,
    test_upload_writes_two_variants_and_replays_by_full_fingerprint,
)
from tests.api.test_inspection_planning_api import _planning_world

__all__ = [
    "test_ac05_invalid_upload_targets_leave_no_rows_or_files",
    "test_ac06_caption_boundary_is_persisted_and_overflow_is_rejected",
    "test_ac12_new_upload_checks_draft_and_locked_task_states",
    "test_ac13_admin_passes_and_task_reader_cannot_upload",
    "test_ac35_field_layer_contract_and_ac38_capture_source_validation",
    "test_other_uploader_cannot_replay_existing_idempotency_key",
    "test_parallel_identical_uploads_create_only_one_photo",
    "test_second_variant_storage_failure_cleans_first_file_and_database",
    "test_stale_snapshot_point_is_requirement_changed_but_unknown_is_invalid",
    "test_tiny_valid_jpeg_is_saved_when_layer_cannot_fit",
    "test_upload_capture_source_and_captured_at_contract",
    "test_upload_rejects_bad_content_and_hash_without_files",
    "test_upload_revalidates_snapshot_changed_while_request_waits",
    "test_upload_requires_project_inspect_and_inspection_module_access",
    "test_upload_writes_two_variants_and_replays_by_full_fingerprint",
]

_BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url: str) -> str:
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    return db_url


@pytest.fixture
def engine(
    request: pytest.FixtureRequest, migrated_url: str
) -> Generator[Engine, None, None]:
    test_engine = create_engine_from_settings(migrated_url)
    assert test_engine.dialect.name == request.config.getoption("--db-backend")
    try:
        yield test_engine
    finally:
        test_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def make_client(engine: Engine):
    def create_client() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return create_client


def test_kd55_change_wins_before_upload_item_lock(
    db_session: Session, engine: Engine, make_client, tmp_path, monkeypatch
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("row-lock interleave requires PostgreSQL")

    storage_root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(storage_root))
    world = _planning_world(db_session, make_client)
    admin = world["admin"]
    field = world["field"]
    project_id = world["project"].id
    plan = admin.post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "AC28 PostgreSQL interleave"},
    )
    assert plan.status_code == 201, plan.text
    task = admin.post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "快照重驗任務",
            "item_ids": [str(world["item"].id)],
            "suggested_assignee_id": str(world["field_user"].id),
        },
    )
    assert task.status_code == 201, task.text
    task_id = task.json()["id"]
    assert (
        admin.post(f"/api/v1/inspection-tasks/{task_id}:dispatch").status_code
        == 200
    )
    assert (
        field.post(f"/api/v1/inspection-tasks/{task_id}:start").status_code
        == 200
    )
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

    patch_ready = Event()
    release_patch = Event()
    patch_backend_pid: int | None = None

    def mark_patch_before_flush(
        session: Session, _flush_context, _instances
    ) -> None:
        if any(
            isinstance(value, ProjectInspectionItem)
            and value.id == world["item"].id
            for value in session.dirty
        ):
            session.info["w791_kd55_patch"] = True

    def pause_patch_before_commit(session: Session) -> None:
        nonlocal patch_backend_pid
        if not session.info.pop("w791_kd55_patch", False):
            return
        patch_backend_pid = (
            session.connection()
            .exec_driver_sql("SELECT pg_backend_pid()")
            .scalar_one()
        )
        patch_ready.set()
        if not release_patch.wait(timeout=20):
            raise TimeoutError("test did not release KD-55 transaction")

    image = _tiny_jpeg()
    key = uuid4()

    def patch_item():
        return admin.patch(
            f"/api/v1/projects/{project_id}/inspection-items/"
            f"{world['item'].id}",
            json={
                "inspection_points": [
                    {
                        "sequence": 1,
                        "title": "更新後項次",
                        "instruction": "更新後說明",
                        "text_standard": {"text": "更新後標準"},
                        "measurement_fields": [],
                        "evidence_requirements": [{"min_count": 1}],
                    }
                ],
                "reinspect": True,
            },
        )

    def upload():
        return field.post(
            f"/api/v1/inspection-tasks/{task_id}/photos",
            headers={"Idempotency-Key": str(key)},
            data={
                "sha256": _sha256(image),
                "item_id": str(item.id),
                "is_overview": "false",
                "point_ids": [str(point_id)],
                "capture_source": "camera",
            },
            files={"file": ("photo.jpg", image, "image/jpeg")},
        )

    def wait_for_blocked_upload() -> None:
        import time

        assert patch_backend_pid is not None
        deadline = time.monotonic() + 15
        observed: list[tuple[int, list[int], str]] = []
        while time.monotonic() < deadline:
            with engine.connect() as connection:
                # 正向查詢也證明探針連到實際測試資料庫。
                assert (
                    connection.exec_driver_sql(
                        "SELECT current_database()"
                    ).scalar_one()
                    == "inspectflow_test"
                )
                observed = list(
                    connection.execute(
                        text(
                            "SELECT pid, pg_blocking_pids(pid), query "
                            "FROM pg_stat_activity "
                            "WHERE datname = current_database() "
                            "AND state = 'active' AND pid <> pg_backend_pid()"
                        )
                    ).all()
                )
            if any(
                patch_backend_pid in blockers
                and "FROM inspection_tasks" in query
                for _, blockers, query in observed
            ):
                return
            time.sleep(0.1)
        raise AssertionError(f"upload did not wait on KD-55 lock: {observed}")

    event.listen(Session, "before_flush", mark_patch_before_flush)
    event.listen(Session, "before_commit", pause_patch_before_commit)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending_patch = executor.submit(patch_item)
            assert patch_ready.wait(timeout=20)
            pending_upload = executor.submit(upload)
            try:
                wait_for_blocked_upload()
            finally:
                release_patch.set()
            changed = pending_patch.result(timeout=30)
            response = pending_upload.result(timeout=30)
    finally:
        release_patch.set()
        event.remove(Session, "before_commit", pause_patch_before_commit)
        event.remove(Session, "before_flush", mark_patch_before_flush)

    assert changed.status_code == 200, changed.text
    new_point_id = UUID(changed.json()["inspection_points"][0]["id"])
    assert new_point_id != point_id
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == ("evidence.requirement_changed")
    assert (
        db_session.scalar(
            select(Evidence.id).where(Evidence.task_id == UUID(task_id))
        )
        is None
    )
    assert not storage_root.exists()


def _tiny_jpeg() -> bytes:
    import io

    from PIL import Image

    output = io.BytesIO()
    Image.new("RGB", (100, 100), (50, 80, 100)).save(output, "JPEG")
    return output.getvalue()


def _sha256(data: bytes) -> str:
    import hashlib

    return hashlib.sha256(data).hexdigest()


def test_shared_event_loop_progresses_while_upload_waits_for_task_lock(
    db_session, engine, make_client, monkeypatch, tmp_path
):
    """FEV-R21：單一 lifespan 事件迴圈不可被同步 FOR UPDATE 堵住。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("row-lock event-loop regression requires PostgreSQL")
    from app.models import InspectionTask
    from tests.api.test_evidence_upload import _upload
    from tests.api.test_evidence_upload_review import _ready

    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task_id, item_id, point_id = _ready(db_session, make_client)
    held, waiting, release = Event(), Event(), Event()
    app = create_app()

    @app.post("/review/hold-task")
    def hold_task():
        with Session(engine) as session:
            session.scalar(
                select(InspectionTask)
                .where(InspectionTask.id == UUID(task_id))
                .with_for_update()
            )
            held.set()
            assert release.wait(15)
        return {"released": True}

    def observe(_conn, _cursor, statement, _params, _context, _many):
        if held.is_set() and "inspection_tasks" in statement:
            if "FOR UPDATE" in statement:
                waiting.set()

    from sqlalchemy.engine import Engine as SQLAlchemyEngine

    from app.auth.sessions import SESSION_COOKIE_NAME

    cookie = world["field"].cookies.get(SESSION_COOKIE_NAME)
    event.listen(SQLAlchemyEngine, "before_cursor_execute", observe)
    try:
        # 必須共用 lifespan portal；不同 TestClient 會掩蓋事件迴圈死結。
        with TestClient(app, base_url="https://testserver") as shared:
            shared.cookies.set(SESSION_COOKIE_NAME, cookie)
            with ThreadPoolExecutor(max_workers=3) as executor:
                lock = executor.submit(shared.post, "/review/hold-task")
                try:
                    assert held.wait(10)
                    upload = executor.submit(
                        _upload,
                        world,
                        task_id,
                        item_id,
                        point_id,
                        _tiny_jpeg(),
                        uuid4(),
                        client=shared,
                    )
                    assert waiting.wait(10)
                    health = executor.submit(shared.get, "/api/v1/health")
                    assert health.result(5).status_code == 200
                finally:
                    release.set()
                assert lock.result(10).status_code == 200
                assert upload.result(20).status_code == 201
    finally:
        release.set()
        event.remove(SQLAlchemyEngine, "before_cursor_execute", observe)
