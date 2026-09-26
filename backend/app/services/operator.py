"""Single entry point for "the current operator" (DOM-R14).

Every Service-layer write that needs to fill ``created_by``/
``updated_by`` must call :func:`get_current_operator` instead of
looking up ``is_system`` (or anything else) itself. Before
``authentication`` exists, this always returns the built-in system
account (``is_system = True``, created by the initialization
command, DOM-R11/DOM-R13 -- there is exactly one such row once the
system has been initialized).

``authentication``'s T5 (issue #153) rewrites this module to return
the logged-in user from request context when one is present, and
falls back to the built-in admin only outside a request (AUT-R09,
mirrored by this task's ticket). Every caller goes through this
single function and never inspects ``is_system`` itself, so that
later swap only touches this file -- nothing in ``companies.py`` or
``users.py`` needs to change.
"""

from sqlalchemy import select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.orm import Session

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


def get_current_operator(session: Session) -> User:
    """Return "the current operator" to fill ``created_by``/
    ``updated_by`` with (DOM-R14).

    Before ``authentication`` exists, this is always the built-in
    system account. Raises :class:`OperatorNotFoundError` when none
    exists, or :class:`MultipleOperatorsFoundError` when more than
    one ``is_system = True`` row exists -- callers should let either
    propagate rather than invent a fallback operator.
    """
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
