"""驗證試用部署只在隔離 HTTP 測試時停用 Secure。"""

import pytest

from app.auth.settings import (
    COOKIE_SECURE_ENV_VAR,
    InvalidAuthSettingError,
    get_cookie_secure,
)
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user


def test_cookie_secure_defaults_to_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(COOKIE_SECURE_ENV_VAR, raising=False)
    assert get_cookie_secure() is True


def test_cookie_secure_accepts_explicit_http_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(COOKIE_SECURE_ENV_VAR, "false")
    assert get_cookie_secure() is False


def test_cookie_secure_rejects_ambiguous_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(COOKIE_SECURE_ENV_VAR, "sometimes")
    with pytest.raises(InvalidAuthSettingError, match=COOKIE_SECURE_ENV_VAR):
        get_cookie_secure()


def test_http_login_cookie_can_be_used_and_cleared(
    make_client, db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(COOKIE_SECURE_ENV_VAR, "false")
    user = make_local_user(db_session, "HTTPCOOKIE")
    client = make_client()

    login = client.post(
        "/api/v1/auth/login",
        json={"login": user.email, "password": DEFAULT_TEST_PASSWORD},
    )
    cookie = login.headers["set-cookie"].lower()
    assert login.status_code == 200
    assert cookie.startswith("inspectflow_session=")
    assert " secure" not in cookie
    assert " samesite=strict" in cookie
    assert client.get("/api/v1/auth/me").status_code == 200

    logout = client.post("/api/v1/auth/logout")
    assert logout.status_code == 204
    assert 'inspectflow_session=""' in logout.headers["set-cookie"]
