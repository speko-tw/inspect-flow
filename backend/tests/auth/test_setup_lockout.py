"""First-login-code lockout acceptance tests (AUT-AC59, AUT-AC60)."""

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import app.cli.init_system as init_module
import app.services.setup_codes as setup_codes
from app.auth.password_service import set_password
from app.auth.settings import (
    SETUP_FAILURE_THRESHOLD_ENV_VAR,
    SETUP_FAILURE_WINDOW_ENV_VAR,
    SETUP_LOCKOUT_DURATION_ENV_VAR,
    get_setup_lockout_settings,
)
from app.cli.init_system import run as initialize
from app.db import clock
from app.models import AuditLog, LoginCounter, SetupCode, User

_CODE_RE = re.compile(r"First-login code: ([A-Za-z0-9_-]+)")
_ADMIN_PASSWORD = "VeryStrongPassword!"
_USER_PASSWORD = "AliceVeryStrongPassword!"


def _initialize(engine) -> str:
    output: list[str] = []
    assert initialize(sessionmaker(bind=engine), output=output.append) == 0
    match = _CODE_RE.fullmatch(output[0])
    assert match is not None
    return match.group(1)


def test_aut_ac59_setup_failures_lock_independently_and_log_safely(
    client,
    engine,
    caplog,
) -> None:
    code = _initialize(engine)
    with Session(engine) as session:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one()
        user = User(
            username="alice",
            email="alice@example.test",
            name_zh="Alice",
            is_external_collaborator=False,
            created_by=admin.id,
            updated_by=admin.id,
        )
        session.add(user)
        session.flush()
        set_password(session, user, _USER_PASSWORD, is_temporary=False)
        session.commit()
        user_id = user.id
        admin_id = admin.id
        created_at = session.scalars(select(SetupCode)).one().created_at

    now = created_at + timedelta(seconds=1)
    clock.set_clock(lambda: now)
    try:
        # Five regular login failures stay on Alice's own account.
        for _ in range(5):
            response = client.post(
                "/api/v1/auth/login",
                json={
                    "login": "alice",
                    "password": "wrong password",
                },
            )
            assert response.status_code == 401

        for _ in range(10):
            response = client.post(
                "/api/v1/setup/admin-password",
                json={"code": "not-the-code", "password": _ADMIN_PASSWORD},
            )
            assert response.status_code == 401
            assert response.json() == {"error": {"code": "setup.invalid_code"}}

        with Session(engine) as session:
            row = session.scalars(select(SetupCode)).one()
            alice_counter = session.scalars(
                select(LoginCounter).where(LoginCounter.user_id == user_id)
            ).one()
            assert row.failed_attempts == 10
            assert row.locked_until == now + timedelta(minutes=15)
            assert alice_counter is not None
            assert alice_counter.failure_count == 5
            locked_audits = session.scalars(
                select(AuditLog).where(AuditLog.event_type == "user.locked")
            ).all()
            assert locked_audits == []

        locked = client.post(
            "/api/v1/setup/admin-password",
            json={"code": code, "password": _ADMIN_PASSWORD},
        )
        assert locked.status_code == 401
        assert locked.json() == response.json()
        assert "First-login code locked" in caplog.text
        assert "not-the-code" not in caplog.text
        assert code not in caplog.text

        # Five more failures during the setup-code lock remain scoped to
        # Alice's login counter and do not extend the setup lock.
        for _ in range(5):
            response = client.post(
                "/api/v1/auth/login",
                json={
                    "login": "alice",
                    "password": "wrong password",
                },
            )
            assert response.status_code == 401
        with Session(engine) as session:
            row = session.scalars(select(SetupCode)).one()
            alice_counter = session.scalars(
                select(LoginCounter).where(LoginCounter.user_id == user_id)
            ).one()
            assert row.failed_attempts == 10
            assert row.locked_until == now + timedelta(minutes=15)
            assert alice_counter.failure_count == 10

        now += timedelta(minutes=15)
        success = client.post(
            "/api/v1/setup/admin-password",
            json={"code": code, "password": _ADMIN_PASSWORD},
        )
        assert success.status_code == 204

        with Session(engine) as session:
            row = session.scalars(select(SetupCode)).one()
            alice_counter = session.scalars(
                select(LoginCounter).where(LoginCounter.user_id == user_id)
            ).one()
            admin_counter = session.scalars(
                select(LoginCounter).where(LoginCounter.user_id == admin_id)
            ).one_or_none()
            assert row.failed_attempts == 0
            assert row.failure_window_started_at is None
            assert row.locked_until is None
            assert alice_counter is not None
            assert alice_counter.failure_count == 10
            assert admin_counter is None or admin_counter.failure_count == 0
            login_lock_audit = session.scalars(
                select(AuditLog).where(AuditLog.event_type == "user.locked")
            ).one()
            assert login_lock_audit.entity_id == user_id
            assert login_lock_audit.created_by == admin_id
    finally:
        clock.reset_clock()


