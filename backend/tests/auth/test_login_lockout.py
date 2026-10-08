"""AUT-AC27, AC45-AC48, AC51-AC53: shared account lockout."""

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import QueuePool

from alembic import command
from app.api.errors import APIError, ErrorCode
from app.api.v1 import auth as auth_api
from app.auth import lockout as lockout_module
from app.auth import login as login_module
from app.auth.dependencies import get_db
from app.auth.password_service import set_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.auth.settings import get_lockout_settings
from app.db import clock
from app.db.engine import get_engine
from app.main import create_app
from app.models import (
    AuditLog,
    AuthSession,
    LoginCounter,
    LoginFailure,
    UserPassword,
)
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.auth.test_auth_logging import _assert_no_secrets, _auth_records
from tests.db.conftest import create_root_user_with_company, make_system_admin

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
    make_system_admin(admin)
    db.commit()
    return admin


def _login(client, user, password):
    return client.post(
        "/api/v1/auth/login",
        json={"login": user.email, "password": password},
    )


def _fail(client, user, count=1):
    return [_login(client, user, "wrong-password") for _ in range(count)]


def _read_busy_timeout():
    with get_engine().connect() as connection:
        return connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()


# The tests below set a 50 ms busy timeout; the default is 5000 ms. A
# request that returns within this bound waited for the configured short
# timeout, not the default one. The bound is a loose cap (about 40x the
# configured value) so CI load cannot trip it, instead of comparing two
# short wall-clock durations against each other.
_SHORT_BUSY_TIMEOUT_CAP_SECONDS = 2.0


def _assert_returned_within_short_timeout(durations):
    assert max(durations) < _SHORT_BUSY_TIMEOUT_CAP_SECONDS, durations


def test_sqlite_write_lock_timeout_returns_retryable_error(
    client, db_session, engine, monkeypatch, caplog
):
    _admin(db_session)
    user = make_local_user(db_session, "DEMO_LOCK")
    user_id, email = user.id, user.email
    assert email is not None
    original_busy_timeout = _read_busy_timeout()
    monkeypatch.setenv("INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS", "50")
    caplog.set_level(logging.INFO, logger="app.auth")

    with engine.connect() as holder:
        holder.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            responses = []
            durations = []
            for login, password in (
                (email, "wrong-password"),
                (email, P),
                ("missing-user", "wrong-password"),
            ):
                started = time.monotonic()
                response = client.post(
                    "/api/v1/auth/login",
                    json={"login": login, "password": password},
                )
                durations.append(time.monotonic() - started)
                responses.append(response)
                assert response.status_code == 503
                assert response.json() == {
                    "error": {"code": ErrorCode.SERVER_TEMPORARILY_UNAVAILABLE}
                }
                assert response.headers["retry-after"] == "5"
                assert "set-cookie" not in response.headers
                assert _read_busy_timeout() == original_busy_timeout
            _assert_returned_within_short_timeout(durations)
            assert responses[0].content == responses[1].content
            assert responses[1].content == responses[2].content
            assert not any(
                getattr(record, "event", None) == "auth.login_failed"
                for record in caplog.records
            )
        finally:
            holder.rollback()

    warnings = [
        record
        for record in caplog.records
        if record.levelno == logging.WARNING
    ]
    assert len(warnings) == 3
    assert all(
        record.event == "auth.lockout_write_timeout"
        and record.reason == "sqlite_lock_timeout"
        and "user_id" not in record.__dict__
        for record in warnings
    )
    _assert_no_secrets(caplog, P, "wrong-password", email)

    db_session.rollback()
    assert (
        db_session.scalar(
            select(LoginCounter).where(LoginCounter.user_id == user_id)
        )
        is None
    )
    assert (
        db_session.query(AuthSession).filter_by(user_id=user_id).count() == 0
    )
    db_session.rollback()
    unknown = client.post(
        "/api/v1/auth/login",
        json={"login": "missing-user", "password": "wrong-password"},
    )
    assert unknown.status_code == 401
    assert any(
        getattr(record, "event", None) == "auth.login_failed"
        and record.user_id is None
        for record in caplog.records
    )
    assert _read_busy_timeout() == original_busy_timeout
    db_session.rollback()
    assert _login(client, user, "wrong-password").status_code == 401
    assert _read_busy_timeout() == original_busy_timeout
    db_session.rollback()
    counter = db_session.scalar(
        select(LoginCounter).where(LoginCounter.user_id == user_id)
    )
    assert counter is not None and counter.failure_count == 1
    db_session.rollback()
    assert _login(client, user, P).status_code == 200
    assert _read_busy_timeout() == original_busy_timeout


