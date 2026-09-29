"""Tests for the change-password API and the set-password Service
entry point (AUT-AC34, AUT-AC36~AUT-AC40, AUT-AC49, AUT-AC50; T11,
issue #192).

AUT-AC34 and AUT-AC49 (the set-password command's own behavior) live
in ``backend/tests/cli/test_set_password.py`` per plan.md's "AC 對應
測試"; this module covers the change-password API, the allowlist's
final contents, the Service entry point called directly, the error
code catalog, and the audit trail across both entry points.
"""

import uuid

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.errors import ErrorCode, build_error_code_descriptions
from app.api.v1.auth import change_password, get_me, logout
from app.auth import password_service
from app.auth.dependencies import (
    TEMPORARY_PASSWORD_ALLOWLIST,
    get_db,
    require_login,
)
from app.auth.passwords import hash_password, verify_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session, hash_token
from app.main import create_app
from app.models import AuditLog, AuthSession, User, UserPassword
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.auth.test_password_gate import (
    _make_external_user_with_leftover_flag,
    _make_temporary_password_user,
)
from tests.contract.test_route_conventions import _iter_business_routes
from tests.db.conftest import create_root_user_with_company, make_system_admin

PASSWORD = DEFAULT_TEST_PASSWORD
NEW_PASSWORD = "Demo-New-Pass1"


class TestAutAc36AllowlistHasThreeEntries:
    """AUT-AC36: the allowlist is exactly ``me``, ``logout`` and
    change-password, and each names a real route on the actual
    application.
    """

    def test_allowlist_is_exactly_three_operations(self):
        assert TEMPORARY_PASSWORD_ALLOWLIST == {
            ("GET", get_me),
            ("POST", logout),
            ("POST", change_password),
        }

    def test_allowlist_entries_match_real_routes(self):
        app = create_app()
        matched: set[tuple[str, str]] = set()
        for route, path in _iter_business_routes(app):
            for method in route.methods or set():
                if (method, route.endpoint) in TEMPORARY_PASSWORD_ALLOWLIST:
                    matched.add((method, path))
        assert matched == {
            ("GET", "/api/v1/auth/me"),
            ("POST", "/api/v1/auth/logout"),
            ("POST", "/api/v1/auth/password"),
        }


class TestAutAc37FourFailureModes:
    """AUT-AC37: wrong current password, too-short new password, a
    temporary password "changed" to itself, and an external account
    -- each rejected without touching ``UserPassword`` or the login
    state count.
    """

    def test_four_rejections_leave_everything_unchanged(self, db_session):
        user = _make_temporary_password_user(db_session, "P370")
        _row, token = create_session(db_session, user)
        db_session.commit()

        app = create_app()
        client = TestClient(app, base_url="https://testserver")
        cookies = {SESSION_COOKIE_NAME: token}

        wrong_current = client.post(
            "/api/v1/auth/password",
            json={
                "current_password": "not-the-password",
                "new_password": NEW_PASSWORD,
            },
            cookies=cookies,
        )
        assert wrong_current.status_code == 400
        assert (
            wrong_current.json()["error"]["code"]
            == ErrorCode.AUTH_CURRENT_PASSWORD_INCORRECT.value
        )

        too_short = client.post(
            "/api/v1/auth/password",
            json={"current_password": PASSWORD, "new_password": "short1"},
            cookies=cookies,
        )
        assert too_short.status_code == 422
        assert (
            too_short.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_INVALID.value
        )

        unchanged = client.post(
            "/api/v1/auth/password",
            json={"current_password": PASSWORD, "new_password": PASSWORD},
            cookies=cookies,
        )
        assert unchanged.status_code == 422
        assert (
            unchanged.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_UNCHANGED.value
        )

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )
        assert stored.must_change_password is True
        assert verify_password(stored.password_hash, PASSWORD)
        session_count = (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
        )
        assert session_count == 1

        external_user = _make_external_user_with_leftover_flag(
            db_session, "P371"
        )
        _ext_row, ext_token = create_session(db_session, external_user)
        db_session.commit()

        external_resp = client.post(
            "/api/v1/auth/password",
            json={"current_password": PASSWORD, "new_password": NEW_PASSWORD},
            cookies={SESSION_COOKIE_NAME: ext_token},
        )
        assert external_resp.status_code == 403
        assert (
            external_resp.json()["error"]["code"]
            == ErrorCode.PERMISSION_DENIED.value
        )


