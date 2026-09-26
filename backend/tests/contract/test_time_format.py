"""Contract tests for UTC time formatting (API-AC11).

The test route below only exists in this module to prove the
format_utc convention is workable through an HTTP response; it is
never mounted on the real application.
"""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.time_format import UTC_TIMESTAMP_PATTERN, format_utc, parse_utc

# A fixed instant with sub-second precision in a non-UTC zone, used
# to prove both the UTC conversion and the microsecond truncation.
SOURCE_INSTANT = datetime(
    2026, 9, 26, 16, 30, 0, 999999, tzinfo=timezone(timedelta(hours=8))
)
EXPECTED_UTC_STRING = "2026-09-26T08:30:00Z"

INVALID_TIMESTAMPS = [
    "2026-99-99T99:99:99Z",
    "2026-09-26T08:30:00.000Z",
]


def _build_test_app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/v1/test-time")
    def get_test_time() -> dict[str, str]:
        return {"created_at": format_utc(SOURCE_INSTANT)}

    return app


def is_valid_utc_timestamp(value: str) -> bool:
    """Validate a timestamp string per API-R09 / API-AC11.

    First checks the raw string shape by regex (rejects fractional
    seconds outright), then parses it and re-checks the semantic
    constraints: UTC offset, zero microseconds, trailing "Z".
    """
    if not UTC_TIMESTAMP_PATTERN.match(value):
        return False
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return False
    return (
        parsed.utcoffset() == timedelta(0)
        and parsed.microsecond == 0
        and value.endswith("Z")
    )


def test_time_format_route_returns_truncated_utc() -> None:
    client = TestClient(_build_test_app())

    response = client.get("/api/v1/test-time")

    assert response.status_code == 200
    created_at = response.json()["created_at"]
    assert is_valid_utc_timestamp(created_at)
    assert created_at == EXPECTED_UTC_STRING


@pytest.mark.parametrize("invalid_value", INVALID_TIMESTAMPS)
def test_invalid_examples_are_rejected(invalid_value: str) -> None:
    assert not is_valid_utc_timestamp(invalid_value)
    with pytest.raises(ValueError):
        parse_utc(invalid_value)


def test_format_utc_rejects_naive_datetime() -> None:
    naive = datetime(2026, 9, 26, 8, 30, 0)
    with pytest.raises(ValueError):
        format_utc(naive)


def test_format_utc_truncates_without_rounding() -> None:
    value = datetime(2026, 9, 26, 8, 30, 0, 999999, tzinfo=UTC)
    assert format_utc(value) == "2026-09-26T08:30:00Z"


def test_parse_utc_round_trips_format_utc() -> None:
    value = datetime(2026, 9, 26, 8, 30, 0, tzinfo=UTC)
    assert parse_utc(format_utc(value)) == value
