"""Tests for the UUIDv7 generator used as the primary key default
(DBF-R11).
"""

import time
import uuid
from types import SimpleNamespace

from app.db import base
from app.db.base import uuid7


def _freeze_ms(monkeypatch, *values_ns: int) -> None:
    """Make ``uuid7`` read the given ``time_ns`` values in turn."""
    remaining = list(values_ns)

    def time_ns() -> int:
        return remaining.pop(0) if len(remaining) > 1 else remaining[0]

    monkeypatch.setattr(base, "time", SimpleNamespace(time_ns=time_ns))


def test_uuid7_has_expected_version_and_variant():
    value = uuid7()

    assert isinstance(value, uuid.UUID)
    assert value.version == 7
    assert value.variant == uuid.RFC_4122


def test_uuid7_values_are_unique():
    values = {uuid7() for _ in range(200)}

    assert len(values) == 200


def test_uuid7_timestamps_are_non_decreasing():
    values = [uuid7() for _ in range(50)]
    # The 48-bit millisecond timestamp occupies the top bits of
    # the 128-bit value.
    timestamps = [value.int >> 80 for value in values]

    assert timestamps == sorted(timestamps)


def test_uuid7_keeps_insertion_order_within_one_millisecond(monkeypatch):
    # #475: rows written in one request share created_at, so the id
    # tie-break must follow the order the ids were minted in.
    now = time.time_ns()
    _freeze_ms(monkeypatch, now)

    values = [uuid7() for _ in range(1000)]

    assert {value.int >> 80 for value in values} == {now // 1_000_000}
    assert values == sorted(values)
    assert len(set(values)) == len(values)
    assert all(value.version == 7 for value in values)
    assert all(value.variant == uuid.RFC_4122 for value in values)


def test_uuid7_does_not_go_backwards_when_the_clock_steps_back(
    monkeypatch,
):
    now = time.time_ns()
    _freeze_ms(monkeypatch, now, now - 5_000_000)

    first = uuid7()
    second = uuid7()

    assert second > first
    assert second.int >> 80 == first.int >> 80 == now // 1_000_000


def test_uuid7_counter_overflow_moves_to_the_next_millisecond(
    monkeypatch,
):
    now_ms = time.time_ns() // 1_000_000
    _freeze_ms(monkeypatch, now_ms * 1_000_000)
    monkeypatch.setattr(base, "_uuid7_last_ms", now_ms)
    monkeypatch.setattr(base, "_uuid7_last_counter", base._UUID7_COUNTER_MAX)

    value = uuid7()

    assert value.int >> 80 == now_ms + 1
    assert value.version == 7
    assert value.variant == uuid.RFC_4122
