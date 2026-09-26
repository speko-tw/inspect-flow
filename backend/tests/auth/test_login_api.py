"""Tests for the login/logout/current-user HTTP API (AUT-AC02,
AUT-AC03, AUT-AC05~AUT-AC07).
"""

import logging

from argon2 import PasswordHasher, Type

from app.api.errors import ErrorCode
from app.auth import login as login_module
from app.auth.passwords import (
    MEMORY_COST_KIB,
    PARALLELISM,
    TIME_COST,
    verify_password,
)
from app.auth.sessions import SESSION_COOKIE_NAME, hash_token
from app.models import AuthSession, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.db.conftest import create_root_user_with_company

PASSWORD = DEFAULT_TEST_PASSWORD


class TestAutAc02RehashOnLogin:
    def test_ac02_login_rehashes_an_outdated_hash(self, client, db_session):
        outdated_hasher = PasswordHasher(
            time_cost=3, memory_cost=12288, parallelism=1, type=Type.ID
        )
        outdated_hash = outdated_hasher.hash(PASSWORD)
        user = make_local_user(db_session, "E020", password_hash=outdated_hash)

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert resp.status_code == 200

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )
        assert stored.password_hash != outdated_hash
        assert (
            f"m={MEMORY_COST_KIB},t={TIME_COST},p={PARALLELISM}"
            in stored.password_hash
        )
        assert verify_password(stored.password_hash, PASSWORD) is True


class TestAutAc03NoSecretLeakage:
    def test_ac03_responses_and_logs_never_contain_secrets(
        self, client, db_session, caplog
    ):
        user = make_local_user(db_session, "E030")
        caplog.set_level(logging.DEBUG)

        login_ok = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        login_fail = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": "wrong-password"},
        )
        token = login_ok.cookies[SESSION_COOKIE_NAME]
        me = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )

        secrets = [PASSWORD, "wrong-password", stored.password_hash, token]
        for resp in (login_ok, login_fail, me):
            for secret in secrets:
                assert secret not in resp.text

        for secret in secrets:
            assert secret not in caplog.text


class TestAutAc05LoginCookieAndBody:
    def test_ac05_response_body_and_cookie_attributes(
        self, client, db_session
    ):
        user = make_local_user(db_session, "E050")

        resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )

        assert resp.status_code == 200
        assert resp.json() == {
            "id": str(user.id),
            "email": user.email,
            "name_en": user.name_en,
            "name_zh": user.name_zh,
            "is_admin": user.is_admin,
        }

        set_cookie_header = resp.headers["set-cookie"]
        assert set_cookie_header.startswith(f"{SESSION_COOKIE_NAME}=")
        lowered = set_cookie_header.lower()
        assert "httponly" in lowered
        assert "secure" in lowered
        assert "samesite=strict" in lowered
        assert "path=/" in lowered
        assert "domain=" not in lowered

        token = resp.cookies[SESSION_COOKIE_NAME]
        db_session.expire_all()
        row = db_session.query(AuthSession).filter_by(user_id=user.id).one()
        assert row.token_hash == hash_token(token)
        assert row.token_hash != token


class TestAutAc06UniformFailureAcrossFiveScenarios:
    def test_ac06_all_scenarios_get_the_identical_401(
        self, client, db_session, monkeypatch
    ):
        wrong_password_user = make_local_user(db_session, "E060")
        disabled_user = make_local_user(db_session, "E062", is_active=False)
        external_user = create_root_user_with_company(db_session, "E063")
        external_user.auth_source = "external"
        external_user.external_source = "ldap"
        external_user.external_id = "e063"
        db_session.commit()
        no_password_user = make_local_user(
            db_session, "E064", with_password=False
        )

        before_count = db_session.query(AuthSession).count()

        call_count = 0
        real_verify_password = login_module.verify_password

        def _counting_verify_password(password_hash, password):
            nonlocal call_count
            call_count += 1
            return real_verify_password(password_hash, password)

        monkeypatch.setattr(
            login_module, "verify_password", _counting_verify_password
        )

        scenarios = [
            ("nonexistent@example.com", "whatever-password"),
            (wrong_password_user.email, "definitely-wrong-password"),
            (disabled_user.email, PASSWORD),
            (external_user.email, "whatever-password"),
            (no_password_user.email, "whatever-password"),
        ]

        responses = [
            client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            for email, password in scenarios
        ]

        first_body = responses[0].content
        for resp in responses:
            assert resp.status_code == 401
            assert resp.content == first_body
            assert "set-cookie" not in resp.headers
            assert (
                resp.json()["error"]["code"]
                == ErrorCode.AUTH_INVALID_CREDENTIALS.value
            )

        after_count = db_session.query(AuthSession).count()
        assert after_count == before_count

        # AUT-R06: every scenario, including "email 不存在" and
        # "沒有密碼", verifies against a hash exactly once.
        assert call_count == len(scenarios)


class TestAutAc07Logout:
    def test_ac07_logout_deletes_session_and_clears_cookie(
        self, client, db_session
    ):
        user = make_local_user(db_session, "E070")
        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        logout_resp = client.post("/api/v1/auth/logout")
        assert logout_resp.status_code == 204

        set_cookie_header = logout_resp.headers["set-cookie"]
        assert set_cookie_header.startswith(f"{SESSION_COOKIE_NAME}=")
        # httpx drops a deletion cookie (empty value, past expiry)
        # from its jar once the response is processed, so absence
        # from the client's own jar is the browser-visible proof
        # the Cookie was cleared.
        assert SESSION_COOKIE_NAME not in client.cookies

        remaining = (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
        )
        assert remaining == 0

        me_after = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert me_after.status_code == 401
        assert (
            me_after.json()["error"]["code"]
            == ErrorCode.AUTH_NOT_AUTHENTICATED.value
        )

    def test_ac07_logout_without_a_cookie_is_idempotent(self, make_client):
        client_without_cookie = make_client()

        resp = client_without_cookie.post("/api/v1/auth/logout")

        assert resp.status_code == 204
