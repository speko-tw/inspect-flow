"""#791 第二輪：項次容量、事件迴圈等待與渲染後狀態交錯。"""

from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from uuid import UUID, uuid4

import anyio
import pytest
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import limits
from app.api.errors import APIError
from app.db.clock import utc_now
from app.models import (
    Evidence,
    InspectionPlan,
    InspectionTask,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
)
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_evidence_upload_review import _ready


@pytest.mark.parametrize(
    "count,all_fields", [(3, True), (200, True), (201, True), (201, False)]
)
def test_repeated_points_reach_domain_limit(
    db_session, make_client, monkeypatch, tmp_path, count, all_fields
):
    """全部八個固定欄位與 200 個重複項次欄位可同時送出。"""
    monkeypatch.setenv(
        "INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path / "photos")
    )
    world, task, item, _ = _ready(db_session, make_client)
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == item,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    points = list(
        db_session.scalars(
            select(TaskSnapshotPoint)
            .where(
                TaskSnapshotPoint.snapshot_id == snapshot.id,
            )
            .order_by(TaskSnapshotPoint.sequence)
        )
    )
    ids = [p.source_point_id for p in points]
    for i in range(len(ids), min(count, limits.POINTS_MAX)):
        point_id = uuid4()
        db_session.add(
            TaskSnapshotPoint(
                snapshot_id=snapshot.id,
                source_point_id=point_id,
                sequence=i + 1,
                title=f"項次 {i + 1}",
                instruction="查核",
                created_by=world["admin_user"].id,
                updated_by=world["admin_user"].id,
            )
        )
        ids.append(point_id)
    db_session.commit()
    if count > limits.POINTS_MAX:
        ids.append(uuid4())
    fields = (
        dict(
            caption="同時佐證",
            captured_at="2026-11-03T00:00:00Z",
            field_edit='{"rotation":0,"brightness":0}',
            layer='{"enabled":false,"corner":"bottom_left"}',
        )
        if all_fields
        else {}
    )
    response = _upload(world, task, item, ids, _jpeg(), uuid4(), **fields)
    assert response.status_code == (
        201 if count <= limits.POINTS_MAX else 422
    ), response.text
    if count <= limits.POINTS_MAX:
        assert set(response.json()["point_ids"]) == {str(p) for p in ids}
    else:
        assert response.json()["error"]["code"] == "request.validation_failed"


def test_three_uploads_wait_without_occupying_default_worker_pool(
    db_session, make_client, monkeypatch, tmp_path
):
    """兩個重作業滿載時第三件等名額，便宜請求仍可使用預設 worker。"""
    from app.api.v1 import evidence as api

    monkeypatch.setenv(
        "INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path / "photos")
    )
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_CONCURRENT_UPLOADS", "2")
    world, task, item, point = _ready(db_session, make_client)
    image, replay_key = _jpeg(), uuid4()
    assert (
        _upload(world, task, item, point, image, replay_key).status_code == 201
    )
    lock, release, two_running, three_parsed = (
        Lock(),
        Event(),
        Event(),
        Event(),
    )
    active = peak = parsed = 0
    original_parse = api._parse_evidence_form

    async def parse(*args):
        nonlocal parsed
        form = await original_parse(*args)
        parsed += 1
        if parsed >= 3:
            three_parsed.set()
        return form

    def process(*args):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active == 2:
                two_running.set()
        try:
            assert release.wait(20)
            return JSONResponse({"stub": True}, status_code=201)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(api, "_parse_evidence_form", parse)
    monkeypatch.setattr(api, "_process_upload", process)
    shared = world["field"]

    @shared.app.get("/review/default-worker")
    def worker_probe():
        return {"available": True}

    async def configure():
        anyio.to_thread.current_default_thread_limiter().total_tokens = 1

    with shared:
        try:
            with ThreadPoolExecutor(max_workers=6) as executor:
                uploads = [
                    executor.submit(
                        _upload,
                        world,
                        task,
                        item,
                        point,
                        image,
                        uuid4(),
                        client=shared,
                    )
                    for _ in range(3)
                ]
                try:
                    assert three_parsed.wait(10)
                    assert two_running.wait(10)
                    # 先讓三件完成登入／串流，再縮小預設池，隔離影像排隊。
                    shared.portal.call(configure)
                    # 預設池只有一個 token；重作業不得持有它。
                    probe = executor.submit(
                        shared.get, "/review/default-worker"
                    )
                    assert probe.result(5).status_code == 200
                    replay = executor.submit(
                        _upload,
                        world,
                        task,
                        item,
                        point,
                        image,
                        replay_key,
                        client=shared,
                    )
                    assert replay.result(5).status_code == 200
                    invalid = executor.submit(
                        _upload,
                        world,
                        task,
                        item,
                        point,
                        image,
                        uuid4(),
                        client=shared,
                        capture_source="invalid",
                    )
                    assert invalid.result(5).status_code == 422
                finally:
                    release.set()
                assert [f.result(15).status_code for f in uploads] == [201] * 3
        finally:
            release.set()
    assert peak == 2


@pytest.mark.parametrize("change", ["complete", "archive"])
def test_sqlite_rechecks_task_and_plan_after_render(
    db_session, engine, make_client, monkeypatch, tmp_path, change
):
    """固定在 render 中提交狀態變更；寫入取得鎖後須重新讀取純量。"""
    from app.services import evidence as service

    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    actor = world["field_user"].id
    original = service.render_office
    changed = []

    def render(*args):
        with Session(engine) as writer:
            row = writer.get(InspectionTask, UUID(task))
            assert row is not None
            if change == "complete":
                row.status = "COMPLETED"
                row.completed_at = utc_now()
                row.completed_by = actor
            else:
                plan = writer.get(InspectionPlan, row.plan_id)
                assert plan is not None
                plan.is_archived = True
            writer.commit()
        changed.append(change)
        return original(*args)

    monkeypatch.setattr(service, "render_office", render)
    response = _upload(world, task, item, point, _jpeg(), uuid4())
    assert changed == [change]
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == (
        "evidence.task_locked"
        if change == "complete"
        else "inspection_plan.archived"
    )
    with Session(engine) as verify:
        assert verify.scalar(select(Evidence)) is None
    assert list(LocalStorage(root).iter_keys()) == []


def test_json_recursion_error_is_a_validation_error(monkeypatch):
    """直接觸發例外分支，不依賴直譯器的 JSON 巢狀深度限制。"""
    from app.api.v1 import evidence as api

    def too_deep(*args):
        raise RecursionError("controlled recursion probe")

    with monkeypatch.context() as patch:
        patch.setattr(api.json, "loads", too_deep)
        with pytest.raises(APIError) as error:
            api._json_object("{}", default={})
    assert error.value.status_code == 422
    assert error.value.code.value == "request.validation_failed"
