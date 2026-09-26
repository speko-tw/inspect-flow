"""Tests for the temporary-password gate (AUT-AC35) and its
allowlist (AUT-R33).
"""

import pytest
from fastapi import APIRouter, Depends, Request
from fastapi.testclient import TestClient
from starlette._utils import get_route_path

from app.api.errors import ErrorCode
from app.api.v1.auth import router as auth_router
from app.auth.dependencies import (
    TEMPORARY_PASSWORD_ALLOWLIST,
    _route_path,
    require_login,
)
from app.auth.passwords import hash_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.main import create_app
from app.models import User, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD
from tests.db.conftest import create_root_user_with_company

PASSWORD = DEFAULT_TEST_PASSWORD


def _make_temporary_password_user(db_session, employee_no: str) -> User:
    """A ``local`` ``User`` whose password is marked temporary
    (AUT-R32).
    """
    user = create_root_user_with_company(db_session, employee_no)
    db_session.add(
        UserPassword(
            user_id=user.id,
            password_hash=hash_password(PASSWORD),
            must_change_password=True,
            created_by=user.id,
            updated_by=user.id,
        )
    )
    db_session.commit()
    return user


def _make_external_user_with_leftover_flag(
    db_session, employee_no: str
) -> User:
    """An ``external`` account with a leftover ``UserPassword`` row
    still marked temporary -- simulating an account that was a
    ``local`` account with a temporary password before being
    converted to ``external`` (AUT-R32: the flag never applies to
    an external account, regardless of what this row says).
    """
    user = create_root_user_with_company(db_session, employee_no)
    user.auth_source = "external"
    user.external_source = "ldap"
    user.external_id = employee_no.lower()
    db_session.add(
        UserPassword(
            user_id=user.id,
            password_hash=hash_password(PASSWORD),
            must_change_password=True,
            created_by=user.id,
            updated_by=user.id,
        )
    )
    db_session.commit()
    return user


def _client_with_gated_probe() -> tuple[TestClient, dict[str, int]]:
    """A needs-login test-only route that counts how many times its
    handler actually ran, exactly like AUT-AC17's probe routes will
    (T4) -- here used to prove AUT-R33's rejection never reaches the
    route handler.
    """
    app = create_app()
    router = APIRouter()
    calls = {"count": 0}

    @router.get("/api/v1/test/gated-probe")
    def gated_probe(
        _user: User = Depends(require_login),  # noqa: B008
    ) -> dict[str, int]:
        calls["count"] += 1
        return {"count": calls["count"]}

    app.include_router(router)
    return TestClient(app, base_url="https://testserver"), calls


def _client_with_aliased_auth_router() -> TestClient:
    """The auth router mounted under both its real ``/api/v1``
    prefix and an extra alias prefix, so the same ``APIRoute``
    object (e.g. the one backing ``GET /me``) is reachable through
    two different full path templates -- reproducing the setup
    where matching a route by identity alone is not enough to know
    which template this particular request actually took (AUT-R33).
    """
    app = create_app()
    app.include_router(auth_router, prefix="/internal-alias")
    return TestClient(app, base_url="https://testserver")


class TestAutAc36AllowlistContents:
    """The allowlist is exactly the two routes this task owns (T11
    later adds the change-password route).
    """

    def test_allowlist_is_exactly_me_and_logout(self):
        assert TEMPORARY_PASSWORD_ALLOWLIST == frozenset(
            {
                ("GET", "/api/v1/auth/me"),
                ("POST", "/api/v1/auth/logout"),
            }
        )


