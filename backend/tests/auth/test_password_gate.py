"""Tests for the temporary-password gate (AUT-AC35) and its
allowlist (AUT-R33).
"""

from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient

from app.api.errors import ErrorCode
from app.auth.dependencies import (
    TEMPORARY_PASSWORD_ALLOWLIST,
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
