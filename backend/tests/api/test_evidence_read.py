"""FEV T3：兩資料庫的真實 API、覆蓋、分頁與圖片讀取。"""

import io
import os
from collections.abc import Generator
from contextlib import contextmanager
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import (
    AuditLog,
    Evidence,
    EvidencePointLink,
    EvidenceVariant,
    InspectionPlan,
    InspectionTask,
    ProjectEvidenceRequirement,
    Role,
    RolePermission,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotPoint,
)
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_evidence_upload_review import _ready


@contextmanager
def _read_database(url: str, postgres: bool):
    """PG 每例只建刪自己的 schema，不觸碰共用 public（#792）。"""
    if not postgres:
        yield url
        return
    schema = "w792_" + uuid4().hex
    control = create_engine_from_settings(url)
    try:
        with control.begin() as connection:
            assert connection.scalar(text("SELECT current_database()")) == (
                "inspectflow_test"
            )
            connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
        isolated = (
            make_url(url)
            .update_query_dict({"options": f"-csearch_path={schema}"})
            .render_as_string(hide_password=False)
        )
        try:
            yield isolated
        finally:
            with control.begin() as connection:
                connection.execution_options(audit_log_ddl_allowed=True)
                connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
    finally:
        control.dispose()


@pytest.fixture(params=["sqlite", "postgresql"])
def read_world(request, tmp_path, monkeypatch) -> Generator[dict, None, None]:
    """同一真實 API 驗收在 SQLite 與專用 PG schema 執行。"""
    postgres = request.param == "postgresql"
    url = (
        os.environ.get("INSPECTFLOW_TEST_POSTGRES_URL")
        if postgres
        else (f"sqlite:///{tmp_path / 'read.db'}")
    )
    if not url:
        pytest.skip("INSPECTFLOW_TEST_POSTGRES_URL is not set")
    dispose_engine()
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    with _read_database(url, postgres) as isolated_url:
        monkeypatch.setenv("INSPECTFLOW_DATABASE_URL", isolated_url)
        config = Config(
            str(Path(__file__).resolve().parents[2] / "alembic.ini")
        )
        command.upgrade(config, "head")
        engine = create_engine_from_settings(isolated_url)
        if postgres:
            with engine.connect() as connection:
                schema = connection.scalar(text("SELECT current_schema()"))
                assert schema is not None and schema.startswith("w792_")
        try:
            with Session(engine) as db:

                def client():
                    return TestClient(
                        create_app(), base_url="https://testserver"
                    )

                world, task, item, point = _ready(db, client)
                # U5 只有 evidence.read；不把普通讀取驗收綁在 Admin 特例。
                role = db.scalar(
                    select(Role).where(Role.name == "API planning reader")
                )
                assert role is not None
                role.permission_codes.append(
                    RolePermission(code="evidence.read")
                )
                db.commit()
                world.update(
                    db=db,
                    engine=engine,
                    root=root,
                    task=task,
                    item_id=item,
                    point_id=point,
                    make_client=client,
                )
                yield world
                for value in world.values():
                    if isinstance(value, TestClient):
                        value.close()
        finally:
            dispose_engine()
            engine.dispose()


def _add_photo(world, **changes) -> dict:
    response = _upload(
        world,
        world["task"],
        world["item_id"],
        world["point_id"],
        _jpeg(),
        uuid4(),
        **changes,
    )
    assert response.status_code == 201, response.text
    return response.json()


def _paths(world, photo=None):
    base = f"/api/v1/inspection-tasks/{world['task']}/photos"
    field = f"/api/v1/field/inspection-tasks/{world['task']}"
    return base, field, f"{base}/{photo['id']}" if photo else base