def test_locked_account_and_unknown_login_share_sqlite_timeout(
    client, db_session, engine, now, monkeypatch, caplog
):
    _admin(db_session)
    user = make_local_user(db_session, "DEMO_LOCKED")
    assert user.email is not None
    db_session.add(
        LoginCounter(
            user_id=user.id,
            failure_count=10,
            locked_until=now[0] + timedelta(minutes=15),
        )
    )
    db_session.commit()
    monkeypatch.setenv("INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS", "50")
    caplog.set_level(logging.INFO, logger="app.auth")

    with engine.connect() as holder:
        holder.exec_driver_sql("BEGIN IMMEDIATE")
        try:
            responses = []
            durations = []
            for login, password in (
                (user.email, P),
                ("missing-user", "wrong-password"),
            ):
                started = time.monotonic()
                response = client.post(
                    "/api/v1/auth/login",
                    json={"login": login, "password": password},
                )
                durations.append(time.monotonic() - started)
                responses.append(response)
            assert all(response.status_code == 503 for response in responses)
            assert responses[0].content == responses[1].content
            _assert_returned_within_short_timeout(durations)
            assert all(
                response.headers["retry-after"] == "5"
                for response in responses
            )
            assert all(
                "set-cookie" not in response.headers for response in responses
            )
            assert not any(
                getattr(record, "event", None) == "auth.login_failed"
                for record in caplog.records
            )
        finally:
            holder.rollback()

    locked = _login(client, user, P)
    unknown = client.post(
        "/api/v1/auth/login",
        json={"login": "missing-user", "password": "wrong-password"},
    )
    assert locked.status_code == unknown.status_code == 401
    assert locked.content == unknown.content
    failures = [
        record
        for record in caplog.records
        if getattr(record, "event", None) == "auth.login_failed"
    ]
    assert len(failures) == 2
    assert {record.reason for record in failures} == {
        "locked",
        "invalid_credentials",
    }


def test_non_lock_sqlite_operational_error_is_not_converted(
    db_session, monkeypatch
):
    class OtherSQLiteError(Exception):
        sqlite_errorname = "SQLITE_IOERR"

    expected = OperationalError("upsert", {}, OtherSQLiteError())
    connection = db_session.connection()
    original_busy_timeout = connection.exec_driver_sql(
        "PRAGMA busy_timeout"
    ).scalar_one()

    def fail_execute(_statement):
        raise expected

    monkeypatch.setattr(db_session, "execute", fail_execute)
    with pytest.raises(OperationalError) as caught:
        lockout_module._serialize_account(db_session, uuid.uuid4())
    assert caught.value is expected
    assert (
        connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
        == original_busy_timeout
    )


@pytest.mark.parametrize("outcome", ["success", "busy", "other_error"])
def test_sqlite_timeout_restores_all_queue_pool_connections(
    tmp_path, monkeypatch, outcome
):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'busy-timeout-pool.db'}",
        poolclass=QueuePool,
        pool_size=3,
        max_overflow=0,
    )
    monkeypatch.setenv("INSPECTFLOW_SQLITE_BUSY_TIMEOUT_MS", "50")
    connections = [engine.connect() for _ in range(3)]
    for connection in connections:
        connection.exec_driver_sql("PRAGMA busy_timeout=123")
        connection.commit()
    connections[0].exec_driver_sql("CREATE TABLE writes (id integer)")
    connections[0].commit()
    if outcome == "busy":
        connections[0].exec_driver_sql("BEGIN IMMEDIATE")
    connections[1].close()
    connections[2].close()

    try:
        with Session(engine) as session:
            connection = session.connection()

            def write() -> None:
                assert (
                    connection.exec_driver_sql(
                        "PRAGMA busy_timeout"
                    ).scalar_one()
                    == 50
                )
                if outcome == "other_error":

                    class OtherSQLiteError(Exception):
                        sqlite_errorname = "SQLITE_IOERR"

                    raise OperationalError("write", {}, OtherSQLiteError())
                session.execute(text("INSERT INTO writes VALUES (1)"))

            if outcome == "busy":
                with pytest.raises(APIError) as caught:
                    lockout_module._execute_sqlite_write(session, write)
                assert caught.value.status_code == 503
            elif outcome == "other_error":
                with pytest.raises(OperationalError):
                    lockout_module._execute_sqlite_write(session, write)
            else:
                lockout_module._execute_sqlite_write(session, write)

        with engine.connect() as first_idle, engine.connect() as second_idle:
            assert (
                first_idle.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
                == 123
            )
            assert (
                second_idle.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
                == 123
            )
    finally:
        if outcome == "busy":
            connections[0].rollback()
        connections[0].close()
        engine.dispose()


