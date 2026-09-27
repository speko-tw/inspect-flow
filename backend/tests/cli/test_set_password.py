"""Tests for the set-password command (AUT-AC04, AUT-AC23~AUT-AC25,
AUT-AC32).

Builds a temporary SQLite database migrated to head through the
real Alembic chain, matching ``backend/tests/cli/test_init_system.py``'s
approach. ``initialized`` seeds it exactly like ``make init`` would:
one company, the built-in ``admin`` (``is_system``) and the owner's
personal account, both ``auth_source = local``. All test data below
uses demo values (``demo-corp.example``, ``demo`` account names) --
never a real company or person.

Most tests call :func:`run` directly with an injected
``password_reader`` (mirroring ``test_init_system.py``'s injected
``input_fn``), against the process's shared engine (the same one
``app.auth.dependencies.get_db`` uses), so a ``fastapi.testclient.
TestClient`` built in the same test sees the same data (AUT-AC23,
AUT-AC32). AUT-AC25 alone needs a real subprocess: it asserts on
``--help``'s actual argument parsing and on an unrecognized
``--password`` option, neither of which a direct Python call can
exercise.
"""

import os
import subprocess
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import select

from alembic import command
from app.auth.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    verify_password,
)
from app.cli.init_system import AccountInput, CompanyInput, initialize_system
from app.cli.set_password import PasswordReader, run
from app.db.engine import dispose_engine, get_session_factory
from app.db.settings import DATABASE_URL_ENV_VAR
from app.main import create_app
from app.models import AuthSession, User, UserPassword

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_ADMIN_EMAIL = "admin@demo-corp.example"
_OWNER_EMAIL = "owner@demo-corp.example"
_EXTERNAL_EMAIL = "external-user@demo-corp.example"

_VALID_PASSWORD = "Demo-Pass1"


@pytest.fixture(autouse=True)
def _dispose_shared_engine():
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
def initialized(migrated_url: str) -> None:
    """Seed the migrated database like ``make init`` would: one
    company, the built-in ``admin`` (``is_system``, AUT-AC32) and
    the owner's personal account (AUT-AC23), both
    ``auth_source = local``. Uses the process's shared engine (no
    ``session_factory`` override) so it is visible to both
    :func:`run` and any ``TestClient`` a test builds afterwards.
    """
    session_factory = get_session_factory()
    with session_factory() as session:
        initialize_system(
            session,
            company=CompanyInput(code="DEMO", name="示範公司"),
            admin=AccountInput(
                department="IT",
                location="HQ",
                employee_no="D0001",
                name_en="System Admin",
                name_zh="系統管理員",
                email=_ADMIN_EMAIL,
            ),
            owner=AccountInput(
                department="Management",
                location="HQ",
                employee_no="D0002",
                name_en="Demo Owner",
                name_zh="示範負責人",
                email=_OWNER_EMAIL,
            ),
        )
        session.commit()


def _add_external_user(company_id, admin_id) -> None:
    """A second ``auth_source = external`` account (AUT-AC24), in
    the same company as the seeded accounts.
    """
    session_factory = get_session_factory()
    with session_factory() as session:
        session.add(
            User(
                company_id=company_id,
                department="IT",
                location="HQ",
                employee_no="D0003",
                name_en="External Demo User",
                name_zh="示範外部使用者",
                email=_EXTERNAL_EMAIL,
                auth_source="external",
                external_source="ldap",
                external_id="ext-demo-1",
                created_by=admin_id,
                updated_by=admin_id,
            )
        )
        session.commit()


def _get_user(email: str) -> User:
    with get_session_factory()() as session:
        return session.scalars(select(User).where(User.email == email)).one()


def _get_user_password(user_id) -> UserPassword | None:
    with get_session_factory()() as session:
        return session.scalars(
            select(UserPassword).where(UserPassword.user_id == user_id)
        ).one_or_none()


def _count_user_passwords() -> int:
    with get_session_factory()() as session:
        return len(session.scalars(select(UserPassword)).all())


def _fixed_reader(first: str, second: str | None = None) -> PasswordReader:
    if second is None:
        second = first

    def _reader() -> tuple[str, str]:
        return first, second

    return _reader


def _no_input_reader() -> None:
    return None


