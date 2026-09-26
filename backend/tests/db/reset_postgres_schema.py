"""Reset the ``public`` schema of the PostgreSQL compatibility
check's database (DBF-AC08).

Used two ways:

- As a library function (:func:`reset_public_schema`) by
  ``conftest.py``'s ``db_url`` fixture, so every test that runs
  under ``--db-backend=postgresql`` starts against (and leaves
  behind) an empty schema.
- As a standalone script (``python -m tests.db.reset_postgres_schema``)
  invoked directly by the ``check-postgres`` Makefile target, before
  running ``alembic upgrade head`` against the same database, so a
  schema left over from a previous run (or a previous ``downgrade``
  test) never leaks into the migration check.

Only ever goes through SQLAlchemy (DBF-R01): never imports
``psycopg`` or any other database driver directly.
"""

import os
import sys

from sqlalchemy import create_engine, text

TEST_POSTGRES_URL_ENV_VAR = "INSPECTFLOW_TEST_POSTGRES_URL"


def get_required_test_postgres_url() -> str:
    """Return ``INSPECTFLOW_TEST_POSTGRES_URL``, raising if unset or
    empty.

    This variable is deliberately separate from
    ``INSPECTFLOW_DATABASE_URL`` (see ``.env.example``): it names a
    database this module is allowed to drop and recreate the schema
    of, which a developer's configured ``INSPECTFLOW_DATABASE_URL``
    must never be assumed to be.
    """
    value = os.environ.get(TEST_POSTGRES_URL_ENV_VAR, "")
    if not value:
        raise RuntimeError(
            f"{TEST_POSTGRES_URL_ENV_VAR} is not set; refusing to "
            "guess which database to reset"
        )
    return value


def reset_public_schema(url: str) -> None:
    """Drop and recreate the ``public`` schema of the database at
    ``url``, leaving it completely empty.

    Runs outside of a transaction block per statement (each
    ``DROP``/``CREATE`` auto-commits) so the reset is not left
    half-applied by a driver-level transaction wrapper.
    """
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            connection.execute(text("DROP SCHEMA public CASCADE"))
            connection.execute(text("CREATE SCHEMA public"))
            connection.commit()
    finally:
        engine.dispose()


def main() -> int:
    url = get_required_test_postgres_url()
    reset_public_schema(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
