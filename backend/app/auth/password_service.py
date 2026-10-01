"""Password-setting Service entry point (AUT-R36).

:func:`set_password` is the one place that hashes a new password,
writes it to ``UserPassword``, deletes the account's existing
``AuthSession`` rows (AUT-R25) and writes the ``user.password_set``
audit record (AUT-R39, AUT-AC49, AUT-AC50) -- shared by the
set-password command (``app.cli.set_password``, T6) and the
change-password API (``app/api/v1/auth.py``, AUT-R34, both T11).
Whether ``admin-dashboard``'s future "Admin 設定臨時密碼" screen calls
this directly or through its own endpoint, it goes through the same
function, so the length check, the audit write and AUT-R25's session
cleanup can never be missed at one call site but not another
(AUT-R36's "單一入口" rationale).

``is_temporary`` is always an explicit parameter, never inferred here:
this module knows nothing about *why* a password is being set, only
what to do once told. The set-password command computes it from
``user.is_system`` (AUT-R37); the change-password API always passes
``False`` (AUT-R34 clears the flag on success); a future Admin
"設定臨時密碼" call always passes ``True`` (AUT-R36).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.lockout import clear_failed_attempts
from app.auth.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    check_password_length,
    hash_password,
)
from app.auth.sessions import delete_all_sessions_for_user
from app.models import User, UserPassword
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator


class PasswordLengthError(ValueError):
    """AUT-R04: the password's length (in Unicode code points) is
    outside ``[MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH]``. Raised
    before anything is written -- ``UserPassword``, the account's
    login states and the audit trail are all left untouched
    (AUT-AC39).
    """


def _clear_login_failures(session: Session, user: User) -> None:
    """Clear failed checks and lift a lockout after password reset."""
    clear_failed_attempts(session, user.id)


def set_password(
    session: Session,
    user: User,
    password: str,
    *,
    is_temporary: bool,
    system_event: bool = False,
) -> UserPassword:
    """Set or replace ``user``'s password (AUT-R36).

    Checks AUT-R04's length rule first and raises
    :class:`PasswordLengthError` without writing anything when it
    fails (AUT-AC39). Otherwise: hashes ``password``, inserts or
    updates the ``UserPassword`` row (``must_change_password`` set to
    ``is_temporary``), deletes every one of ``user``'s existing
    ``AuthSession`` rows (AUT-R25), clears any login lockout
    (:func:`_clear_login_failures`), and writes one ``user.password_set`` audit
    record (AUT-R39) with ``before``/``after`` holding only the
    ``is_temporary`` flag -- never the password or its hash
    (ALG-R08). ``before`` is omitted entirely when ``user`` had no
    prior ``UserPassword`` row (the audit event's ``before_optional``,
    matching "之前沒有密碼時為空值").

    ``created_by``/``updated_by`` on the ``UserPassword`` row, and
    the audit record's operator, both come from
    :func:`app.services.operator.get_current_operator`: the logged-in
    caller inside an HTTP request (AUT-R09), or the built-in
    ``admin`` outside of one (a command-line entry point, AUT-R26).

    Only flushes -- never commits -- so the caller's own unit of
    work (a FastAPI request's ``app.db.unit_of_work``, or the
    set-password command's own) commits everything together.
    """
    if not check_password_length(password):
        raise PasswordLengthError(
            "password length must be between "
            f"{MIN_PASSWORD_LENGTH} and {MAX_PASSWORD_LENGTH} "
            "Unicode code points, inclusive (AUT-R04)"
        )

    operator = (
        session.scalars(select(User).where(User.is_system.is_(True))).one()
        if system_event
        else get_current_operator(session)
    )
    password_hash = hash_password(password)

    existing = session.scalars(
        select(UserPassword).where(UserPassword.user_id == user.id)
    ).one_or_none()
    before_is_temporary = (
        None if existing is None else existing.must_change_password
    )

    if existing is None:
        existing = UserPassword(
            user_id=user.id,
            password_hash=password_hash,
            must_change_password=is_temporary,
            created_by=operator.id,
            updated_by=operator.id,
        )
        session.add(existing)
    else:
        existing.password_hash = password_hash
        existing.must_change_password = is_temporary
        existing.updated_by = operator.id
    session.flush()

    delete_all_sessions_for_user(session, user.id)
    session.flush()

    _clear_login_failures(session, user)

    before = (
        None
        if before_is_temporary is None
        else {"is_temporary": before_is_temporary}
    )
    record_audit_event(
        session,
        "user.password_set",
        entity_id=user.id,
        before=before,
        after={"is_temporary": is_temporary},
        system_event=system_event,
    )

    return existing
