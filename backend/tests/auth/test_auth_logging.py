"""Tests for the ``app.auth`` application log entries login,
login failure and logout write (AUT-AC52).

``T8`` (login failure lockout, #156) is not merged yet: the
"locked" failure reason AUT-AC52 also covers is out of this PR's
scope (plan.md's T12 row) and deliberately has no placeholder test
here.
"""

import logging

from app.auth.sessions import SESSION_COOKIE_NAME, hash_token
from app.models import AuditLog, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user

PASSWORD = DEFAULT_TEST_PASSWORD


def _auth_records(caplog):
    return [r for r in caplog.records if r.name == "app.auth"]


def _password_hash(db_session, user) -> str:
    """The stored ``UserPassword.password_hash`` for ``user``
    (AUT-R41: it must never end up in a log record either).
    """
    return (
        db_session.query(UserPassword)
        .filter_by(user_id=user.id)
        .one()
        .password_hash
    )


def _assert_no_secrets(caplog, *secrets: str) -> None:
    """AUT-R41: no captured ``app.auth`` record's message or
    structured fields may contain any of ``secrets`` (passwords,
    the raw submitted email, or a Cookie/token value).
    """
    for record in _auth_records(caplog):
        haystacks = [record.getMessage()]
        haystacks.extend(str(v) for v in vars(record).values())
        for haystack in haystacks:
            for secret in secrets:
                assert secret not in haystack


class TestAutAc52LoginSucceeded:
    def test_login_with_correct_password_logs_one_succeeded_event(
        self, client, db_session, caplog
    ):
        caplog.set_level(logging.INFO, logger="app.auth")
        user = make_local_user(db_session, "L001")
        assert user.email is not None
        # Deliberately mixed-case so the raw-email assertion below
        # would catch a logger that recorded the submitted input
        # verbatim instead of not recording email at all (AUT-R41).
        submitted_email = user.email.swapcase()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": submitted_email, "password": PASSWORD},
        )
        assert resp.status_code == 200

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.login_succeeded"
        assert events[0].user_id == str(user.id)
        assert events[0].reason is None

        _assert_no_secrets(
            caplog,
            PASSWORD,
            submitted_email,
            user.email,
            _password_hash(db_session, user),
        )

        assert db_session.query(AuditLog).count() == 0


class TestAutAc52Logout:
    def test_logout_with_cookie_logs_the_owning_user_id(
        self, client, db_session, caplog
    ):
        user = make_local_user(db_session, "L002")
        assert user.email is not None
        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        token = login_resp.cookies[SESSION_COOKIE_NAME]
        caplog.clear()
        caplog.set_level(logging.INFO, logger="app.auth")

        logout_resp = client.post("/api/v1/auth/logout")
        assert logout_resp.status_code == 204

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.logout"
        assert events[0].user_id == str(user.id)
        assert events[0].reason is None

        _assert_no_secrets(
            caplog,
            PASSWORD,
            user.email,
            token,
            _password_hash(db_session, user),
            hash_token(token),
        )

        assert db_session.query(AuditLog).count() == 0

    def test_logout_without_a_cookie_logs_no_user_id(
        self, make_client, caplog
    ):
        caplog.set_level(logging.INFO, logger="app.auth")
        client_without_cookie = make_client()

        resp = client_without_cookie.post("/api/v1/auth/logout")
        assert resp.status_code == 204

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.logout"
        assert events[0].user_id is None
        assert events[0].reason is None


class TestAutAc52LoginFailedWrongPassword:
    def test_wrong_password_logs_invalid_credentials_with_user_id(
        self, client, db_session, caplog
    ):
        caplog.set_level(logging.INFO, logger="app.auth")
        user = make_local_user(db_session, "L003")
        assert user.email is not None
        # Deliberately mixed-case so this and the raw-email
        # assertion below would catch a logger that recorded the
        # submitted input verbatim (AUT-R41).
        submitted_email = user.email.swapcase()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": submitted_email, "password": "definitely-wrong"},
        )
        assert resp.status_code == 401

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.login_failed"
        assert events[0].user_id == str(user.id)
        assert events[0].reason == "invalid_credentials"

        _assert_no_secrets(
            caplog,
            PASSWORD,
            "definitely-wrong",
            submitted_email,
            user.email,
            _password_hash(db_session, user),
        )

        assert db_session.query(AuditLog).count() == 0


class TestAutAc52LoginFailedUnknownEmail:
    def test_unknown_email_logs_invalid_credentials_with_no_user_id(
        self, client, caplog
    ):
        caplog.set_level(logging.INFO, logger="app.auth")

        # Deliberately mixed-case so the raw-email assertion below
        # would catch a logger that recorded the input verbatim
        # instead of its normalized/looked-up form (AUT-R41).
        resp = client.post(
            "/api/v1/auth/login",
            json={
                "email": "Nobody@Example.com",
                "password": "whatever-password",
            },
        )
        assert resp.status_code == 401

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.login_failed"
        assert events[0].user_id is None
        assert events[0].reason == "invalid_credentials"

        _assert_no_secrets(caplog, "whatever-password", "Nobody@Example.com")


class TestAutAc52LoginFailedAccountDisabled:
    def test_disabled_account_with_correct_password_logs_account_disabled(
        self, client, db_session, caplog
    ):
        caplog.set_level(logging.INFO, logger="app.auth")
        user = make_local_user(db_session, "L004", is_active=False)
        assert user.email is not None
        submitted_email = user.email.swapcase()

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": submitted_email, "password": PASSWORD},
        )
        assert resp.status_code == 401

        events = _auth_records(caplog)
        assert len(events) == 1
        assert events[0].event == "auth.login_failed"
        assert events[0].user_id == str(user.id)
        assert events[0].reason == "account_disabled"

        _assert_no_secrets(
            caplog,
            PASSWORD,
            submitted_email,
            user.email,
            _password_hash(db_session, user),
        )

        assert db_session.query(AuditLog).count() == 0