def _clone_photos(world, count):
    """建立大量合法資料列來量測查詢成長；不假造 HTTP 回應。"""
    db = world["db"]
    base = db.scalar(select(Evidence))
    variants = list(
        db.scalars(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == base.id
            )
        )
    )
    for _ in range(count):
        photo = Evidence(
            project_id=base.project_id,
            task_id=base.task_id,
            task_inspection_item_id=base.task_inspection_item_id,
            snapshot_revision=base.snapshot_revision,
            upload_key=uuid4(),
            request_fingerprint="0" * 64,
            capture_source="camera",
            is_overview=False,
            uploader_snapshot=base.uploader_snapshot,
            label_source=base.label_source,
            label_layer=base.label_layer,
            created_by=base.created_by,
            updated_by=base.updated_by,
        )
        db.add(photo)
        db.flush()
        db.add(
            EvidencePointLink(
                evidence_id=photo.id,
                source_point_id=world["point_id"],
                created_by=base.created_by,
                updated_by=base.updated_by,
            )
        )
        for variant in variants:
            db.add(
                EvidenceVariant(
                    evidence_id=photo.id,
                    variant_type=variant.variant_type,
                    storage_key=uuid4(),
                    content_type="image/jpeg",
                    byte_size=variant.byte_size,
                    sha256=variant.sha256,
                    width=variant.width,
                    height=variant.height,
                    edit_params=variant.edit_params,
                    label_rule=variant.label_rule,
                    created_by=base.created_by,
                    updated_by=base.updated_by,
                )
            )
    db.commit()


def test_ac04_coverage_multi_point_minimum_and_no_photo_cap(read_world):
    w = read_world
    db = w["db"]
    snapshot = db.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == w["item_id"],
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    point_b = TaskSnapshotPoint(
        snapshot_id=snapshot.id,
        source_point_id=uuid4(),
        sequence=2,
        title="B",
        instruction="B",
        created_by=w["admin_user"].id,
        updated_by=w["admin_user"].id,
    )
    db.add(point_b)
    db.flush()
    db.add(
        TaskSnapshotEvidenceRequirement(
            point_id=point_b.id,
            evidence_type="photo",
            required=True,
            min_count=2,
            created_by=w["admin_user"].id,
            updated_by=w["admin_user"].id,
        )
    )
    db.commit()
    url = _paths(w)[1] + "/evidence"

    def coverage():
        response = w["field"].get(url)
        assert response.status_code == 200, response.text
        return response.json()

    assert coverage()["all_points_satisfied"] is False
    _add_photo(w)
    assert [p["photo_count"] for p in coverage()["items"][0]["points"]] == [
        1,
        0,
    ]
    response = _upload(
        w,
        w["task"],
        w["item_id"],
        [w["point_id"], point_b.source_point_id],
        _jpeg(),
        uuid4(),
    )
    assert response.status_code == 201, response.text
    current = coverage()
    assert [p["missing_count"] for p in current["items"][0]["points"]] == [
        0,
        1,
    ]
    response = _upload(
        w,
        w["task"],
        w["item_id"],
        point_b.source_point_id,
        _jpeg(),
        uuid4(),
    )
    assert response.status_code == 201, response.text
    assert coverage()["all_points_satisfied"] is True
    _add_photo(w, is_overview="true", point_ids=[])
    assert coverage()["items"][0]["overview_count"] == 1
    _clone_photos(w, 100)
    _add_photo(w)  # 已超過一百張後仍以真實上傳證明未設上限。
    current = coverage()["items"][0]
    assert [p["photo_count"] for p in current["points"]] == [103, 2]


