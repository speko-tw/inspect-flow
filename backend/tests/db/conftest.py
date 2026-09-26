"""Shared fixtures for ``backend/tests/db/`` (DBF-AC08).

Tests here run against either a temporary SQLite file (the
default) or a real PostgreSQL database, selected with the
``--db-backend`` option this conftest adds. This lets
``make check-backend`` run the same test files against SQLite as
before, while ``make check-postgres`` runs the identical tests
against PostgreSQL via ``INSPECTFLOW_TEST_POSTGRES_URL`` -- proving
migrations and DB-backed behavior work on both, not only on
SQLite.

A handful of tests are inherently SQLite-specific (PRAGMA/WAL
settings, the default SQLite file path and its parent-directory
creation): mark those ``sqlite_only``. They are automatically
skipped under ``--db-backend=postgresql`` (see
:func:`pytest_collection_modifyitems`).
"""

import os
from collections.abc import Generator
from pathlib import Path

import pytest

from app.db.engine import dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from tests.db.reset_postgres_schema import (
    TEST_POSTGRES_URL_ENV_VAR,
    reset_public_schema,
)

_DB_BACKENDS = ("sqlite", "postgresql")


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--db-backend",
        action="store",
        default="sqlite",
        choices=_DB_BACKENDS,
        help=(
            "Which database backend to run backend/tests/db/ "
            "against (default: sqlite)."
        ),
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "sqlite_only: inherently SQLite-specific; skipped under "
        "--db-backend=postgresql",
    )
    if config.getoption("--db-backend") != "postgresql":
        return
    if not os.environ.get(TEST_POSTGRES_URL_ENV_VAR, ""):
        raise pytest.UsageError(
            "--db-backend=postgresql requires "
            f"{TEST_POSTGRES_URL_ENV_VAR} to be set; refusing to "
            "silently fall back to SQLite"
        )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    if config.getoption("--db-backend") != "postgresql":
        return
    skip_sqlite_only = pytest.mark.skip(
        reason="sqlite_only: skipped under --db-backend=postgresql"
    )
    for item in items:
        if item.get_closest_marker("sqlite_only") is not None:
            item.add_marker(skip_sqlite_only)


@pytest.fixture
def db_url(
    request: pytest.FixtureRequest,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Generator[str, None, None]:
    """Return a connection URL for this test's configured backend,
    and point ``INSPECTFLOW_DATABASE_URL`` at it for the duration
    of the test.

    SQLite (default): a fresh file under ``tmp_path``, matching
    every test's previous ad hoc
    ``create_engine(f"sqlite:///{tmp_path / ...}")`` calls.

    PostgreSQL (``--db-backend=postgresql``): the database at
    ``INSPECTFLOW_TEST_POSTGRES_URL``, with its ``public`` schema
    reset to empty both before and after the test, so a previous
    test's leftover tables never leak in, and this test's own
    tables never leak into whatever runs next.

    Disposes the shared engine before and after every test
    regardless of backend, guarding against a stale cached engine
    leaking in from (or out to) another test -- the same concern
    ``test_migrations.py`` and ``test_engine_reuse.py`` already
    guarded against individually before this fixture existed.
    """
    backend = request.config.getoption("--db-backend")
    if backend == "postgresql":
        url = os.environ[TEST_POSTGRES_URL_ENV_VAR]
    else:
        url = f"sqlite:///{tmp_path / 'test.db'}"

    monkeypatch.setenv(DATABASE_URL_ENV_VAR, url)
    dispose_engine()
    if backend == "postgresql":
        reset_public_schema(url)
    try:
        yield url
    finally:
        dispose_engine()
        if backend == "postgresql":
            reset_public_schema(url)