def test_ac27_ac51_lock_boundary_audit_and_log(
    client, db_session, now, caplog
):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO1")
    assert user.email is not None
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


def test_username_and_email_share_lockout_counter(client, db_session, now):
    _admin(db_session)
    user = make_local_user(db_session, "DEMO6")
    assert user.email is not None
    login_values = (user.username, user.email)

    failures = [
        client.post(
            "/api/v1/auth/login",
            json={"login": login, "password": "wrong-password"},
        )
        for login in login_values
        for _ in range(5)
    ]
    assert all(response.status_code == 401 for response in failures)
    assert all(
        response.content == failures[0].content for response in failures
    )
    assert failures[0].json()["error"]["code"] == "auth.invalid_credentials"

    for login in login_values:
        locked = client.post(
            "/api/v1/auth/login",
            json={"login": login, "password": P},
        )
        assert locked.status_code == 401
        assert locked.content == failures[0].content
        assert "set-cookie" not in locked.headers

    db_session.expire_all()
    counter = db_session.query(LoginCounter).filter_by(user_id=user.id).one()
    assert counter.failure_count == 10
    assert counter.locked_until == T0 + timedelta(minutes=15)
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user.id).count() == 10
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
        failure_columns = {
            row["name"]
            for row in inspect(engine).get_columns("login_failures")
        }
        counter_columns = {
            row["name"]
            for row in inspect(engine).get_columns("login_counters")
        }
        assert {"user_id", "failed_at"} <= failure_columns
        assert {"user_id", "failure_count", "locked_until"} <= (
            counter_columns
        )
        command.downgrade(cfg, "9d2b7c6e4a10")
        assert "login_failures" not in inspect(engine).get_table_names()
        assert "login_counters" not in inspect(engine).get_table_names()
        command.upgrade(cfg, "c1a8e5d13f62")
        assert "login_failures" in inspect(engine).get_table_names()
        assert "login_counters" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_concurrent_failures_count_once_and_audit_once(
    make_client, db_session, now, monkeypatch
):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO5")
    email, user_id = user.email, user.id
    barrier = threading.Barrier(5)
    actual_record = login_module.record_failure

    def synchronized_record(db, target_id):
        barrier.wait(timeout=15)
        actual_record(db, target_id)

    monkeypatch.setattr(login_module, "record_failure", synchronized_record)

    def send_two_failures():
        client = make_client()
        barrier_results = []
        for _ in range(2):
            response = client.post(
                "/api/v1/auth/login",
                json={"login": email, "password": "wrong-password"},
            )
            barrier_results.append(response.status_code)
        return barrier_results

    with ThreadPoolExecutor(max_workers=5) as pool:
        results = list(pool.map(lambda _: send_two_failures(), range(5)))
    assert results == [[401, 401]] * 5
    db_session.rollback()
    counter = db_session.query(LoginCounter).filter_by(user_id=user_id).one()
    assert counter.failure_count == 10
    assert counter.locked_until == T0 + timedelta(minutes=15)
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user_id).count() == 10
    )
    audit = (
        db_session.query(AuditLog).filter_by(event_type="user.locked").one()
    )
    assert audit.entity_id == user_id
    assert audit.created_by == admin.id


