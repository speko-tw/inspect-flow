"""Admin password reset command acceptance tests (AUT-AC62~AUT-AC64)."""

import subprocess
import sys

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

import app.cli.reset_admin_password as reset_command
from app.auth.lockout import record_failure
from app.auth.password_service import set_password
from app.auth.passwords import verify_password
from app.auth.sessions import create_session
from app.cli.init_system import run as initialize
from app.cli.reset_admin_password import run
from app.models import (
    AuditLog,
    AuthSession,
    LoginCounter,
    LoginFailure,
    SetupCode,
    User,
    UserPassword,
)

_PASSWORD = "VeryStrongPassword!"
_NEW_PASSWORD = "NewVeryStrongPassword!"


def _initialized_admin(session_factory: sessionmaker[Session]) -> User:
    initialize(session_factory, output=lambda _line: None)
    with session_factory() as session:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one()
        set_password(session, admin, _PASSWORD, is_temporary=False)
        session.commit()
        session.refresh(admin)
        return admin


def test_aut_ac62_resets_admin_and_clears_sessions_and_lockout(
    session_factory: sessionmaker[Session],
) -> None:
    admin = _initialized_admin(session_factory)
    with session_factory() as session:
        create_session(session, admin)
        record_failure(session, admin.id)
        session.commit()
        prior_audits = len(session.scalars(select(AuditLog)).all())

    output: list[str] = []
    assert (
        run(
            _NEW_PASSWORD,
            _NEW_PASSWORD,
            session_factory,
            output=output.append,
        )
        == 0
    )
    assert output == ["Admin password reset."]

    with session_factory() as session:
        password = session.scalars(
            select(UserPassword).where(UserPassword.user_id == admin.id)
        ).one()
        assert verify_password(password.password_hash, _NEW_PASSWORD)
        assert password.must_change_password is False
        assert (
            session.scalars(
                select(AuthSession).where(AuthSession.user_id == admin.id)
            ).all()
            == []
        )
        counter = session.scalars(
            select(LoginCounter).where(LoginCounter.user_id == admin.id)
        ).one()
        assert counter is not None
        assert counter.failure_count == 0
        assert counter.locked_until is None
        assert (
            session.scalars(
                select(LoginFailure).where(LoginFailure.user_id == admin.id)
            ).all()
            == []
        )
        audits = session.scalars(
            select(AuditLog).where(AuditLog.event_type == "user.password_set")
        ).all()
        assert len(audits) == prior_audits + 1
        reset_audit = audits[-1]
        assert reset_audit.entity_id == admin.id
        assert reset_audit.created_by == admin.id
        assert reset_audit.after == {"is_temporary": False}
        assert _NEW_PASSWORD not in repr(reset_audit)
        assert session.scalars(select(SetupCode)).one().voided_at is None


def test_aut_ac63_unconfigured_admin_is_refused_without_changes(
    session_factory: sessionmaker[Session],
) -> None:
    initialize(session_factory, output=lambda _line: None)
    with session_factory() as session:
        before = (
            len(session.scalars(select(UserPassword)).all()),
            len(session.scalars(select(AuthSession)).all()),
            len(session.scalars(select(AuditLog)).all()),
        )

    output: list[str] = []
    assert (
        run(_PASSWORD, _PASSWORD, session_factory, output=output.append) == 1
    )
    assert output == [
        "Admin has no password; run make init to get a setup code."
    ]
    with session_factory() as session:
        after = (
            len(session.scalars(select(UserPassword)).all()),
            len(session.scalars(select(AuthSession)).all()),
            len(session.scalars(select(AuditLog)).all()),
        )
        assert after == before


def test_aut_ac24_rejected_passwords_do_not_change_data(
    session_factory: sessionmaker[Session],
) -> None:
    admin = _initialized_admin(session_factory)
    with session_factory() as session:
        password = session.scalars(
            select(UserPassword).where(UserPassword.user_id == admin.id)
        ).one()
        original_hash = password.password_hash
        original_audits = len(session.scalars(select(AuditLog)).all())

    assert run("one", "two", session_factory, output=lambda _line: None) == 1
    assert run("1234567", "1234567", session_factory) == 1
    with session_factory() as session:
        password = session.scalars(
            select(UserPassword).where(UserPassword.user_id == admin.id)
        ).one()
        assert password.password_hash == original_hash
        assert len(session.scalars(select(AuditLog)).all()) == original_audits


def test_aut_ac64_removes_generic_set_password_command() -> None:
    from pathlib import Path

    repo_root = Path(__file__).resolve().parents[3]
    makefile = (repo_root / "Makefile").read_text()
    cli_files = {
        path.name for path in (repo_root / "backend/app/cli").glob("*.py")
    }
    assert "reset-admin-password:" in makefile
    assert "set-password:" not in makefile
    assert "set_password.py" not in cli_files
    help_output = subprocess.run(
        ["make", "help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert "make init" in help_output
    assert "make reset-admin-password" in help_output
    assert "set-password" not in help_output


def test_reset_command_rejects_password_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        sys, "argv", ["reset-admin-password", "--password", "secret"]
    )
    with pytest.raises(SystemExit):
        reset_command.main()