class TestAutAc35TemporaryPasswordGate:
    def test_temporary_password_blocks_everything_but_the_allowlist(
        self, db_session
    ):
        user = _make_temporary_password_user(db_session, "E950")
        client, calls = _client_with_gated_probe()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200
        assert login_resp.json()["must_change_password"] is True
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        me_resp = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert me_resp.status_code == 200
        assert me_resp.json()["must_change_password"] is True

        gated_resp = client.get(
            "/api/v1/test/gated-probe",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert gated_resp.status_code == 403
        assert (
            gated_resp.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED.value
        )
        assert calls["count"] == 0

        logout_resp = client.post(
            "/api/v1/auth/logout", cookies={SESSION_COOKIE_NAME: token}
        )
        assert logout_resp.status_code == 204

    def test_external_account_with_leftover_flag_is_unaffected(
        self, db_session
    ):
        user = _make_external_user_with_leftover_flag(db_session, "E951")
        _row, token = create_session(db_session, user)
        db_session.commit()

        client, calls = _client_with_gated_probe()

        gated_resp = client.get(
            "/api/v1/test/gated-probe",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert gated_resp.status_code == 200
        assert calls["count"] == 1

    def test_clearing_the_flag_unblocks_the_route(self, db_session):
        user = _make_temporary_password_user(db_session, "E952")
        client, calls = _client_with_gated_probe()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        blocked_resp = client.get(
            "/api/v1/test/gated-probe",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert blocked_resp.status_code == 403
        assert calls["count"] == 0

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )
        stored.must_change_password = False
        db_session.commit()

        allowed_resp = client.get(
            "/api/v1/test/gated-probe",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert allowed_resp.status_code == 200
        assert calls["count"] == 1


class TestAutR33AliasedRouteIsMatchedByPathNotIdentity:
    """The same ``APIRoute`` object mounted under two prefixes must
    be told apart by which path this request actually took, not
    just by identity (AUT-R33).
    """

    def test_alias_path_is_blocked_but_real_path_is_allowed(self, db_session):
        user = _make_temporary_password_user(db_session, "E953")
        client = _client_with_aliased_auth_router()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        alias_resp = client.get(
            "/internal-alias/auth/me",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert alias_resp.status_code == 403
        assert (
            alias_resp.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED.value
        )

        real_resp = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert real_resp.status_code == 200
        assert real_resp.json()["must_change_password"] is True


def _request_with_scope(path: str, root_path: str) -> Request:
    """A bare ``Request`` carrying just the scope fields
    ``_route_path`` (and Starlette's own ``get_route_path``) read:
    ``scope["path"]`` and ``scope["root_path"]``.
    """
    return Request({"type": "http", "path": path, "root_path": root_path})


class TestRoutePathMatchesStarletteBoundaryRule:
    """``_route_path`` reimplements Starlette's private
    ``get_route_path`` (rather than importing it) and must match it
    exactly, including the path-segment boundary check: ``root_path``
    is only stripped when the next character after it is ``/`` (or
    ``path`` and ``root_path`` are equal), never on a bare substring
    match (AUT-R33 depends on this: a wrongly-stripped path could
    make ``_matched_route_template`` recover the wrong template, or
    none at all, and either wrongly allow or wrongly block a request
    under the temporary-password gate).
    """

    @pytest.mark.parametrize(
        ("path", "root_path", "expected"),
        [
            # (a) no root_path: returned unchanged.
            ("/api/v1/auth/me", "", "/api/v1/auth/me"),
            # (b) normal root_path prefix, segment boundary.
            ("/api/v1/auth/me", "/api/v1", "/auth/me"),
            # (c) path == root_path: empty string, not None.
            ("/api/v1/auth/me", "/api/v1/auth/me", ""),
            # (d) coincidental substring overlap, not a segment
            # boundary -- root_path="/api/v1/auth/m" is a prefix of
            # path="/api/v1/auth/me" as raw characters, but the byte
            # right after root_path is "e", not "/", so Starlette
            # (and this function) return the original path
            # unchanged rather than stripping to "e".
            (
                "/api/v1/auth/me",
                "/api/v1/auth/m",
                "/api/v1/auth/me",
            ),
        ],
    )
    def test_matches_expected_and_starlette(
        self, path: str, root_path: str, expected: str
    ) -> None:
        request = _request_with_scope(path, root_path)
        assert _route_path(request) == expected
        assert get_route_path(request.scope) == expected

    @pytest.mark.parametrize(
        ("path", "root_path"),
        [
            ("/api/v1/auth/me", ""),
            ("/api/v1/auth/me", "/api/v1"),
            ("/api/v1/auth/me", "/api/v1/auth/me"),
            ("/api/v1/auth/me", "/api/v1/auth/m"),
            ("/other/path", "/api/v1"),
        ],
    )
    def test_always_agrees_with_starlette(
        self, path: str, root_path: str
    ) -> None:
        request = _request_with_scope(path, root_path)
        assert _route_path(request) == get_route_path(request.scope)
