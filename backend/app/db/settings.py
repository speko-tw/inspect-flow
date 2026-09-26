"""Database connection settings (DBF-R05).

The SQLAlchemy connection URL is read from an environment
variable so the target database can be switched between SQLite
and PostgreSQL without a code change. When the variable is unset
or empty, callers fall back to a SQLite file located under this
backend's own directory, resolved from this module's own path so
the result does not depend on the process's current working
directory.
"""

import os
from pathlib import Path

DATABASE_URL_ENV_VAR = "INSPECTFLOW_DATABASE_URL"

# backend/app/db/settings.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_DEFAULT_SQLITE_PATH = _BACKEND_DIR / "data" / "inspectflow.db"


def default_sqlite_path() -> Path:
    """Return the absolute default SQLite database file path."""
    return _DEFAULT_SQLITE_PATH


def default_database_url() -> str:
    """Return the SQLAlchemy URL used when the env var is unset.

    This is a plain function (not a module-level constant) so the
    default is recomputed from ``default_sqlite_path()`` each
    time, matching how ``get_database_url`` resolves it.
    """
    return f"sqlite:///{default_sqlite_path()}"


def get_database_url() -> str:
    """Resolve the SQLAlchemy database URL.

    Reads ``INSPECTFLOW_DATABASE_URL``; an unset or empty value
    falls back to :func:`default_database_url`. This function does
    not create the engine, open a connection, or create any
    directory -- it only resolves a string.
    """
    value = os.environ.get(DATABASE_URL_ENV_VAR, "")
    if value:
        return value
    return default_database_url()
