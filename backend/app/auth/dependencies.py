"""FastAPI dependencies for the database session and the "需登入"
access level (AUT-R14, AUT-R18).

Only the "需登入" layer lives here; T4 builds "需 Admin"、"需專案
權限"、"本人或 Admin" on top of it (plan.md's risk section requires
those to sit above this same dependency so T9's temporary-password
gate, once added here, applies to every layer).
"""

import contextvars
from collections.abc import AsyncGenerator, Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.sessions import SESSION_COOKIE_NAME, validate_and_touch_session
from app.db.unit_of_work import unit_of_work
from app.models import User


def get_db() -> Generator[Session, None, None]:
    """Yield a ``Session`` scoped to this request.

    Wraps ``app.db.unit_of_work``: the transaction commits once
    every dependency and the route handler sharing this session
    (FastAPI resolves ``Depends(get_db)`` once per request and
    reuses the result) finish without raising, and rolls back
    otherwise -- including when a route handler raises ``APIError``
    after this generator already yielded.
    """
    with unit_of_work() as session:
        yield session


# The request-scoped current user (DOM-R14/AUT-R09): Service-layer
# code that has no ``Request`` parameter at all -- T5's rewrite of
# the "目前操作者" entry point -- reads this through
# ``get_request_user()`` instead. ``request.state`` (used by an
# earlier version of this module) only helps callers that already
# have ``request`` in hand, which a Service-layer function usually
# does not; this variable is set from an ``async`` dependency (see
# ``require_login`` below), not from ``_check_login`` itself.
_request_user: contextvars.ContextVar[User | None] = contextvars.ContextVar(
    "request_user", default=None
)


def get_request_user() -> User | None:
    """The current request's logged-in ``User``, or ``None`` when
    called outside of a request that passed ``require_login`` (for
    example, a command-line entry point).
    """
    return _request_user.get()


def _check_login(
    request: Request,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> User:
    """The DB/Cookie half of the "需登入" check (AUT-R14, AUT-R18).

    A plain ``def`` (FastAPI runs it in a worker thread): resolves
    the session Cookie to its ``User``, rejecting with 401
    ``auth.not_authenticated`` when the Cookie is missing or
    ``validate_and_touch_session`` reports the login state is no
    longer valid (unknown token, expired, or the account is no
    longer active). Deliberately does not touch ``_request_user``
    itself -- a worker thread runs against its own copy of the
    context, so a ``ContextVar.set`` here would never be visible
    back in the coroutine that dispatches the route handler; see
    ``require_login``.
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        raise APIError(ErrorCode.AUTH_NOT_AUTHENTICATED, 401)

    user = validate_and_touch_session(db, token)
    if user is None:
        raise APIError(ErrorCode.AUTH_NOT_AUTHENTICATED, 401)

    return user


async def require_login(
    user: User = Depends(_check_login),  # noqa: B008 -- FastAPI's DI
) -> AsyncGenerator[User, None]:
    """The "需登入" access level (AUT-R14, AUT-R18): ``_check_login``
    does the actual validation; this ``async`` wrapper only sets
    ``_request_user`` for the rest of this request and resets it
    once the request is done.

    Must be ``async`` (not a plain ``def``) for the ``set`` below
    to reach the route handler at all: FastAPI/Starlette dispatch a
    sync callable -- a plain-``def`` dependency or the route
    handler itself -- through ``anyio.to_thread.run_sync``, which
    copies the *current* context into a worker thread; a mutation
    made inside that copy never propagates back out to whichever
    context a later, separate ``run_sync`` call copies from. An
    ``async def`` dependency, in contrast, runs directly in this
    request's own coroutine (no thread hop), so ``set`` here
    mutates the same context that a later sync route handler's
    ``run_sync`` call then copies -- verified in
    ``tests/auth/test_sessions.py``'s isolation test.
    """
    token = _request_user.set(user)
    try:
        yield user
    finally:
        _request_user.reset(token)
