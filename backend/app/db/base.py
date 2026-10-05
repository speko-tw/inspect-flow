"""Declarative model base and shared columns (DBF-R08, DBF-R11,
DBF-R14).

Provides:

- :func:`uuid7`: a monotonic RFC 9562 UUID version 7 generator used
  as the default for primary keys.
- :class:`UTCDateTime`: a timezone-aware UTC datetime column type
  that behaves the same on SQLite and PostgreSQL.
- :class:`Base`: the shared declarative base (with a naming
  convention so Alembic-generated constraint names stay stable).
- :class:`TimestampedMixin`: a plain mixin (not itself a
  ``DeclarativeBase``) providing the ``id``/``created_at``/
  ``updated_at`` columns every model shares, so it can be combined
  with any declarative base -- including a test's own throwaway
  one, instead of only the shared production ``Base``.
- :class:`TimestampedBase`: :class:`TimestampedMixin` combined
  with :class:`Base`, for production models to subclass.
"""

import os
import threading
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import DateTime, TypeDecorator, Uuid

from app.db import clock

# Chosen per KD-07 after evaluating UUIDv4 and SQLite
# AUTOINCREMENT (DBF-R07 rules out relying on AUTOINCREMENT as a
# cross-system identity): UUIDv7 embeds a millisecond timestamp in
# its high bits, so generated ids sort roughly by creation time and
# stay index-friendly, unlike UUIDv4's fully random layout -- while
# still leaving enough random bits that an offline client can mint
# its own id without coordinating with a central sequence. Python
# 3.12 has no ``uuid.uuid7`` (added in 3.14), and the plan for this
# task does not allow adding a third-party UUID package, so this
# generator implements RFC 9562 UUIDv7 directly; once the backend
# requires Python >= 3.14, this can be replaced with the standard
# library's ``uuid.uuid7``.
#
# Ids are monotonic within a process (RFC 9562 section 6.2, method
# 1, the same layout as Python 3.14's ``uuid.uuid7``): a 42-bit
# counter fills ``rand_a`` and the top of ``rand_b``, starts at a
# random value each millisecond and is incremented for every id
# minted in the same millisecond. Rows written in one request often
# share ``created_at`` (and always do under a frozen test clock), so
# ``ORDER BY created_at, id`` relies on ids keeping insertion order
# (KD-07; #475). Purely random low bits would order same-millisecond
# ids arbitrarily.
_UUID7_COUNTER_MAX = (1 << 42) - 1
_uuid7_lock = threading.Lock()
_uuid7_last_ms = -1
_uuid7_last_counter = 0


def _uuid7_counter_seed() -> int:
    # 41 random bits, top counter bit clear, leaves room for at least
    # 2**41 increments within one millisecond.
    return int.from_bytes(os.urandom(6), "big") & 0x1FFFFFFFFFF


def _uuid7_reset_after_fork() -> None:
    global _uuid7_lock, _uuid7_last_ms, _uuid7_last_counter
    _uuid7_lock = threading.Lock()
    _uuid7_last_ms = -1
    _uuid7_last_counter = 0


os.register_at_fork(after_in_child=_uuid7_reset_after_fork)


def uuid7() -> uuid.UUID:
    """Generate a monotonic RFC 9562 UUID version 7 value.

    Use it only as a sortable primary key, never as a credential or an
    unguessable link: the next id minted in the same millisecond can be
    derived from the previous one (counter + 1). Generate credentials
    with :mod:`secrets` instead.
    """
    global _uuid7_last_ms, _uuid7_last_counter
    with _uuid7_lock:
        unix_ts_ms = time.time_ns() // 1_000_000
        if unix_ts_ms > _uuid7_last_ms:
            counter = _uuid7_counter_seed()
        else:
            # Same millisecond, or the clock stepped back: keep the
            # last timestamp so ids never go backwards.
            unix_ts_ms = _uuid7_last_ms
            counter = _uuid7_last_counter + 1
            if counter > _UUID7_COUNTER_MAX:
                unix_ts_ms += 1
                counter = _uuid7_counter_seed()
        _uuid7_last_ms = unix_ts_ms
        _uuid7_last_counter = counter
    tail = int.from_bytes(os.urandom(4), "big")

    value = unix_ts_ms & 0xFFFFFFFFFFFF
    value = (value << 4) | 0x7  # version 7
    value = (value << 12) | (counter >> 30)  # rand_a: counter high
    value = (value << 2) | 0b10  # variant 10 (RFC 4122/9562)
    value = (value << 30) | (counter & 0x3FFFFFFF)  # counter low
    value = (value << 32) | tail  # random tail

    return uuid.UUID(int=value)


class UTCDateTime(TypeDecorator):
    """A timezone-aware UTC datetime column (DBF-R08).

    Backed by ``DateTime(timezone=True)``. SQLite has no native
    timezone-aware storage, so this type normalizes on both sides
    of the round trip instead of relying on the database: naive
    values are rejected on bind, and a naive value read back from
    the database (as SQLite would return) is assumed to already be
    UTC and tagged accordingly, so callers always see an aware,
    UTC datetime regardless of backend.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(
        self, value: datetime | None, dialect: object
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError(
                "UTCDateTime requires an aware datetime; got naive "
                f"value {value!r}"
            )
        return value.astimezone(UTC)

    def process_result_value(
        self, value: datetime | None, dialect: object
    ) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


# Alembic-generated constraint names should not depend on the
# order migrations happen to be written in; a fixed naming
# convention keeps them stable and predictable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Shared declarative base for every InspectFlow model."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampedMixin:
    """Mixin providing the id/created_at/updated_at columns shared
    by every model (DBF-R11, DBF-R14).

    A plain class, not a ``DeclarativeBase`` subclass itself:
    SQLAlchemy's "mixin and base classes" declarative pattern picks
    up its ``Mapped``/``mapped_column`` attributes on whichever
    declarative base a subclass combines it with. Production models
    get these columns through :class:`TimestampedBase` below (which
    binds the mixin to the shared ``Base``); a test that wants the
    same columns without registering a table on the shared
    production metadata can instead combine this mixin with a
    throwaway ``DeclarativeBase`` of its own.

    ``created_at``/``updated_at`` defaults call ``clock.utc_now``
    (not ``datetime.now`` directly) so a test can replace the
    active clock via ``app.db.clock.set_clock`` and see it take
    effect on both insert and update (DBF-AC11).
    """

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid7
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=clock.utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime,
        nullable=False,
        default=clock.utc_now,
        onupdate=clock.utc_now,
    )


class TimestampedBase(TimestampedMixin, Base):
    """Abstract base combining :class:`TimestampedMixin` with the
    shared application :class:`Base`. Production models subclass
    this (not :class:`TimestampedMixin` directly) to share the
    application's metadata and naming convention.
    """

    __abstract__ = True
