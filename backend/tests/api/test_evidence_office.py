"""FEV-AC02／12／13／31～37：真後端編修、確定性與失敗回滾。"""

import hashlib
import io
import logging
import subprocess
import sys
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from PIL import Image
from sqlalchemy import event, select

from app.models import (
    Evidence,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
    Role,
    RolePermission,
    TaskInspectionItem,
    TaskSnapshotPoint,
    UserModulePermission,
)
from app.services import evidence_office as office_service
from app.services.evidence_images import default_layer
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_inspection_planning_api import (
    _dispatched_field_task,
    _planning_world,
)
from tests.db.conftest import make_system_admin


def _office_world(db_session, make_client, monkeypatch, tmp_path, size=None):
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world = _planning_world(db_session, make_client)
    # T5 真稽核要求正式環境必備的系統操作者，直接服務測試也要初始化。
    make_system_admin(world["admin_user"])
    db_session.commit()
    plan_id, task_id = _dispatched_field_task(
        world,
        "內業照片",
        world["field_user"].id,
    )
    started = world["field"].post(
        f"/api/v1/inspection-tasks/{task_id}:start",
    )
    assert started.status_code == 200, started.text
    item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.task_id == UUID(task_id),
        )
    )
    point = db_session.scalar(select(TaskSnapshotPoint.source_point_id))
    assert item is not None and point is not None
    image = _jpeg()
    if size:
        output = io.BytesIO()
        Image.new("RGB", size, (40, 90, 130)).save(output, "JPEG", quality=90)
        image = output.getvalue()
    response = _upload(
        world,
        task_id,
        item.id,
        point,
        image,
        uuid4(),
        caption="照片註記",
    )
    assert response.status_code == 201, response.text
    photo_id = UUID(response.json()["id"])
    world.update(
        {
            "url": f"/api/v1/inspection-tasks/{task_id}/photos/"
            f"{photo_id}/office-version",
            "photo_id": photo_id,
            "task_id": UUID(task_id),
            "plan_id": UUID(plan_id),
            "image": image,
            "root": root,
            "initial": response.json(),
        }
    )
    return world


def _state(session, world):
    session.expire_all()
    photo = session.get(Evidence, world["photo_id"])
    assert photo is not None
    variants = {
        row.variant_type: row
        for row in session.scalars(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == world["photo_id"],
            ),
        )
    }
    store = LocalStorage(world["root"])
    files = {}
    for key in store.iter_keys():
        with store.open(key) as stream:
            files[key] = stream.read()
    return deepcopy(
        {
            "actors": {
                name: (row.updated_by, row.edited_by, row.edited_at)
                for name, row in variants.items()
            },
            "source": photo.label_source,
            "layer": photo.label_layer,
            "caption": photo.caption,
            "variants": {
                name: (
                    row.id,
                    row.storage_key,
                    row.sha256,
                    row.width,
                    row.height,
                    row.edit_params,
                    row.label_rule,
                )
                for name, row in variants.items()
            },
            "files": files,
        }
    )


@pytest.mark.parametrize("size", [None, (320, 480), (64, 64)])
def test_edit_repeat_reset_preserves_field_baseline_and_only_two_files(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
    size,
):
    world = _office_world(
        db_session,
        make_client,
        monkeypatch,
        tmp_path,
        size,
    )
    before = _state(db_session, world)
    edit: dict = {"rotation": 90, "straighten": 15, "brightness": -100}
    if size is None:
        edit["crop"] = {
            "x": 0.125,
            "y": 0.125,
            "width": 0.625,
            "height": 0.625,
        }
    hashes = []
    for _ in range(2):
        response = world["admin"].put(world["url"], json=edit)
        assert response.status_code == 200, response.text
        assert "storage_key" not in response.text
        hashes.append(response.json()["variants"]["office"]["sha256"])
        now = _state(db_session, world)
        assert len(now["files"]) == 2
        assert now["actors"]["OFFICE"][:2] == (
            world["admin_user"].id,
            world["admin_user"].id,
        )
        assert now["variants"]["FIELD"] == before["variants"]["FIELD"]
        assert now["source"] == before["source"]
        assert now["caption"] == "照片註記"
        assert now["variants"]["OFFICE"][0] == before["variants"]["OFFICE"][0]
        assert before["variants"]["OFFICE"][1] not in now["files"]
        if size is None:
            assert now["variants"]["OFFICE"][3:5] == (500, 750)
    assert hashes[0] == hashes[1]
    reset = world["admin"].put(world["url"], json={})
    assert reset.status_code == 200, reset.text
    final = _state(db_session, world)
    assert final["variants"]["OFFICE"][2] == before["variants"]["OFFICE"][2]
    assert final["variants"]["OFFICE"][6] == before["variants"]["OFFICE"][6]
    assert len(final["files"]) == 2