def test_ac06_ac19_views_labels_snapshot_and_traceability(read_world):
    w = read_world
    photo = _add_photo(w, caption="現場註記")
    db = w["db"]
    row = db.get(Evidence, UUID(photo["id"]))
    original = deepcopy(row.label_source)
    row.label_layer = {
        **row.label_layer,
        "overrides": {
            "project_name": "",
            "item_name": "覆寫項目",
            "inspection_location": "覆寫地點",
        },
    }
    old_name = row.uploader_snapshot["name_zh"]
    w["field_user"].name_zh = "改名之後"
    db.commit()
    base, field, detail = _paths(w, photo)
    office = w["reader"].get(detail)
    assert office.status_code == 200, office.text
    data = office.json()
    assert data["caption"] == "現場註記"
    assert data["labels"] == {
        **original,
        "project_name": "",
        "item_title": "覆寫項目",
        "location": "覆寫地點",
    }
    assert data["uploaded_by"] == {"name_zh": old_name, "is_me": False}
    assert data["has_layer_overrides"] is True
    assert data["project_id"] == str(w["project"].id)
    assert data["snapshot_revision"] == row.snapshot_revision
    assert set(data["variants"]) == {"field", "office"}
    assert all(len(v["sha256"]) == 64 for v in data["variants"].values())
    assert data["layer_history"] == {"items": [], "next_cursor": None}
    assert row.label_source == original
    result = w["field"].get(field + "/photos").json()["items"][0]
    assert result["labels"] == data["labels"]
    assert result["caption"] == data["caption"]
    assert result["uploaded_by"]["is_me"] is True
    for forbidden in (
        "variants",
        "is_non_realtime_capture",
        "task_id",
        "project_id",
        "uploader_snapshot",
    ):
        assert forbidden not in result
    for response in (office, w["reader"].get(base)):
        assert "storage_key" not in response.text
        for version in db.scalars(select(EvidenceVariant)):
            assert str(version.storage_key) not in response.text
    _add_photo(w)
    assert (
        w["field"].get(field + "/photos").json()["items"][1]["caption"] is None
    )


def test_ac20_stable_pagination_filters_and_scoped_cursors(read_world):
    w = read_world
    first = _add_photo(w)
    second = _add_photo(w)
    overview = _add_photo(w, is_overview="true", point_ids=[])
    base, field, _ = _paths(w)
    for client, path in ((w["field"], field + "/photos"), (w["reader"], base)):
        ids, cursor = [], None
        while True:
            params = {"limit": 1}
            if cursor:
                params["cursor"] = cursor
            response = client.get(path, params=params)
            assert response.status_code == 200, response.text
            page = response.json()
            ids.extend(p["id"] for p in page["items"])
            cursor = page["next_cursor"]
            if not cursor:
                break
        assert ids == [overview["id"], first["id"], second["id"]]
    cursor = w["reader"].get(base, params={"limit": 1}).json()["next_cursor"]
    for path, params in (
        (base, {"cursor": cursor, "deleted": False}),
        (base, {"cursor": cursor, "item_id": str(w["item_id"])}),
        (field + "/photos", {"cursor": cursor}),
        (base, {"cursor": "{"}),
        (base, {"limit": 101}),
        (base, {"limit": 0}),
    ):
        client = w["field"] if "/field/" in path else w["reader"]
        assert client.get(path, params=params).status_code == 422
    assert (
        w["reader"].get(base, params={"item_id": str(uuid4())}).json()["items"]
        == []
    )


@pytest.mark.parametrize(
    "delta,source,expected",
    [
        (None, "camera", True),
        (0, "library", True),
        (0, "camera", False),
        (600, "camera", False),
        (-600, "camera", False),
        (601, "camera", True),
        (-601, "camera", True),
    ],
)
def test_ac39_non_realtime_flag_is_office_only(
    read_world, delta, source, expected
):
    w = read_world
    photo = _add_photo(w, capture_source=source)
    db = w["db"]
    row = db.get(Evidence, UUID(photo["id"]))
    row.captured_at = (
        None if delta is None else row.created_at + timedelta(seconds=delta)
    )
    db.commit()
    base, field, detail = _paths(w, photo)
    for path in (base, detail):
        response = w["reader"].get(path)
        assert response.status_code == 200, response.text
        data = response.json()
        if path == base:
            data = data["items"][0]
        assert data["is_non_realtime_capture"] is expected
        assert data["capture_source"] == source
        assert data["labels"]["uploaded_at"] == photo["labels"]["uploaded_at"]
    assert (
        "is_non_realtime_capture" not in w["field"].get(field + "/photos").text
    )


