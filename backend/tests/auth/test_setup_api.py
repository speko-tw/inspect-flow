"""First-setup route acceptance tests (AUT-AC56~AUT-AC58)."""

import logging
import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.passwords import hash_password, verify_password
from app.cli.init_system import run as initialize
from app.db import clock
from app.models import AuditLog, SetupCode, UserPassword

_CODE_RE = re.compile(r"First-login code: ([A-Za-z0-9_-]+)")
_PASSWORD = "VeryStrongPassword!"


def _initialize(engine) -> str:
    from sqlalchemy.orm import sessionmaker

    output: list[str] = []
    assert initialize(sessionmaker(bind=engine), output=output.append) == 0
    matches = [match for line in output if (match := _CODE_RE.fullmatch(line))]
    assert len(matches) == 1
    return matches[0].group(1)


def test_aut_ac56_first_setup_sets_password_audit_and_cookie(
    client, engine
) -> None:
    code = _initialize(engine)

    before = client.get("/api/v1/setup/status")
    assert before.status_code == 200
    assert before.json() == {"setup_required": True}

    response = client.post(
        "/api/v1/setup/admin-password",
        json={"code": code, "password": _PASSWORD},
    )
    assert response.status_code == 204
    assert "set-cookie" in response.headers
    assert response.content == b""

    after = client.get("/api/v1/setup/status")
    assert after.json() == {"setup_required": False}
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    assert me.json()["is_admin"] is True
    assert me.json()["must_change_password"] is False

    with Session(engine) as session:
        password = session.scalars(select(UserPassword)).one()
        setup_code = session.scalars(select(SetupCode)).one()
        audit = session.scalars(
            select(AuditLog).where(AuditLog.event_type == "user.password_set")
        ).one()
        assert password.must_change_password is False
        assert verify_password(password.password_hash, _PASSWORD)
        assert setup_code.voided_at is not None
        assert audit.created_by == password.created_by
        assert audit.after == {"is_temporary": False}
        assert audit.before is None

    repeated = client.post(
        "/api/v1/setup/admin-password",
        json={"code": code, "password": _PASSWORD},
    )
    assert repeated.status_code == 409
    assert repeated.json() == {"error": {"code": "setup.already_completed"}}


def test_aut_ac57_invalid_codes_have_identical_response_and_no_code_use(
    client, engine
) -> None:
    code = _initialize(engine)
    expired_code = "expired-but-random"
    voided_code = "voided-but-random"
    from app.models import User

    with Session(engine) as session:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one()
        now = clock.utc_now()
        session.add_all(
            [
                SetupCode(
                    code_hash=hash_password(expired_code),
                    expires_at=now - timedelta(seconds=1),
                    created_at=now - timedelta(days=2),
                    updated_at=now - timedelta(days=2),
                    created_by=admin.id,
                    updated_by=admin.id,
                ),
                SetupCode(
                    code_hash=hash_password(voided_code),
                    expires_at=now + timedelta(hours=1),
                    voided_at=now - timedelta(seconds=1),
                    created_at=now - timedelta(days=1),
                    updated_at=now - timedelta(days=1),
                    created_by=admin.id,
                    updated_by=admin.id,
                ),
            ]
        )
        session.commit()

    codes = [expired_code, voided_code, "random-invalid-code"]
    responses = [
        client.post(
            "/api/v1/setup/admin-password",
            json={"code": invalid, "password": _PASSWORD},
        )
        for invalid in codes
    ]
    assert all(response.status_code == 401 for response in responses)
    assert len({response.content for response in responses}) == 1
    assert responses[0].json() == {"error": {"code": "setup.invalid_code"}}
    assert all("set-cookie" not in response.headers for response in responses)

    with Session(engine) as session:
        password_rows = session.scalars(select(UserPassword)).all()
        audit_rows = session.scalars(select(AuditLog)).all()
        setup_rows = session.scalars(select(SetupCode)).all()
        active = next(row for row in setup_rows if row.voided_at is None)
        assert password_rows == []
        assert audit_rows == []
        # Only the AUT-R45 counters on the current code change; the
        # stored code and its validity remain unchanged (AC57 clarification).
        assert verify_password(active.code_hash, code)
        assert active.expires_at == active.created_at + timedelta(hours=24)
        assert active.voided_at is None
        assert active.failed_attempts == 3


def test_aut_ac58_invalid_password_does_not_consume_code_then_login(
    client, engine
) -> None:
    code = _initialize(engine)
    invalid = client.post(
        "/api/v1/setup/admin-password",
        json={"code": code, "password": "1234567"},
    )
    assert invalid.status_code == 422
    assert invalid.json() == {"error": {"code": "auth.password_invalid"}}

    with Session(engine) as session:
        row = session.scalars(select(SetupCode)).one()
        assert row.voided_at is None
        assert row.failed_attempts == 0
        assert session.scalars(select(UserPassword)).all() == []

    success = client.post(
        "/api/v1/setup/admin-password",
        json={"code": code, "password": _PASSWORD},
    )
    assert success.status_code == 204
    login = client.post(
        "/api/v1/auth/login",
        json={"login": "admin", "password": _PASSWORD},
    )
    assert login.status_code == 200
    assert login.json()["username"] == "admin"


def test_aut_ac66_setup_secrets_do_not_reach_logs_or_audit(
    client, engine, caplog
) -> None:
    caplog.set_level(logging.INFO)
    code = _initialize(engine)
    failed_code = "typed-random-code"
    password = "AnotherStrongPassword!"

    failed = client.post(
        "/api/v1/setup/admin-password",
        json={"code": failed_code, "password": password},
    )
    assert failed.status_code == 401
    success = client.post(
        "/api/v1/setup/admin-password",
        json={"code": code, "password": password},
    )
    assert success.status_code == 204
    cookie = success.cookies.get("__Host-inspectflow_session")
    assert cookie
    account_field_secret = "PasswordTypedHere1!@example.test"
    login_failure = client.post(
        "/api/v1/auth/login",
        json={"login": account_field_secret, "password": "WrongSecret!"},
    )
    assert login_failure.status_code == 401

    with Session(engine) as session:
        audit_rows = session.scalars(select(AuditLog)).all()
        password_hash = (
            session.scalars(select(UserPassword)).one().password_hash
        )

    captured = (
        caplog.text
        + "\n"
        + "\n".join(
            repr((row.event_type, row.before, row.after, row.created_by))
            for row in audit_rows
        )
    )
    for secret in (
        code,
        failed_code,
        password,
        password_hash,
        cookie,
        account_field_secret,
        "WrongSecret!",
    ):
        assert secret not in captured
