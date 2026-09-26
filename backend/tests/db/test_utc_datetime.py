"""Tests for the UTC-aware datetime column type (DBF-AC06)."""

from collections.abc import Generator
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app.api.time_format import format_utc
from app.db.base import UTCDateTime


class _ProbeBase(DeclarativeBase):
    """A metadata island private to this test module.

    DBF-R03 forbids ``create_all`` in production code paths, but
    tests are explicitly allowed to use it on a metadata of their
    own -- this keeps that table off ``app.db.base.Base.metadata``.
    """


class TimestampedRow(_ProbeBase):
    __tablename__ = "utc_datetime_probe"

    id: Mapped[int] = mapped_column(primary_key=True)
    happened_at: Mapped[datetime] = mapped_column(UTCDateTime)


@pytest.fixture
def engine(tmp_path) -> Generator[Engine, None, None]:
    eng = create_engine(f"sqlite:///{tmp_path / 'utc_datetime.db'}")
    _ProbeBase.metadata.create_all(eng)
    try:
        yield eng
    finally:
        eng.dispose()


def test_round_trip_preserves_utc_instant(engine):
    tz_plus8 = timezone(timedelta(hours=8))
    written = datetime(2026, 1, 2, 10, 0, 0, tzinfo=tz_plus8)

    with Session(engine) as session:
        row = TimestampedRow(happened_at=written)
        session.add(row)
        session.commit()
        row_id = row.id
        session.expire_all()

        reloaded = session.get(TimestampedRow, row_id)

        assert reloaded is not None
        assert reloaded.happened_at.tzinfo is not None
        assert reloaded.happened_at == written
        assert format_utc(reloaded.happened_at) == "2026-01-02T02:00:00Z"


def test_naive_datetime_is_rejected(engine):
    with Session(engine) as session:
        row = TimestampedRow(happened_at=datetime(2026, 1, 2, 10, 0, 0))
        session.add(row)

        with pytest.raises(StatementError) as exc_info:
            session.commit()

        assert isinstance(exc_info.value.orig, ValueError)
