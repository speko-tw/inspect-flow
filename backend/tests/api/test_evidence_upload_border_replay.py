"""FEV-R07：預設外框不得改變升級前同一上傳請求的指紋。"""

import hashlib
import json
from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.api.errors import APIError
from app.models import Evidence
from app.services.evidence import _request_fingerprint, upload_evidence
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_evidence_upload_review import _ready


def test_default_border_preserves_pre_upgrade_upload_replays(
    db_session,
    make_client,
    monkeypatch,
    tmp_path,
):
    """以獨立舊格式 hash 模擬回應遺失，驗證 HTTP 與服務重放。"""
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    image, key = _jpeg(), uuid4()
    original = _upload(world, task, item, point, image, key)
    assert original.status_code == 201, original.text
    result = original.json()
    # 舊格式必須獨立定義，不能用待測指紋函式產生期望值。
    old_layer = {
        "enabled": True,
        "corner": "bottom_left",
        "offset_x": 0.0,
        "offset_y": 0.0,
        "size": "medium",
        "style": "dark",
        "overrides": {},
    }
    old_payload = {
        "sha256": hashlib.sha256(image).hexdigest(),
        "item_id": str(item),
        "is_overview": False,
        "point_ids": [str(point)],
        "caption": None,
        "captured_at": None,
        "capture_source": "camera",
        "field_edit": None,
        "layer": old_layer,
    }
    old_fingerprint = hashlib.sha256(
        json.dumps(
            old_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    photo = db_session.get(Evidence, UUID(result["id"]))
    assert photo is not None
    photo.request_fingerprint = old_fingerprint
    db_session.commit()
    stored_keys = set(LocalStorage(root).iter_keys())
    assert len(stored_keys) == 2

    # API 只收 enabled／corner；兩種合法本文都會補入預設 border。
    for fields in (
        {},
        {
            "layer": json.dumps(
                {
                    "enabled": True,
                    "corner": "bottom_left",
                }
            )
        },
    ):
        response = _upload(world, task, item, point, image, key, **fields)
        assert response.status_code == 200, response.text
        assert response.json() == result

    request = {
        **old_payload,
        "item_id": item,
        "point_ids": [point],
    }
    for layer in (old_layer, {**old_layer, "border": True}):
        candidate = {**request, "layer": layer}
        before = deepcopy(layer)
        assert _request_fingerprint(**candidate) == old_fingerprint
        replay, repeated = upload_evidence(
            db_session,
            task_id=UUID(task),
            upload_key=key,
            uploader=world["field_user"],
            content=image,
            **candidate,
        )
        assert repeated and replay == result
        assert layer == before

    for changes in (
        {"layer": {**old_layer, "border": False}},
        {"caption": "變更註記"},
        {"point_ids": [uuid4()]},
        {"layer": {**old_layer, "enabled": False}},
        {"layer": {**old_layer, "corner": "top_right"}},
    ):
        candidate = {**request, **changes}
        assert _request_fingerprint(**candidate) != old_fingerprint
        with pytest.raises(APIError) as conflict:
            upload_evidence(
                db_session,
                task_id=UUID(task),
                upload_key=key,
                uploader=world["field_user"],
                content=image,
                **candidate,
            )
        assert conflict.value.status_code == 409
        assert conflict.value.code == "evidence.idempotency_conflict"

    for changes in (
        {"caption": "變更註記"},
        {"point_ids": str(uuid4())},
        {"layer": '{"enabled":false}'},
        {"layer": '{"corner":"top_right"}'},
    ):
        response = _upload(
            world,
            task,
            item,
            point,
            image,
            key,
            **changes,
        )
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == (
            "evidence.idempotency_conflict"
        )
    db_session.refresh(photo)
    assert photo.request_fingerprint == old_fingerprint
    assert db_session.scalar(select(func.count()).select_from(Evidence)) == 1
    assert set(LocalStorage(root).iter_keys()) == stored_keys
