"""FEV-R26／AC07：入口拒絕 EXIF 等 metadata，避免兩版保留個資。"""

import hashlib
import io
import json
from uuid import uuid4

import pytest
from PIL import Image, ImageCms
from sqlalchemy import func, select

from app.models import Evidence, EvidenceVariant
from app.storage import LocalStorage
from tests.api.test_evidence_upload import _jpeg, _upload
from tests.api.test_evidence_upload_review import _ready


def _segment(marker, payload):
    return bytes([255, marker]) + (len(payload) + 2).to_bytes(2) + payload


@pytest.mark.parametrize("enabled", [False, True])
@pytest.mark.parametrize(
    "metadata",
    [
        "exif",
        "xmp",
        "comment",
        "app13",
        "after_scan",
    ],
)
def test_metadata_upload_is_rejected_without_artifacts(
    db_session, make_client, monkeypatch, tmp_path, enabled, metadata
):
    """不允許的 metadata 不能由圖層開關或段落位置繞過。"""
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    data = _jpeg()
    if metadata == "exif":
        output = io.BytesIO()
        exif = Image.Exif()
        exif[315] = "PRIVATE-OWNER-MARKER"
        with Image.open(io.BytesIO(data)) as image:
            image.save(output, "JPEG", exif=exif)
        data = output.getvalue()
    else:
        marker, payload = {
            "xmp": (0xE1, b"http://ns.adobe.com/xap/1.0/\0private"),
            "comment": (0xFE, b"private comment"),
            "app13": (0xED, b"Photoshop 3.0\0private"),
            "after_scan": (0xE1, b"Exif\0\0private"),
        }[metadata]
        segment = _segment(marker, payload)
        if metadata == "after_scan":
            data = data[:-2] + segment + data[-2:]
        else:
            data = data[:2] + segment + data[2:]
    response = _upload(
        world,
        task,
        item,
        point,
        data,
        uuid4(),
        layer=json.dumps({"enabled": enabled}),
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "evidence.invalid_image"
    assert response.json()["error"]["details"] == ["metadata"]
    assert db_session.scalar(select(func.count(Evidence.id))) == 0
    assert db_session.scalar(select(func.count(EvidenceVariant.id))) == 0
    assert not list(LocalStorage(root).iter_keys())


@pytest.mark.parametrize(
    "marker", [x for x in range(0xE0, 0xF0) if x not in {0xE1, 0xED}]
)
def test_other_app_segments_are_preserved(
    db_session, make_client, monkeypatch, tmp_path, marker
):
    """拒收清單外的每種 APPn 均能保存，不假設 Safari 的段落集合。"""
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    data = _jpeg()
    data = data[:2] + _segment(marker, b"custom application data") + data[2:]
    response = _upload(
        world, task, item, point, data, uuid4(), layer='{"enabled":false}'
    )
    assert response.status_code == 201, response.text
    for variant in db_session.scalars(select(EvidenceVariant)):
        assert variant.sha256 == hashlib.sha256(data).hexdigest()
        with LocalStorage(root).open(variant.storage_key) as stream:
            assert stream.read() == data
    assert len(list(LocalStorage(root).iter_keys())) == 2


@pytest.mark.parametrize("icc", [False, True])
@pytest.mark.parametrize("progressive", [False, True])
def test_canvas_shaped_jpeg_preserves_sha_replay_and_disabled_office(
    db_session, make_client, monkeypatch, tmp_path, icc, progressive
):
    """canvas 形狀的 JPEG 不重編碼，兩版與重放契約保持不變。"""
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task, item, point = _ready(db_session, make_client)
    output = io.BytesIO()
    profile = (
        ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
        if icc
        else None
    )
    Image.new("RGB", (1200, 800), (40, 90, 130)).save(
        output, "JPEG", icc_profile=profile, progressive=progressive
    )
    data, key = output.getvalue(), uuid4()
    for status in (201, 200):
        response = _upload(
            world,
            task,
            item,
            point,
            data,
            key,
            layer=json.dumps({"enabled": False}),
        )
        assert response.status_code == status, response.text
    for variant in db_session.scalars(select(EvidenceVariant)):
        assert variant.sha256 == hashlib.sha256(data).hexdigest()
        with LocalStorage(root).open(variant.storage_key) as stream:
            assert stream.read() == data
    assert db_session.scalar(select(func.count(Evidence.id))) == 1
    assert len(list(LocalStorage(root).iter_keys())) == 2


def test_sha_is_checked_before_metadata(
    db_session, make_client, monkeypatch, tmp_path
):
    """雜湊不符時先回既有錯誤，不改用 metadata 錯誤。"""
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path))
    world, task, item, point = _ready(db_session, make_client)
    data = _jpeg()
    data = data[:2] + _segment(0xE1, b"Exif\0\0private") + data[2:]
    response = _upload(
        world, task, item, point, data, uuid4(), sha256="0" * 64
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "evidence.sha256_mismatch"
