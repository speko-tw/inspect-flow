"""FEV-AC30、AC33：標示合成、容納退讓與確定性。"""

import hashlib
import io
import logging
from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from PIL import Image

from app.services import evidence_images
from app.services.evidence_images import (
    _resolved_values,
    default_layer,
    fit_office_layer,
    inspect_jpeg,
    render_office,
)
from app.services.evidence_labels import (
    ImprovementLabelContext,
    build_label_source,
)


def _jpeg(size: tuple[int, int]) -> bytes:
    image = Image.new("RGB", size, (80, 120, 160))
    output = io.BytesIO()
    image.save(output, "JPEG", quality=90)
    return output.getvalue()


def test_label_render_is_stable_and_keeps_photo_dimensions():
    original = _jpeg((1200, 800))
    source = {
        "project_name": "工程",
        "item_title": "檢驗項目",
        "location": "A區",
        "uploader_name": "現場人員",
        "uploaded_at": "2026-11-02T04:00:00Z",
    }
    layer = default_layer()

    first, rule = render_office(original, source, layer, "evidence-id")
    second, second_rule = render_office(original, source, layer, "evidence-id")

    assert rule == second_rule
    assert rule["render_state"] == "applied"
    assert rule["effective_size"] == "medium"
    assert rule["base_size"] == "medium"
    assert first == second
    assert hashlib.sha256(first).digest() == hashlib.sha256(second).digest()
    with Image.open(io.BytesIO(first)) as rendered:
        assert rendered.size == (1200, 800)
    assert first != original


def test_defensive_fit_fallback_and_tiny_upload_preserve_both_versions(
    monkeypatch,
):
    layer = default_layer()

    original_fit = evidence_images._can_fit
    monkeypatch.setattr(
        evidence_images,
        "_can_fit",
        lambda _width, _height, candidate: candidate["size"] == "small",
    )
    fallback, state, effective = fit_office_layer(320, 300, layer)
    assert fallback["size"] == "small"
    assert state == "fallback_small"
    assert effective == "small"

    monkeypatch.setattr(
        evidence_images,
        "_can_fit",
        lambda _width, _height, _candidate: False,
    )
    omitted, state, effective = fit_office_layer(100, 100, layer)
    assert omitted["size"] == "medium"
    assert state == "omitted_too_small"
    assert effective is None
    monkeypatch.setattr(evidence_images, "_can_fit", original_fit)
    image = _jpeg((100, 100))
    office, rule = render_office(
        image,
        {
            "project_name": "工程",
            "item_title": "項目",
            "location": "位置",
            "uploader_name": "人員",
            "uploaded_at": "2026-11-02T04:00:00Z",
        },
        layer,
        "evidence-id",
    )
    assert office == image
    assert rule["render_state"] == "omitted_too_small"
    assert rule["base_size"] == "small"


def test_fit_short_edge_scan_records_current_non_expected_behavior():
    """FEV-AC33：記錄現狀，非期望規則；邊界有非單調變化。"""
    expected = {
        215: False,
        216: False,
        217: False,
        218: True,
        219: True,
        220: True,
        221: True,
        222: True,
        223: True,
        224: True,
        225: False,
        226: False,
        227: False,
        228: False,
        229: False,
        230: True,
        231: True,
        232: True,
    }
    for size, fits in expected.items():
        assert (
            evidence_images._can_fit(
                size, size, {**default_layer(), "size": "small"}
            )
            is fits
        )
        assert (
            evidence_images._can_fit(
                size, size, {**default_layer(), "size": "medium"}
            )
            is fits
        )


def test_jpeg_verification_rejects_format_and_pixel_limit():
    jpeg = _jpeg((20, 20))
    assert inspect_jpeg(jpeg, 400).width == 20

    try:
        inspect_jpeg(jpeg, 399)
    except ValueError as exc:
        assert str(exc) == "pixels"
    else:
        raise AssertionError("pixel limit must reject oversized image")

    try:
        inspect_jpeg(b"not an image", 400)
    except ValueError:
        pass
    else:
        raise AssertionError("invalid image bytes must be rejected")


def test_label_sources_keep_complete_values_and_format_missing_fields():
    source = {
        "project_name": "完整工程名稱",
        "item_title": "長項目名稱",
        "location": "",
        "uploader_name": "上傳者",
        "uploaded_at": "2026-11-02T04:00:59Z",
    }
    layer = default_layer()
    values = _resolved_values(source, layer, "Asia/Taipei")
    assert values == [
        "完整工程名稱",
        "長項目名稱",
        "未填寫",
        "上傳者",
        "2026/11/02 12:00",
    ]
    overridden = {
        **layer,
        "overrides": {"project_name": "內業覆寫", "item_name": ""},
    }
    assert _resolved_values(source, overridden, "Asia/Taipei")[:2] == [
        "內業覆寫",
        "未記錄",
    ]


def test_missing_font_glyph_logs_codepoint_and_does_not_fail(caplog):
    image = _jpeg((1200, 800))
    source = {
        "project_name": "缺字\u0378工程",
        "item_title": "項目",
        "location": "位置",
        "uploader_name": "人員",
        "uploaded_at": "2026-11-02T04:00:00Z",
    }
    with caplog.at_level(logging.WARNING):
        office, rule = render_office(
            image, source, default_layer(), "evidence-id"
        )
    assert office
    assert rule["render_state"] == "applied"
    assert "codepoint=U+0378" in caplog.text
    assert "缺字\u0378工程" not in caplog.text


