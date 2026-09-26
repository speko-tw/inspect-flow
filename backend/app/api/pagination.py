"""Opaque cursor helpers for cursor-based list pagination.

Implements the sort/cursor key required by API-R08 (KD-13): list
pages are ordered by ``(created_at, id)`` so that records created
within the same second still sort deterministically, and cursors
stay bound to that key instead of a positional offset. This module
only proves the mechanism is workable; page size defaults/limits and
the list response envelope shape are left to the first feature spec
that implements a real list endpoint (see the "not included"
section of docs/specs/api-conventions/spec.md).
"""

import base64
import binascii
import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime

from app.api.time_format import format_utc, parse_utc

_CURSOR_ALPHABET = re.compile(r"[A-Za-z0-9_-]+")


@dataclass(frozen=True, order=True)
class CursorKey:
    """Sort/cursor key: creation time plus id, per KD-13.

    Field order matches the sort order (created_at first, id as the
    tie-breaker), so instances compare directly as a tuple.
    """

    created_at: datetime
    id: uuid.UUID


def encode_cursor(key: CursorKey) -> str:
    """Encode a CursorKey as an opaque, URL-safe cursor string."""
    payload = {"t": format_utc(key.created_at), "id": str(key.id)}
    raw = json.dumps(payload, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8"))
    return encoded.decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> CursorKey:
    """Decode an opaque cursor string back into a CursorKey.

    Decoding is strict: the only strings accepted are the exact,
    canonical cursors ``encode_cursor`` produces. Any malformed or
    non-canonical input is reported as a plain ValueError; mapping
    that to an HTTP error response is left to the shared error
    handling module (not part of this task).

    Raises:
        ValueError: for any malformed input (bad base64 alphabet or
            padding, bad JSON, missing/extra keys, invalid timestamp,
            invalid UUID) or any input that decodes but is not the
            canonical cursor string for its key (e.g. non-canonical
            base64 trailing bits, extra JSON whitespace, or a
            non-canonical UUID spelling).
    """
    if not _CURSOR_ALPHABET.fullmatch(cursor):
        raise ValueError(f"invalid cursor: {cursor!r}")

    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + padding)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid cursor: {cursor!r}") from exc

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"invalid cursor: {cursor!r}") from exc

    if not isinstance(payload, dict) or set(payload) != {"t", "id"}:
        raise ValueError(f"invalid cursor payload: {payload!r}")

    try:
        created_at = parse_utc(payload["t"])
        key_id = uuid.UUID(payload["id"])
    except (AttributeError, TypeError, ValueError) as exc:
        raise ValueError(f"invalid cursor payload: {payload!r}") from exc

    key = CursorKey(created_at=created_at, id=key_id)
    if encode_cursor(key) != cursor:
        raise ValueError(f"non-canonical cursor: {cursor!r}")

    return key