def _make_client() -> TestClient:
    return TestClient(create_app(), base_url="https://testserver")


class TestAutAc04LengthRule:
    """AUT-AC04: five password lengths against one local account --
    8, 128 (with CJK characters, so its UTF-8 encoding exceeds 128
    bytes even though its code-point count is exactly 128) and a
    12-character lowercase-only password succeed; 7 and 129 (ASCII)
    characters fail, leaving ``UserPassword`` unchanged.
    """

    def test_boundary_and_composition_cases(self, initialized: None):
        owner = _get_user(_OWNER_EMAIL)

        # 7 characters: too short, fails, nothing written yet.
        exit_code = run(
            [_OWNER_EMAIL], password_reader=_fixed_reader("abcdefg")
        )
        assert exit_code == 1
        assert _get_user_password(owner.id) is None

        # 8 characters: minimum valid length, succeeds.
        exit_code = run(
            [_OWNER_EMAIL], password_reader=_fixed_reader("abcd1234")
        )
        assert exit_code == 0
        assert MIN_PASSWORD_LENGTH == 8
        row = _get_user_password(owner.id)
        assert row is not None
        assert verify_password(row.password_hash, "abcd1234")

        # 128 code points, all CJK (well over 128 UTF-8 bytes):
        # succeeds, since the rule counts code points.
        long_cjk_password = "密" * 128
        assert len(long_cjk_password) == 128
        assert len(long_cjk_password.encode("utf-8")) > 128
        exit_code = run(
            [_OWNER_EMAIL], password_reader=_fixed_reader(long_cjk_password)
        )
        assert exit_code == 0
        assert MAX_PASSWORD_LENGTH == 128
        row = _get_user_password(owner.id)
        assert row is not None
        assert verify_password(row.password_hash, long_cjk_password)
        unchanged_hash = row.password_hash

        # 129 ASCII characters: one over the limit, fails, the
        # previous (128-character) hash is left in place.
        exit_code = run(
            [_OWNER_EMAIL], password_reader=_fixed_reader("a" * 129)
        )
        assert exit_code == 1
        row = _get_user_password(owner.id)
        assert row is not None
        assert row.password_hash == unchanged_hash

        # 12 characters, lowercase letters only: no character
        # composition rule is enforced, so this succeeds too.
        exit_code = run(
            [_OWNER_EMAIL],
            password_reader=_fixed_reader("abcdefghijkl"),
        )
        assert exit_code == 0
        row = _get_user_password(owner.id)
        assert row is not None
        assert verify_password(row.password_hash, "abcdefghijkl")


class TestAutAc23SetPasswordInvalidatesSessionsAndLogsIn:
    """AUT-AC23: the owner's account already has a password and a
    logged-in client; setting a new password invalidates that
    client's session (AUT-R25) and the new password can log in.
    ``created_by``/``updated_by`` on the resulting row is the
    built-in ``admin`` (AUT-R26).
    """

    def test_old_session_dies_and_new_password_logs_in(
        self, initialized: None
    ):
        admin = _get_user(_ADMIN_EMAIL)
        owner = _get_user(_OWNER_EMAIL)

        # Give the owner an initial password directly (this task's
        # own command has not run yet) and log in with it.
        first_exit_code = run(
            [_OWNER_EMAIL],
            password_reader=_fixed_reader(_VALID_PASSWORD),
        )
        assert first_exit_code == 0

        old_client = _make_client()
        login_resp = old_client.post(
            "/api/v1/auth/login",
            json={"email": _OWNER_EMAIL, "password": _VALID_PASSWORD},
        )
        assert login_resp.status_code == 200
        assert old_client.get("/api/v1/auth/me").status_code == 200

        new_password = "Demo-Pass2"
        exit_code = run(
            [_OWNER_EMAIL], password_reader=_fixed_reader(new_password)
        )
        assert exit_code == 0

        row = _get_user_password(owner.id)
        assert row is not None
        assert verify_password(row.password_hash, new_password)
        assert row.created_by == admin.id
        assert row.updated_by == admin.id

        with get_session_factory()() as session:
            remaining = session.scalars(
                select(AuthSession).where(AuthSession.user_id == owner.id)
            ).all()
            assert remaining == []

        assert old_client.get("/api/v1/auth/me").status_code == 401

        new_client = _make_client()
        new_login = new_client.post(
            "/api/v1/auth/login",
            json={"email": _OWNER_EMAIL, "password": new_password},
        )
        assert new_login.status_code == 200


