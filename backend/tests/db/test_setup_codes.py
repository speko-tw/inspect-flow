"""Tests for the ``SetupCode`` table (AUT-AC31, ``SetupCode`` part).

The ``UserPassword``/``AuthSession`` part of AUT-AC31 lives in
``test_auth_tables.py``. Same fixture pattern: migrate the ``db_url``
database with the real Alembic chain, then read and write it only
through SQLAlchemy.
"""

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import CHAR, Engine, Uuid, insert, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import SetupCode, User
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$aGFzaGVkY29kZQ"
_EXPIRES = datetime(2026, 1, 2, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def engine(db_url) -> Generator[Engine, None, None]:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    eng = create_engine_from_settings(db_url)
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
    user = create_root_user_with_company(session, "SC0001")
    session.commit()
    return user


class TestAutAc31SetupCodeStructure:
    """AUT-AC31: ``setup_codes`` has a UUID primary key, the columns
    the authentication spec lists with the right nullability, and the
    shared audit columns.
    """

    def test_primary_key_is_uuid(self, engine):
        inspector = inspect(engine)
        assert inspector.get_pk_constraint("setup_codes")[
            "constrained_columns"
        ] == ["id"]

        columns = {c["name"]: c for c in inspector.get_columns("setup_codes")}
        id_type = columns["id"]["type"]
        assert columns["id"]["nullable"] is False
        if engine.dialect.name == "sqlite":
            assert isinstance(id_type, CHAR)
            assert id_type.length == 32
        else:
            assert isinstance(id_type, Uuid)

    def test_columns_and_nullability(self, engine):
        columns = {
            c["name"]: c for c in inspect(engine).get_columns("setup_codes")
        }
        assert set(columns) == {
            "id",
            "code_hash",
            "expires_at",
            "voided_at",
            "failed_attempts",
            "failure_window_started_at",
            "locked_until",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        }
        for name in (
            "code_hash",
            "expires_at",
            "failed_attempts",
            "created_by",
            "updated_by",
        ):
            assert columns[name]["nullable"] is False, name
        for name in ("voided_at", "failure_window_started_at", "locked_until"):
            assert columns[name]["nullable"] is True, name
        assert columns["failed_attempts"]["type"].python_type is int

    def test_audit_columns_reference_users(self, engine):
        references = {
            fk["constrained_columns"][0]: fk["referred_table"]
            for fk in inspect(engine).get_foreign_keys("setup_codes")
        }
        assert references == {"created_by": "users", "updated_by": "users"}


class TestAutAc31SetupCodeRows:
    def test_row_without_failed_attempts_reads_back_zero(self, session, user):
        code = SetupCode(
            code_hash=_HASH,
            expires_at=_EXPIRES,
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(code)
        session.commit()
        session.expire(code)

        stored = session.get(SetupCode, code.id)
        assert stored.failed_attempts == 0
        assert stored.voided_at is None
        assert stored.failure_window_started_at is None
        assert stored.locked_until is None

    def test_failed_attempts_default_also_applies_to_core_inserts(
        self, session, user
    ):
        """The default is a ``server_default`` too, so a statement
        that does not go through the ORM still gets 0.
        """
        new_id = uuid7()
        session.execute(
            insert(SetupCode).values(
                id=new_id,
                code_hash=_HASH,
                expires_at=_EXPIRES,
                created_at=_EXPIRES,
                updated_at=_EXPIRES,
                created_by=user.id,
                updated_by=user.id,
            )
        )
        session.commit()

        assert session.get(SetupCode, new_id).failed_attempts == 0

    @pytest.mark.parametrize(
        "field", ["code_hash", "expires_at", "created_by"]
    )
    def test_null_required_field_is_rejected(self, session, user, field):
        kwargs = {
            "code_hash": _HASH,
            "expires_at": _EXPIRES,
            "created_by": user.id,
            "updated_by": user.id,
        }
        kwargs[field] = None
        session.add(SetupCode(**kwargs))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(SetupCode).count() == 0

    def test_null_failed_attempts_is_rejected_by_the_database(
        self, session, user
    ):
        # Core ``insert`` sends an explicit NULL; the ORM would apply
        # the column default instead.
        with pytest.raises(IntegrityError):
            session.execute(
                insert(SetupCode).values(
                    id=uuid7(),
                    code_hash=_HASH,
                    expires_at=_EXPIRES,
                    failed_attempts=None,
                    created_at=_EXPIRES,
                    updated_at=_EXPIRES,
                    created_by=user.id,
                    updated_by=user.id,
                )
            )
            session.commit()
        session.rollback()

        assert session.query(SetupCode).count() == 0

    def test_dangling_created_by_is_rejected(self, session, user):
        session.add(
            SetupCode(
                code_hash=_HASH,
                expires_at=_EXPIRES,
                created_by=uuid7(),
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(SetupCode).count() == 0
