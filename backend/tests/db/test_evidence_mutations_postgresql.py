"""FEV-AC17／28：隔離 schema 的點位互換與兩種上傳／作廢交錯。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session

from app.models import Evidence, TaskInspectionItem, TaskSnapshotPoint
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_evidence_upload_review import _ready
from tests.db.test_evidence_office_postgresql import (
    migrated_url as migrated_url,
)
from tests.db.test_evidence_upload_postgresql import (
    _dispose_shared_engine as _dispose_shared_engine,
)
from tests.db.test_evidence_upload_postgresql import db_session as db_session
from tests.db.test_evidence_upload_postgresql import engine as engine
from tests.db.test_evidence_upload_postgresql import make_client as make_client
from tests.db.test_evidence_upload_postgresql import (
    test_kd55_change_wins_before_upload_item_lock,
)
from tests.db.test_project_item_edit_concurrency import (
    test_project_item_patch_can_swap_point_sequences_on_postgresql,
)

__all__ = [
    "test_kd55_change_wins_before_upload_item_lock",
    "test_project_item_patch_can_swap_point_sequences_on_postgresql",
]


def test_upload_wins_then_kd55_voids_the_committed_photo(
    db_session, engine, make_client, tmp_path, monkeypatch
):
    """AC28：先持有上傳交易，確認 KD-55 真正等鎖，再提交與作廢。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks")
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task, item, point = _ready(db_session, make_client)
    project_id, source_id = world["project"].id, world["item"].id
    db_session.commit()
    ready, release = Event(), Event()
    uploader_pid = None

    def mark(session, *_):
        if any(isinstance(row, Evidence) for row in session.new):
            session.info["w794_upload"] = True

    def pause(session):
        nonlocal uploader_pid
        if not session.info.pop("w794_upload", False):
            return
        uploader_pid = session.scalar(text("SELECT pg_backend_pid()"))
        ready.set()
        if not release.wait(20):
            raise TimeoutError("upload was not released")

    event.listen(Session, "before_flush", mark)
    event.listen(Session, "before_commit", pause)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            uploaded = executor.submit(
                _upload, world, task, item, point, _jpeg(), uuid4()
            )
            assert ready.wait(15)
            changed = executor.submit(
                world["admin"].patch,
                f"/api/v1/projects/{project_id}/inspection-items/{source_id}",
                json={"title": "修改後標準", "reinspect": True},
            )
            try:
                deadline = monotonic() + 15
                while monotonic() < deadline:
                    with engine.connect() as connection:
                        schema = connection.scalar(
                            text("SELECT current_schema()")
                        )
                        assert schema.startswith("w793_")
                        blockers = (
                            connection.execute(
                                text(
                                    "SELECT pg_blocking_pids(pid) "
                                    "FROM pg_stat_activity "
                                    "WHERE datname = current_database() "
                                    "AND pid <> pg_backend_pid() "
                                    "AND state = 'active'"
                                )
                            )
                            .scalars()
                            .all()
                        )
                    if any(uploader_pid in value for value in blockers):
                        break
                    sleep(0.05)
                else:
                    raise AssertionError("KD-55 did not wait for upload")
            finally:
                release.set()
            response = uploaded.result(25)
            result = changed.result(25)
    finally:
        release.set()
        event.remove(Session, "before_flush", mark)
        event.remove(Session, "before_commit", pause)
    assert response.status_code == 201, response.text
    assert result.status_code == 200, result.text
    db_session.expire_all()
    photo = db_session.get(Evidence, UUID(response.json()["id"]))
    assert photo.void_reason == "STANDARD_CHANGED"
    task_item = db_session.get(TaskInspectionItem, item)
    assert task_item.needs_reinspection
    point_ids = set(
        db_session.scalars(select(TaskSnapshotPoint.source_point_id))
    )
    assert point in point_ids
