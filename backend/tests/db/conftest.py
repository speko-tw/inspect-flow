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
import uuid
from collections.abc import Generator
from pathlib import Path

import pytest
from sqlalchemy import insert, inspect
from sqlalchemy.orm import Session

from app.db import clock
from app.db.base import uuid7
from app.db.engine import dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from app.models import Company, User
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
    backend = request.config.getoption("--db-backend", default="sqlite")
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


def username_for(user_id: uuid.UUID | None = None) -> str:
    """Return a valid ``username`` independent of ``employee_no``.

    The optional id keeps a root user's username stable while tests
    can request a fresh value without constructing that user first.
    """
    return f"u{(user_id or uuid7()).hex[:31]}"


def make_system_admin(user: User) -> User:
    """Turn ``user`` into the built-in ``admin`` (DOM-R50).

    Sets ``is_system`` and clears/sets every field the built-in
    account is required to have: ``username = "admin"``, ``is_admin``,
    and no company, department, location, employee number or names.
    Only one such row can exist (``username`` is unique), so callers
    that need a *second* ``is_system`` row must bypass the CHECK
    themselves.
    """
    user.is_system = True
    user.is_admin = True
    user.username = "admin"
    user.company_id = None
    user.department = None
    user.location = None
    user.employee_no = None
    user.name_zh = None
    user.name_en = None
    return user


def create_root_user_with_company(session: Session, employee_no: str) -> User:
    """Build and flush a self-referential ``User`` (``created_by``/
    ``updated_by`` point at its own id, per DBF-R14/DBF-Q2) together
    with a freshly created ``Company`` it belongs to, satisfying
    DOM-R01's ``company_id`` ``NOT NULL``/foreign-key requirement.

    Shared by every ``tests/db/`` suite that only needs *some* valid
    operator/company pair as a precondition -- not the specific
    ``Company`` row under test (``test_company.py``'s own
    ``existing_company``/``boundary_company`` fixtures build those
    separately) -- so each pre-existing test that built a bare
    self-referential ``User`` before ``User.company_id`` existed
    (``test_user_project.py``, ``test_auth_tables.py``,
    ``test_company.py``'s ``creator``,
    ``test_narrow_business_number_lengths.py``) keeps working with a
    minimal change at each call site.

    Mirrors DOM-R11/T6's required write order for this circular
    foreign key (``User.company_id`` is the ``DEFERRABLE INITIALLY
    DEFERRED`` side, ``Company.created_by``/``updated_by`` are not --
    see ``app/models/user.py``'s docstring and plan.md's "風險"
    section): the ``User`` row is flushed (an actual ``INSERT``) so
    it already exists in the database *before* the ``Company`` row
    that names it as ``created_by``/``updated_by`` is added.
    SQLAlchemy's automatic flush ordering does not reliably resolve
    this cycle in the caller's favor on its own -- verified
    empirically it can choose to insert ``companies`` first instead,
    which fails ``Company.created_by``'s immediate (non-deferred)
    foreign key check.

    Only flushes, does not commit: the deferred ``company_id``
    foreign key is not re-checked until the caller's own
    ``session.commit()``, so this can be used as part of a larger
    transaction the caller is still building up.

    Do not call this a second time in the same test to get a
    *conflicting* second user (e.g. a duplicate ``employee_no``): the
    eager ``flush()`` above would raise the expected
    ``IntegrityError`` immediately, inside this helper, instead of
    at the caller's own ``session.commit()``. Use
    :func:`build_root_user` for that second row instead, reusing
    this call's ``company_id``.
    """
    self_id = uuid7()
    company_id = uuid7()

    user = build_root_user(employee_no, company_id, self_id=self_id)
    user_columns = {
        column["name"]
        for column in inspect(session.connection()).get_columns("users")
    }
    if "is_external_collaborator" in user_columns:
        session.add(user)
        session.flush()
    else:
        # Historical migration tests intentionally use the schema from
        # before the external-collaborator migration. Insert only columns
        # present at that revision; ORM persistence would include the new
        # mapped fields and fail against the older table.
        values = {
            column.name: getattr(user, column.name)
            for column in User.__table__.columns
            if column.name in user_columns
            and getattr(user, column.name) is not None
        }
        values["created_at"] = clock.utc_now()
        values["updated_at"] = clock.utc_now()
        session.execute(insert(User).values(values))

    session.add(
        Company(
            id=company_id,
            name=f"Company for {employee_no}",
            created_by=self_id,
            updated_by=self_id,
        )
    )
    session.flush()

    return user


def build_root_user(
    employee_no: str,
    company_id: uuid.UUID | None,
    *,
    self_id: uuid.UUID | None = None,
) -> User:
    """Build (but do not add or flush) a self-referential ``User``,
    referencing an already-existing ``company_id`` -- typically one
    a prior :func:`create_root_user_with_company` call already
    committed or flushed.

    For tests that need a *second* root user in the same session,
    often one expected to violate a constraint (a duplicate
    ``employee_no``, an over-length field, ...): unlike
    :func:`create_root_user_with_company`, this never touches the
    session, so the caller controls exactly when (and whether) the
    resulting ``IntegrityError`` surfaces.
    """
    if self_id is None:
        self_id = uuid7()
    return User(
        id=self_id,
        username=username_for(self_id),
        employee_no=employee_no,
        company_id=company_id,
        department="Operations",
        location="HQ",
        name_en=f"Root User {employee_no}",
        name_zh=f"根使用者{employee_no}",
        email=f"{self_id.hex}@example.com",
        is_external_collaborator=False,
        created_by=self_id,
        updated_by=self_id,
    )
