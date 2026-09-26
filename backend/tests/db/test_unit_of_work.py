"""Tests for the Service-layer unit of work (DBF-AC07)."""

from collections.abc import Generator

import pytest
from sqlalchemy import Engine, create_engine, select
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    sessionmaker,
)

from app.db.unit_of_work import unit_of_work


class _ProbeBase(DeclarativeBase):
    """A metadata island private to this test module (see
    ``test_utc_datetime.py`` for why this stays off the shared
    ``app.db.base.Base`` metadata).
    """


class Widget(_ProbeBase):
    __tablename__ = "unit_of_work_widget"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]


class _SimulatedError(Exception):
    """A distinct exception so the test can assert re-raising."""


@pytest.fixture
def session_factory(tmp_path) -> Generator[sessionmaker, None, None]:
    engine: Engine = create_engine(f"sqlite:///{tmp_path / 'uow.db'}")
    _ProbeBase.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    try:
        yield factory
    finally:
        engine.dispose()


def _widget_names(factory: sessionmaker) -> list[str]:
    with factory() as session:
        return sorted(session.scalars(select(Widget.name)))


def test_exception_rolls_back_all_writes_in_the_block(session_factory):
    with pytest.raises(_SimulatedError):
        with unit_of_work(session_factory) as session:
            session.add(Widget(name="a"))
            session.add(Widget(name="b"))
            session.flush()
            raise _SimulatedError("simulated failure")

    assert _widget_names(session_factory) == []


def test_successful_block_commits_all_writes(session_factory):
    with unit_of_work(session_factory) as session:
        session.add(Widget(name="a"))
        session.add(Widget(name="b"))

    assert _widget_names(session_factory) == ["a", "b"]
