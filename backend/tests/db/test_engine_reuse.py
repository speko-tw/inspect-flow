"""Tests that the default (no explicit engine/session_factory) path
through ``get_engine``/``get_session_factory``/``unit_of_work``
reuses one shared engine per process instead of building a new
connection pool on every call.
"""

from collections.abc import Generator

import pytest
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.db import settings
from app.db.engine import dispose_engine, get_engine, get_session_factory
from app.db.unit_of_work import unit_of_work


class _ProbeBase(DeclarativeBase):
    """A metadata island private to this test module (see
    ``test_utc_datetime.py`` for why this stays off the shared
    ``app.db.base.Base`` metadata).
    """


class Widget(_ProbeBase):
    __tablename__ = "engine_reuse_widget"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str]


@pytest.fixture(autouse=True)
def _reset_shared_engine(monkeypatch, tmp_path) -> Generator[None, None, None]:
    """Point the shared engine at a tmp SQLite file for every test
    in this module, and always dispose it afterwards.

    Disposing before the test too guards against a shared engine
    left over from an earlier test elsewhere in the suite; without
    it, ``get_engine()`` here could reuse a stale cached engine
    instead of one built from this test's own tmp path -- and,
    worse, that stale engine could be pointed at the real default
    path under ``backend/data``.
    """
    dispose_engine()
    db_path = tmp_path / "shared.db"
    monkeypatch.setenv(settings.DATABASE_URL_ENV_VAR, f"sqlite:///{db_path}")
    try:
        yield
    finally:
        dispose_engine()


def test_get_engine_returns_the_same_instance_on_repeat_calls():
    first = get_engine()
    second = get_engine()

    assert first is second


def test_dispose_engine_forces_a_fresh_engine_on_next_call():
    first = get_engine()

    dispose_engine()
    second = get_engine()

    assert first is not second


def test_get_session_factory_reuses_the_shared_engine_by_default():
    first = get_session_factory()
    second = get_session_factory()

    assert first is second
    assert first.kw["bind"] is get_engine()


def test_get_session_factory_with_explicit_engine_is_not_cached():
    explicit_engine = get_engine()

    first = get_session_factory(explicit_engine)
    second = get_session_factory(explicit_engine)

    assert first is not second


def test_unit_of_work_without_factory_uses_the_env_configured_db():
    _ProbeBase.metadata.create_all(get_engine())

    with unit_of_work() as session:
        session.add(Widget(name="a"))

    with get_session_factory()() as session:
        names = sorted(session.scalars(select(Widget.name)))

    assert names == ["a"]
