"""Tests for the shared timestamped columns mixin (DBF-R14), and a
pre-check that the replaceable clock feeds ``onupdate`` (a simple
predecessor to the full DBF-AC11 check, which lands with the
``User``/``Project`` models).

Uses ``TimestampedMixin`` combined with a throwaway
``DeclarativeBase`` of this test's own, instead of subclassing
``TimestampedBase`` (which lives on the shared, production
``app.db.base.Base`` metadata) -- so this test never registers a
table on the metadata Alembic and the running application actually
use (DBF-R03: tests may still ``create_all`` a metadata of their
own).
"""

from collections.abc import Generator
from datetime import timedelta

import pytest
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app.db import clock
from app.db.base import Base, TimestampedMixin


class _ProbeBase(DeclarativeBase):
    """A metadata island private to this test module."""


class TimestampedProbe(TimestampedMixin, _ProbeBase):
    __tablename__ = "timestamped_mixin_probe"

    label: Mapped[str] = mapped_column(default="probe")


def test_mixin_does_not_register_a_table_on_the_shared_base():
    assert TimestampedProbe.__tablename__ not in Base.metadata.tables


@pytest.fixture(autouse=True)
def _reset_clock_after_test() -> Generator[None, None, None]:
    yield
    clock.reset_clock()


@pytest.fixture
def session(db_url: str) -> Generator[Session, None, None]:
    engine: Engine = create_engine(db_url)
    _ProbeBase.metadata.create_all(engine)
    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


def test_created_and_updated_at_are_set_on_insert(session):
    row = TimestampedProbe()
    session.add(row)
    session.commit()

    assert row.created_at.tzinfo is not None
    assert row.updated_at.tzinfo is not None


def test_onupdate_uses_the_replaced_clock(session):
    row = TimestampedProbe()
    session.add(row)
    session.commit()
    original_created_at = row.created_at
    original_updated_at = row.updated_at

    later = original_updated_at + timedelta(seconds=5)
    clock.set_clock(lambda: later)

    row.label = "changed"
    session.commit()

    assert row.created_at == original_created_at
    assert row.updated_at == later
    assert row.updated_at > original_updated_at