class TestAutAc38SuccessRotatesCookieAndLoginStates:
    """AUT-AC38: a successful change clears the temporary flag,
    rotates the caller's Cookie, invalidates every other login state
    (including the caller's own old Cookie), and the old/new
    passwords behave accordingly at login.
    """

    def test_change_succeeds_and_invalidates_other_login_states(
        self, db_session, make_client
    ):
        user = _make_temporary_password_user(db_session, "P380")

        client_a = make_client()
        client_b = make_client()
        client_c = make_client()
        for client in (client_a, client_b, client_c):
            login_resp = client.post(
                "/api/v1/auth/login",
                json={"email": user.email, "password": PASSWORD},
            )
            assert login_resp.status_code == 200
        original_a_cookie = client_a.cookies[SESSION_COOKIE_NAME]

        change_resp = client_a.post(
            "/api/v1/auth/password",
            json={
                "current_password": PASSWORD,
                "new_password": NEW_PASSWORD,
            },
        )
        assert change_resp.status_code == 204

        set_cookie_header = change_resp.headers["set-cookie"]
        assert set_cookie_header.startswith(f"{SESSION_COOKIE_NAME}=")
        lowered = set_cookie_header.lower()
        assert "httponly" in lowered
        assert "secure" in lowered
        assert "samesite=strict" in lowered
        assert "path=/" in lowered
        assert "domain=" not in lowered

        new_token = change_resp.cookies[SESSION_COOKIE_NAME]
        assert new_token != original_a_cookie
        assert len(new_token) >= 43

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )
        assert stored.must_change_password is False
        assert verify_password(stored.password_hash, NEW_PASSWORD)
        assert stored.updated_by == user.id

        new_me = client_a.get("/api/v1/auth/me")
        assert new_me.status_code == 200
        assert new_me.json()["must_change_password"] is False

        old_a_resp = client_a.get(
            "/api/v1/auth/me", cookies={SESSION_COOKIE_NAME: original_a_cookie}
        )
        assert old_a_resp.status_code == 401
        assert client_b.get("/api/v1/auth/me").status_code == 401
        assert client_c.get("/api/v1/auth/me").status_code == 401

        remaining = (
            db_session.query(AuthSession).filter_by(user_id=user.id).all()
        )
        assert len(remaining) == 1
        assert remaining[0].token_hash == hash_token(new_token)

        old_login = make_client().post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert old_login.status_code == 401
        new_login = make_client().post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": NEW_PASSWORD},
        )
        assert new_login.status_code == 200


class TestAutAc39DirectServiceCalls:
    """AUT-AC39: calling ``password_service.set_password`` directly
    -- marking temporary, then clearing it, then a 7-character
    password -- updates the flag and hash correctly, kills every
    existing login state on each successful call, and rejects the
    too-short password leaving ``UserPassword`` untouched.
    """

    def test_mark_then_clear_then_reject_short_password(self, db_session):
        # A built-in system account is required outside of any HTTP
        # request: get_current_operator() falls back to it there.
        operator = create_root_user_with_company(db_session, "P390")
        make_system_admin(operator)
        user = create_root_user_with_company(db_session, "P391")
        db_session.add(
            UserPassword(
                user_id=user.id,
                password_hash=hash_password(PASSWORD),
                created_by=user.id,
                updated_by=user.id,
            )
        )
        db_session.commit()

        _row_x, _token_x = create_session(db_session, user)
        _row_y, _token_y = create_session(db_session, user)
        db_session.commit()
        assert (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
            == 2
        )

        row = password_service.set_password(
            db_session, user, "Temp-Pass1", is_temporary=True
        )
        db_session.commit()
        assert row.must_change_password is True
        assert verify_password(row.password_hash, "Temp-Pass1")
        assert (
            db_session.query(AuthSession).filter_by(user_id=user.id).count()
            == 0
        )

        row = password_service.set_password(
            db_session, user, "Final-Pass1", is_temporary=False
        )
        db_session.commit()
        assert row.must_change_password is False
        assert verify_password(row.password_hash, "Final-Pass1")

        with pytest.raises(password_service.PasswordLengthError):
            password_service.set_password(
                db_session, user, "short1", is_temporary=True
            )
        db_session.rollback()

        db_session.expire_all()
        stored = (
            db_session.query(UserPassword).filter_by(user_id=user.id).one()
        )
        assert stored.must_change_password is False
        assert verify_password(stored.password_hash, "Final-Pass1")


