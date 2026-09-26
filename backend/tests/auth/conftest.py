"""Shared fixtures and helpers for ``backend/tests/auth/``: a test
database (schema built directly from the ORM metadata) plus a
FastAPI ``TestClient`` wired up against that same database.

Pytest only auto-discovers a ``conftest.py``'s fixtures for test
modules in its own directory and below; ``tests/auth/`` is a
sibling of ``tests/db/``, not a descendant of it, so ``db_url`` and
the root-user helpers are re-exported here rather than duplicated
(this file, plus ``test_sessions.py``/``test_login_api.py``, is the
"needs to touch a conftest" case this task's ticket asked to be
justified: reusing ``tests/db/conftest.py``'s database-per-backend
fixture and self-referential ``User`` helpers instead of
reimplementing them).

Schema setup deliberately uses ``Base.metadata.create_all`` rather
than running the real Alembic chain the way
``tests/db/test_auth_tables.py`` does: T2 already proves the
migrations build the right schema, so this directory only needs
*some* working schema to exercise login behavior against. Running
Alembic here would also call ``alembic/env.py``'s
``fileConfig(config.config_file_name)`` (default
``disable_existing_loggers=True``), which permanently disables any
already-created logger not named in ``alembic.ini`` -- including
``app.api.errors``'s -- for the rest of the process. That is a
pre-existing landmine in shared, out-of-scope files
(``alembic/env.py``/``alembic.ini``, confirmed reproducible on
``main`` with zero changes from this task, simply by letting any
Alembic-running test execute before
``tests/contract/test_error_envelope.py::
test_unhandled_exception_does_not_log_secret_message`` in the same
process); avoiding Alembic here sidesteps it without touching those
shared files. See this task's handback report.
"""

from collections.abc import Callable, Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.auth.passwords import hash_password
from app.db.base import Base
from app.db.engine import create_engine_from_settings, dispose_engine
from app.main import create_app
from app.models import User, UserPassword
from tests.db.conftest import (  # noqa: F401 -- re-exported fixtures
    build_root_user,
    create_root_user_with_company,
    db_url,
)

DEFAULT_TEST_PASSWORD = "Sup3rSecret!"


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
def engine(db_url) -> Generator[Engine, None, None]:  # noqa: F811
    # F811 is a false positive: this parameter intentionally
    # re-requests the ``db_url`` fixture re-exported by the import
    # above (a plain pytest name-based fixture lookup), not a
    # redefinition of that import.
    eng = create_engine_from_settings(db_url)
    Base.metadata.create_all(eng)
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
    the same migrated database -- each call returns a fresh
    ``TestClient`` with its own cookie jar, for ACs that need
    several distinct logged-in clients at once (AUT-AC10, AUT-AC11).

    Uses ``https://`` so ``Secure`` cookies are actually sent back
    and forth (plan.md's "風險" section): browsers and httpx only
    transmit a ``Secure`` cookie over HTTPS (or a browser's notion
    of ``localhost``), and AUT-R12 requires this Cookie to carry
    ``Secure``.
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
    """A ``local`` ``User``, with (by default) a matching
    ``UserPassword`` row already committed -- the precondition most
    login-flow tests in this directory need.

    ``with_password=False`` builds AUT-AC06's "local account with
    no ``UserPassword`` row at all" scenario; ``password_hash``
    lets a caller (AUT-AC02) install an already-hashed value
    produced with different Argon2id parameters instead of hashing
    ``password`` with the program's current ones.
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
