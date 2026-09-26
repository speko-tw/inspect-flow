"""Replaceable UTC clock for automatic timestamp columns (DBF-R14).

The shared model base's ``created_at``/``updated_at`` defaults
call :func:`utc_now` at write time rather than binding
``datetime.now`` when the module is imported, so a test can swap
the active time source with :func:`set_clock` and observe the
replacement in ``onupdate`` (DBF-AC11). Restore the real clock
with :func:`reset_clock` once the test is done -- fixtures should
do this in a ``finally``/teardown so a failing assertion cannot
leave a later test with a frozen clock.
"""

from collections.abc import Callable
from datetime import UTC, datetime


def _real_now() -> datetime:
    return datetime.now(UTC)


_clock_source: Callable[[], datetime] = _real_now


def utc_now() -> datetime:
    """Return the current time from the active clock source."""
    return _clock_source()


def set_clock(source: Callable[[], datetime]) -> None:
    """Replace the time source used by :func:`utc_now` (tests)."""
    global _clock_source
    _clock_source = source


def reset_clock() -> None:
    """Restore the default, real-time clock source."""
    global _clock_source
    _clock_source = _real_now
