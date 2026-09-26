"""Tests for SQLite connection initialization (DBF-AC05).

Covers: PRAGMA settings take effect on a real SQLite file
database; the same initialization is a no-op on a non-SQLite
dialect; and every PRAGMA statement under ``backend/app`` carries
the ``# db-dependency: sqlite`` annotation the plan requires.
"""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.dialects import postgresql

from app.db.engine import (
    configure_sqlite_connection,
    create_engine_from_settings,
)

PRAGMA_TAG = "# db-dependency: sqlite"


def test_sqlite_pragmas_enabled_on_file_database(tmp_path):
    db_path = tmp_path / "pragma.db"
    engine = create_engine_from_settings(f"sqlite:///{db_path}")
    try:
        with engine.connect() as conn:
            foreign_keys = conn.execute(text("PRAGMA foreign_keys")).scalar()
            journal_mode = conn.execute(text("PRAGMA journal_mode")).scalar()
    finally:
        engine.dispose()
    assert foreign_keys == 1
    assert journal_mode == "wal"


class _RecordingCursor:
    def __init__(self, connection: "_RecordingConnection") -> None:
        self._connection = connection

    def execute(self, statement, parameters=None) -> None:
        self._connection.executed.append(statement)

    def close(self) -> None:
        pass


class _RecordingConnection:
    """A minimal stand-in for a non-SQLite DBAPI connection.

    Only implements ``cursor()``, which is all
    ``configure_sqlite_connection`` needs to reach in order to run
    a PRAGMA. It deliberately raises if given a real dialect that
    is not SQLite and the function under test still tries to use
    it, so a regression that removes the dialect check would fail
    loudly here.
    """

    def __init__(self) -> None:
        self.executed: list[str] = []

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self)


def test_non_sqlite_dialect_runs_no_pragma():
    """DBF-AC05's non-SQLite path.

    Driving this through a full ``create_engine(...)`` call with a
    fake PostgreSQL DBAPI module turns out to need much more than
    a fake ``connect()`` -- the postgresql dialect issues its own
    "select pg_catalog.version()" query while initializing the
    engine on first connect, before application code (including
    our listener) ever runs, which would mean faking a working
    DBAPI cursor/result protocol unrelated to what this test is
    trying to check. Per the plan's fallback, this test instead
    calls ``configure_sqlite_connection`` directly against a real,
    non-SQLite ``Dialect`` object (``postgresql.dialect()``) and a
    fake DBAPI connection, and asserts no PRAGMA (indeed nothing at
    all) is executed on it.
    """
    dialect = postgresql.dialect()
    assert dialect.name != "sqlite"
    connection = _RecordingConnection()

    configure_sqlite_connection(dialect, connection, connection_record=None)

    assert connection.executed == []


def test_pragma_statements_are_tagged_with_db_dependency():
    app_dir = Path(__file__).resolve().parents[2] / "app"
    py_files = sorted(app_dir.rglob("*.py"))
    found_pragma = False
    for path in py_files:
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            if "PRAGMA" not in line:
                continue
            found_pragma = True
            tagged_same_line = PRAGMA_TAG in line
            tagged_prev_line = index > 0 and PRAGMA_TAG in lines[index - 1]
            assert tagged_same_line or tagged_prev_line, (
                f"{path}:{index + 1} contains PRAGMA without "
                f"{PRAGMA_TAG!r} on the same or previous line"
            )
    assert found_pragma, (
        f"expected to find at least one PRAGMA statement under {app_dir}"
    )
