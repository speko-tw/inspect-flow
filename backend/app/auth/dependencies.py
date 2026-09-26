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


class _NotInRequest:
    """Sentinel: ``_request_user``'s default value, meaning no
    request-scoped dependency (``bind_request_scope``) is active in
    the current context -- as opposed to one being active with no
    logged-in user. AUT-R09 tells these two apart: a command (not a
    request at all) falls back to the built-in ``admin``, while an
    HTTP request with nobody logged in must be rejected.
    """


_NOT_IN_REQUEST = _NotInRequest()

# The request-scoped current user (DOM-R14/AUT-R09): Service-layer
# code that has no ``Request`` parameter at all -- T5's rewrite of
# the "目前操作者" entry point -- reads this through
# ``get_request_user()``/``in_request_scope()`` instead.
# ``request.state`` (used by an earlier version of this module) only
# helps callers that already have ``request`` in hand, which a
# Service-layer function usually does not. Set from ``async``
# dependencies only (``bind_request_scope``, ``require_login``), not
# from ``_check_login`` itself -- see ``require_login``'s docstring
# for why.
_request_user: contextvars.ContextVar[User | None | _NotInRequest] = (
    contextvars.ContextVar("request_user", default=_NOT_IN_REQUEST)
)


def get_request_user() -> User | None:
    """The current request's logged-in ``User``; ``None`` both when
    nobody is logged in and when called outside of any request (use
    ``in_request_scope()`` to tell those two apart).
    """
    value = _request_user.get()
    return None if isinstance(value, _NotInRequest) else value


def in_request_scope() -> bool:
    """Whether the current context is inside a request that ran
    ``bind_request_scope`` -- with or without a logged-in user.
    ``False`` outside of any HTTP request (a command-line entry
    point, for instance).
    """
    return not isinstance(_request_user.get(), _NotInRequest)


async def bind_request_scope() -> AsyncGenerator[None, None]:
    """Marks "an HTTP request is being handled" for the rest of
    this request, independent of whether anyone is logged in.

    Every access level -- including T4's "公開" one -- must depend
    on this (directly or, like ``require_login`` below, through a
    dependency that itself does); a route that skips it makes T5's
    entry point treat it as a non-request call and fall back to the
    built-in ``admin`` instead of rejecting an anonymous request.
    """
    token = _request_user.set(None)
    try:
        yield
    finally:
        _request_user.reset(token)


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
    _scope: None = Depends(bind_request_scope),  # noqa: B008
    user: User = Depends(_check_login),  # noqa: B008 -- FastAPI's DI
) -> AsyncGenerator[User, None]:
    """The "需登入" access level (AUT-R14, AUT-R18): ``_check_login``
    does the actual validation; this ``async`` wrapper marks the
    request scope (``bind_request_scope``) and then upgrades it from
    "logged out" to ``user`` for the rest of this request, resetting
    back once the request is done.

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