def test_normal_correction_and_improvement_sources_use_fixed_snapshots():
    uploaded_at = datetime(2026, 11, 2, 4, 0, tzinfo=UTC)
    base = {
        "project_name": "目前工程",
        "item_title": "目前項目快照",
        "zone_name": "三樓",
        "location_text": "北側",
        "uploader_name": "本次上傳者",
        "uploaded_at": uploaded_at,
    }
    normal = build_label_source(source_kind="normal", **base)
    correction = build_label_source(source_kind="correction", **base)
    assert normal == correction
    assert normal["location"] == "三樓／北側"
    assert normal["uploaded_at"] == "2026-11-02T04:00:00Z"

    result_id = uuid4()
    context = ImprovementLabelContext(
        result_id=result_id,
        is_effective=True,
        is_nonconforming=True,
        task_id=uuid4(),
        task_inspection_item_id=uuid4(),
        snapshot_revision=3,
        project_name="結果所屬工程",
        item_title="結果修訂項目名稱",
        zone_name="二樓",
        location_text="東側補充位置",
    )
    improvement = build_label_source(
        source_kind="improvement",
        project_name=None,
        item_title=None,
        zone_name=None,
        location_text=None,
        uploader_name="改善上傳者",
        uploaded_at=uploaded_at,
        result_id=result_id,
        resolve_result=lambda actual_id: (
            context if actual_id == result_id else None
        ),
    )
    assert improvement == {
        "project_name": "結果所屬工程",
        "item_title": "結果修訂項目名稱",
        "location": "二樓／東側補充位置",
        "uploader_name": "改善上傳者",
        "uploaded_at": "2026-11-02T04:00:00Z",
    }

    invalid = ImprovementLabelContext(
        **{**context.__dict__, "is_effective": False}
    )
    try:
        build_label_source(
            source_kind="improvement",
            project_name=None,
            item_title=None,
            zone_name=None,
            location_text=None,
            uploader_name="改善上傳者",
            uploaded_at=uploaded_at,
            result_id=result_id,
            resolve_result=lambda _: invalid,
        )
    except ValueError as exc:
        assert "effective finding" in str(exc)
    else:
        raise AssertionError("ineffective result must not label improvement")


def test_font_identity_and_basic_layout_are_explicit(monkeypatch):
    """R18：實際字型內容與光柵化版本均列入規則，固定 BASIC 排版。"""
    from PIL import ImageFont, features
    from PIL import __version__ as pillow_version

    original = ImageFont.truetype
    engines = []

    def load(*args, **kwargs):
        engines.append(kwargs.get("layout_engine"))
        return original(*args, **kwargs)

    monkeypatch.setattr(ImageFont, "truetype", load)
    _, rule = render_office(
        _jpeg((1200, 800)), {}, default_layer(), str(uuid4())
    )
    digest = hashlib.sha256(
        (evidence_images._FONT_PATH / evidence_images._FONT_NAME).read_bytes()
    ).hexdigest()
    assert digest in rule["font_version"]
    assert pillow_version in rule["font_version"]
    assert features.version_module("freetype2") in rule["font_version"]
    assert engines == [ImageFont.Layout.BASIC]


def test_regional_font_covers_common_and_uncommon_name_characters():
    """負責人 #791：以實際姓名字元驗證官方繁中區域字庫。"""
    from PIL import ImageFont

    path = evidence_images._FONT_PATH / evidence_images._FONT_NAME
    font = ImageFont.truetype(
        str(path), 32, layout_engine=ImageFont.Layout.BASIC
    )
    assert font.getname() == ("Noto Sans TC", "Regular")
    assert hashlib.sha256(path.read_bytes()).hexdigest() == (
        "5bab0cb3c1cf89dde07c4a95a4054b195afbcfe784d69d75c340780712237537"
    )
    missing = bytes(cast(Any, font.getmask("\u0378")))
    names = (
        "陳林張吳黃李王劉蔡楊許鄭謝郭洪邱曾廖賴徐周"
        "葉蘇蕭羅龔鍾堃喆璿𡘙祐翊璟瑋琮"
    )
    for char in names:
        assert bytes(cast(Any, font.getmask(char))) != missing, char


def test_regional_missing_glyphs_render_question_marks_without_failure(caplog):
    """姓名異體與區域字庫外字元只替代顯示，不阻斷影像產生。"""
    image = _jpeg((1200, 800))
    source = {
        "project_name": "工程",
        "item_title": "照片",
        "location": "工地",
        "uploader_name": "陳𠮷髙桜诶",
        "uploaded_at": "2026-11-03T00:00:00Z",
    }
    with caplog.at_level(logging.WARNING):
        actual, rule = render_office(
            image, source, default_layer(), "rare-name"
        )
    expected, _ = render_office(
        image,
        {**source, "uploader_name": "陳????"},
        default_layer(),
        "rare-name",
    )
    assert actual == expected
    assert rule["render_state"] == "applied"
    for char in "𠮷髙桜诶":
        assert f"U+{ord(char):04X}" in caplog.text
    assert "陳𠮷髙桜诶" not in caplog.text
    assert source["uploader_name"] == "陳𠮷髙桜诶"
