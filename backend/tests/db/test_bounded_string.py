"""Tests for ``BoundedString``'s compiled-statement cache key
(issue #183).

``sqlalchemy.types.TypeEngine._static_cache_key`` builds a type's
cache key from its ``__init__`` parameter names, but only for names
that are also present in ``self.__dict__``.
``TypeDecorator.__init__`` stores ``length`` on ``self.impl`` (the
wrapped ``String``), not on ``self`` -- so without
``BoundedString.__init__`` also assigning ``self.length``, two
instances built with the same ``check`` callable but different
``length`` values would produce the same cache key. Under SQLAlchemy's
per-engine compiled-statement cache, a statement compiled for the
first instance (with its ``VARCHAR(length)``) could then be reused
for the second, silently applying the wrong length.

The first test checks the cache key directly; the second proves the
consequence would be visible in actual compiled SQL sent to the
database, by round-tripping ``CAST`` expressions through the same
engine (and therefore the same compiled cache).
"""

from collections.abc import Generator

import pytest
from sqlalchemy import Engine, cast, create_engine, event, literal, select

from app.models._bounded_string import BoundedString


def _no_op_check(value: str) -> None:
    return None


@pytest.fixture
def engine(db_url: str) -> Generator[Engine, None, None]:
    eng = create_engine(db_url)
    try:
        yield eng
    finally:
        eng.dispose()


def test_cache_key_differs_by_length():
    short = BoundedString(32, _no_op_check)
    long = BoundedString(64, _no_op_check)

    assert short._static_cache_key != long._static_cache_key


def test_compiled_cast_uses_each_instances_own_length(engine):
    """Executing a 32-length ``CAST`` then a 64-length one on the
    same engine must not let the second reuse the first's compiled
    ``VARCHAR(32)`` SQL out of the shared compiled-statement cache.
    """
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", _capture)
    try:
        with engine.connect() as conn:
            conn.execute(
                select(cast(literal("x"), BoundedString(32, _no_op_check)))
            )
            conn.execute(
                select(cast(literal("x"), BoundedString(64, _no_op_check)))
            )
    finally:
        event.remove(engine, "before_cursor_execute", _capture)

    assert len(statements) == 2
    assert "VARCHAR(32)" in statements[0]
    assert "VARCHAR(64)" in statements[1]