class TestAutAc40ErrorCodesRegistered:
    """AUT-AC40: the change-password error codes are all registered
    and dot-namespace formatted (API-AC09).

    Read through the ``ErrorCode`` members themselves (never a
    separately spelled-out string) -- API-AC10c's scan flags any
    file that lists a code's dot-namespace value in a table- or
    lookup-shaped line, since that is exactly the hand-maintained,
    drift-prone table ``build_error_code_descriptions`` exists to
    replace.
    """

    def test_four_codes_are_registered(self):
        descriptions = build_error_code_descriptions(ErrorCode)
        expected_members = (
            ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED,
            ErrorCode.AUTH_CURRENT_PASSWORD_INCORRECT,
            ErrorCode.AUTH_PASSWORD_INVALID,
            ErrorCode.AUTH_PASSWORD_UNCHANGED,
        )
        for member in expected_members:
            assert member.value in descriptions
            namespace, name = member.value.split(".")
            assert namespace.islower()
            assert name.islower()


class _SetPasswordBody(BaseModel):
    user_id: str
    password: str
    is_temporary: bool


def _client_with_admin_set_password_route() -> TestClient:
    """A needs-login test-only route calling the Service entry point
    directly on behalf of the logged-in caller -- standing in for
    ``admin-dashboard``'s future "Admin 設定臨時密碼" screen (AUT-R36),
    which this task does not build.
    """
    app = create_app()
    router = APIRouter()

    def admin_set_password(
        body: _SetPasswordBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _caller: User = Depends(require_login),  # noqa: B008
    ) -> dict[str, bool]:
        target = db.get(User, uuid.UUID(body.user_id))
        assert target is not None
        row = password_service.set_password(
            db, target, body.password, is_temporary=body.is_temporary
        )
        return {"must_change_password": row.must_change_password}

    router.add_api_route(
        "/api/v1/test/admin-set-password",
        admin_set_password,
        methods=["POST"],
        status_code=200,
    )
    app.include_router(router)
    return TestClient(app, base_url="https://testserver")


class TestAutAc50AuditTrailAcrossServiceAndApi:
    """AUT-AC50: Admin A sets U's password to a temporary one through
    the Service entry point, U changes it through the change-password
    API, and two rejected attempts write nothing -- exactly two
    ``user.password_set`` records, operators A then U, ``is_temporary``
    false/true then true/false, nothing serialized carries a password,
    hash or Cookie value.
    """

    def test_two_successes_two_rejections(self, db_session):
        admin_a = make_local_user(db_session, "P500", password="Admin-Pass1")
        admin_a.is_admin = True
        u = make_local_user(db_session, "P501", password="Old-Pass1")
        db_session.commit()

        client = _client_with_admin_set_password_route()
        admin_login = client.post(
            "/api/v1/auth/login",
            json={"email": admin_a.email, "password": "Admin-Pass1"},
        )
        assert admin_login.status_code == 200

        set_resp = client.post(
            "/api/v1/test/admin-set-password",
            json={
                "user_id": str(u.id),
                "password": "Temp-Pass1",
                "is_temporary": True,
            },
        )
        assert set_resp.status_code == 200
        assert set_resp.json()["must_change_password"] is True

        u_client = TestClient(create_app(), base_url="https://testserver")
        u_login = u_client.post(
            "/api/v1/auth/login",
            json={"email": u.email, "password": "Temp-Pass1"},
        )
        assert u_login.status_code == 200
        assert u_login.json()["must_change_password"] is True

        change_resp = u_client.post(
            "/api/v1/auth/password",
            json={
                "current_password": "Temp-Pass1",
                "new_password": NEW_PASSWORD,
            },
        )
        assert change_resp.status_code == 204

        too_short = u_client.post(
            "/api/v1/auth/password",
            json={"current_password": NEW_PASSWORD, "new_password": "s1"},
        )
        assert too_short.status_code == 422

        wrong_current = u_client.post(
            "/api/v1/auth/password",
            json={
                "current_password": "not-it",
                "new_password": "Another-Pass1",
            },
        )
        assert wrong_current.status_code == 400

        db_session.expire_all()
        logs = (
            db_session.query(AuditLog)
            .filter_by(event_type="user.password_set", entity_id=u.id)
            .order_by(AuditLog.created_at)
            .all()
        )
        assert len(logs) == 2

        assert logs[0].created_by == admin_a.id
        assert logs[0].before == {"is_temporary": False}
        assert logs[0].after == {"is_temporary": True}

        assert logs[1].created_by == u.id
        assert logs[1].before == {"is_temporary": True}
        assert logs[1].after == {"is_temporary": False}

        for log in logs:
            for payload in (log.before, log.after):
                assert payload is not None
                assert set(payload) == {"is_temporary"}
