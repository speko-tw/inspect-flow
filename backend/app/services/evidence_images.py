"""FEV-R06、R22：驗證 JPEG 並可重現產生帶工程標示的 OFFICE。"""

from __future__ import annotations

import hashlib
import io
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError, features
from PIL import __version__ as pillow_version

logger = logging.getLogger(__name__)
_FONT_PATH = Path(__file__).resolve().parents[1] / "assets/fonts"
_FONT_NAME = "NotoSansTC-Regular.otf"


@lru_cache(maxsize=1)
def _font_version() -> str:
    """R18：以字型內容與實際光柵化版本識別可重現環境。"""
    digest = hashlib.sha256((_FONT_PATH / _FONT_NAME).read_bytes()).hexdigest()
    freetype = features.version_module("freetype2")
    return f"sha256:{digest};Pillow:{pillow_version};FreeType:{freetype}"


_SIZE_FACTORS = {"small": 0.60, "medium": 0.78, "large": 0.96}
_SIZE_MULTIPLIERS = {"small": 0.9, "medium": 1.0, "large": 1.2}
_FIELDS = (
    ("工程名稱", "project_name"),
    ("檢驗項目", "item_title"),
    ("檢驗位置", "location"),
    ("檢驗人員", "uploader_name"),
    ("檢驗時間", "uploaded_at"),
)


class InvalidEvidenceImageError(ValueError):
    """FEV-R06：內容不是符合像素上限的可解碼 JPEG。"""


@dataclass(frozen=True)
class ImageInfo:
    """已解碼 JPEG 的原始尺寸與確定性內容摘要。"""

    width: int
    height: int
    sha256: str


def inspect_jpeg(data: bytes, max_pixels: int) -> ImageInfo:
    """拒絕格式偽裝、毀損內容與解碼像素超限的 JPEG。"""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "JPEG":
                raise InvalidEvidenceImageError("format")
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > max_pixels:
                raise InvalidEvidenceImageError("pixels")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
    except InvalidEvidenceImageError:
        raise
    except (
        OSError,
        UnidentifiedImageError,
        Image.DecompressionBombError,
    ) as exc:
        raise InvalidEvidenceImageError("decode") from exc
    return ImageInfo(width, height, hashlib.sha256(data).hexdigest())


def default_layer() -> dict:
    """FEV-R22：完整保存現場可選設定的系統預設值。"""
    return {
        "enabled": True,
        "corner": "bottom_left",
        "offset_x": 0.0,
        "offset_y": 0.0,
        "size": "medium",
        "style": "dark",
        "overrides": {},
    }