def test_full_layer_overrides_validation_auto_fit_and_reset(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    layer: dict = dict(default_layer(), size="small", style="paper")
    layer["overrides"] = {
        "project_name": "覆寫" * 500,
        "item_name": "",
        "inspection_location": None,
    }
    response = world["admin"].put(world["url"], json={"layer": layer})
    assert response.status_code == 200, response.text
    assert response.json()["labels"]["project_name"] == "覆寫" * 500
    assert response.json()["labels"]["item_title"] == ""
    assert response.json()["has_layer_overrides"] is True
    assert "inspection_location" not in response.json()["layer"]["overrides"]
    before = _state(db_session, world)
    assert before["variants"]["OFFICE"][6]["base_size"] == "small"
    crop = {"x": 0, "y": 0, "width": 0.08, "height": 0.08}
    edited = world["admin"].put(world["url"], json={"crop": crop})
    assert edited.status_code == 200, edited.text
    assert edited.json()["layer_render"]["render_state"] == "omitted_too_small"
    same = response.json()["layer"]
    assert (
        world["admin"]
        .put(
            world["url"],
            json={"crop": crop, "layer": same},
        )
        .status_code
        == 200
    )
    smaller = dict(layer, style="outline")
    failed = world["admin"].put(
        world["url"],
        json={"crop": crop, "layer": smaller},
    )
    assert failed.status_code == 422
    assert failed.json()["error"]["code"] == "evidence.invalid_layer"
    assert world["admin"].put(world["url"], json={}).status_code == 200
    assert (
        _state(db_session, world)["variants"]["OFFICE"][2]
        == (before["variants"]["OFFICE"][2])
    )
    for bad in [
        {"layer": {"enabled": True}},
        {"layer": None},
        {"layer": dict(layer, enabled=1)},
        {"layer": dict(layer, corner=[])},
        {"layer": dict(layer, size="huge")},
        {"layer": dict(layer, offset_x=1.01)},
        {"layer": dict(layer, overrides={"uploader_name": "冒名"})},
        {"layer": dict(layer, overrides={"uploaded_at": "2020"})},
        {"layer": dict(layer, overrides={"item_name": "字" * 1001})},
        {"brightness": True},
        {"rotation": "90"},
        {"unknown": 1},
    ]:
        failed = world["admin"].put(world["url"], json=bad)
        assert failed.status_code == 422, failed.text
        assert failed.json()["error"]["code"] == "request.validation_failed"
    for bad in [
        {"rotation": 1},
        {"straighten": 15.01},
        {"brightness": -101},
        {"crop": dict(crop, width=0.01)},
        {"crop": dict(crop, x=0.99)},
    ]:
        failed = world["admin"].put(world["url"], json=bad)
        assert failed.status_code == 422, failed.text
        assert failed.json()["error"]["code"] == "evidence.invalid_edit"
    assert _state(db_session, world)["source"] == before["source"]


@pytest.mark.parametrize(
    "fault", ["save", "delete", "flush", "commit", "audit"]
)
def test_failed_replacement_restores_original_rows_keys_and_bytes(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
    fault,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    before = _state(db_session, world)
    original_delete = LocalStorage.delete
    old_key = before["variants"]["OFFICE"][1]

    def fail(*args, **kwargs):
        raise RuntimeError("injected office failure")

    def delete(self, key):
        if key == old_key:
            fail()
        return original_delete(self, key)

    if fault in {"flush", "commit"}:
        event_name = "after_flush" if fault == "flush" else "before_commit"
        event.listen(db_session, event_name, fail, once=True)
    elif fault == "audit":
        monkeypatch.setattr(office_service, "record_office_edit", fail)
    else:
        monkeypatch.setattr(
            LocalStorage,
            fault,
            delete if fault == "delete" else fail,
        )
    with pytest.raises(RuntimeError, match="injected office failure"):
        office_service.edit_office(
            db_session,
            task_id=world["task_id"],
            photo_id=world["photo_id"],
            operator_id=world["admin_user"].id,
            raw={
                "brightness": 100,
                "layer": dict(default_layer(), style="paper"),
            },
        )
    assert _state(db_session, world) == before


@pytest.mark.parametrize("status", ["PENDING", "CANCELLED", "COMPLETED"])
def test_task_plan_and_photo_lock_precedence(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
    status,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    task = db_session.get(InspectionTask, world["task_id"])
    plan = db_session.get(InspectionPlan, world["plan_id"])
    assert task is not None and plan is not None
    task.status = status
    task.cancelled_from_status = (
        "IN_PROGRESS" if status == "CANCELLED" else None
    )
    task.cancellation_reason = "暫停" if status == "CANCELLED" else None
    db_session.commit()
    response = world["admin"].put(world["url"], json={})
    assert response.status_code == (200 if status == "COMPLETED" else 409)
    if status != "COMPLETED":
        assert response.json()["error"]["code"] == "evidence.task_locked"
    plan.is_archived = True
    db_session.commit()
    response = world["admin"].put(world["url"], content="not json")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "inspection_plan.archived"
    task.status = "IN_PROGRESS"
    task.cancelled_from_status = None
    task.cancellation_reason = None
    plan.is_archived = False
    db_session.commit()
    photo = db_session.get(Evidence, world["photo_id"])
    assert photo is not None
    for reason in ("voided", "referenced_by_report", "deleted"):
        photo.voided_at = photo.created_at if reason == "voided" else None
        photo.void_reason = "STANDARD_CHANGED" if reason == "voided" else None
        photo.deleted_at = photo.created_at if reason == "deleted" else None
        photo.deleted_by = photo.created_by if reason == "deleted" else None
        db_session.commit()
        monkeypatch.setattr(
            office_service,
            "_report_checker",
            (
                (lambda session, photo: True)
                if reason == "referenced_by_report"
                else None
            ),
        )
        before = _state(db_session, world)
        response = world["admin"].put(world["url"], content="not json")
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "evidence.photo_locked"
        assert response.json()["error"]["details"][0] == reason
        assert _state(db_session, world) == before


def test_access_two_layers_and_manage_without_read_does_not_leak_office(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    for who in ("field", "reader", "plain", "outsider"):
        denied = world[who].put(world["url"], content="invalid")
        assert denied.status_code == 403, denied.text
    anonymous = make_client().put(world["url"], json={})
    assert anonymous.status_code == 401
    role = db_session.scalar(
        select(Role).where(
            Role.name == "API field inspector",
        )
    )
    assert role is not None
    role.permission_codes.append(RolePermission(code="evidence.manage"))
    db_session.commit()
    allowed = world["field"].put(world["url"], json={"brightness": 50})
    assert allowed.status_code == 200, allowed.text
    body = allowed.json()
    assert "variants" not in body
    assert "sha256" not in allowed.text
    assert "edit_params" not in allowed.text
    assert "is_non_realtime_capture" not in body
    assert body["uploaded_by"]["is_me"] is True
    role.permission_codes.append(RolePermission(code="evidence.read"))
    db_session.commit()
    allowed = world["field"].put(world["url"], json={})
    assert allowed.status_code == 200, allowed.text
    assert set(allowed.json()["variants"]) == {"field", "office"}
    permission = db_session.scalar(
        select(UserModulePermission).where(
            UserModulePermission.user_id == world["field_user"].id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    db_session.delete(permission)
    db_session.commit()
    assert world["field"].put(world["url"], json={}).status_code == 403
    missing = world["url"].replace(str(world["photo_id"]), str(uuid4()))
    response = world["admin"].put(missing, json={})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "resource.not_found"


def test_capture_flag_boundary_and_layer_disabled_exact_field_bytes(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    photo = db_session.get(Evidence, world["photo_id"])
    assert photo is not None
    for seconds, capture_source, expected in [
        (600, "camera", False),
        (-600, "camera", False),
        (601, "camera", True),
        (-601, "camera", True),
        (0, "library", True),
        (None, "camera", True),
    ]:
        photo.capture_source = capture_source
        photo.captured_at = (
            photo.created_at + timedelta(seconds=seconds)
            if seconds is not None
            else None
        )
        db_session.commit()
        result = world["admin"].put(
            world["url"],
            json={
                "layer": dict(default_layer(), enabled=False),
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["is_non_realtime_capture"] is expected
        now = _state(db_session, world)
        assert (
            now["variants"]["OFFICE"][2]
            == hashlib.sha256(
                world["image"],
            ).hexdigest()
        )
        assert len(now["files"]) == 2


def test_maintenance_preserves_inputs_skips_locks_and_is_repeatable(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    from app.cli.regenerate_office_versions import regenerate_office_versions

    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    system = world["admin_user"]
    make_system_admin(system)
    db_session.commit()
    layer: dict = dict(default_layer(), enabled=False, style="outline")
    layer["overrides"] = {"item_name": "維運保留完整覆寫"}
    updated = world["admin"].put(
        world["url"],
        json={
            "rotation": 90,
            "brightness": 50,
            "layer": layer,
        },
    )
    assert updated.status_code == 200, updated.text
    before = _state(db_session, world)
    recorded = []

    def capture(session, **payload):
        recorded.append(payload)

    monkeypatch.setattr(office_service, "record_office_edit", capture)
    for _ in range(2):
        assert regenerate_office_versions(db_session) == (1, 0)
        now = _state(db_session, world)
        assert now["actors"]["OFFICE"][:2] == (system.id, system.id)
        assert now["source"] == before["source"]
        assert now["layer"] == before["layer"]
        assert (
            now["variants"]["OFFICE"][2:] == before["variants"]["OFFICE"][2:]
        )
        assert now["variants"]["FIELD"] == before["variants"]["FIELD"]
        assert len(now["files"]) == 2
    assert all(row["operator_id"] == system.id for row in recorded)
    assert all(row["reason"] == "label_rule_change" for row in recorded)
    assert all(row["rule"]["font_version"] for row in recorded)
    photo = db_session.get(Evidence, world["photo_id"])
    task = db_session.get(InspectionTask, world["task_id"])
    plan = db_session.get(InspectionPlan, world["plan_id"])
    assert photo is not None and task is not None and plan is not None
    for locked in ("voided", "deleted", "report", "cancelled", "archived"):
        photo.voided_at = photo.created_at if locked == "voided" else None
        photo.void_reason = "STANDARD_CHANGED" if locked == "voided" else None
        photo.deleted_at = photo.created_at if locked == "deleted" else None
        photo.deleted_by = photo.created_by if locked == "deleted" else None
        task.status = "CANCELLED" if locked == "cancelled" else "IN_PROGRESS"
        task.cancelled_from_status = (
            "IN_PROGRESS" if locked == "cancelled" else None
        )
        task.cancellation_reason = "暫停" if locked == "cancelled" else None
        plan.is_archived = locked == "archived"
        db_session.commit()
        monkeypatch.setattr(
            office_service,
            "_report_checker",
            ((lambda session, photo: True) if locked == "report" else None),
        )
        before = _state(db_session, world)
        assert regenerate_office_versions(db_session) == (0, 1)
        assert _state(db_session, world) == before


@pytest.mark.parametrize(
    "brightness,expected", [(-100, (21, 45, 65)), (100, (62, 135, 195))]
)
def test_transform_brightness_endpoints_rounding_and_clockwise_order(
    brightness,
    expected,
):
    data = _jpeg()
    edit, _ = office_service.normalize_edit({"brightness": brightness})
    with Image.open(io.BytesIO(data)) as decoded:
        assert decoded.getpixel((10, 10)) == (41, 90, 130)
    image = office_service.transform_field(data, edit)
    assert image is not None
    # 編碼前驗證 D5，JPEG 不精確的色值不能冒充規格的 Q 取整驗收。
    assert image.getpixel((10, 10)) == expected
    output = io.BytesIO()
    asymmetric = Image.new("RGB", (129, 257), "white")
    asymmetric.paste((200, 0, 0), (0, 0, 64, 128))
    asymmetric.save(output, "JPEG", quality=100, subsampling=0)
    edit, _ = office_service.normalize_edit(
        {
            "rotation": 90,
            "crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 1},
        }
    )
    rotated = office_service.transform_field(output.getvalue(), edit)
    assert rotated is not None
    # Q(128.5)=129；正值 90° 將原左上紅區移至右上。
    assert rotated.size == (128, 129)
    red = rotated.getpixel((100, 10))
    assert isinstance(red, tuple)
    assert red[0] > 180 and red[1] < 10 and red[2] < 10


@pytest.mark.parametrize("straighten", [-15, 15])
def test_straighten_fills_working_frame_without_black_corners(straighten):
    edit, _ = office_service.normalize_edit({"straighten": straighten})
    image = office_service.transform_field(_jpeg(), edit)
    assert image is not None and image.size == (1200, 800)
    for xy in ((0, 0), (1199, 0), (0, 799), (1199, 799)):
        pixel = image.getpixel(xy)
        assert isinstance(pixel, tuple)
        assert min(pixel) > 20


def test_parallel_office_edits_leave_exactly_the_two_committed_files(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    before = _state(db_session, world)
    barrier = Barrier(2)

    def edit(brightness):
        barrier.wait(timeout=10)
        return world["admin"].put(
            world["url"],
            json={"brightness": brightness},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(edit, [-100, 100]))
    assert [response.status_code for response in responses] == [200, 200]
    now = _state(db_session, world)
    assert now["variants"]["FIELD"] == before["variants"]["FIELD"]
    assert set(now["files"]) == {
        now["variants"]["FIELD"][1],
        now["variants"]["OFFICE"][1],
    }
    assert (
        hashlib.sha256(now["files"][now["variants"]["OFFICE"][1]]).hexdigest()
        == (now["variants"]["OFFICE"][2])
    )


def test_saved_small_baseline_legacy_inference_and_source_never_refreshes(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    initial = world["admin"].put(
        world["url"],
        json={
            "layer": dict(default_layer(), size="small"),
        },
    )
    assert initial.status_code == 200, initial.text
    initial_hash = initial.json()["variants"]["office"]["sha256"]
    photo = db_session.get(Evidence, world["photo_id"])
    office = db_session.scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == world["photo_id"],
            EvidenceVariant.variant_type == "OFFICE",
        )
    )
    assert photo is not None and office is not None
    source = deepcopy(photo.label_source)
    # 模擬既有 FIELD 的初版 small 基準，保存的請求設定仍是 medium。
    photo.label_layer = default_layer()
    rule = dict(office.label_rule or {}, render_state="fallback_small")
    rule.pop("base_size")
    office.label_rule = rule
    world["project"].name = "後來的新工程名"
    world["field_user"].name_zh = "後來的新姓名"
    db_session.commit()
    for raw in (
        {},
        {
            "crop": {
                "x": 0,
                "y": 0,
                "width": 0.08,
                "height": 0.08,
            }
        },
        {},
    ):
        response = world["admin"].put(world["url"], json=raw)
        assert response.status_code == 200, response.text
    assert response.json()["variants"]["office"]["sha256"] == initial_hash
    assert response.json()["layer_render"] == {
        "render_state": "fallback_small",
        "effective_size": "small",
    }
    assert response.json()["labels"] == source
    now = _state(db_session, world)
    assert now["variants"]["OFFICE"][6]["base_size"] == "small"
    assert now["source"] == source
    # 無 base_size／effective_size 的舊列改由已保存 FIELD 推導，不猜歷史。
    office = db_session.scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == world["photo_id"],
            EvidenceVariant.variant_type == "OFFICE",
        )
    )
    assert office is not None
    office.label_rule = {}
    db_session.commit()
    inferred = world["admin"].put(world["url"], json={})
    assert inferred.status_code == 200, inferred.text
    assert _state(db_session, world)["variants"]["OFFICE"][6]["base_size"] == (
        "medium"
    )


def test_crop_after_tiny_upload_uses_saved_small_base_without_changing_field(
    db_session, make_client, monkeypatch, tmp_path
):
    """FEV-AC33：只裁切可達 fallback_small，且 FIELD 維持原始位元組。"""
    world = _office_world(
        db_session, make_client, monkeypatch, tmp_path, size=(227, 227)
    )
    initial = world["initial"]
    assert initial["layer_render"] == {
        "render_state": "omitted_too_small",
        "effective_size": None,
    }
    before = _state(db_session, world)
    field_before = before["files"][before["variants"]["FIELD"][1]]
    response = world["admin"].put(
        world["url"],
        json={
            "crop": {
                "x": 0,
                "y": 0,
                "width": 0.96,
                "height": 0.96,
            }
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["layer_render"] == {
        "render_state": "fallback_small",
        "effective_size": "small",
    }
    after = _state(db_session, world)
    assert after["layer"]["size"] == "medium"
    assert after["variants"]["OFFICE"][6]["base_size"] == "small"
    assert after["files"][after["variants"]["FIELD"][1]] == field_before


@pytest.mark.parametrize("operation", ["put", "put_missing_delete", "cli"])
def test_missing_office_is_rebuilt_from_field(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
    caplog,
    operation,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    if operation == "cli":
        make_system_admin(world["admin_user"])
        db_session.commit()
    before = _state(db_session, world)
    old_key = before["variants"]["OFFICE"][1]
    field_key = before["variants"]["FIELD"][1]
    store = LocalStorage(world["root"])
    store.delete(old_key)
    assert set(store.iter_keys()) == {field_key}
    if operation == "put_missing_delete":
        original_delete = LocalStorage.delete

        def missing_delete(self, key):
            if key == old_key:
                raise FileNotFoundError("missing old OFFICE")
            return original_delete(self, key)

        monkeypatch.setattr(LocalStorage, "delete", missing_delete)
    if operation == "cli":
        result = subprocess.run(
            [sys.executable, "-m", "app.cli.regenerate_office_versions"],
            cwd=Path(__file__).resolve().parents[2],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "Regenerated: 1; skipped locked: 0"
        warnings = [
            line
            for line in result.stderr.splitlines()
            if "evidence_office_missing_file" in line
        ]
    else:
        caplog.set_level(logging.WARNING, logger=office_service.__name__)
        response = world["admin"].put(world["url"], json={})
        assert response.status_code == 200, response.text
        warnings = [
            record.getMessage()
            for record in caplog.records
            if record.name == office_service.__name__
        ]
    assert len(warnings) == 1
    assert str(world["photo_id"]) in warnings[0]
    assert str(old_key) not in warnings[0]
    assert str(field_key) not in warnings[0]
    after = _state(db_session, world)
    assert after["variants"]["FIELD"] == before["variants"]["FIELD"]
    assert after["variants"]["OFFICE"][0] == before["variants"]["OFFICE"][0]
    assert after["variants"]["OFFICE"][2] == before["variants"]["OFFICE"][2]
    new_key = after["variants"]["OFFICE"][1]
    assert new_key != old_key
    assert set(after["files"]) == {field_key, new_key}
    assert after["files"][field_key] == before["files"][field_key]
    assert after["files"][new_key] == before["files"][old_key]
    assert after["source"] == before["source"]
    assert after["layer"] == before["layer"]


def test_missing_office_failed_commit_does_not_restore_a_phantom_file(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    before = _state(db_session, world)
    old_key = before["variants"]["OFFICE"][1]
    LocalStorage(world["root"]).delete(old_key)
    before = _state(db_session, world)

    def fail_commit(*args):
        raise RuntimeError("injected missing OFFICE commit failure")

    original_restore = LocalStorage.restore

    def unexpected_restore(self, key, source):
        if key == old_key:
            pytest.fail("a missing OFFICE has no backup to restore")
        return original_restore(self, key, source)

    monkeypatch.setattr(LocalStorage, "restore", unexpected_restore)
    event.listen(db_session, "before_commit", fail_commit, once=True)
    with pytest.raises(RuntimeError, match="injected missing OFFICE"):
        office_service.edit_office(
            db_session,
            task_id=world["task_id"],
            photo_id=world["photo_id"],
            operator_id=world["admin_user"].id,
            raw={"brightness": 100},
        )
    assert _state(db_session, world) == before
