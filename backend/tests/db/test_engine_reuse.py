"""Tests that the default (no explicit engine/session_factory) path
through ``get_engine``/``get_session_factory``/``unit_of_work``
reuses one shared engine per process instead of building a new
connection pool on every call.
"""

import threading
from collections.abc import Generator

import pytest
from sqlalchemy import select
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

import app.db.engine as engine_module
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
def _reset_shared_engine(db_url) -> Generator[None, None, None]:
    """Point the shared engine at this test's configured database
    (SQLite by default, PostgreSQL under ``--db-backend=postgresql``)
    for every test in this module.

    ``conftest.py``'s ``db_url`` fixture already disposes the
    shared engine before and after each test -- guarding against a
    shared engine left over from an earlier test elsewhere in the
    suite, which could otherwise mean ``get_engine()`` here reuses
    a stale cached engine instead of one built from this test's own
    database, or worse, one pointed at the real default path under
    ``backend/data``. This fixture only needs to depend on it to
    trigger that setup for every test in this module.
    """
    yield


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


def test_concurrent_first_calls_build_the_engine_once(monkeypatch):
    """Regression test: several threads calling ``get_engine()`` for
    the first time at once must still build exactly one engine and
    all observe the same instance (the lock guarding the shared
    engine/session-factory state must actually serialize the build,
    not just look like it does under a single thread).
    """
    real_create_engine_from_settings = (
        engine_module.create_engine_from_settings
    )
    call_count = 0
    count_lock = threading.Lock()

    def counting_create_engine_from_settings(*args, **kwargs):
        nonlocal call_count
        with count_lock:
            call_count += 1
        return real_create_engine_from_settings(*args, **kwargs)

    monkeypatch.setattr(
        engine_module,
        "create_engine_from_settings",
        counting_create_engine_from_settings,
    )

    thread_count = 8
    barrier = threading.Barrier(thread_count)
    results: list[object] = [None] * thread_count
    errors: list[BaseException] = []

    def worker(index: int) -> None:
        try:
            barrier.wait()
            results[index] = get_engine()
        except BaseException as exc:  # pragma: no cover - defensive
            errors.append(exc)

    threads = [
        threading.Thread(target=worker, args=(i,)) for i in range(thread_count)
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert not errors
    assert call_count == 1
    assert len({id(result) for result in results}) == 1