def test_setup_failure_window_expires_after_fifteen_minutes(client, engine):
    _initialize(engine)
    with Session(engine) as session:
        row = session.scalars(select(SetupCode)).one()
        start = row.created_at + timedelta(seconds=1)

    now = start
    clock.set_clock(lambda: now)
    try:
        for _ in range(9):
            response = client.post(
                "/api/v1/setup/admin-password",
                json={"code": "wrong-code", "password": _ADMIN_PASSWORD},
            )
            assert response.status_code == 401

        now = start + timedelta(minutes=15)
        response = client.post(
            "/api/v1/setup/admin-password",
            json={"code": "wrong-code", "password": _ADMIN_PASSWORD},
        )
        assert response.status_code == 401

        with Session(engine) as session:
            row = session.scalars(select(SetupCode)).one()
            assert row.failed_attempts == 1
            assert row.failure_window_started_at == now
            assert row.locked_until is None
    finally:
        clock.reset_clock()


@pytest.mark.parametrize("state", ["missing", "expired", "locked"])
def test_hidden_setup_code_states_verify_a_dummy_hash(
    state, engine, monkeypatch
) -> None:
    _initialize(engine)
    with Session(engine) as session:
        row = session.scalars(select(SetupCode)).one()
        if state == "missing":
            row.voided_at = row.created_at
            now = row.created_at + timedelta(seconds=1)
        elif state == "expired":
            now = row.expires_at
        else:
            now = row.created_at + timedelta(seconds=1)
            row.locked_until = now + timedelta(minutes=15)
        session.commit()

    real_verify = setup_codes.verify_password
    verified_hashes: list[str] = []

    def recording_verify(password_hash: str, plaintext: str) -> bool:
        verified_hashes.append(password_hash)
        return real_verify(password_hash, plaintext)

    monkeypatch.setattr(setup_codes, "verify_password", recording_verify)
    clock.set_clock(lambda: now)
    try:
        with Session(engine) as session:
            assert setup_codes.verify_setup_code(session, "submitted") is None
        assert verified_hashes == [setup_codes._DUMMY_CODE_HASH]
    finally:
        clock.reset_clock()


def test_aut_ac60_rerun_issues_unlocked_code(engine) -> None:
    session_factory = sessionmaker(bind=engine)
    output: list[str] = []
    assert initialize(session_factory, output=output.append) == 0
    first_code = _CODE_RE.fullmatch(output[0])
    assert first_code is not None

    with session_factory() as session:
        old = session.scalars(select(SetupCode)).one()
        old.failed_attempts = 10
        old.locked_until = old.created_at + timedelta(minutes=15)
        session.commit()

    new_output: list[str] = []
    assert initialize(session_factory, output=new_output.append) == 0
    new_code = _CODE_RE.fullmatch(new_output[0])
    assert new_code is not None
    assert new_code.group(1) != first_code.group(1)

    with session_factory() as session:
        rows = session.scalars(
            select(SetupCode).order_by(SetupCode.created_at)
        ).all()
        assert rows[0].voided_at is not None
        assert rows[1].failed_attempts == 0
        assert rows[1].locked_until is None


def test_setup_lockout_settings_allow_environment_overrides(
    monkeypatch,
) -> None:
    monkeypatch.setenv(SETUP_FAILURE_THRESHOLD_ENV_VAR, "7")
    monkeypatch.setenv(SETUP_FAILURE_WINDOW_ENV_VAR, "9")
    monkeypatch.setenv(SETUP_LOCKOUT_DURATION_ENV_VAR, "11")
    assert get_setup_lockout_settings().failure_threshold == 7
    assert get_setup_lockout_settings().failure_window == timedelta(minutes=9)
    assert get_setup_lockout_settings().lockout_duration == timedelta(
        minutes=11
    )

    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    env_example = (repo_root / ".env.example").read_text(encoding="utf-8")
    assert SETUP_FAILURE_THRESHOLD_ENV_VAR in env_example
    assert SETUP_FAILURE_WINDOW_ENV_VAR in env_example
    assert SETUP_LOCKOUT_DURATION_ENV_VAR in env_example


def test_concurrent_initialization_keeps_one_active_code_on_sqlite(
    engine, monkeypatch
) -> None:
    _initialize(engine)
    factory = sessionmaker(bind=engine)
    barrier = Barrier(2)
    initialize_system = init_module.initialize_system

    def synchronized_initialize(session: Session) -> tuple[User, str]:
        barrier.wait(timeout=10)
        return initialize_system(session)

    monkeypatch.setattr(
        init_module, "initialize_system", synchronized_initialize
    )

    def initialize_concurrently() -> int:
        return initialize(factory, output=lambda _line: None)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(lambda _index: initialize_concurrently(), range(2))
        )

    assert results == [0, 0]
    with Session(engine) as session:
        active_codes = session.scalars(
            select(SetupCode).where(SetupCode.voided_at.is_(None))
        ).all()
        assert len(active_codes) == 1
