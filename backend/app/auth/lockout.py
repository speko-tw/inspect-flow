"""Shared, serialized per-account password failure counter (AUT-R28)."""

import uuid

from sqlalchemy import case, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.settings import get_lockout_settings
from app.db import clock
from app.models import LoginCounter, LoginFailure
from app.services.audit import record_audit_event

_UNKNOWN_USER_ID = uuid.UUID(int=0)
_SQLITE_BUSY_TIMEOUT_MS = 30000


def _is_sqlite_lock_error(exc: OperationalError) -> bool:
    name = getattr(exc.orig, "sqlite_errorname", "")
    return name.startswith(("SQLITE_BUSY", "SQLITE_LOCKED"))


def _serialize_account(db: Session, user_id: uuid.UUID) -> None:
    """Take the per-user write lock before reading failure history.

    SQLite's upsert starts a write transaction; PostgreSQL locks the
    conflicting counter row. Both then serialize the window count,
    failure insert, and audit write until the caller commits. The
    caller must end any earlier read transaction before entering
    here, since WAL cannot upgrade a stale SQLite read snapshot.
    """
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        # db-dependency: sqlite; wait for the preceding writer instead
        # of returning a transient "database is locked" as HTTP 500.
        db.connection().exec_driver_sql(
            # db-dependency: sqlite
            f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}"
        )
        insert = sqlite_insert(LoginCounter)
    elif dialect == "postgresql":
        insert = pg_insert(LoginCounter)
    else:
        raise ValueError(f"unsupported lockout database: {dialect}")
    statement = insert.values(
        user_id=user_id, revision=0, failure_count=0, locked_until=None
    ).on_conflict_do_update(
        index_elements=[LoginCounter.user_id],
        set_={"revision": LoginCounter.revision + 1},
    )
    try:
        db.execute(statement)
    except OperationalError as exc:
        if dialect != "sqlite" or not _is_sqlite_lock_error(exc):
            raise
        db.rollback()
        raise APIError(ErrorCode.SERVER_TEMPORARILY_UNAVAILABLE, 503) from exc


def is_locked(db: Session, user_id: uuid.UUID | None) -> bool:
    """Check the account's deadline; unknown users use a fixed ID.

    Looking up the sentinel makes an unknown login pay the same
    lockout-query round trip as a known account, without recording
    a failure or exposing the submitted login (AUT-R06).
    """
    lookup_id = user_id if user_id is not None else _UNKNOWN_USER_ID
    locked_until = db.scalar(
        select(LoginCounter.locked_until).where(
            LoginCounter.user_id == lookup_id
        )
    )
    return locked_until is not None and locked_until > clock.utc_now()


def record_failure(db: Session, user_id: uuid.UUID) -> None:
    """Atomically count a failed check and audit the lock transition.

    The final count and deadline come from one UPDATE RETURNING.
    Individual failure timestamps preserve AUT-R28's sliding-window
    boundary; the counter row serializes concurrent callers.
    """
    _serialize_account(db, user_id)
    now = clock.utc_now()
    settings = get_lockout_settings()
    previous_lock = db.scalar(
        select(LoginCounter.locked_until).where(
            LoginCounter.user_id == user_id
        )
    )
    if previous_lock is not None and previous_lock > now:
        return

    cutoff = now - settings.failure_window
    if previous_lock is not None:
        # An expired lock starts a new window even if its failures
        # were recent. Locked attempts never extend the deadline.
        db.execute(delete(LoginFailure).where(LoginFailure.user_id == user_id))
    else:
        db.execute(
            delete(LoginFailure).where(
                LoginFailure.user_id == user_id,
                LoginFailure.failed_at <= cutoff,
            )
        )

    recent_count = (
        select(func.count(LoginFailure.id))
        .where(
            LoginFailure.user_id == user_id,
            LoginFailure.failed_at > cutoff,
        )
        .scalar_subquery()
        + 1
    )
    count, locked_until = db.execute(
        update(LoginCounter)
        .where(LoginCounter.user_id == user_id)
        .values(
            failure_count=recent_count,
            locked_until=case(
                (
                    recent_count >= settings.failure_threshold,
                    now + settings.lockout_duration,
                ),
                else_=None,
            ),
        )
        .returning(LoginCounter.failure_count, LoginCounter.locked_until)
    ).one()
    db.add(LoginFailure(user_id=user_id, failed_at=now))
    db.flush()
    if count == settings.failure_threshold:
        record_audit_event(
            db,
            "user.locked",
            entity_id=user_id,
            before=None,
            after={"locked_until": locked_until},
        )


def clear_failed_attempts(db: Session, user_id: uuid.UUID) -> None:
    """Clear the window and lift any active lock under the same lock."""
    _serialize_account(db, user_id)
    db.execute(delete(LoginFailure).where(LoginFailure.user_id == user_id))
    db.execute(
        update(LoginCounter)
        .where(LoginCounter.user_id == user_id)
        .values(failure_count=0, locked_until=None)
    )


def clear_after_successful_check(db: Session, user_id: uuid.UUID) -> bool:
    """Recheck lockout under the account write lock before clearing.

    Return False if a concurrent failure locked the account after the
    caller's initial, pre-hash lockout lookup. The caller must keep this
    transaction open through the successful action it is authorizing.
    """
    _serialize_account(db, user_id)
    locked_until = db.scalar(
        select(LoginCounter.locked_until).where(
            LoginCounter.user_id == user_id
        )
    )
    if locked_until is not None and locked_until > clock.utc_now():
        return False

    db.execute(delete(LoginFailure).where(LoginFailure.user_id == user_id))
    db.execute(
        update(LoginCounter)
        .where(LoginCounter.user_id == user_id)
        .values(failure_count=0, locked_until=None)
    )
    return True
