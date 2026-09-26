"""Contract tests for cursor-based pagination (API-AC12).

The test route below only exists in this module to prove the
cursor-based pagination convention (sort key = created_at + id) is
workable; the ``{"items": ..., "next_cursor": ...}`` response shape
it uses is specific to this test and does not represent the real
list response envelope, which is left to the first feature spec
that implements a real list endpoint.
"""

import base64
import json
import uuid
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI, Query
from fastapi.testclient import TestClient

from app.api.pagination import CursorKey, decode_cursor, encode_cursor
from app.api.time_format import format_utc

CREATED_AT = datetime(2026, 9, 26, 8, 30, 0, tzinfo=UTC)

# Ids are spaced out (multiples of 10) so tests can insert new
# records that sort strictly between two existing ones.
RECORD_IDS = (10, 20, 30, 40, 50, 60)


def _uuid(n: int) -> uuid.UUID:
    """Build a fixed, orderable test UUID from a small integer."""
    return uuid.UUID(int=n)


@dataclass
class _Record:
    id: uuid.UUID
    created_at: datetime


@pytest.fixture
def records() -> list[_Record]:
    """Six same-second records with predictable id ordering.

    A fresh list per test; nothing is kept in module-level state.
    """
    return [_Record(id=_uuid(n), created_at=CREATED_AT) for n in RECORD_IDS]


def _build_test_app(records: list[_Record]) -> FastAPI:
    app = FastAPI()

    @app.get("/api/v1/test-items")
    def list_items(
        cursor: str | None = Query(default=None),
        limit: int = Query(default=2),
    ) -> dict[str, Any]:
        ordered = sorted(records, key=lambda r: (r.created_at, r.id))
        if cursor is not None:
            after = decode_cursor(cursor)
            ordered = [
                r
                for r in ordered
                if (r.created_at, r.id) > (after.created_at, after.id)
            ]
        page = ordered[:limit]
        next_cursor = None
        if len(ordered) > limit:
            last = page[-1]
            next_cursor = encode_cursor(
                CursorKey(created_at=last.created_at, id=last.id)
            )
        return {
            "items": [
                {
                    "id": str(r.id),
                    "created_at": format_utc(r.created_at),
                }
                for r in page
            ],
            "next_cursor": next_cursor,
        }

    return app


def test_pagination_no_duplicates_or_omissions(
    records: list[_Record],
) -> None:
    client = TestClient(_build_test_app(records))

    page1 = client.get("/api/v1/test-items").json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"] is not None

    # Insert a record whose sort key (same second, id=15) falls
    # strictly between the two already-read records (10 and 20).
    records.append(_Record(id=_uuid(15), created_at=CREATED_AT))

    seen_ids = [item["id"] for item in page1["items"]]
    cursor = page1["next_cursor"]
    while cursor is not None:
        page = client.get(
            "/api/v1/test-items", params={"cursor": cursor}
        ).json()
        seen_ids.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]

    original_ids = {str(_uuid(n)) for n in RECORD_IDS}
    assert Counter(seen_ids) == Counter(original_ids)
    assert str(_uuid(15)) not in seen_ids


def test_pagination_cursor_binds_key_not_offset(
    records: list[_Record],
) -> None:
    client = TestClient(_build_test_app(records))

    page1 = client.get("/api/v1/test-items").json()
    cursor = page1["next_cursor"]
    assert cursor is not None

    decoded = decode_cursor(cursor)
    assert decoded == CursorKey(created_at=CREATED_AT, id=_uuid(20))

    # Mutate the already-read range: remove one record, add
    # another, changing how many records exist before the cursor's
    # key without touching anything past it.
    records[:] = [r for r in records if r.id != _uuid(10)]
    records.append(_Record(id=_uuid(5), created_at=CREATED_AT))

    page2 = client.get("/api/v1/test-items", params={"cursor": cursor}).json()

    assert page2["items"][0]["id"] == str(_uuid(30))


def test_cursor_round_trip() -> None:
    key = CursorKey(created_at=CREATED_AT, id=_uuid(42))
    assert decode_cursor(encode_cursor(key)) == key


def test_cursor_does_not_expose_uuid_in_plaintext() -> None:
    key = CursorKey(created_at=CREATED_AT, id=_uuid(99))
    cursor = encode_cursor(key)
    assert str(_uuid(99)) not in cursor


def _encode_raw(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8"))
    return encoded.decode("ascii").rstrip("=")


def _encode_raw_bytes(raw: bytes) -> str:
    encoded = base64.urlsafe_b64encode(raw)
    return encoded.decode("ascii").rstrip("=")


_VALID_CURSOR = encode_cursor(CursorKey(created_at=CREATED_AT, id=_uuid(1)))

# Same key/payload as _VALID_CURSOR, but re-encoded with extra JSON
# whitespace instead of the canonical tight separators.
_WHITESPACE_PAYLOAD_CURSOR = _encode_raw_bytes(
    json.dumps({"t": format_utc(CREATED_AT), "id": str(_uuid(1))}).encode(
        "utf-8"
    )
)

# Same key as _VALID_CURSOR, but with a non-canonical UUID spelling
# (uppercase, no hyphens) that `uuid.UUID()` still parses.
_UPPERCASE_UUID_CURSOR = _encode_raw(
    {"t": format_utc(CREATED_AT), "id": str(_uuid(1)).upper().replace("-", "")}
)


@pytest.mark.parametrize(
    "bad_cursor",
    [
        "not-valid-base64!!!",
        _encode_raw({"t": "2026-09-26T08:30:00Z"}),
        _encode_raw(
            {"t": "2026-09-26T08:30:00Z", "id": str(_uuid(1)), "x": 1}
        ),
        _encode_raw({"t": "bad-time", "id": str(_uuid(1))}),
        _encode_raw({"t": "2026-09-26T08:30:00Z", "id": "not-a-uuid"}),
        _VALID_CURSOR + "!",
        _VALID_CURSOR[:4] + "\n" + _VALID_CURSOR[4:],
        _VALID_CURSOR + "\n",
        _VALID_CURSOR + "=",
        _WHITESPACE_PAYLOAD_CURSOR,
        _UPPERCASE_UUID_CURSOR,
    ],
)
def test_decode_cursor_rejects_malformed_input(bad_cursor: str) -> None:
    with pytest.raises(ValueError):
        decode_cursor(bad_cursor)