def test_image_stream_and_transient_thumbnail_are_authorized(read_world):
    w = read_world
    photo = _add_photo(w)
    detail = _paths(w, photo)[2]
    before = {p.name: p.read_bytes() for p in w["root"].iterdir()}
    for version in ("field", "office"):
        row = w["db"].scalar(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == UUID(photo["id"]),
                EvidenceVariant.variant_type == version.upper(),
            )
        )
        image_url = detail + "/image"
        original = w["reader"].get(image_url, params={"variant": version})
        assert original.status_code == 200, original.text
        assert original.content == before[str(row.storage_key)]
        assert original.headers["content-type"] == "image/jpeg"
        assert original.headers["cache-control"] == "no-store"
        for edge, size in (
            (64, (64, 43)),
            (600, (600, 400)),
            (4096, (1200, 800)),
        ):
            response = w["reader"].get(
                image_url, params={"variant": version, "max_edge": edge}
            )
            assert response.status_code == 200, response.text
            assert Image.open(io.BytesIO(response.content)).size == size
        for edge in (63, 4097):
            assert (
                w["reader"]
                .get(image_url, params={"max_edge": edge})
                .status_code
                == 422
            )
    assert {p.name: p.read_bytes() for p in w["root"].iterdir()} == before
    assert w["field"].get(detail + "/image").status_code == 200
    assert w["field"].get(detail + "/image?variant=office").status_code == 403
    assert w["make_client"]().get(detail + "/image").status_code == 401
    field_row = w["db"].scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == UUID(photo["id"]),
            EvidenceVariant.variant_type == "FIELD",
        )
    )
    LocalStorage(w["root"]).delete(field_row.storage_key)
    response = w["reader"].get(detail + "/image")
    assert response.status_code == 404
    assert str(w["root"]) not in response.text


def test_ac36_history_full_values_actor_snapshot_pagination_and_scope(
    read_world,
):
    w = read_world
    photo, other = _add_photo(w), _add_photo(w)
    db = w["db"]
    state = {
        "layer": {**photo["layer"], "overrides": {"item_name": "長" * 2000}},
        "labels": {**photo["labels"], "item_title": "長" * 2000},
    }
    events = []
    event_time = db.get(Evidence, UUID(photo["id"])).created_at
    for _ in range(3):
        row = AuditLog(
            created_by=w["admin_user"].id,
            actor_snapshot="原操作者快照",
            created_at=event_time,
            project_id=w["project"].id,
            event_type="evidence.layer_updated",
            entity_type="evidence",
            entity_id=UUID(photo["id"]),
            before={"layer": photo["layer"], "labels": photo["labels"]},
            after=state,
        )
        db.add(row)
        db.flush()
        events.append(row)
    # 別照片、不同事件、錯誤專案都不混進這張照片歷程。
    for target, kind, project in (
        (other["id"], "evidence.layer_updated", w["project"].id),
        (photo["id"], "evidence.office_version_edited", w["project"].id),
        (photo["id"], "evidence.layer_updated", uuid4()),
    ):
        db.add(
            AuditLog(
                created_by=w["admin_user"].id,
                actor_snapshot="不可見",
                project_id=project,
                event_type=kind,
                entity_type="evidence",
                entity_id=UUID(target),
                before=None,
                after=None,
            )
        )
    db.commit()
    before = db.scalar(select(func.count()).select_from(AuditLog))
    detail = _paths(w, photo)[2]
    response = w["reader"].get(detail, params={"layer_history_limit": 1})
    assert response.status_code == 200, response.text
    history = response.json()["layer_history"]
    cursor = history["next_cursor"]
    received = history["items"]
    first_cursor = cursor
    while cursor:
        response = w["reader"].get(
            detail,
            params={
                "layer_history_limit": 1,
                "layer_history_cursor": cursor,
            },
        )
        assert response.status_code == 200, response.text
        history = response.json()["layer_history"]
        received += history["items"]
        cursor = history["next_cursor"]
    assert [row["id"] for row in received] == [
        str(row.id) for row in reversed(events)
    ]
    assert all(row["after"] == state for row in received)
    assert all(row["actor"]["snapshot"] == "原操作者快照" for row in received)
    assert all(row["occurred_at"].endswith("Z") for row in received)
    other_url = _paths(w, other)[2]
    assert (
        w["reader"]
        .get(other_url, params={"layer_history_cursor": first_cursor})
        .status_code
        == 422
    )
    assert w["reader"].get("/api/v1/audit-logs").status_code == 403
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(AuditLog)) == before


