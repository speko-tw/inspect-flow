"""Tests for the ``UserPassword``/``AuthSession`` migration
(AUT-AC31).

Migrates the database behind ``conftest.py``'s ``db_url`` fixture
(a temporary SQLite file by default, PostgreSQL under
``--db-backend=postgresql``) with the real Alembic migration
chain (through the public ``alembic.config``/``alembic.command``
API, as ``test_migrations.py``/``test_user_project.py`` do), then
reads and writes it exclusively through SQLAlchemy -- never
``sqlite3``/``psycopg`` directly, per DBF-R01. The engine under
test is always built with
``app.db.engine.create_engine_from_settings`` (not a bare
``sqlalchemy.create_engine``), because only that constructor wires
up the ``PRAGMA foreign_keys=ON`` connection setup the dangling
``user_id`` checks below depend on.
"""

from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import CHAR, Engine, Uuid, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import AuthSession, User, UserPassword

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

# A syntactically plausible Argon2id PHC string; T1 owns the real
# hashing scheme, this table only stores whatever string it
# produces.
_VALID_PASSWORD_HASH = (
    "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQxMjM0NTY3OA$aGFzaGVkcGFzc3dvcmQ"
)


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    """Same guard ``test_migrations.py``/``test_user_project.py``
    use: a stale cached shared engine must never leak between
    tests or into the real default database under ``backend/data``.
    """
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    """Migrate the test database from ``conftest.py``'s ``db_url``
    fixture to head and return its connection URL.
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


def _new_root_user(employee_no: str) -> User:
    """Build a ``User`` whose ``created_by``/``updated_by`` point
    at its own id, the way the first ``User`` row must be created
    (see ``test_user_project.py``'s helper of the same name).
    """
    self_id = uuid7()
    return User(
        id=self_id,
        employee_no=employee_no,
        created_by=self_id,
        updated_by=self_id,
    )


def _new_user_password(user: User) -> UserPassword:
    return UserPassword(
        user_id=user.id,
        password_hash=_VALID_PASSWORD_HASH,
        created_by=user.id,
        updated_by=user.id,
    )


def _new_auth_session(
    user: User, token_hash: str, expires_at: datetime | None = None
) -> AuthSession:
    if expires_at is None:
        expires_at = datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=8)
    return AuthSession(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=expires_at,
        created_by=user.id,
        updated_by=user.id,
    )


@pytest.fixture
def user(session) -> User:
    """A committed ``User`` row that ``UserPassword``/
    ``AuthSession`` rows can point at.
    """
    u = _new_root_user("E900")
    session.add(u)
    session.commit()
    return u


class TestAutAc31TableStructure:
    """AUT-AC31: both tables have a UUID primary key, the columns
    the spec's "資料" section defines with the right nullability
    and uniqueness, the shared audit columns, and a ``user_id``
    foreign key into ``users`` -- and ``users`` itself carries no
    password or token column.
    """

    def test_primary_key_is_uuid_on_both_tables(self, engine):
        inspector = inspect(engine)
        for table_name in ("user_passwords", "auth_sessions"):
            pk = inspector.get_pk_constraint(table_name)
            assert pk["constrained_columns"] == ["id"]

            columns = {
                col["name"]: col for col in inspector.get_columns(table_name)
            }
            id_column = columns["id"]
            assert id_column["nullable"] is False
            id_type = id_column["type"]
            # sa.Uuid reflects back as CHAR(32) on SQLite (no
            # native UUID storage type) and as a native UUID
            # elsewhere; an autoincrement primary key would
            # instead reflect as an integer type -- DBF-R07 rules
            # that out as a cross-system identity.
            assert id_type.python_type is not int
            if engine.dialect.name == "sqlite":
                assert isinstance(id_type, CHAR)
                assert id_type.length == 32
            else:
                assert isinstance(id_type, Uuid)

            model = {
                "user_passwords": UserPassword,
                "auth_sessions": AuthSession,
            }[table_name]
            assert isinstance(model.__table__.c.id.type, Uuid)

    def test_user_passwords_columns_and_constraints(self, engine):
        inspector = inspect(engine)
        columns = {
            col["name"]: col for col in inspector.get_columns("user_passwords")
        }
        assert columns["user_id"]["nullable"] is False
        assert columns["password_hash"]["nullable"] is False
        for name in (
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ):
            assert columns[name]["nullable"] is False

        unique_columns = {
            tuple(uc["column_names"])
            for uc in inspector.get_unique_constraints("user_passwords")
        }
        assert ("user_id",) in unique_columns

        references = {
            fk["constrained_columns"][0]: fk["referred_table"]
            for fk in inspector.get_foreign_keys("user_passwords")
        }
        assert references["user_id"] == "users"
        assert references["created_by"] == "users"
        assert references["updated_by"] == "users"

    def test_auth_sessions_columns_and_constraints(self, engine):
        inspector = inspect(engine)
        columns = {
            col["name"]: col for col in inspector.get_columns("auth_sessions")
        }
        assert columns["user_id"]["nullable"] is False
        assert columns["token_hash"]["nullable"] is False
        assert columns["expires_at"]["nullable"] is False
        assert "last_seen_at" in columns
        for name in (
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        ):
            assert columns[name]["nullable"] is False

        unique_columns = {
            tuple(uc["column_names"])
            for uc in inspector.get_unique_constraints("auth_sessions")
        }
        assert ("token_hash",) in unique_columns
        # user_id must NOT be unique: the same User can hold
        # several AuthSession rows at once (AUT-R11, AUT-R17).
        assert ("user_id",) not in unique_columns

        references = {
            fk["constrained_columns"][0]: fk["referred_table"]
            for fk in inspector.get_foreign_keys("auth_sessions")
        }
        assert references["user_id"] == "users"
        assert references["created_by"] == "users"
        assert references["updated_by"] == "users"

    def test_users_table_has_no_password_or_token_columns(self, engine):
        inspector = inspect(engine)
        column_names = {col["name"] for col in inspector.get_columns("users")}
        assert "password_hash" not in column_names
        assert "token_hash" not in column_names


class TestAutAc31ValidRowsCanBeInserted:
    """A ``User`` with its ``UserPassword`` and ``AuthSession`` can
    be created, setting up the rows the rejection tests below then
    try to violate.
    """

    def test_user_password_and_auth_session_can_be_created(
        self, session, user
    ):
        session.add(_new_user_password(user))
        session.add(_new_auth_session(user, "a" * 64))
        session.commit()

        assert (
            session.query(UserPassword).filter_by(user_id=user.id).count() == 1
        )
        assert (
            session.query(AuthSession).filter_by(user_id=user.id).count() == 1
        )


class TestAutAc31RejectedWrites:
    """Each of AUT-AC31's error scenarios: the database rejects the
    write with ``IntegrityError`` and the row count is unchanged.
    """

    def test_second_user_password_for_same_user_is_rejected(
        self, session, user
    ):
        session.add(_new_user_password(user))
        session.commit()

        session.add(_new_user_password(user))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = session.query(UserPassword).filter_by(user_id=user.id).count()
        assert count == 1

    def test_duplicate_token_hash_is_rejected(self, session, user):
        token_hash = "b" * 64
        session.add(_new_auth_session(user, token_hash))
        session.commit()

        session.add(_new_auth_session(user, token_hash))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        count = (
            session.query(AuthSession).filter_by(token_hash=token_hash).count()
        )
        assert count == 1

    def test_user_password_dangling_user_id_is_rejected(self, session, user):
        dangling = uuid7()
        session.add(
            UserPassword(
                user_id=dangling,
                password_hash=_VALID_PASSWORD_HASH,
                created_by=user.id,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(UserPassword).count() == 0

    def test_auth_session_dangling_user_id_is_rejected(self, session, user):
        dangling = uuid7()
        session.add(
            AuthSession(
                user_id=dangling,
                token_hash="c" * 64,
                expires_at=datetime(2026, 1, 1, tzinfo=UTC),
                created_by=user.id,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(AuthSession).count() == 0

    def test_null_password_hash_is_rejected(self, session, user):
        session.add(
            UserPassword(
                user_id=user.id,
                password_hash=None,
                created_by=user.id,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(UserPassword).count() == 0

    def test_null_token_hash_is_rejected(self, session, user):
        session.add(
            AuthSession(
                user_id=user.id,
                token_hash=None,
                expires_at=datetime(2026, 1, 1, tzinfo=UTC),
                created_by=user.id,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(AuthSession).count() == 0

    def test_null_expires_at_is_rejected(self, session, user):
        session.add(
            AuthSession(
                user_id=user.id,
                token_hash="d" * 64,
                expires_at=None,
                created_by=user.id,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(AuthSession).count() == 0

    def test_null_created_by_is_rejected_on_both_tables(self, session, user):
        session.add(
            UserPassword(
                user_id=user.id,
                password_hash=_VALID_PASSWORD_HASH,
                created_by=None,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(UserPassword).count() == 0

        session.add(
            AuthSession(
                user_id=user.id,
                token_hash="e" * 64,
                expires_at=datetime(2026, 1, 1, tzinfo=UTC),
                created_by=None,
                updated_by=user.id,
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        assert session.query(AuthSession).count() == 0
