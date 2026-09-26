"""Tests for server-side login state: issuing, the per-request
check, and counting valid sessions (AUT-AC10~AUT-AC15, AUT-AC26).
"""

import inspect
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.auth.dependencies import (
    bind_request_scope,
    get_request_user,
    in_request_scope,
    require_login,
)
from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    count_valid_sessions,
    create_session,
    hash_token,
)
from app.auth.settings import (
    ABSOLUTE_TIMEOUT_ENV_VAR,
    IDLE_TIMEOUT_ENV_VAR,
    get_session_timeouts,
)
from app.db import clock
from app.db.base import uuid7
from app.main import create_app
from app.models import AuthSession, User
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.db.conftest import build_root_user, create_root_user_with_company

PASSWORD = DEFAULT_TEST_PASSWORD


@pytest.fixture(autouse=True)
def _reset_clock() -> Generator[None, None, None]:
    yield
    clock.reset_clock()


class TestAutAc10TokenIssuance:
    def test_ac10_two_logins_get_distinct_usable_tokens_neither_reused(
        self, make_client, db_session
    ):
        user = make_local_user(db_session, "E100")
        client_a = make_client()
        client_b = make_client()

        resp_a = client_a.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert resp_a.status_code == 200
        token_a = resp_a.cookies[SESSION_COOKIE_NAME]

        # The second login carries the first token as its request
        # Cookie; the new token issued must not be that same value
        # (AUT-R13: never reuse a token the request brought in).
        resp_b = client_b.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
            cookies={SESSION_COOKIE_NAME: token_a},
        )
        assert resp_b.status_code == 200
        token_b = resp_b.cookies[SESSION_COOKIE_NAME]

        assert token_a != token_b
        assert len(token_a) >= 43
        assert len(token_b) >= 43

        me_a = client_a.get("/api/v1/auth/me")
        me_b = client_b.get("/api/v1/auth/me")
        assert me_a.status_code == 200
        assert me_b.status_code == 200


class TestAutAc11DeactivationInvalidatesImmediately:
    def test_ac11_deactivating_user_expires_every_session(
        self, make_client, db_session
    ):
        user = make_local_user(db_session, "E110")
        client_a = make_client()
        client_b = make_client()

        resp_a = client_a.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        resp_b = client_b.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert resp_a.status_code == 200
        assert resp_b.status_code == 200

        db_session.expire_all()
        db_user = db_session.get(type(user), user.id)
        db_user.is_active = False
        db_session.commit()

        me_a = client_a.get("/api/v1/auth/me")
        me_b = client_b.get("/api/v1/auth/me")
        assert me_a.status_code == 401
        assert me_a.json()["error"]["code"] == "auth.not_authenticated"
        assert me_b.status_code == 401

        remaining = (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
        )
        assert remaining == 0


class TestAutAc12ExternalAccountSessionBypassesPassword:
    def test_ac12_directly_issued_session_works_but_password_login_fails(
        self, client, db_session
    ):
        user = create_root_user_with_company(db_session, "E120")
        user.auth_source = "external"
        user.external_source = "ldap"
        user.external_id = "e120"
        db_session.commit()

        _row, token = create_session(db_session, user)
        db_session.commit()

        me = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert me.status_code == 200

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": "whatever-password"},
        )
        assert login_resp.status_code == 401
        assert login_resp.json()["error"]["code"] == "auth.invalid_credentials"


class TestAutAc13TimeoutBoundaries:
    def test_ac13_absolute_timeout_boundary(self, client, db_session):
        user = make_local_user(db_session, "E130")
        base = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: base)

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        # AUT-AC13's own Given/When keeps touching the session at
        # intervals under the (default 60-minute) idle timeout
        # while advancing toward the 8-hour absolute deadline --
        # otherwise the idle check alone would reject a request
        # this far from login, without ever exercising the
        # absolute-timeout boundary this test targets.
        touch_at = base
        for _ in range(15):
            touch_at += timedelta(minutes=30)
            clock.set_clock(lambda t=touch_at: t)
            touch_resp = client.get(
                "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
            )
            assert touch_resp.status_code == 200
        assert touch_at == base + timedelta(hours=7, minutes=30)

        just_before = base + timedelta(hours=8) - timedelta(seconds=1)
        clock.set_clock(lambda: just_before)
        still_valid = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert still_valid.status_code == 200

        db_session.expire_all()
        row = db_session.query(AuthSession).filter_by(user_id=user.id).one()
        assert row.last_seen_at == just_before

        clock.set_clock(lambda: base + timedelta(hours=8))
        expired = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert expired.status_code == 401

        db_session.expire_all()
        remaining = (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
        )
        assert remaining == 0

    def test_ac13_idle_timeout_boundary(self, client, db_session):
        user = make_local_user(db_session, "E131")
        base = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: base)

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        at_idle_limit = base + timedelta(minutes=60)
        clock.set_clock(lambda: at_idle_limit)
        still_valid = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert still_valid.status_code == 200

        db_session.expire_all()
        row = db_session.query(AuthSession).filter_by(user_id=user.id).one()
        assert row.last_seen_at == at_idle_limit

        past_idle_limit = at_idle_limit + timedelta(minutes=60, seconds=1)
        clock.set_clock(lambda: past_idle_limit)
        expired = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert expired.status_code == 401

        db_session.expire_all()
        remaining = (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
        )
        assert remaining == 0


