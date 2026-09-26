"""Tests for the UUIDv7 generator used as the primary key default
(DBF-R11).
"""

import uuid

from app.db.base import uuid7


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
