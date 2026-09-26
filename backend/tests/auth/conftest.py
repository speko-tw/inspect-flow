"""Shared fixtures and helpers for ``backend/tests/auth/``: a
migrated test database plus a FastAPI ``TestClient`` wired up
against that same database.

Pytest only shares a ``conftest.py``'s fixtures with test modules in
its own directory and below; ``tests/auth/`` is a sibling of
``tests/db/``, so ``db_url`` and the root-user helpers are
re-exported here rather than duplicated.
"""

from collections.abc import Callable, Generator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.auth.passwords import hash_password
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import User, UserPassword
from tests.db.conftest import (  # noqa: F401 -- re-exported fixtures
    build_root_user,
    create_root_user_with_company,
    db_url,
)

DEFAULT_TEST_PASSWORD = "Sup3rSecret!"

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    """Same guard ``tests/db/test_auth_tables.py`` uses: a stale
    cached shared engine must never leak between tests or into the
    real default database under ``backend/data``.
    """
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:  # noqa: F811 -- re-requests db_url by name
    """Migrate ``tests/db/conftest.py``'s ``db_url`` fixture to
    head and return its connection URL.
    """
    command.upgrade(_alembic_config(), "head")
    return db_url


@pytest.fixture
def engine(migrated_url) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def db_session(engine) -> Generator[Session, None, None]:
    """A plain SQLAlchemy session for arranging/asserting test data
    directly, alongside whatever ``TestClient`` requests do through
    the app's own request-scoped session.
    """
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def make_client(engine) -> Callable[[], TestClient]:
    """A factory for independent ``TestClient`` "browsers" against
    the same migrated database (AUT-AC10, AUT-AC11 need several at
    once, each with its own cookie jar).

    ``https://`` so ``Secure`` cookies are sent/received at all
    (plan.md's "風險" section; AUT-R12 requires ``Secure``).
    """

    def _make() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return _make


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


def make_local_user(
    session: Session,
    employee_no: str,
    *,
    password: str = DEFAULT_TEST_PASSWORD,
    password_hash: str | None = None,
    is_active: bool = True,
    with_password: bool = True,
) -> User:
    """A ``local`` ``User`` with a matching ``UserPassword`` row
    already committed (unless ``with_password=False``, AUT-AC06's
    "no ``UserPassword`` row" scenario). ``password_hash`` lets a
    caller (AUT-AC02) install an already-hashed value instead of
    hashing ``password`` with the program's current parameters.
    """
    user = create_root_user_with_company(session, employee_no)
    user.is_active = is_active
    if with_password:
        session.add(
            UserPassword(
                user_id=user.id,
                password_hash=password_hash or hash_password(password),
                created_by=user.id,
                updated_by=user.id,
            )
        )
    session.commit()
    return user
