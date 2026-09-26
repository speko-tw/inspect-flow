"""Engine and session construction (DBF-R04, DBF-R05, DBF-R06).

Engines are built lazily -- through :func:`create_engine_from_settings`
directly, or through :func:`get_engine`, which additionally caches
the result -- rather than at import time, so importing this module
never touches the filesystem or opens a connection. Access goes
through SQLAlchemy exclusively (DBF-R01): this module does not
import ``sqlite3`` or any PostgreSQL driver.

:func:`get_engine` and :func:`get_session_factory` (when called
without an explicit engine) are the ones the Service layer's unit
of work uses by default. They build their engine/sessionmaker once
per process and reuse it afterwards, so repeated units of work do
not each open their own connection pool against the configured
database. Call :func:`dispose_engine` to drop that shared state --
tests that change ``INSPECTFLOW_DATABASE_URL`` between cases must
do this in teardown, and a long-running process may do it on
shutdown.
"""

from pathlib import Path
from typing import Any

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import Dialect, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.db.settings import get_database_url

_MEMORY_DATABASES = {"", ":memory:"}


def configure_sqlite_connection(
    dialect: Dialect,
    dbapi_connection: Any,
    connection_record: object,
) -> None:
    """Apply SQLite-only connection setup on a new DBAPI connection.

    No-ops for any dialect other than SQLite (DBF-R06, DBF-R07),
    so the same function can be wired to an engine's ``connect``
    event regardless of backend, and can also be called directly
    in tests against a non-SQLite ``Dialect`` object without a
    real database connection.
    """
    if dialect.name != "sqlite":
        return
    cursor = dbapi_connection.cursor()
    try:
        # db-dependency: sqlite
        cursor.execute("PRAGMA foreign_keys=ON")
        # db-dependency: sqlite
        cursor.execute("PRAGMA journal_mode=WAL")
    finally:
        cursor.close()


def _ensure_sqlite_parent_dir(url: str) -> None:
    """Create the parent directory of a SQLite file database.

    Does nothing for non-SQLite URLs or the SQLite in-memory
    database.
    """
    parsed = make_url(url)
    if parsed.get_backend_name() != "sqlite":
        return
    database = parsed.database or ""
    if database in _MEMORY_DATABASES:
        return
    Path(database).parent.mkdir(parents=True, exist_ok=True)


def create_engine_from_settings(database_url: str | None = None) -> Engine:
    """Build an engine for ``database_url`` (default: the
    configured URL).

    Ensures a SQLite file database's parent directory exists
    before the first connection is opened, and installs
    :func:`configure_sqlite_connection` on the engine's
    ``connect`` event.
    """
    url = database_url if database_url is not None else get_database_url()
    _ensure_sqlite_parent_dir(url)
    engine = create_engine(url)

    def _on_connect(dbapi_connection: Any, connection_record: object) -> None:
        configure_sqlite_connection(
            engine.dialect, dbapi_connection, connection_record
        )

    event.listen(engine, "connect", _on_connect)
    return engine


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Return the shared engine for the currently configured
    database, building it on first use and reusing the same
    instance on every later call within this process.

    This is what the default unit of work goes through, so a
    process making many units of work against the configured
    database shares one connection pool instead of opening a new
    one per call. Use :func:`dispose_engine` to drop the cached
    engine (for example, after changing the connection settings).
    """
    global _engine
    if _engine is None:
        _engine = create_engine_from_settings()
    return _engine


def dispose_engine() -> None:
    """Dispose of and forget the shared engine and session factory.

    Safe to call even when no shared engine has been built yet. A
    later :func:`get_engine`/:func:`get_session_factory` call
    rebuilds them from the currently configured database.
    """
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def get_session_factory(
    engine: Engine | None = None,
) -> sessionmaker[Session]:
    """Return a ``sessionmaker`` for ``engine``.

    With an explicit ``engine``, always builds a fresh
    ``sessionmaker`` bound to it. Without one, returns the shared
    ``sessionmaker`` bound to the shared engine from
    :func:`get_engine`, building and caching it on first use.
    """
    if engine is not None:
        return sessionmaker(bind=engine)
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine())
    return _session_factory
