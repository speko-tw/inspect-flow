"""Tests for ``UserPassword.must_change_password`` and its
migration (AUT-AC33).

Same fixture pattern as ``test_auth_tables.py``: migrates the
database behind ``conftest.py``'s ``db_url`` fixture with the real
Alembic migration chain (through the public
``alembic.config``/``alembic.command`` API), then reads and writes
it exclusively through SQLAlchemy (DBF-R01). The engine under test
is always built with ``app.db.engine.create_engine_from_settings``.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import User, UserPassword
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_VALID_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$aGFzaGVkcGFzc3dvcmQ"
)


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    """Same guard ``test_auth_tables.py``/``test_migrations.py`` use:
    a stale cached shared engine must never leak between tests or
    into the real default database under ``backend/data``.
    """
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    """Migrate ``tests/db/conftest.py``'s ``db_url`` fixture to head
    and return its connection URL.
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
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def user(session) -> User:
    """A committed ``User`` row that ``UserPassword`` rows can point
    at.
    """
    u = create_root_user_with_company(session, "E910")
    session.commit()
    return u


class TestAutAc33FlagColumn:
    """AUT-AC33: ``UserPassword.must_change_password`` exists, is
    not nullable, defaults to ``false`` for a row that does not
    specify it, and rejects an explicit ``NULL`` at the database
    level (row count unchanged).
    """

    def test_column_exists_and_is_not_nullable(self, engine):
        inspector = inspect(engine)
        columns = {
            col["name"]: col for col in inspector.get_columns("user_passwords")
        }
        assert "must_change_password" in columns
        assert columns["must_change_password"]["nullable"] is False

    def test_unspecified_flag_reads_back_false(self, session, user):
        row = UserPassword(
            user_id=user.id,
            password_hash=_VALID_PASSWORD_HASH,
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(row)
        session.commit()
        session.expire(row)

        stored = session.get(UserPassword, row.id)
        assert stored.must_change_password is False

    def test_null_flag_is_rejected_by_the_database(self, session, user):
        """A plain ``def __init__`` construction never sends
        ``NULL`` for a Python-defaulted column, so a Core
        ``insert()`` is used instead -- mirrors
        ``test_user_fields.py``'s equivalent check for ``is_admin``
        etc.
        """
        before = session.query(UserPassword).count()

        with pytest.raises(IntegrityError):
            session.execute(
                insert(UserPassword).values(
                    user_id=user.id,
                    password_hash=_VALID_PASSWORD_HASH,
                    must_change_password=None,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(UserPassword).count() == before


class TestMigrationRoundTrip:
    """Migration round trip: upgrading to head, downgrading to this
    migration's explicit parent (``600b0736442e``, not the relative
    ``"-1"``), and upgrading back to head again still leaves
    ``must_change_password`` enforced as not-nullable.
    """

    def test_flag_still_enforced_after_round_trip(self, db_url):
        cfg = _alembic_config()
        command.upgrade(cfg, "head")
        command.downgrade(cfg, "600b0736442e")
        command.upgrade(cfg, "head")

        engine = create_engine_from_settings(db_url)
        try:
            inspector = inspect(engine)
            columns = {
                col["name"]: col
                for col in inspector.get_columns("user_passwords")
            }
            assert "must_change_password" in columns
            assert columns["must_change_password"]["nullable"] is False

            with Session(engine) as sess:
                user = create_root_user_with_company(sess, "E911")
                sess.commit()

                before = sess.query(UserPassword).count()
                with pytest.raises(IntegrityError):
                    sess.execute(
                        insert(UserPassword).values(
                            user_id=user.id,
                            password_hash=_VALID_PASSWORD_HASH,
                            must_change_password=None,
                            created_by=user.id,
                            updated_by=user.id,
                        )
                    )
                    sess.commit()
                sess.rollback()
                assert sess.query(UserPassword).count() == before
        finally:
            engine.dispose()
