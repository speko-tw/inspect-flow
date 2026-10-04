"""Password-based login: which ``User``, if any, a plaintext
password belongs to (AUT-R01, AUT-R02, AUT-R05, AUT-R06, AUT-R27).

Deliberately separate from ``app.auth.sessions.create_session``
(AUT-R27): this module only verifies a password. It never creates
an ``AuthSession`` or touches a Cookie itself.

Also writes the ``auth.login_succeeded``/``auth.login_failed``
application log entries AUT-R40 requires (this is the only place
that knows both the resolved ``User``, if any, and the specific
failure reason). AUT-R41: the log message is a fixed string, never
built from ``login`` or ``password``; ``extra`` never carries a
password, a hash or a Cookie/token value.
"""

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.lockout import (
    clear_after_successful_check,
    is_locked,
    record_failure,
    wait_for_sqlite_login_write_lock,
)
from app.auth.passwords import hash_password, needs_rehash, verify_password
from app.models import User, UserPassword

logger = logging.getLogger("app.auth")

# AUT-R06: when the login does not exist, or exists but has no
# password set, a same-cost hash verification still runs so the
# response time does not give away which of these is true. This
# hash is created once, at import time, and reused for every such
# call -- generating a fresh hash per request would itself take
# time and reintroduce the gap this is meant to close (see plan.md's
# "風險" section). The password string is arbitrary: it only needs
# to produce a structurally valid Argon2id hash that never matches
# a real login attempt.
_DUMMY_PASSWORD_HASH = hash_password(
    "inspectflow-dummy-hash-for-timing-safety-only"
)


def authenticate(db: Session, login: str, password: str) -> User | None:
    """Verify ``login``/``password`` against a local account.

    Returns the matching ``User`` only when every one of AUT-R06's
    conditions holds: an account matching this login (compared
    case-insensitively, DOM-R02 and DOM-R45) exists, is ``auth_source =
    "local"``, is ``is_active``, has a password set, and the
    password is correct. Every other combination -- unknown email,
    wrong password, disabled account, external account, or a local
    account with no ``UserPassword`` row -- returns ``None``,
    indistinguishable from the caller's point of view. An ``@`` in
    the stripped login selects email; otherwise it selects username.

    ``verify_password`` is always called exactly once, against
    either the account's real hash or the module-level dummy hash
    when there is no real hash to check (AUT-R06). Rehashes the
    stored hash in place (AUT-R02, flushed but not committed) when
    it verified successfully but uses outdated parameters.

    AUT-R40: logs exactly one ``auth.login_succeeded`` or
    ``auth.login_failed`` entry per call. The failure reason
    (``invalid_credentials`` or ``account_disabled``) is only ever
    distinguished in this log, never in the response AUT-R06
    requires to stay uniform: an unknown login, a local account with
    no ``UserPassword`` row, an external account, and a wrong
    password (including a wrong password on a disabled account) are
    all ``invalid_credentials``; ``account_disabled`` is reported
    only once the password itself has already checked out.
    """
    normalized_login = login.strip().lower()
    column = User.email if "@" in normalized_login else User.username
    user = db.scalar(
        select(User).where(func.lower(column) == normalized_login)
    )

    user_password: UserPassword | None = None
    password_hash = _DUMMY_PASSWORD_HASH
    if user is not None:
        user_password = db.scalar(
            select(UserPassword).where(UserPassword.user_id == user.id)
        )
        if user_password is not None:
            password_hash = user_password.password_hash

    password_ok = verify_password(password_hash, password)

    def _log_failed(user_id: str | None, reason: str) -> None:
        logger.info(
            "auth.login_failed",
            extra={
                "event": "auth.login_failed",
                "user_id": user_id,
                "reason": reason,
            },
        )

    user_id = user.id if user is not None else None
    # Known wrong passwords also write a failure counter after their
    # Argon2 check; that extra database round trip is small beside the
    # hash cost. This timing difference is accepted for this internal
    # network service, which also locks accounts after repeated failures.
    # AUT-R06: unknown accounts still pay for one lockout lookup,
    # using a fixed absent ID; neither path reveals the login.
    locked = is_locked(db, user_id)
    if user is None:
        _log_failed(None, "invalid_credentials")
        db.commit()
        wait_for_sqlite_login_write_lock(db)
        db.commit()
        return None
    assert user_id is not None
    if locked:
        _log_failed(str(user_id), "locked")
        db.commit()
        wait_for_sqlite_login_write_lock(db)
        db.commit()
        return None
    if user_password is None:
        db.commit()
        record_failure(db, user_id)
        _log_failed(str(user_id), "invalid_credentials")
        return None
    if user.auth_source != "local":
        db.commit()
        record_failure(db, user_id)
        _log_failed(str(user_id), "invalid_credentials")
        return None
    if not password_ok:
        db.commit()
        record_failure(db, user_id)
        _log_failed(str(user_id), "invalid_credentials")
        return None
    db.commit()
    # The earlier lock check preceded Argon2 and cannot authorize success:
    # a concurrent tenth failure may have locked this account meanwhile.
    # Recheck while holding the same per-account write lock used by failures.
    if not clear_after_successful_check(db, user_id):
        _log_failed(str(user_id), "locked")
        return None
    if not user.is_active:
        _log_failed(str(user.id), "account_disabled")
        return None

    logger.info(
        "auth.login_succeeded",
        extra={
            "event": "auth.login_succeeded",
            "user_id": str(user.id),
            "reason": None,
        },
    )

    if needs_rehash(password_hash):
        user_password.password_hash = hash_password(password)
        db.flush()

    return user