class TestAutAc14ValidSessionCount:
    def test_ac14_counts_only_currently_valid_sessions(self, db_session):
        user_u = create_root_user_with_company(db_session, "E140")
        user_v = build_root_user("E141", user_u.company_id, self_id=uuid7())
        db_session.add(user_v)
        db_session.commit()

        now = datetime(2026, 1, 1, tzinfo=UTC)
        clock.set_clock(lambda: now)

        create_session(db_session, user_u)
        create_session(db_session, user_u)
        expired_row, _token = create_session(db_session, user_u)
        expired_row.expires_at = now - timedelta(seconds=1)
        db_session.commit()

        assert count_valid_sessions(db_session, user_u.id) == 2
        assert count_valid_sessions(db_session, user_v.id) == 0


class TestAutAc15SessionTimeoutSettings:
    def test_ac15_defaults_when_unset(self, monkeypatch):
        monkeypatch.delenv(IDLE_TIMEOUT_ENV_VAR, raising=False)
        monkeypatch.delenv(ABSOLUTE_TIMEOUT_ENV_VAR, raising=False)

        timeouts = get_session_timeouts()

        assert timeouts.idle_timeout == timedelta(minutes=60)
        assert timeouts.absolute_timeout == timedelta(hours=8)

    def test_ac15_reads_configured_values(self, monkeypatch):
        monkeypatch.setenv(IDLE_TIMEOUT_ENV_VAR, "15")
        monkeypatch.setenv(ABSOLUTE_TIMEOUT_ENV_VAR, "2")

        timeouts = get_session_timeouts()

        assert timeouts.idle_timeout == timedelta(minutes=15)
        assert timeouts.absolute_timeout == timedelta(hours=2)

    def test_ac15_env_example_lists_both_variable_names(self):
        repo_root = Path(__file__).resolve().parents[3]
        content = (repo_root / ".env.example").read_text(encoding="utf-8")

        assert IDLE_TIMEOUT_ENV_VAR in content
        assert ABSOLUTE_TIMEOUT_ENV_VAR in content


class TestAutAc26CreateSessionHasNoPasswordParameter:
    def test_ac26_signature_excludes_any_password_parameter(self):
        params = inspect.signature(create_session).parameters

        assert "password" not in params
        assert not any("password" in name for name in params)

    def test_ac26_directly_created_session_is_usable_via_me(
        self, client, db_session
    ):
        user = create_root_user_with_company(db_session, "E260")
        db_session.commit()

        row, token = create_session(db_session, user)
        db_session.commit()

        assert row.token_hash == hash_token(token)

        resp = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert resp.status_code == 200
        assert resp.json()["id"] == str(user.id)


def _probe_body() -> dict[str, str | bool | None]:
    """What both test-only probe routes below report, calling the
    two read-only functions with no ``request``/``Request``
    parameter at all -- standing in for a Service-layer entry point
    (T5's DOM-R14 rewrite) that has no way to receive one.
    """
    probed = get_request_user()
    return {
        "in_request_scope": in_request_scope(),
        "id": str(probed.id) if probed is not None else None,
    }


def _client_with_operator_probe() -> TestClient:
    """One needs-login route (``require_login``) and one public
    route (only ``bind_request_scope``, no Cookie needed), both
    reporting :func:`_probe_body`.
    """
    app = create_app()
    router = APIRouter()

    @router.get("/api/v1/test/operator-probe")
    def operator_probe(
        _user: User = Depends(require_login),  # noqa: B008
    ) -> dict[str, str | bool | None]:
        return _probe_body()

    @router.get("/api/v1/test/public-operator-probe")
    def public_operator_probe(
        _scope: None = Depends(bind_request_scope),  # noqa: B008
    ) -> dict[str, str | bool | None]:
        return _probe_body()

    app.include_router(router)
    return TestClient(app, base_url="https://testserver")


class TestRequestScopedOperatorForServiceLayer:
    """AUT-R09/DOM-R14 hand-off: ``get_request_user()``/
    ``in_request_scope()`` are how a Service-layer function with no
    ``request`` parameter reads the logged-in user, and tells "HTTP
    request, nobody logged in" apart from "not a request at all"
    (T5 builds on this; not itself an AUT-AC).
    """

    def test_probe_route_sees_the_logged_in_user_and_resets_after(
        self, db_session
    ):
        user = make_local_user(db_session, "E900")
        client = _client_with_operator_probe()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200

        probe_resp = client.get("/api/v1/test/operator-probe")
        assert probe_resp.status_code == 200
        assert probe_resp.json() == {
            "in_request_scope": True,
            "id": str(user.id),
        }

        # Outside of any request handling (this test function's own
        # body), neither must still report being inside a request.
        assert in_request_scope() is False
        assert get_request_user() is None

    def test_public_route_is_in_request_scope_with_no_user(self):
        client = _client_with_operator_probe()

        probe_resp = client.get("/api/v1/test/public-operator-probe")

        assert probe_resp.status_code == 200
        assert probe_resp.json() == {"in_request_scope": True, "id": None}
        assert in_request_scope() is False
        assert get_request_user() is None

    def test_two_users_requests_do_not_cross_contaminate(self, db_session):
        user_a = make_local_user(db_session, "E901")
        user_b = make_local_user(db_session, "E902")
        client = _client_with_operator_probe()

        login_a = client.post(
            "/api/v1/auth/login",
            json={"email": user_a.email, "password": PASSWORD},
        )
        token_a = login_a.cookies[SESSION_COOKIE_NAME]

        login_b = client.post(
            "/api/v1/auth/login",
            json={"email": user_b.email, "password": PASSWORD},
        )
        token_b = login_b.cookies[SESSION_COOKIE_NAME]

        probe_a = client.get(
            "/api/v1/test/operator-probe",
            cookies={SESSION_COOKIE_NAME: token_a},
        )
        probe_b = client.get(
            "/api/v1/test/operator-probe",
            cookies={SESSION_COOKIE_NAME: token_b},
        )

        assert probe_a.json()["id"] == str(user_a.id)
        assert probe_b.json()["id"] == str(user_b.id)
        assert get_request_user() is None