@pytest.mark.parametrize(
    "status", ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
)
def test_ac12_ac18_read_is_allowed_in_all_dispatched_states(
    read_world, status
):
    w = read_world
    photo = _add_photo(w)
    db = w["db"]
    task = db.get(InspectionTask, UUID(w["task"]))
    if status == "CANCELLED":
        response = w["admin"].post(
            f"/api/v1/inspection-tasks/{w['task']}:cancel",
            json={"reason": "讀取驗收"},
        )
        assert response.status_code == 200, response.text
        db.refresh(task)
    else:
        task.status = status
    plan = db.get(InspectionPlan, task.plan_id)
    plan.is_archived = True
    db.commit()
    base, field, detail = _paths(w, photo)
    for client, path in (
        (w["field"], field + "/photos"),
        (w["field"], field + "/evidence"),
        (w["reader"], base),
        (w["reader"], detail),
        (w["reader"], detail + "/image"),
    ):
        response = client.get(path)
        assert response.status_code == 200, response.text


def test_current_snapshot_text_correction_keeps_stable_photo_coverage(
    read_world,
):
    w = read_world
    photo = _add_photo(w)
    db = w["db"]
    source_point = w["point_id"]
    # 共用舊 fixture 未設來源照片需求；補成目前 API 要求的合法結構。
    actor_id = w["admin_user"].id
    db.add(
        ProjectEvidenceRequirement(
            inspection_point_id=source_point,
            project_inspection_item_id=w["item"].id,
            evidence_type="photo",
            required=True,
            min_count=1,
            created_by=actor_id,
            updated_by=actor_id,
        )
    )
    db.commit()
    response = w["admin"].patch(
        f"/api/v1/projects/{w['project'].id}/inspection-items/{w['item'].id}",
        json={
            "inspection_points": [
                {
                    "id": str(source_point),
                    "sequence": 1,
                    "title": "文字更正項次",
                    "instruction": "文字更正說明",
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                }
            ],
            "reinspect": False,
        },
    )
    assert response.status_code == 200, response.text
    db.expire_all()
    old_photo = db.get(Evidence, UUID(photo["id"]))
    snapshot = db.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == w["item_id"],
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot.revision > old_photo.snapshot_revision
    coverage = w["field"].get(_paths(w)[1] + "/evidence")
    assert coverage.status_code == 200, coverage.text
    point = coverage.json()["items"][0]["points"][0]
    assert point["id"] == str(source_point)
    assert point["title"] == "文字更正項次"
    assert point["photo_count"] == 1
    assert coverage.json()["all_points_satisfied"] is True


def test_default_page_size_and_legacy_render_metadata(read_world):
    w = read_world
    photo = _add_photo(w)
    _clone_photos(w, 51)
    db = w["db"]
    office = db.scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == UUID(photo["id"]),
            EvidenceVariant.variant_type == "OFFICE",
        )
    )
    office.label_rule = None
    db.commit()
    base, field, detail = _paths(w, photo)
    for client, path in ((w["reader"], base), (w["field"], field + "/photos")):
        response = client.get(path)
        assert response.status_code == 200, response.text
        assert len(response.json()["items"]) == 50
        cursor = response.json()["next_cursor"]
        assert (
            len(client.get(path, params={"cursor": cursor}).json()["items"])
            == 2
        )
    assert w["reader"].get(detail).json()["layer_render"] == {
        "render_state": None,
        "effective_size": None,
    }


