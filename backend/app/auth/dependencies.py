"""FastAPI dependencies for the database session, the "需登入"
access level (AUT-R14, AUT-R18) and the temporary-password gate on
top of it (AUT-R32, AUT-R33).

Only the "需登入" layer and the temporary-password gate live here;
T4 builds "需 Admin"、"需專案權限"、"本人或 Admin" on top of both
(plan.md's risk section requires those to sit above this same
dependency so the gate applies to every layer).
"""

import contextvars
from collections.abc import AsyncGenerator, Generator

from fastapi import Depends, Request
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.sessions import SESSION_COOKIE_NAME, validate_and_touch_session
from app.db.unit_of_work import unit_of_work
from app.models import User, UserPassword

# AUT-R33: while a ``local`` account's password is still marked
# temporary, only these (method, endpoint) pairs are let through the
# gate below; every other request that reaches ``require_login`` is
# rejected before its route handler runs. Identified by the matched
# route's *endpoint* -- ``f"{endpoint.__module__}.{endpoint.__qualname__}"``
# -- rather than by request path or route-template string, so the
# allowlist keeps working (and keeps meaning "this one operation")
# regardless of which prefix(es) ``include_router`` mounts the route
# under. AUT-AC35/AUT-AC36 assert this set's exact contents against
# the real application's routes.
TEMPORARY_PASSWORD_ALLOWLIST: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "app.api.v1.auth.get_me"),
        ("POST", "app.api.v1.auth.logout"),
    }
)


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

    ``app.main.create_app()`` applies this at the app level
    (``FastAPI(dependencies=[Depends(bind_request_scope)])``), so
    every route on the real application already runs inside the
    request scope -- including T4's "公開" one -- without having to
    declare it itself. ``require_login`` below still depends on it
    directly too; FastAPI caches a dependency's result per request
    by callable identity, so the two calls resolve to the same
    cached run instead of entering (and leaving) the scope twice.
    A route built on a bare ``FastAPI()`` in a test (rather than
    through ``create_app()``) does not get this for free and must
    add ``Depends(bind_request_scope)`` itself, or T5's
    ``get_current_operator`` treats the call as a non-request call
    and falls back to the built-in ``admin`` instead of rejecting an
    anonymous request.
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


def has_effective_temporary_password_flag(db: Session, user: User) -> bool:
    """AUT-R32/AUT-R33's "有效標記": whether ``user`` currently must
    change a temporary password.

    Only ``auth_source = "local"`` accounts are ever affected
    (AUT-R32): an external account reports ``False`` here even when
    a leftover ``UserPassword`` row (from before it was converted)
    still carries the flag, since that row "not being used" is
    exactly what AUT-R32 means by "外部帳號不使用本地密碼". A
    ``local`` account with no ``UserPassword`` row at all (cannot
    log in with a password anyway) also reports ``False``.

    Shared by the temporary-password gate below and by the
    ``me``/login response bodies (AUT-R08, ``app/api/v1/auth.py``)
    so the two can never disagree about what the flag currently
    is.
    """
    if user.auth_source != "local":
        return False
    user_password = (
        db.query(UserPassword).filter_by(user_id=user.id).one_or_none()
    )
    return user_password is not None and user_password.must_change_password


def _matched_route_operation(request: Request) -> str | None:
    """The matched route's endpoint identity, as
    ``f"{endpoint.__module__}.{endpoint.__qualname__}"`` (e.g.
    ``"app.api.v1.auth.get_me"``), used instead of the request path
    so which prefix(es) ``include_router`` happens to mount the
    route under can never affect ``TEMPORARY_PASSWORD_ALLOWLIST``:
    the same handler function is the same operation no matter how
    many aliases reach it.

    ``request.scope["route"]`` (the same attribute
    ``app/api/errors.py``'s unhandled-exception handler already
    reads) is already the ``APIRoute`` Starlette matched this
    request against by the time a dependency of that route (such as
    this gate) runs -- so this never has to re-derive or re-compile
    anything path-related itself.

    Reports ``None`` when the matched route isn't an ``APIRoute``
    with a real ``endpoint`` (defensive; every route that reaches
    ``require_login`` is one in practice). ``None`` never matches
    any entry in ``TEMPORARY_PASSWORD_ALLOWLIST``, so this keeps the
    gate fail-closed: a request whose operation cannot be confirmed
    is rejected rather than risk wrongly allowing it through.
    """
    route = request.scope.get("route")
    if not isinstance(route, APIRoute):
        return None
    endpoint = route.endpoint
    module = getattr(endpoint, "__module__", None)
    qualname = getattr(endpoint, "__qualname__", None)
    if not module or not qualname:
        return None
    return f"{module}.{qualname}"


def _check_temporary_password_gate(
    request: Request,
    user: User = Depends(_check_login),  # noqa: B008 -- FastAPI's DI
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> User:
    """AUT-R33: once AUT-R14 (``_check_login``) has confirmed the
    login state itself is valid, reject a still-temporary ``local``
    password's request unless it matches
    ``TEMPORARY_PASSWORD_ALLOWLIST`` -- with 403
    ``auth.password_change_required``, and before the route handler
    ever runs (raising here stops FastAPI's dependency resolution,
    same as ``_check_login`` raising 401 does).
    """
    if has_effective_temporary_password_flag(db, user):
        operation = _matched_route_operation(request)
        if (request.method, operation) not in TEMPORARY_PASSWORD_ALLOWLIST:
            raise APIError(ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED, 403)
    return user


async def require_login(
    _scope: None = Depends(bind_request_scope),  # noqa: B008
    user: User = Depends(_check_temporary_password_gate),  # noqa: B008
) -> AsyncGenerator[User, None]:
    """The "需登入" access level (AUT-R14, AUT-R18) plus the
    temporary-password gate on top of it (AUT-R33):
    ``_check_temporary_password_gate`` runs ``_check_login`` and
    then the gate itself; this ``async`` wrapper marks the request
    scope (``bind_request_scope``) and then upgrades it from
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
