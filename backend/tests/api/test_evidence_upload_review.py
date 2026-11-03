"""#791 複驗：串流鎖、快照交錯與 multipart 邊界回歸。"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import limits
from app.models import (
    Evidence,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
)
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_inspection_planning_api import (
    _dispatched_field_task,
    _planning_world,
)


def _ready(db_session, make_client):
    world = _planning_world(db_session, make_client)
    _, task_id = _dispatched_field_task(
        world, "上傳審查回歸", world["field_user"].id
    )
    response = world["field"].post(f"/api/v1/inspection-tasks/{task_id}:start")
    assert response.status_code == 200, response.text
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id)
        )
    )
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    point = db_session.scalar(
        select(TaskSnapshotPoint.source_point_id).where(
            TaskSnapshotPoint.snapshot_id == snapshot.id
        )
    )
    return world, task_id, item.id, point


@pytest.mark.parametrize(
    "change",
    [
        {"field_edit": "[" * 1500 + "]" * 1500},
        {"captured_at": "0001-01-01T00:00:00+23:59"},
        {"point_ids": '["00000000-0000-0000-0000-000000000001"]'},
    ],
)
def test_malformed_upload_is_422(
    db_session, make_client, monkeypatch, tmp_path, change
):
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task, item, point = _ready(db_session, make_client)
    response = _upload(world, task, item, point, _jpeg(), uuid4(), **change)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "request.validation_failed"


def test_streaming_request_releases_auth_write_transaction(
    db_session, make_client, monkeypatch, tmp_path
):
    from app.api.v1 import evidence as api

    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task, item, point = _ready(db_session, make_client)
    ready, release = Event(), Event()
    original = api._parse_evidence_form

    async def paused(*args):
        ready.set()
        assert await asyncio.to_thread(release.wait, 15)
        return await original(*args)

    monkeypatch.setattr(api, "_parse_evidence_form", paused)
    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                _upload, world, task, item, point, _jpeg(), uuid4()
            )
            assert ready.wait(10)
            # 另一請求也會 touch auth_sessions；必須能在串流尚未完成時提交。
            response = world["admin"].get("/api/v1/auth/me")
            assert response.status_code == 200, response.text
            release.set()
            assert future.result(20).status_code == 201
    finally:
        release.set()


def test_sqlite_snapshot_change_during_render_rolls_back_and_cleans_files(
    db_session, engine, make_client, monkeypatch, tmp_path
):
    from app.services import evidence as service

    assert engine.dialect.name == "sqlite"
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    project, source_item = world["project"].id, world["item"].id
    original = service.render_office
    changed = []

    def render(*args):
        # 固定在讀取快照後、寫入照片前提交真正的 KD-55 變更，不靠 sleep。
        response = world["admin"].patch(
            f"/api/v1/projects/{project}/inspection-items/{source_item}",
            json={
                "inspection_points": [
                    {
                        "sequence": 1,
                        "title": "新標準",
                        "instruction": "新標準",
                        "text_standard": {"text": "新標準"},
                        "measurement_fields": [],
                        "evidence_requirements": [{"min_count": 1}],
                    }
                ],
                "reinspect": True,
            },
        )
        assert response.status_code == 200, response.text
        changed.append(response.status_code)
        return original(*args)

    monkeypatch.setattr(service, "render_office", render)
    response = _upload(world, task, item, point, _jpeg(), uuid4())
    assert changed == [200]
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "evidence.requirement_changed"
    with Session(engine) as verify:
        assert verify.scalar(select(Evidence)) is None
    assert list(LocalStorage(root).iter_keys()) == []


@pytest.mark.parametrize("boundary", ["length", "chunked", "fields", "part"])
def test_multipart_limits_before_upload(
    db_session, make_client, monkeypatch, tmp_path, boundary
):
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES", "128")
    world, task, _, _ = _ready(db_session, make_client)
    headers = {"Content-Type": "multipart/form-data; boundary=review"}
    if boundary in {"length", "chunked"}:
        body = b"x" * (129 + limits.EVIDENCE_MULTIPART_OVERHEAD_MAX)
        expected = 413
        if boundary == "length":
            headers["Content-Length"] = str(len(body))
            content = body
        else:
            # iterator 走 chunked，確認沒有 Content-Length 預檢可依賴。
            content = iter([body[:100], body[100:]])
    else:
        # 固定欄位與 200 個項次共用推導上限，再多一個 part 就拒絕。
        count = limits.EVIDENCE_MULTIPART_FIELDS_MAX + 1
        value = b"x"
        if boundary == "part":
            count = 1
            value *= limits.EVIDENCE_MULTIPART_FIELD_MAX + 1
        body = (
            b"".join(
                b'--review\r\nContent-Disposition: form-data; name="caption"'
                b"\r\n\r\n" + value + b"\r\n"
                for _ in range(count)
            )
            + b"--review--\r\n"
        )
        content, expected = body, 422
    request = world["field"].build_request(
        "POST",
        f"/api/v1/inspection-tasks/{task}/photos",
        headers=headers,
        content=content,
    )
    if boundary == "chunked":
        assert "content-length" not in request.headers
        assert request.headers["transfer-encoding"] == "chunked"
    response = world["field"].send(request)
    assert response.status_code == expected, response.text
    assert response.json()["error"]["code"] == (
        "evidence.file_too_large"
        if expected == 413
        else "request.validation_failed"
    )


def test_upload_timestamp_matches_label_and_identifier_is_uuid7(
    db_session, make_client, monkeypatch, tmp_path
):
    """R13：標示與上傳時間必須來自同一個伺服器時點。"""
    from datetime import datetime

    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task, item, point = _ready(db_session, make_client)
    response = _upload(world, task, item, point, _jpeg(), uuid4())
    assert response.status_code == 201, response.text
    data = response.json()
    assert UUID(data["id"]).version == 7
    assert datetime.fromisoformat(data["uploaded_at"]) == (
        datetime.fromisoformat(data["labels"]["uploaded_at"])
    )


def test_regional_font_missing_name_still_commits_both_variants(
    db_session, make_client, monkeypatch, tmp_path, caplog
):
    """缺字只改 OFFICE 顯示，原姓名與兩個版本仍完成同一交易。"""
    from app.models import User

    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    user = db_session.get(User, world["field_user"].id)
    user.name_zh = "張𠮷"
    db_session.commit()
    response = _upload(world, task, item, point, _jpeg(), uuid4())
    assert response.status_code == 201, response.text
    assert response.json()["labels"]["uploader_name"] == "張𠮷"
    assert "U+20BB7" in caplog.text
    assert "張𠮷" not in caplog.text
    assert len(list(LocalStorage(root).iter_keys())) == 2
    db_session.expire_all()
    assert db_session.scalar(select(Evidence)) is not None