def test_ac20_ac29_item_group_order_precedes_overview_and_tied_uploads(
    read_world,
):
    w = read_world
    project_id = w["project"].id
    plan = w["admin"].post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "跨項目排序"},
    )
    assert plan.status_code == 201, plan.text
    response = w["admin"].post(
        f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
        json={
            "name": "跨項目排序",
            "item_ids": [
                str(w["item"].id),
                str(w["item_two"].id),
            ],
        },
    )
    assert response.status_code == 201, response.text
    task = response.json()["id"]
    assert (
        w["admin"]
        .post(f"/api/v1/inspection-tasks/{task}:dispatch")
        .status_code
        == 200
    )
    assert (
        w["field"].post(f"/api/v1/inspection-tasks/{task}:start").status_code
        == 200
    )
    from app.models import TaskInspectionItem

    db = w["db"]
    items = list(
        db.scalars(
            select(TaskInspectionItem)
            .where(TaskInspectionItem.task_id == UUID(task))
            .order_by(TaskInspectionItem.created_at, TaskInspectionItem.id)
        )
    )
    identifiers = []
    # 較後項目的總覽先上傳，仍不能越過前一個項目的照片。
    for item, overview in (
        (items[1], True),
        (items[0], False),
        (items[0], False),
    ):
        snapshot = db.scalar(
            select(TaskRequirementSnapshot).where(
                TaskRequirementSnapshot.task_inspection_item_id == item.id,
                TaskRequirementSnapshot.is_current.is_(True),
            )
        )
        point = db.scalar(
            select(TaskSnapshotPoint.source_point_id).where(
                TaskSnapshotPoint.snapshot_id == snapshot.id
            )
        )
        response = _upload(
            w,
            task,
            item.id,
            [] if overview else point,
            _jpeg(),
            uuid4(),
            is_overview="true" if overview else "false",
        )
        assert response.status_code == 201, response.text
        identifiers.append(response.json()["id"])
    tied_time = db.get(Evidence, UUID(identifiers[1])).created_at
    db.get(Evidence, UUID(identifiers[2])).created_at = tied_time
    db.commit()
    for client, prefix in (
        (w["field"], "/api/v1/field"),
        (w["reader"], "/api/v1"),
    ):
        path = f"{prefix}/inspection-tasks/{task}/photos"
        found, cursor = [], None
        while True:
            response = client.get(
                path,
                params={
                    "limit": 1,
                    **({"cursor": cursor} if cursor else {}),
                },
            )
            assert response.status_code == 200, response.text
            found.extend(row["id"] for row in response.json()["items"])
            cursor = response.json()["next_cursor"]
            if not cursor:
                break
        assert found == sorted(identifiers[1:]) + identifiers[:1]
        assert (
            len(
                client.get(path, params={"item_id": str(items[1].id)}).json()[
                    "items"
                ]
            )
            == 1
        )


