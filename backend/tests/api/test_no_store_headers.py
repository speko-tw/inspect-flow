"""所有 `/api/` 回應都帶 `Cache-Control: no-store`（#711）。"""

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.no_store import NoStoreMiddleware
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import User
from tests.db.conftest import create_root_user_with_company


def _admin_client(db_session, make_client) -> tuple[TestClient, User]:
    admin = create_root_user_with_company(db_session, "NOSTORE-ADM")
    admin.is_admin = True
    _, token = create_session(db_session, admin)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client, admin


def test_me_and_effective_access_are_not_cacheable(db_session, make_client):
    client, admin = _admin_client(db_session, make_client)
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200, me.text
    assert me.headers["cache-control"] == "no-store"
    access = client.get(f"/api/v1/users/{admin.id}/effective-access")
    assert access.status_code == 200, access.text
    assert access.headers["cache-control"] == "no-store"


def test_errors_and_unauthenticated_api_responses_are_not_cacheable(
    make_client,
):
    client = make_client()
    unauthenticated = client.get("/api/v1/auth/me")
    assert unauthenticated.status_code == 401
    assert unauthenticated.headers["cache-control"] == "no-store"
    missing = client.get("/api/v1/does-not-exist")
    assert missing.status_code == 404
    assert missing.headers["cache-control"] == "no-store"


def test_explicit_cache_control_is_kept_and_non_api_is_untouched():
    app = FastAPI()
    app.add_middleware(NoStoreMiddleware)

    @app.get("/api/custom")
    def custom() -> JSONResponse:
        return JSONResponse({}, headers={"Cache-Control": "max-age=60"})

    @app.get("/api/plain")
    def plain() -> dict[str, str]:
        return {}

    @app.get("/static-page")
    def static_page() -> dict[str, str]:
        return {}

    client = TestClient(app)
    assert client.get("/api/custom").headers["cache-control"] == "max-age=60"
    assert client.get("/api/plain").headers["cache-control"] == "no-store"
    assert "cache-control" not in client.get("/static-page").headers
