"""Issue and verify one-time first-login codes (AUT-R42~AUT-R45)."""

import logging
import secrets
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.passwords import hash_password, verify_password
from app.auth.settings import get_setup_lockout_settings
from app.db import clock
from app.models import SetupCode, User

logger = logging.getLogger("app.auth")
SETUP_CODE_LIFETIME = timedelta(hours=24)


def issue_setup_code(session: Session, admin: User) -> str:
    """Void prior codes and add a newly hashed code to the transaction."""
    now = clock.utc_now()
    # The setup-code table may be empty, so locking its existing rows
    # cannot serialize concurrent initializations. Lock the always-present
    # admin row first; PostgreSQL then serializes issuers on this row.
    session.scalar(
        select(User.id).where(User.id == admin.id).with_for_update()
    )
    for previous in session.scalars(
        select(SetupCode)
        .where(SetupCode.voided_at.is_(None))
        .with_for_update()
    ):
        previous.voided_at = now
        previous.updated_by = admin.id

    code = secrets.token_urlsafe(32)
    session.add(
        SetupCode(
            created_at=now,
            updated_at=now,
            code_hash=hash_password(code),
            expires_at=now + SETUP_CODE_LIFETIME,
            created_by=admin.id,
            updated_by=admin.id,
        )
    )
    session.flush()
    return code


def verify_setup_code(
    session: Session, code: str
) -> tuple[User, SetupCode] | None:
    """Verify the current code, recording failures on its own row.

    Invalid requests return ``None`` so the public API can return the
    generic error as a normal response and commit the lockout counter.
    """
    now = clock.utc_now()
    admin = session.scalars(
        select(User).where(User.is_system.is_(True))
    ).one_or_none()
    if admin is None:
        return None

    row = session.scalars(
        select(SetupCode)
        .where(SetupCode.voided_at.is_(None))
        .order_by(SetupCode.created_at.desc())
        .limit(1)
        .with_for_update()
    ).first()
    if row is None or row.expires_at <= now:
        return None

    if row.locked_until is not None and row.locked_until > now:
        return None

    if verify_password(row.code_hash, code):
        return admin, row

    settings = get_setup_lockout_settings()
    if (
        row.failure_window_started_at is None
        or now - row.failure_window_started_at >= settings.failure_window
    ):
        row.failure_window_started_at = now
        row.failed_attempts = 0
        row.locked_until = None

    row.failed_attempts += 1
    if row.failed_attempts >= settings.failure_threshold:
        row.locked_until = now + settings.lockout_duration
        logger.warning("First-login code locked")
    session.flush()
    return None


def void_setup_code(session: Session, row: SetupCode, admin: User) -> None:
    """Void a successfully used code and clear its lockout state."""
    row.voided_at = clock.utc_now()
    row.failed_attempts = 0
    row.failure_window_started_at = None
    row.locked_until = None
    row.updated_by = admin.id
    session.flush()
