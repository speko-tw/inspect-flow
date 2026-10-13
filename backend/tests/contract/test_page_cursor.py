"""共用清單 cursor 解析函式的嚴格性測試（API-AC12、API-R08）。

真實端點的翻頁行為由 tests/api/test_roles_api.py 驗證；
這裡只鎖定 page_cursor_key 對格式錯誤 cursor 的拒絕行為。
"""

import base64
import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest

from app.api.errors import APIError, ErrorCode
from app.api.pagination import encode_page_cursor, page_cursor_key

CREATED_AT = datetime(2026, 9, 26, 8, 30, 0, 123456, tzinfo=UTC)
CURSOR_ID = uuid.UUID(int=1)


def _encode_raw_bytes(raw: bytes) -> str:
    encoded = base64.urlsafe_b64encode(raw)
    return encoded.decode("ascii").rstrip("=")


def _encode_raw(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"))
    return _encode_raw_bytes(raw.encode("utf-8"))


_VALID_CURSOR = encode_page_cursor(CREATED_AT, CURSOR_ID)
_VALID_TIME = CREATED_AT.isoformat(timespec="microseconds")

# 與 _VALID_CURSOR 同一組排序鍵，但 JSON 帶多餘空白、不是標準寫法。
_WHITESPACE_PAYLOAD_CURSOR = _encode_raw_bytes(
    json.dumps({"t": _VALID_TIME, "id": str(CURSOR_ID)}).encode("utf-8")
)

# 同一組排序鍵，但 UUID 用大寫且無連字號；uuid.UUID() 仍可解析。
_UPPERCASE_UUID_CURSOR = _encode_raw(
    {"t": _VALID_TIME, "id": str(CURSOR_ID).upper().replace("-", "")}
)


def test_page_cursor_round_trip_keeps_microseconds() -> None:
    assert page_cursor_key(_VALID_CURSOR) == (CREATED_AT, CURSOR_ID)


def test_page_cursor_none_means_first_page() -> None:
    assert page_cursor_key(None) is None


@pytest.mark.parametrize(
    "bad_cursor",
    [
        "not-valid-base64!!!",
        _encode_raw({"t": _VALID_TIME}),
        _encode_raw({"t": _VALID_TIME, "id": str(CURSOR_ID), "x": 1}),
        _encode_raw({"t": "bad-time", "id": str(CURSOR_ID)}),
        _encode_raw({"t": _VALID_TIME, "id": "not-a-uuid"}),
        _VALID_CURSOR + "!",
        _VALID_CURSOR[:4] + "\n" + _VALID_CURSOR[4:],
        _VALID_CURSOR + "\n",
        _VALID_CURSOR + "=",
        _WHITESPACE_PAYLOAD_CURSOR,
        _UPPERCASE_UUID_CURSOR,
    ],
)
def test_page_cursor_key_rejects_malformed_input(bad_cursor: str) -> None:
    with pytest.raises(APIError) as exc_info:
        page_cursor_key(bad_cursor)
    assert exc_info.value.status_code == 422
    assert exc_info.value.code is ErrorCode.REQUEST_VALIDATION_FAILED
