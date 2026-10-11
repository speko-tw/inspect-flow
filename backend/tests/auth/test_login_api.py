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
from app.models import AuthSession, Company, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.db.conftest import (
    create_root_user_with_company,
    make_system_admin,
)

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
            json={"login": user.email, "password": PASSWORD},
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
            json={"login": user.email, "password": PASSWORD},
        )
        login_fail = client.post(
            "/api/v1/auth/login",
            json={"login": user.email, "password": "wrong-password"},
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
        user.username = "anna.deng"
        user.email = "Anna.Deng@demo.example"
        db_session.commit()
        company = db_session.get(Company, user.company_id)
        assert company is not None

        login_values = (
            "anna.deng",
            "ANNA.DENG",
            "anna.deng@demo.example",
            " Anna.Deng@DEMO.example ",
        )
        for expected_count, login_value in enumerate(login_values, start=1):
            resp = client.post(
                "/api/v1/auth/login",
                json={"login": login_value, "password": PASSWORD},
            )

            assert resp.status_code == 200
            assert resp.json() == {
                "id": str(user.id),
                "username": user.username,
                "email": user.email,
                "name_en": user.name_en,
                "name_zh": user.name_zh,
                "is_admin": user.is_admin,
                "must_change_password": False,
                "company": {
                    "id": str(company.id),
                    "name": company.name,
                },
                "department": user.department,
                "location": user.location,
                "employee_no": user.employee_no,
                "has_office_access": False,
                "has_field_access": False,
                "has_template_access": False,
                "module_permissions": [],
            }

            # AUT-R05: the login body is identical to ``me``'s.
            assert resp.json() == client.get("/api/v1/auth/me").json()

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
            rows = db_session.query(AuthSession).filter_by(user_id=user.id)
            assert rows.count() == expected_count
            row = rows.filter_by(token_hash=hash_token(token)).one()
            assert row is not None
            assert row.token_hash == hash_token(token)
            assert row.token_hash != token


class TestAutAc06UniformFailureAcrossSixScenarios:
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
        make_system_admin(no_password_user)
        no_password_user.email = None
        db_session.commit()

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
            ("nonexistent", "whatever-password"),
            (wrong_password_user.email, "definitely-wrong-password"),
            (disabled_user.email, PASSWORD),
            (external_user.email, "whatever-password"),
            ("admin", "whatever-password"),
            (f"{wrong_password_user.username}@x", PASSWORD),
        ]

        responses = [
            client.post(
                "/api/v1/auth/login",
                json={"login": login, "password": password},
            )
            for login, password in scenarios
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

        # AUT-R06: every scenario, including "login 不存在" and
        # "沒有密碼", verifies against a hash exactly once.
        assert call_count == len(scenarios)


class TestAutAc08CurrentUser:
    def test_ac08_me_includes_username_and_admin_null_fields(
        self, client, make_client, db_session
    ):
        user = make_local_user(db_session, "E080")
        admin = make_local_user(db_session, "E081")
        make_system_admin(admin)
        admin.email = None
        db_session.commit()

        expected_keys = {
            "id",
            "username",
            "email",
            "name_en",
            "name_zh",
            "is_admin",
            "must_change_password",
            "company",
            "department",
            "location",
            "employee_no",
            "has_office_access",
            "has_field_access",
            "has_template_access",
            "module_permissions",
        }
        for account in (user, admin):
            account_client = make_client()
            login_resp = account_client.post(
                "/api/v1/auth/login",
                json={"login": account.username, "password": PASSWORD},
            )
            assert login_resp.status_code == 200
            resp = account_client.get("/api/v1/auth/me")
            assert resp.status_code == 200
            body = resp.json()
            # AUT-R05: login returns the very same body as ``me``.
            assert login_resp.json() == body
            assert set(body) == expected_keys
            assert body["id"] == str(account.id)
            assert body["username"] == account.username
            assert body["username"] is not None
            assert body["email"] == account.email
            assert body["name_zh"] == account.name_zh
            assert body["name_en"] == account.name_en
            assert body["must_change_password"] is False

        assert admin.email is None
        assert admin.name_zh is None
        assert user.email is not None
        assert user.name_zh is not None
        unauthenticated = client.get("/api/v1/auth/me")
        assert unauthenticated.status_code == 401
        assert (
            unauthenticated.json()["error"]["code"]
            == ErrorCode.AUTH_NOT_AUTHENTICATED.value
        )


class TestAutAc07Logout:
    def test_ac07_logout_deletes_session_and_clears_cookie(
        self, client, db_session
    ):
        user = make_local_user(db_session, "E070")
        login_resp = client.post(
            "/api/v1/auth/login",
            json={"login": user.email, "password": PASSWORD},
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