@pytest.mark.parametrize("target", ["office", "field", "history"])
@pytest.mark.parametrize("malformation", ["overflow", "nested_non_object"])
def test_tampered_inner_cursor_is_validation_error(
    read_world, target, malformation
):
    import base64
    import json

    w = read_world
    photo = _add_photo(w)
    _add_photo(w)
    base, field, detail = _paths(w, photo)
    if target == "history":
        db = w["db"]
        actor, project = w["admin_user"].id, w["project"].id
        db.add_all(
            AuditLog(
                created_by=actor,
                actor_snapshot="測試操作者",
                project_id=project,
                entity_type="evidence",
                entity_id=UUID(photo["id"]),
                event_type="evidence.layer_updated",
                before=None,
                after=None,
            )
            for _ in range(2)
        )
        db.commit()
        path, param, limit = (
            detail,
            "layer_history_cursor",
            "layer_history_limit",
        )
        client = w["reader"]
        cursor = client.get(path, params={limit: 1}).json()["layer_history"][
            "next_cursor"
        ]
    else:
        path = field + "/photos" if target == "field" else base
        client = w["field"] if target == "field" else w["reader"]
        param, limit = "cursor", "limit"
        cursor = client.get(path, params={limit: 1}).json()["next_cursor"]
    assert cursor
    payload = json.loads(
        base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
    )
    if malformation == "overflow":
        raw = json.dumps(
            {"t": "0001-01-01T00:00:00+14:00", "id": str(uuid4())}
        )
    else:
        # 巢狀非物件 JSON 驗非法型別拒絕，不會觸發 RecursionError。
        # 遞迴例外由 tests/contract/test_page_cursor.py 的 10000 層案例覆蓋；
        # API 外層 4096 字元上限無法送入該深度。
        raw = "[" * 1040 + "0" + "]" * 1040
    inner = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    payload["keys"][0] = inner
    if target != "history" and malformation == "nested_non_object":
        # 先測第一個內層鍵；壓縮後面的無關鍵，保留外層長度預算。
        payload["keys"][2] = ""
    encoded = (
        base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        )
        .decode()
        .rstrip("=")
    )
    assert len(encoded) <= 4096
    with TestClient(
        client.app,
        base_url="https://testserver",
        raise_server_exceptions=False,
    ) as observed:
        observed.cookies.update(client.cookies)
        response = observed.get(path, params={param: encoded})
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "request.validation_failed"


