"""FEV-AC07：上傳長邊守門不追溯改變既存照片的讀取及內業編修。"""

import hashlib
import io
from uuid import uuid4

import pytest
from PIL import Image, ImageFile
from sqlalchemy import func, select

from app.models import Evidence, EvidenceVariant
from app.storage import LocalStorage
from tests.api.test_evidence_office import _office_world
from tests.api.test_evidence_upload import _upload
from tests.api.test_evidence_upload_review import _ready


def _jpeg(size):
    output = io.BytesIO()
    Image.new("RGB", size, (40, 90, 130)).save(output, "JPEG", quality=90)
    return output.getvalue()


@pytest.mark.parametrize("size", [(2560, 128), (128, 2560)])
def test_ac07_field_long_edge_boundary_is_accepted(
    db_session, make_client, monkeypatch, tmp_path, size
):
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task_id, item_id, point_id = _ready(db_session, make_client)
    data = _jpeg(size)
    response = _upload(world, task_id, item_id, point_id, data, uuid4())
    assert response.status_code == 201, response.text
    field = response.json()["variants"]["field"]
    assert (field["width"], field["height"]) == size
    assert field["sha256"] == hashlib.sha256(data).hexdigest()
    assert db_session.scalar(select(func.count(Evidence.id))) == 1
    assert db_session.scalar(select(func.count(EvidenceVariant.id))) == 2
    assert len(list(LocalStorage(root).iter_keys())) == 2


@pytest.mark.parametrize("size", [(2561, 128), (128, 2561)])
def test_ac07_field_long_edge_rejects_before_decode_without_artifacts(
    db_session, make_client, monkeypatch, tmp_path, size
):
    root = tmp_path / "photos"
    monkeypatch.setenv("INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(root))
    world, task_id, item_id, point_id = _ready(db_session, make_client)
    data = _jpeg(size)
    decoded = []

    def unexpected_decode(*args, **kwargs):
        decoded.append(True)
        raise AssertionError("oversized FIELD must fail before decoding")

    # JPEG 的完整解碼入口是 ImageFile.load；不能只攔截基底 Image.load。
    monkeypatch.setattr(ImageFile.ImageFile, "load", unexpected_decode)
    response = _upload(world, task_id, item_id, point_id, data, uuid4())
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "evidence.invalid_image"
    assert response.json()["error"]["details"] == ["pixels"]
    assert decoded == []
    assert db_session.scalar(select(func.count(Evidence.id))) == 0
    assert db_session.scalar(select(func.count(EvidenceVariant.id))) == 0
    assert not root.exists() or not list(root.iterdir())


def test_ac07_legacy_large_field_can_still_be_read_and_edited(
    db_session, make_client, monkeypatch, tmp_path
):
    world = _office_world(db_session, make_client, monkeypatch, tmp_path)
    data = _jpeg((2561, 128))
    store = LocalStorage(world["root"])
    # 直接建立升級前的保存狀態；不能靠放寬新上傳限制製造 legacy 樣本。
    for version in db_session.scalars(
        select(EvidenceVariant).where(
            EvidenceVariant.evidence_id == world["photo_id"]
        )
    ):
        store.delete(version.storage_key)
        store.restore(version.storage_key, io.BytesIO(data))
        version.width, version.height = (2561, 128)
        version.byte_size = len(data)
        version.sha256 = hashlib.sha256(data).hexdigest()
    db_session.commit()

    url = world["url"].removesuffix("/office-version") + "/image"
    for variant in ("field", "office"):
        original = world["admin"].get(url, params={"variant": variant})
        assert original.status_code == 200, original.text
        assert original.content == data
        thumbnail = world["admin"].get(
            url, params={"variant": variant, "max_edge": 64}
        )
        assert thumbnail.status_code == 200, thumbnail.text

    edited = world["admin"].put(
        world["url"], json={"rotation": 90, "brightness": 5}
    )
    assert edited.status_code == 200, edited.text
    variants = edited.json()["variants"]
    assert variants["field"]["sha256"] == hashlib.sha256(data).hexdigest()
    assert (variants["office"]["width"], variants["office"]["height"]) == (
        128,
        2561,
    )
    assert len(list(store.iter_keys())) == 2