def test_tenth_failure_wins_race_with_successful_login(
    make_client, db_session, now, monkeypatch
):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO6")
    email, user_id = user.email, user.id
    assert all(r.status_code == 401 for r in _fail(make_client(), user, 9))

    success_reached_lock = threading.Event()
    tenth_failure_finished = threading.Event()
    actual_clear = login_module.clear_after_successful_check

    def pause_before_serialized_recheck(db, target_id):
        success_reached_lock.set()
        assert tenth_failure_finished.wait(timeout=15)
        return actual_clear(db, target_id)

    monkeypatch.setattr(
        login_module,
        "clear_after_successful_check",
        pause_before_serialized_recheck,
    )

    def successful_login():
        client = make_client()
        return client.post(
            "/api/v1/auth/login",
            json={"login": email, "password": P},
        )

    def tenth_failure():
        assert success_reached_lock.wait(timeout=15)
        try:
            client = make_client()
            response = client.post(
                "/api/v1/auth/login",
                json={"login": email, "password": "wrong-password"},
            )
            return response.status_code
        finally:
            tenth_failure_finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        success_future = pool.submit(successful_login)
        failure_future = pool.submit(tenth_failure)
        success_response = success_future.result(timeout=30)
        failure_status = failure_future.result(timeout=30)

    assert failure_status == 401
    assert success_response.status_code == 401
    assert "set-cookie" not in success_response.headers
    db_session.rollback()
    counter = db_session.query(LoginCounter).filter_by(user_id=user_id).one()
    assert counter.failure_count == 10
    assert counter.locked_until == T0 + timedelta(minutes=15)
    assert (
        db_session.query(LoginFailure).filter_by(user_id=user_id).count() == 10
    )
    assert (
        db_session.query(AuthSession).filter_by(user_id=user_id).count() == 0
    )
    audit = (
        db_session.query(AuditLog).filter_by(event_type="user.locked").one()
    )
    assert audit.entity_id == user_id
    assert audit.created_by == admin.id


def test_tenth_failure_wins_race_with_password_change(
    engine, db_session, now, monkeypatch
):
    admin = _admin(db_session)
    user = make_local_user(db_session, "DEMO7")
    email, user_id = user.email, user.id
    password_hash = (
        db_session.query(UserPassword)
        .filter_by(user_id=user_id)
        .one()
        .password_hash
    )
    _session, token = create_session(db_session, user)
    db_session.commit()

    app = create_app()

    def get_wal_db():
        with Session(engine) as session:
            session.connection().exec_driver_sql("BEGIN")
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    app.dependency_overrides[get_db] = get_wal_db

    def make_wal_client():
        return TestClient(app, base_url="https://testserver")

    assert all(r.status_code == 401 for r in _fail(make_wal_client(), user, 9))

    change_reached_lock = threading.Event()
    tenth_failure_finished = threading.Event()
    actual_clear = auth_api.clear_after_successful_check

    def pause_before_serialized_recheck(db, target_id):
        change_reached_lock.set()
        assert tenth_failure_finished.wait(timeout=15)
        return actual_clear(db, target_id)

    monkeypatch.setattr(
        auth_api,
        "clear_after_successful_check",
        pause_before_serialized_recheck,
    )

    def change_password():
        client = make_wal_client()
        return client.post(
            "/api/v1/auth/password",
            json={"current_password": P, "new_password": NEW_P},
            cookies={SESSION_COOKIE_NAME: token},
        )

    def tenth_failure():
        assert change_reached_lock.wait(timeout=15)
        try:
            client = make_wal_client()
            response = client.post(
                "/api/v1/auth/login",
                json={"login": email, "password": "wrong-password"},
            )
            return response.status_code
        finally:
            tenth_failure_finished.set()

    with ThreadPoolExecutor(max_workers=2) as pool:
        change_future = pool.submit(change_password)
        failure_future = pool.submit(tenth_failure)
        change_response = change_future.result(timeout=30)
        failure_status = failure_future.result(timeout=30)

    assert failure_status == 401
    assert change_response.status_code == 400
    assert "set-cookie" not in change_response.headers
    db_session.rollback()
    password = db_session.query(UserPassword).filter_by(user_id=user_id).one()
    assert password.password_hash == password_hash
    assert (
        db_session.query(AuthSession).filter_by(user_id=user_id).count() == 1
    )
    counter = db_session.query(LoginCounter).filter_by(user_id=user_id).one()
    assert counter.failure_count == 10
    audit = (
        db_session.query(AuditLog).filter_by(event_type="user.locked").one()
    )
    assert audit.entity_id == user_id
    assert audit.created_by == admin.id
