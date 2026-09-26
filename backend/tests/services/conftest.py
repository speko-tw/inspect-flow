"""Shared fixtures for ``backend/tests/services/``.

Builds a temporary SQLite database migrated to head through the
real Alembic chain -- same approach as ``backend/tests/db/
conftest.py``'s ``db_url``/``migrated_url``/``engine``/``session``
fixtures -- so the Service-layer entry points under test run
against real foreign keys, unique constraints and ``NOT NULL``
columns rather than a mock. Unlike ``tests/db/conftest.py``, this
does not wire up the ``--db-backend`` option: ``make check-postgres``
only runs ``tests/db`` (Makefile), and these tests exercise Service
logic, not backend-specific schema behavior.

``create_root_user_with_company``/``build_root_user`` (imported
from ``tests.db.conftest``, a plain module import -- not fixture
inheritance) build the "root" ``User``/``Company`` pair each test
here turns into a Service-layer operator by setting ``is_system =
True`` on it, matching ``test_company.py``'s existing use of the
same helpers.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from app.models import User
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv(DATABASE_URL_ENV_VAR, url)
    return url


@pytest.fixture
def migrated_url(db_url: str) -> str:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    return db_url


@pytest.fixture
def engine(migrated_url: str) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def operator(session: Session) -> User:
    """A ``User`` with ``is_system = True``, the row
    :func:`app.services.operator.get_current_operator` (DOM-R14)
    resolves to before ``authentication`` exists. Built on top of
    ``create_root_user_with_company`` (its own throwaway
    ``Company``) purely to get a valid self-referential ``User``
    row satisfying ``company_id``'s ``NOT NULL`` requirement -- that
    company is otherwise unrelated to the ``Company``/``User`` rows
    each test creates through the Service layer.
    """
    user = create_root_user_with_company(session, "OPR001")
    user.is_system = True
    session.flush()
    return user