class TestAutAc24RejectedInputsWriteNothing:
    """AUT-AC24: an unknown email, an ``external`` account, and
    mismatched entries all fail, leaving ``UserPassword`` untouched.
    """

    def test_unknown_email_fails(self, initialized: None):
        exit_code = run(
            ["nobody@demo-corp.example"],
            password_reader=_fixed_reader(_VALID_PASSWORD),
        )
        assert exit_code == 1
        assert _count_user_passwords() == 0

    def test_external_account_fails(self, initialized: None):
        owner = _get_user(_OWNER_EMAIL)
        _add_external_user(owner.company_id, owner.id)

        exit_code = run(
            [_EXTERNAL_EMAIL],
            password_reader=_fixed_reader(_VALID_PASSWORD),
        )
        assert exit_code == 1
        assert _count_user_passwords() == 0

    def test_mismatched_entries_fail(self, initialized: None):
        exit_code = run(
            [_OWNER_EMAIL],
            password_reader=_fixed_reader("Demo-Pass1", "Demo-Pass2"),
        )
        assert exit_code == 1
        assert _count_user_passwords() == 0


class TestAutAc25NoPasswordOnTheCommandLineOrEnvironment:
    """AUT-AC25: ``--help`` shows no password-accepting option;
    empty standard input fails without reading either
    ``INSPECTFLOW_PASSWORD`` or ``PASSWORD``; ``--password`` fails
    as an unrecognized argument. Run as real subprocesses -- these
    assert on argparse's own behavior and on ``sys.stdin.isatty()``
    being false for a piped child process, neither of which a
    direct Python call exercises.
    """

    def _run_cli(
        self, *args: str, stdin_input: str
    ) -> subprocess.CompletedProcess:
        env = dict(os.environ)
        env["INSPECTFLOW_PASSWORD"] = _VALID_PASSWORD
        env["PASSWORD"] = _VALID_PASSWORD
        return subprocess.run(
            [
                "uv",
                "run",
                "--locked",
                "python",
                "-m",
                "app.cli.set_password",
                *args,
            ],
            cwd=_BACKEND_DIR,
            env=env,
            input=stdin_input,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_help_defines_no_password_option(self, initialized: None):
        result = self._run_cli("--help", stdin_input="")
        assert result.returncode == 0
        assert "--password" not in result.stdout
        assert "PASSWORD" not in result.stdout
        assert "INSPECTFLOW_PASSWORD" not in result.stdout

    def test_empty_stdin_fails_without_using_env_vars(self, initialized: None):
        result = self._run_cli(_OWNER_EMAIL, stdin_input="")
        assert result.returncode != 0
        assert _count_user_passwords() == 0

    def test_password_option_is_unrecognized(self, initialized: None):
        result = self._run_cli(
            _OWNER_EMAIL,
            "--password",
            _VALID_PASSWORD,
            stdin_input=f"{_VALID_PASSWORD}\n{_VALID_PASSWORD}\n",
        )
        assert result.returncode != 0
        assert "unrecognized" in (result.stdout + result.stderr).lower()
        assert _count_user_passwords() == 0


class TestAutAc32BuiltinAdminCanSetPasswordAndLogIn:
    """AUT-AC32: the built-in ``admin`` has no password yet; setting
    one succeeds, and logging in with it returns 200 and
    ``is_admin: true``.
    """

    def test_builtin_admin_sets_password_and_logs_in(self, initialized: None):
        admin = _get_user(_ADMIN_EMAIL)
        assert admin.is_system is True

        exit_code = run(
            [_ADMIN_EMAIL], password_reader=_fixed_reader(_VALID_PASSWORD)
        )
        assert exit_code == 0

        row = _get_user_password(admin.id)
        assert row is not None
        assert verify_password(row.password_hash, _VALID_PASSWORD)

        client = _make_client()
        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": _ADMIN_EMAIL, "password": _VALID_PASSWORD},
        )
        assert login_resp.status_code == 200
        body = login_resp.json()
        assert body["id"] == str(admin.id)
        assert body["is_admin"] is True
