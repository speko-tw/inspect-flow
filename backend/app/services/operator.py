"""Single entry point for "the current operator" (DOM-R14).

Every Service-layer write that needs to fill ``created_by``/
``updated_by`` must call :func:`get_current_operator` instead of
looking up ``is_system`` (or anything else) itself, and never
inspects ``in_request_scope()``/``get_request_user()`` directly --
so that a future change to how the operator is resolved only ever
touches this file, not ``companies.py`` or ``users.py``.

``authentication``'s T5 (issue #153) resolves the operator from
request context (``app.auth.dependencies``, populated by T3's
``bind_request_scope``/``require_login``) when one is present:

- Inside an HTTP request with a logged-in user: that ``User``
  (AUT-R09).
- Inside an HTTP request with nobody logged in: rejects with
  :class:`OperatorNotAuthenticatedError` rather than falling back to
  the built-in admin (AUT-R09) -- see that class's docstring for why.
- Outside of any HTTP request (a command-line entry point or other
  background job): the built-in system account (``is_system =
  True``, created by the initialization command, DOM-R11/DOM-R13 --
  there is exactly one such row once the system has been
  initialized), exactly as before ``authentication`` existed
  (AUT-R26).
"""

from sqlalchemy import select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.orm import Session

from app.auth.dependencies import get_request_user, in_request_scope
from app.models import User


class OperatorNotFoundError(RuntimeError):
    """No built-in system account (``is_system = True``) exists
    yet -- the initialization command (DOM-R11) has not run against
    this database.
    """


class MultipleOperatorsFoundError(RuntimeError):
    """More than one built-in system account (``is_system = True``)
    exists. DOM-R11/DOM-R13 expect exactly one once the system has
    been initialized; this signals a data problem (or a bypass of
    the initialization command) rather than silently picking one of
    them as "the" operator.
    """


class OperatorNotAuthenticatedError(RuntimeError):
    """Raised when :func:`get_current_operator` is called while an
    HTTP request is being handled (``in_request_scope()`` is
    ``True``) but nobody is logged in (AUT-R09).

    This deliberately does not fall back to the built-in ``admin``:
    doing so would let an unauthenticated write be recorded as if
    the system account made it, hiding the fact that a route wrote
    to the database without going through the "需登入" access level
    (``app.auth.dependencies.require_login`` or an access level
    built on top of it).

    This is also deliberately a plain ``RuntimeError`` rather than
    ``app.api.errors.APIError``: the Service layer must not depend
    on the API layer. In practice, this can only happen when a route
    handler reaches a Service-layer write without depending on
    ``require_login`` (or a stricter access level) -- a routing bug,
    not a normal "not logged in" request. Left uncaught, it surfaces
    as an unhandled exception (500 ``server.internal_error``) and
    the surrounding transaction rolls back (``app.db.unit_of_work``),
    so no write ever lands; the offending route is not masked behind
    an ordinary 401 either, since that would look like working-as-
    intended access control instead of a bug.
    """


def get_current_operator(session: Session) -> User:
    """Return "the current operator" to fill ``created_by``/
    ``updated_by`` with (DOM-R14, AUT-R09).

    Inside an HTTP request (``in_request_scope()``), returns the
    logged-in ``User``, or raises
    :class:`OperatorNotAuthenticatedError` when nobody is logged in.
    Outside of any request, returns the built-in system account
    (``is_system = True``), raising :class:`OperatorNotFoundError`
    when none exists or :class:`MultipleOperatorsFoundError` when
    more than one ``is_system = True`` row exists -- callers should
    let any of these three propagate rather than invent a fallback
    operator.
    """
    if in_request_scope():
        user = get_request_user()
        if user is None:
            raise OperatorNotAuthenticatedError(
                "get_current_operator() was called while handling an "
                "HTTP request, but nobody is logged in (AUT-R09); the "
                "route reaching this call must depend on "
                "app.auth.dependencies.require_login (or a stricter "
                "access level built on it)"
            )
        return user

    try:
        operator = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one_or_none()
    except MultipleResultsFound as exc:
        raise MultipleOperatorsFoundError(
            "more than one is_system=True User found; DOM-R11/DOM-R13 "
            "expect exactly one once the system has been initialized"
        ) from exc
    if operator is None:
        raise OperatorNotFoundError(
            "no is_system=True User found; has the initialization "
            "command (DOM-R11) been run against this database?"
        )
    return operator