def normalize_field_layer(raw: object) -> dict:
    """FEV-R23：現場只能改圖層開關與角落，其他值採系統預設。"""
    if not isinstance(raw, dict) or set(raw) - {"enabled", "corner"}:
        raise ValueError("invalid layer keys")
    layer = default_layer()
    if "enabled" in raw:
        if not isinstance(raw["enabled"], bool):
            raise ValueError("enabled must be boolean")
        layer["enabled"] = raw["enabled"]
    if "corner" in raw:
        if raw["corner"] not in {
            "bottom_left",
            "bottom_right",
            "top_left",
            "top_right",
        }:
            raise ValueError("invalid corner")
        layer["corner"] = raw["corner"]
    return layer


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current)
            current = char
        else:
            current = candidate
    if current:
        lines.append(current)
    if not lines:
        return [""]
    if len(lines) > 2:
        lines = lines[:2]
        last = lines[1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        lines[1] = last + "…"
    return lines


def _resolved_values(
    source: dict, layer: dict, timezone_name: str
) -> list[str]:
    overrides = layer.get("overrides") or {}
    values = []
    for _, key in _FIELDS:
        override_key = {
            "project_name": "project_name",
            "item_title": "item_name",
            "location": "inspection_location",
        }.get(key)
        value = overrides.get(override_key, source.get(key))
        fallback = "未填寫" if key == "location" else "未記錄"
        if key == "uploaded_at" and value:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                value = parsed.astimezone(ZoneInfo(timezone_name)).strftime(
                    "%Y/%m/%d %H:%M"
                )
            except (ValueError, ZoneInfoNotFoundError):
                value = "未記錄"
        values.append(value or fallback)
    return values


def _can_fit(width: int, height: int, layer: dict) -> bool:
    short_edge = min(width, height)
    font_size = max(
        14,
        math.floor(
            0.022 * short_edge * _SIZE_MULTIPLIERS[layer["size"]] + 0.5
        ),
    )
    padding = max(2, math.floor(0.02 * short_edge + 0.5))
    row_height = math.ceil(font_size * 1.2 * 2 + padding * 2)
    box_width = math.floor(short_edge * _SIZE_FACTORS[layer["size"]] + 0.5)
    return (
        box_width >= 100 and row_height * 5 <= min(width, height) - 2 * padding
    )


def fit_office_layer(
    width: int, height: int, layer: dict
) -> tuple[dict, str, str | None]:
    """FEV-R22：合法上傳依保存大小、中／小退讓，容納不足則暫不合成。"""
    requested = layer["size"]
    if not layer["enabled"]:
        return layer, "disabled", None
    if _can_fit(width, height, layer):
        return layer, "applied", requested
    if requested != "small":
        fallback = {**layer, "size": "small"}
        if _can_fit(width, height, fallback):
            return fallback, "fallback_small", "small"
    return layer, "omitted_too_small", None


def render_office(
    data: bytes,
    source: dict,
    layer: dict,
    evidence_id: str,
    *,
    image: Image.Image | None = None,
) -> tuple[bytes, dict]:
    """FEV-R18／R22：不延伸照片畫布，並保存確切合成結果摘要。"""
    # FEV-D5：T4 傳入未編碼工作圖，避免編修後再多壓一次 JPEG。
    edited = image is not None
    if image is None:
        with Image.open(io.BytesIO(data)) as opened:
            image = opened.convert("RGB")
    else:
        image = image.copy()
    timezone_name = os.environ.get(
        "INSPECTFLOW_EVIDENCE_LABEL_TIMEZONE", "Asia/Taipei"
    )
    try:
        ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("invalid label timezone") from exc
    effective_layer, state, effective_size = fit_office_layer(
        image.width, image.height, layer
    )
    rule = {
        "rule_version": "field-evidence-label-v1",
        "font_version": _font_version(),
        "timezone": timezone_name,
        "render_state": state,
        "effective_size": effective_size,
        "base_size": (
            "small"
            if state == "omitted_too_small"
            else effective_size or layer["size"]
        ),
    }
    if state in {"disabled", "omitted_too_small"}:
        if not edited:
            return data, rule
        output = io.BytesIO()
        image.save(
            output, format="JPEG", quality=90, subsampling=0, optimize=False
        )
        return output.getvalue(), rule

    font_path = _FONT_PATH / _FONT_NAME
    font_size = max(
        14,
        math.floor(
            0.022
            * min(image.width, image.height)
            * _SIZE_MULTIPLIERS[effective_layer["size"]]
            + 0.5
        ),
    )
    font = ImageFont.truetype(
        str(font_path), font_size, layout_engine=ImageFont.Layout.BASIC
    )
    probe = ImageDraw.Draw(image)
    label_width = math.floor(
        min(image.width, image.height) * _SIZE_FACTORS[effective_layer["size"]]
        + 0.5
    )
    margin = max(2, math.floor(0.02 * min(image.width, image.height) + 0.5))
    inner = max(2, math.floor(0.006 * min(image.width, image.height) + 0.5))
    left_width = math.floor((label_width - 2 * inner) * 0.25 + 0.5)
    cell_width = label_width - 2 * inner - left_width
    line_height = math.ceil(font_size * 1.2)
    row_height = line_height * 2 + inner * 2
    box_height = row_height * len(_FIELDS) + 2 * inner
    values = _resolved_values(source, effective_layer, timezone_name)
    safe_values = []
    missing_mask = bytes(cast(Any, font.getmask("\u0378")))
    for value in values:
        missing = []
        for char in value:
            if (
                bytes(cast(Any, font.getmask(char))) == missing_mask
                and char != "?"
            ):
                missing.append(char)
        if missing:
            for char in set(missing):
                logger.warning(
                    "evidence_label_missing_glyph evidence_id=%s "
                    "font_version=%s codepoint=U+%04X",
                    evidence_id,
                    _font_version(),
                    ord(char),
                )
                value = value.replace(char, "?")
        safe_values.append(value)

    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    if effective_layer["style"] == "paper":
        background, foreground = (255, 255, 255, 255), (0, 0, 0)
    elif effective_layer["style"] == "outline":
        background, foreground = (0, 0, 0, 0), (255, 255, 255)
    else:
        background, foreground = (0, 0, 0, 168), (255, 255, 255)
    outline = effective_layer["style"] == "outline"
    corner = effective_layer["corner"]
    offset_x = int(effective_layer["offset_x"] * image.width)
    offset_y = int(effective_layer["offset_y"] * image.height)
    left = margin if "left" in corner else image.width - label_width - margin
    top = margin if "top" in corner else image.height - box_height - margin
    left = min(max(0, left + offset_x), image.width - label_width)
    top = min(max(0, top + offset_y), image.height - box_height)
    right, bottom = left + label_width, top + box_height
    draw.rounded_rectangle(
        (left, top, right, bottom),
        radius=max(2, margin // 2),
        fill=background,
        outline=(255, 255, 255, 255) if outline else None,
        width=3 if outline else 1,
    )
    for index, ((title, _), value) in enumerate(
        zip(_FIELDS, safe_values, strict=True)
    ):
        y = top + inner + index * row_height
        title_lines = _wrap_text(probe, title, font, left_width - 2 * inner)
        value_lines = _wrap_text(probe, value, font, cell_width - 2 * inner)
        draw.text(
            (left + inner, y + inner),
            "\n".join(title_lines),
            font=font,
            fill=foreground,
            spacing=0,
            stroke_width=3 if outline else 0,
            stroke_fill=(0, 0, 0) if outline else None,
        )
        draw.text(
            (left + inner + left_width, y + inner),
            "\n".join(value_lines),
            font=font,
            fill=foreground,
            spacing=0,
            stroke_width=3 if outline else 0,
            stroke_fill=(0, 0, 0) if outline else None,
        )
        draw.line(
            (left, y + row_height, right, y + row_height), fill=foreground
        )
        draw.line(
            (left + left_width, y, left + left_width, y + row_height),
            fill=foreground,
        )
    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert(
        "RGB"
    )
    output = io.BytesIO()
    image.save(
        output, format="JPEG", quality=90, subsampling=0, optimize=False
    )
    return output.getvalue(), rule
