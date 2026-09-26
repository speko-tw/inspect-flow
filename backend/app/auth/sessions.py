"""Server-side login state: issuing, checking and counting
``AuthSession`` rows (AUT-R09, AUT-R11~AUT-R17, AUT-R25, AUT-R27).

Deliberately split from ``app.auth.login`` (AUT-R27): nothing in
here ever looks at a password. This is what lets an external
identity source (a future ``external-identity-sync``) call
``create_session`` after its own, different verification succeeds,
reusing the same login state mechanism.
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.settings import get_session_timeouts
from app.db import clock
from app.models import AuthSession, User

# AUT-R12: ``__Host-`` prefix, no ``Domain``, ``Path=/`` -- enforced
# by browsers only when the cookie also carries ``Secure``, which
# ``app.api.v1.auth`` sets alongside this name.
SESSION_COOKIE_NAME = "__Host-inspectflow_session"

# AUT-R11: at least 256 bits of randomness. ``secrets.token_urlsafe``
# base64url-encodes ``_TOKEN_BYTES`` random bytes and strips padding,
# giving a 43-character string for 32 bytes (AUT-AC10).
_TOKEN_BYTES = 32


def generate_token() -> str:
    """Return a new random session token (AUT-R11, AUT-R13)."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    """Hash a session token for storage (AUT-R11): the database
    keeps only this SHA-256 hex digest, never the token itself.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User) -> tuple[AuthSession, str]:
    """Issue a new login state for ``user``, returning the created
    row together with the plaintext token to send back as a Cookie.

    Deliberately takes no password parameter: "驗證身分" and "建立
    登入狀態" are two separate steps (AUT-R27), so this function
    works the same whether the caller just verified a local
    password (``app.auth.login.authenticate``) or, in the future,
    an external identity source. AUT-AC26 asserts this signature
    has no password parameter via ``inspect.signature``.

    ``created_by``/``updated_by`` are the user themself (the
    spec's "資料" section: the operator of an ``AuthSession`` is
    always the person who is logging in, not whatever the
    request-wide "目前操作者" entry point would otherwise report).

    Flushes but does not commit -- the caller (a FastAPI dependency
    using ``app.db.unit_of_work``) commits once its request
    finishes handling successfully.
    """
    token = generate_token()
    now = clock.utc_now()
    timeouts = get_session_timeouts()
    session_row = AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=now + timeouts.absolute_timeout,
        last_seen_at=now,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(session_row)
    db.flush()
    return session_row, token


def _is_expired(
    row: AuthSession, now: datetime, idle_timeout: timedelta
) -> bool:
    """AUT-R15's two deadlines. Absolute: expired once the elapsed
    time reaches (not merely exceeds) the absolute timeout. Idle:
    expired only once the idle time exceeds (strictly more than)
    the idle timeout -- exactly equal is still valid.
    """
    if now >= row.expires_at:
        return True
    return (now - row.last_seen_at) > idle_timeout


def validate_and_touch_session(db: Session, token: str) -> User | None:
    """The per-request check AUT-R14 requires: resolve ``token`` to
    its ``User`` when the login state is valid, or delete the row
    and return ``None`` when it is not (unknown token, past either
    deadline, or the user is no longer active).

    ``User.is_active`` is read fresh from the database on every
    call (never cached on ``AuthSession``), so deactivating someone
    takes effect on their very next request, per AUT-R14. On
    success, advances ``last_seen_at`` to now (AUT-R15) and flushes
    (but does not commit): the caller (``require_login``) returns
    normally afterwards, so the request's own unit of work commits
    it.

    A rejection, in contrast, *commits* the deletion immediately
    instead of merely flushing it. ``require_login`` always raises
    an ``APIError`` right after getting ``None`` back from this
    function, and that request's unit of work rolls everything
    back on any raised exception -- without an explicit commit
    here, the very deletion AUT-R14 requires would be undone by
    the same request that was supposed to perform it.
    """
    token_hash = hash_token(token)
    row = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_hash)
    )
    if row is None:
        return None

    now = clock.utc_now()
    timeouts = get_session_timeouts()
    user = db.get(User, row.user_id)

    if (
        user is None
        or not user.is_active
        or _is_expired(row, now, timeouts.idle_timeout)
    ):
        db.delete(row)
        db.commit()
        return None

    row.last_seen_at = now
    row.updated_by = row.user_id
    db.flush()
    return user


def delete_session_by_token(db: Session, token: str) -> None:
    """Delete the ``AuthSession`` matching ``token`` (AUT-R07's
    logout). Idempotent: does nothing when no row matches an
    unknown or already-removed token.
    """
    token_hash = hash_token(token)
    row = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_hash)
    )
    if row is not None:
        db.delete(row)
        db.flush()


def delete_all_sessions_for_user(db: Session, user_id: uuid.UUID) -> None:
    """Delete every ``AuthSession`` belonging to ``user_id``
    (AUT-R25, AUT-R35): used by the set-password command/Service
    entry point (T6/T11) and by change-password (T11), both outside
    this task -- kept here since it is plain login-state
    bookkeeping, the same category as the functions above.
    """
    db.query(AuthSession).filter(AuthSession.user_id == user_id).delete(
        synchronize_session=False
    )


def count_valid_sessions(db: Session, user_id: uuid.UUID) -> int:
    """AUT-R16: how many of ``user_id``'s ``AuthSession`` rows are
    currently valid (neither past the absolute deadline nor idle
    beyond the idle timeout), for a future deactivation screen's
    "N active logins" figure.

    Read-only: unlike ``validate_and_touch_session``, this never
    deletes the invalid rows it counts past -- a display-only
    calculation should not have the side effect of pruning data.
    """
    now = clock.utc_now()
    timeouts = get_session_timeouts()
    rows = db.scalars(
        select(AuthSession).where(AuthSession.user_id == user_id)
    ).all()
    return sum(
        1 for row in rows if not _is_expired(row, now, timeouts.idle_timeout)
    )
