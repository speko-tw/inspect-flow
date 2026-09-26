"""Shared UTC time formatting helpers (API-R09, KD-14).

Provides a single serialization path for API response time fields:
ISO 8601 / RFC 3339 strings, always UTC, truncated (not rounded) to
whole-second precision, ending in "Z". Leniency on the input side
(such as accepting fractional seconds or non-UTC offsets on parse)
is out of scope for this module; see the "not included" section of
docs/specs/api-conventions/spec.md. parse_utc is intentionally
strict and is used to decode the time component of cursors.
"""

import re
from datetime import UTC, datetime

UTC_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def format_utc(value: datetime) -> str:
    """Serialize an aware datetime as a UTC, second-precision string.

    Converts ``value`` to UTC and truncates (does not round) any
    sub-second component before formatting, per KD-14.

    Raises:
        ValueError: if ``value`` is naive (has no ``tzinfo``).
    """
    if value.tzinfo is None:
        raise ValueError("format_utc requires an aware datetime")
    truncated = value.astimezone(UTC).replace(microsecond=0)
    return truncated.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(value: str) -> datetime:
    """Parse a strict UTC timestamp as produced by format_utc.

    Only the exact shape ``YYYY-MM-DDTHH:MM:SSZ`` is accepted (no
    fractional seconds, no other UTC offsets); anything else raises
    ValueError.

    Raises:
        ValueError: if ``value`` does not match the expected shape
            or cannot be parsed as a valid date/time.
    """
    if not UTC_TIMESTAMP_PATTERN.match(value):
        raise ValueError(f"invalid UTC timestamp: {value!r}")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"invalid UTC timestamp: {value!r}") from exc
    return parsed.astimezone(UTC)
