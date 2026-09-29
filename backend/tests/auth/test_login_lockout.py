"""AUT-AC27, AC45-AC48, AC51-AC53: shared account lockout."""

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, inspect, select

from alembic import command
from app.auth.password_service import set_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.auth.settings import get_lockout_settings
from app.db import clock
from app.models import AuditLog, AuthSession, LoginFailure, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.auth.test_auth_logging import _assert_no_secrets, _auth_records
from tests.db.conftest import create_root_user_with_company

P = DEFAULT_TEST_PASSWORD
NEW_P = "Demo-New-Pass1"
T0 = datetime(2026, 9, 29, 0, 0, tzinfo=UTC)


@pytest.fixture
def now():
    current = [T0]
    clock.set_clock(lambda: current[0])
    try:
        yield current
    finally:
        clock.reset_clock()


def _admin(db):
    admin = create_root_user_with_company(db, "DEMO0")
    admin.is_system = True
    db.commit()
    return admin


def _login(client, user, password):
    return client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": password},
    )


def _fail(client, user, count=1):
    return [_login(client, user, "wrong-password") for _ in range(count)]


def test_ac27_ac51_lock_boundary_audit_and_log(
    client, db_session, now, caplog
):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO1")
    caplog.set_level(logging.INFO, logger="app.auth")
    failed = _fail(client, user, 10)
    assert all(r.status_code == 401 for r in failed)
    assert all(r.content == failed[0].content for r in failed)
    assert all("set-cookie" not in r.headers for r in failed)

    db_session.expire_all()
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.event_type == "user.locked")
    ).one()
    assert audit.entity_id == user.id
    assert audit.created_by == admin.id
    assert audit.after == {"locked_until": "2026-09-29T00:15:00Z"}

    locked_response = _login(client, user, P)
    assert locked_response.content == failed[0].content
    assert "set-cookie" not in locked_response.headers
    now[0] = T0 + timedelta(minutes=14)
    assert _fail(client, user)[0].content == failed[0].content
    now[0] = T0 + timedelta(minutes=15, seconds=-1)
    assert _login(client, user, P).content == failed[0].content
    assert _auth_records(caplog)[-1].reason == "locked"
    _assert_no_secrets(caplog, P, "wrong-password", user.email)
    db_session.expire_all()
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user.id).count() == 10
    )
    now[0] = T0 + timedelta(minutes=15)
    assert _login(client, user, P).status_code == 200
    db_session.expire_all()
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user.id).count() == 0
    )
    assert (
        db_session.query(AuditLog).filter_by(event_type="user.locked").count()
        == 1
    )


@pytest.mark.parametrize("offset,locked", [(899, True), (900, False)])
def test_ac45_window_boundary(client, db_session, now, offset, locked):
    _admin(db_session)
    user = make_local_user(db_session, f"DEMO{offset}")
    _fail(client, user, 9)
    now[0] = T0 + timedelta(seconds=offset)
    _fail(client, user)
    assert (_login(client, user, P).status_code == 401) is locked


def test_ac46_success_clears_failures(client, db_session, now):
    _admin(db_session)
    user = make_local_user(db_session, "DEMO2")
    for _ in range(2):
        _fail(client, user, 9)
        assert _login(client, user, P).status_code == 200
    _fail(client, user, 10)
    assert _login(client, user, P).status_code == 401


def test_ac47_shared_counter_and_locked_password_change(
    client, db_session, now
):
    _admin(db_session)
    user = make_local_user(db_session, "DEMO3")
    _row, token = create_session(db_session, user)
    db_session.commit()
    body = {"current_password": "wrong-password", "new_password": NEW_P}
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/password",
            json=body,
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert response.status_code == 400
    _fail(client, user, 5)
    assert _login(client, user, P).status_code == 401
    locked = client.post(
        "/api/v1/auth/password",
        json={"current_password": P, "new_password": NEW_P},
        cookies={SESSION_COOKIE_NAME: token},
    )
    assert locked.status_code == 400
    assert locked.content == response.content
    db_session.expire_all()
    assert (
        db_session.query(AuthSession).filter_by(user_id=user.id).count() == 1
    )
    assert (
        db_session.query(UserPassword).filter_by(user_id=user.id).count() == 1
    )


def test_ac48_settings(monkeypatch):
    names = (
        "INSPECTFLOW_LOGIN_FAILURE_THRESHOLD",
        "INSPECTFLOW_LOGIN_FAILURE_WINDOW_MINUTES",
        "INSPECTFLOW_LOGIN_LOCKOUT_MINUTES",
    )
    for name in names:
        monkeypatch.delenv(name, raising=False)
    settings = get_lockout_settings()
    assert settings.failure_threshold == 10
    assert settings.failure_window == timedelta(minutes=15)
    assert settings.lockout_duration == timedelta(minutes=15)
    for name, value in zip(names, ("4", "5", "6"), strict=True):
        monkeypatch.setenv(name, value)
    settings = get_lockout_settings()
    assert settings.failure_threshold == 4
    assert settings.failure_window == timedelta(minutes=5)
    assert settings.lockout_duration == timedelta(minutes=6)
    for name in names:
        monkeypatch.setenv(name, "")
    assert get_lockout_settings().failure_threshold == 10


def test_ac53_reset_lifts_lock_immediately(client, db_session, now):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO4")
    create_session(db_session, user)
    db_session.commit()
    _fail(client, user, 10)
    assert _login(client, user, P).status_code == 401
    set_password(db_session, user, NEW_P, is_temporary=False)
    db_session.commit()
    assert (
        db_session.query(AuthSession).filter_by(user_id=user.id).count() == 0
    )
    assert _login(client, user, NEW_P).status_code == 200
    db_session.expire_all()
    password = db_session.query(UserPassword).filter_by(user_id=user.id).one()
    assert password.updated_by == admin.id
    assert (
        db_session.query(AuthSession).filter_by(user_id=user.id).count() == 1
    )
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user.id).count() == 0
    )


def test_lockout_migration_round_trip(db_url):
    backend = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend / "alembic.ini"))
    engine = create_engine(db_url)
    try:
        command.upgrade(cfg, "c1a8e5d13f62")
        columns = {
            row["name"]
            for row in inspect(engine).get_columns("login_failures")
        }
        assert {"user_id", "failed_at", "locked_until"} <= columns
        command.downgrade(cfg, "9d2b7c6e4a10")
        assert "login_failures" not in inspect(engine).get_table_names()
        command.upgrade(cfg, "c1a8e5d13f62")
        assert "login_failures" in inspect(engine).get_table_names()
    finally:
        engine.dispose()