def test_thumbnail_releases_login_transaction_before_decoding(
    read_world, monkeypatch
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from app.auth.dependencies import get_db
    from app.db.unit_of_work import unit_of_work

    w = read_world
    photo = _add_photo(w)
    ready, release = Event(), Event()
    request_databases, active_transactions = [], []
    original = Image.open

    def observed_db():
        with unit_of_work() as db:
            request_databases.append(db)
            yield db

    def paused_open(*args, **kwargs):
        active_transactions.append(request_databases[-1].in_transaction())
        ready.set()
        assert release.wait(10)
        return original(*args, **kwargs)

    app = w["reader"].app
    app.dependency_overrides[get_db] = observed_db
    monkeypatch.setattr(Image, "open", paused_open)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            pending = executor.submit(
                w["reader"].get, _paths(w, photo)[2] + "/image?max_edge=600"
            )
            try:
                assert ready.wait(5)
                assert active_transactions == [False]
                # 真正的另一個登入請求會 UPDATE last_seen_at，不能被縮圖擋住。
                other = executor.submit(w["admin"].get, "/api/v1/auth/me")
                assert other.result(2).status_code == 200
            finally:
                release.set()
            assert pending.result(5).status_code == 200
    finally:
        app.dependency_overrides.clear()
        release.set()


@pytest.mark.parametrize("capacity", [1, 2])
def test_thumbnail_concurrency_uses_bounded_dedicated_workers(
    read_world, monkeypatch, capacity
):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event, Lock

    from sqlalchemy import event

    from app.auth.sessions import SESSION_COOKIE_NAME

    w = read_world
    photo = _add_photo(w)
    monkeypatch.setenv(
        "INSPECTFLOW_EVIDENCE_MAX_CONCURRENT_UPLOADS", str(capacity)
    )
    entered, prepared, release = Event(), Event(), Event()
    lock = Lock()
    active, peak = 0, 0
    committed = set()
    original = Image.Image.thumbnail

    def after_commit(db):
        with lock:
            committed.add(id(db))
            if len(committed) == 4:
                prepared.set()

    def paused_thumbnail(image, *args, **kwargs):
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
            if active >= capacity:
                entered.set()
        try:
            assert release.wait(10)
            return original(image, *args, **kwargs)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(Image.Image, "thumbnail", paused_thumbnail)
    event.listen(Session, "after_commit", after_commit)
    try:
        with TestClient(
            w["reader"].app, base_url="https://testserver"
        ) as shared:
            with ThreadPoolExecutor(max_workers=4) as executor:
                pending = [
                    executor.submit(
                        shared.get,
                        _paths(w, photo)[2] + "/image?max_edge=600",
                        headers={
                            "Cookie": (
                                f"{SESSION_COOKIE_NAME}="
                                f"{w[name].cookies.get(SESSION_COOKIE_NAME)}"
                            )
                        },
                    )
                    for name in (
                        "field",
                        "field_two",
                        "field_reader",
                        "reader",
                    )
                ]
                try:
                    assert entered.wait(5)
                    # 排隊的請求也先完成授權並提交，不能持有 SQLite 寫鎖。
                    assert prepared.wait(5)
                    assert shared.get("/api/v1/health").status_code == 200
                    assert peak == capacity
                finally:
                    release.set()
                assert all(job.result(5).status_code == 200 for job in pending)
        assert peak == capacity
    finally:
        release.set()
        event.remove(Session, "after_commit", after_commit)


def test_thumbnail_checks_actual_decode_pixel_limit(read_world, monkeypatch):
    w = read_world
    photo = _add_photo(w)
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_MAX_DECODE_PIXELS", "1000")
    response = w["reader"].get(_paths(w, photo)[2] + "/image?max_edge=64")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "evidence.invalid_image"
    assert response.json()["error"]["details"] == ["pixels"]


def test_image_response_does_not_disclose_field_hash_in_etag(read_world):
    w = read_world
    photo = _add_photo(w)
    response = w["field"].get(_paths(w, photo)[2] + "/image")
    assert response.status_code == 200
    assert "etag" not in response.headers
    assert response.headers["cache-control"] == "no-store"


def test_image_reloads_variant_once_when_old_storage_key_disappears(
    read_world, monkeypatch, caplog
):
    w = read_world
    photo = _add_photo(w)
    db = w["db"]
    variant = db.scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == UUID(photo["id"]),
            EvidenceVariant.variant_type == "OFFICE",
        )
    )
    old_key, variant_id = variant.storage_key, variant.id
    storage = LocalStorage(w["root"])
    with storage.open(old_key) as source:
        data = source.read()
    new_key = storage.save(io.BytesIO(data))
    original = LocalStorage.open
    calls = []

    def replace_after_first_lookup(store, key):
        calls.append(key)
        if len(calls) == 1:
            # 真正提交 T4 式新鍵切換，確保重試必須讀到資料庫新值。
            with Session(w["engine"]) as changing:
                row = changing.get(EvidenceVariant, variant_id)
                assert row is not None
                row.storage_key = new_key
                changing.commit()
            storage.delete(old_key)
        return original(store, key)

    monkeypatch.setattr(LocalStorage, "open", replace_after_first_lookup)
    response = w["reader"].get(_paths(w, photo)[2] + "/image?variant=office")
    assert response.status_code == 200, response.text
    assert response.content == data
    assert calls == [old_key, new_key]
    assert "Evidence image unavailable" not in caplog.text


def test_missing_image_retries_only_once_and_logs_no_storage_key(
    read_world, monkeypatch, caplog
):
    w = read_world
    photo = _add_photo(w)
    version = w["db"].scalar(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == UUID(photo["id"]),
            EvidenceVariant.variant_type == "FIELD",
        )
    )
    key = version.storage_key
    LocalStorage(w["root"]).delete(key)
    original = LocalStorage.open
    calls = []

    def observed(store, requested_key):
        calls.append(requested_key)
        return original(store, requested_key)

    monkeypatch.setattr(LocalStorage, "open", observed)
    response = w["field"].get(_paths(w, photo)[2] + "/image")
    assert response.status_code == 404
    assert calls == [key, key]
    assert photo["id"] in caplog.text
    assert str(key) not in caplog.text
