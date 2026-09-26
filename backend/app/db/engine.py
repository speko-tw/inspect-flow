"""Engine and session construction (DBF-R04, DBF-R05, DBF-R06).

Engines are built lazily through :func:`create_engine_from_settings`
/ :func:`get_engine` rather than at import time, so importing this
module never touches the filesystem or opens a connection. Access
goes through SQLAlchemy exclusively (DBF-R01): this module does not
import ``sqlite3`` or any PostgreSQL driver.
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


def get_engine() -> Engine:
    """Build a fresh engine for the currently configured database.

    Cheap to call repeatedly; callers that want a single long-lived
    engine (such as the application at startup) should hold onto
    the returned value themselves.
    """
    return create_engine_from_settings()


def get_session_factory(
    engine: Engine | None = None,
) -> sessionmaker[Session]:
    """Return a ``sessionmaker`` bound to ``engine`` (or a fresh
    engine for the configured database when omitted).
    """
    return sessionmaker(bind=engine or get_engine())
