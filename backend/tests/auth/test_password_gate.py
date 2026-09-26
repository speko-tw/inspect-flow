"""Tests for the temporary-password gate (AUT-AC35) and its
allowlist (AUT-R33).
"""

import functools

from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.api.errors import ErrorCode
from app.api.v1.auth import get_me, logout
from app.api.v1.auth import router as auth_router
from app.auth.dependencies import TEMPORARY_PASSWORD_ALLOWLIST, require_login
from app.auth.passwords import hash_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.main import create_app
from app.models import User, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD
from tests.contract.test_route_conventions import _iter_business_routes
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


def _client_with_wrapped_lookalike_probe() -> tuple[
    TestClient, dict[str, int]
]:
    """A needs-login test-only route whose handler is wrapped with
    ``functools.wraps(get_me)`` -- so it shares ``get_me``'s
    ``__module__``/``__qualname__`` (and thus the same
    ``f"{module}.{qualname}"`` string) while being a distinct
    function object. Reproduces the vulnerability AUT-R33's
    endpoint-identity allowlist closes: a name-based allowlist would
    wrongly recognize this as the real ``get_me`` operation and let
    it through.
    """
    app = create_app()
    router = APIRouter()
    calls = {"count": 0}

    @router.get("/api/v1/test/wrapped-probe", response_model=dict[str, int])
    @functools.wraps(get_me)
    def wrapped_lookalike(*args, **kwargs) -> dict[str, int]:
        # ``functools.wraps`` copies ``__wrapped__`` and
        # ``__annotations__``, both of which FastAPI would otherwise
        # read from ``get_me`` (its parameter signature, so the
        # dependencies below arrive as keyword arguments regardless
        # of this function's own parameter names; and its return
        # type, so ``response_model`` is set explicitly here to
        # override that). ``*args, **kwargs`` absorbs whatever
        # dependencies ``get_me``'s signature resolves to.
        calls["count"] += 1
        return {"count": calls["count"]}

    app.include_router(router)
    return TestClient(app, base_url="https://testserver"), calls


def _client_with_aliased_auth_router() -> TestClient:
    """The auth router mounted under both its real ``/api/v1``
    prefix and an extra alias prefix, so the same handler function
    (e.g. the one backing ``GET /me``) is reachable through two
    different full paths -- reproducing the setup an
    endpoint-identity allowlist (AUT-R33) is meant to keep
    recognizing as one operation regardless of path.
    """
    app = create_app()
    app.include_router(auth_router, prefix="/internal-alias")
    return TestClient(app, base_url="https://testserver")


class TestAutAc36AllowlistContents:
    """The allowlist is exactly the two operations this task owns
    (T11 later adds the change-password route).
    """

    def test_allowlist_is_exactly_me_and_logout(self):
        assert TEMPORARY_PASSWORD_ALLOWLIST == {
            ("GET", get_me),
            ("POST", logout),
        }

    def test_allowlist_entries_match_real_routes(self):
        """Each allowlist entry names a real business route on the
        actual application -- not merely a function that happens to
        exist somewhere -- and it is exactly the route this task
        expects: ``GET /api/v1/auth/me`` and
        ``POST /api/v1/auth/logout`` (AUT-AC36). Matches by the
        route's ``endpoint`` object itself (AUT-R33), the same
        identity ``create_app()``'s real ``APIRoute`` will hold.
        Paves the way for T11's change-password route to be added to
        both this set and the allowlist together.
        """
        app = create_app()
        matched: set[tuple[str, str]] = set()
        for route, path in _iter_business_routes(app):
            for method in route.methods or set():
                if (method, route.endpoint) in TEMPORARY_PASSWORD_ALLOWLIST:
                    matched.add((method, path))
        assert matched == {
            ("GET", "/api/v1/auth/me"),
            ("POST", "/api/v1/auth/logout"),
        }


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


class TestAutR33AliasedRouteIsRecognizedAsTheSameOperation:
    """The allowlist matches by the matched route's *endpoint*
    identity, not by request path or route template, so the same
    handler function reached through an extra alias prefix (e.g. an
    ``include_router`` mount added for a proxy or a deprecated
    compatibility path) is still recognized as the same operation
    (AUT-R33) -- neither wrongly narrowed nor wrongly widened by how
    many prefixes happen to reach it.
    """

    def test_alias_path_and_real_path_are_both_allowed(self, db_session):
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
        assert alias_resp.status_code == 200
        assert alias_resp.json()["must_change_password"] is True

        real_resp = client.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: token}
        )
        assert real_resp.status_code == 200
        assert real_resp.json()["must_change_password"] is True


class TestAutR33NameLookalikeIsNotRecognized:
    """The allowlist matches by the matched route's *endpoint
    object*, not by ``f"{module}.{qualname}"`` -- so a
    ``functools.wraps``-wrapped look-alike that shares ``get_me``'s
    name is still rejected (the vulnerability fixed on issue #200).
    """

    def test_wrapped_lookalike_is_blocked(self, db_session):
        user = _make_temporary_password_user(db_session, "E954")
        client, calls = _client_with_wrapped_lookalike_probe()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200
        token = login_resp.cookies[SESSION_COOKIE_NAME]

        wrapped_resp = client.get(
            "/api/v1/test/wrapped-probe",
            cookies={SESSION_COOKIE_NAME: token},
        )
        assert wrapped_resp.status_code == 403
        assert (
            wrapped_resp.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED.value
        )
        assert calls["count"] == 0
