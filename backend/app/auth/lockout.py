"""Shared per-account password failure counter (AUT-R28)."""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.settings import get_lockout_settings
from app.db import clock
from app.models import LoginFailure, User
from app.services.audit import record_audit_event


def _failures(db: Session, user: User) -> list[LoginFailure]:
    # Serialize updates for one account on databases with row locks.
    db.execute(select(User.id).where(User.id == user.id).with_for_update())
    return list(
        db.scalars(
            select(LoginFailure)
            .where(LoginFailure.user_id == user.id)
            .order_by(LoginFailure.failed_at)
        )
    )


def is_locked(db: Session, user: User) -> bool:
    """Return whether the account is locked at the current UTC time."""
    now = clock.utc_now()
    return any(
        row.locked_until is not None and row.locked_until > now
        for row in _failures(db, user)
    )


def record_failure(db: Session, user: User) -> None:
    """Count one failed check and audit exactly once on transition."""
    now = clock.utc_now()
    settings = get_lockout_settings()
    rows = _failures(db, user)
    if any(
        row.locked_until is not None and row.locked_until > now for row in rows
    ):
        return

    # After a lock expires the next failed check starts a new window.
    if any(row.locked_until is not None for row in rows):
        clear_failed_attempts(db, user)
        rows = []
    window_start = now - settings.failure_window
    recent = [row for row in rows if row.failed_at > window_start]
    locked_until = (
        now + settings.lockout_duration
        if len(recent) + 1 >= settings.failure_threshold
        else None
    )
    db.add(
        LoginFailure(user_id=user.id, failed_at=now, locked_until=locked_until)
    )
    db.flush()
    if locked_until is not None:
        record_audit_event(
            db,
            "user.locked",
            entity_id=user.id,
            before=None,
            after={"locked_until": locked_until},
        )


def clear_failed_attempts(db: Session, user: User) -> None:
    """Clear the counter and lift any active lockout."""
    db.execute(delete(LoginFailure).where(LoginFailure.user_id == user.id))
