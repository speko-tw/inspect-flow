"""FastAPI dependencies for the database session, the "需登入"
access level (AUT-R14, AUT-R18) and the temporary-password gate on
top of it (AUT-R32, AUT-R33).

Only the "需登入" layer and the temporary-password gate live here;
T4 builds "需 Admin"、"需專案權限"、"本人或 Admin" on top of both
(plan.md's risk section requires those to sit above this same
dependency so the gate applies to every layer).
"""

import contextvars
from collections.abc import AsyncGenerator, Generator, Iterator, Sequence
from typing import Any

from fastapi import Depends, Request
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.routing import BaseRoute, compile_path

from app.api.errors import APIError, ErrorCode
from app.auth.sessions import SESSION_COOKIE_NAME, validate_and_touch_session
from app.db.unit_of_work import unit_of_work
from app.models import User, UserPassword

# AUT-R33: while a ``local`` account's password is still marked
# temporary, only these (method, route-template) pairs are let
# through the gate below; every other request that reaches
# ``require_login`` is rejected before its route handler runs.
# Route templates, not raw request paths, so a path parameter's
# value can never accidentally match (or fail to match) an entry
# here. AUT-AC35/AUT-AC36 assert this set's exact contents against
# the real application's routes.
TEMPORARY_PASSWORD_ALLOWLIST: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/auth/me"),
        ("POST", "/api/v1/auth/logout"),
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


def _iter_routes_with_full_path(
    routes: Sequence[BaseRoute],
) -> Iterator[tuple[APIRoute, str]]:
    """Yield every ``APIRoute`` mounted (directly or through a
    ``include_router``) on ``routes`` together with its effective,
    fully-prefixed path.

    ``app.routes`` used to hold ``APIRoute`` objects with
    ``include_router(..., prefix=...)`` already rewriting each
    one's ``.path`` to include the prefix. The installed FastAPI no
    longer flattens an included router this way: it groups the
    included router's routes behind an internal node instead, whose
    own ``APIRoute`` objects keep their *unprefixed* path. Each such
    node still exposes ``effective_candidates()`` -- the same
    lookup FastAPI itself uses to resolve a request -- which
    resolves the original ``APIRoute`` together with its effective,
    fully-prefixed path; this is used via duck typing (``hasattr``)
    rather than importing any internal class, so it keeps working
    whether or not a given route happens to be flattened. Mirrors
    ``tests/contract/test_route_conventions.py``'s
    ``_iter_business_routes`` (not imported from there: that module
    is test-only).
    """
    for route in routes:
        if isinstance(route, APIRoute):
            yield route, route.path
            continue
        effective_candidates = getattr(route, "effective_candidates", None)
        if not callable(effective_candidates):
            continue
        # No stable public type to annotate against here -- this is
        # a duck-typed lookup on an internal FastAPI grouping node --
        # so each item is verified via ``isinstance`` below before
        # being yielded.
        candidates: Any = effective_candidates()
        for context in candidates:
            original_route = getattr(context, "original_route", None)
            path = getattr(context, "path", None)
            if isinstance(original_route, APIRoute) and isinstance(path, str):
                yield original_route, path


def _route_path(request: Request) -> str:
    """The path used for route matching -- mirrors Starlette's own
    (private) ``get_route_path``: ``request.scope["path"]`` with
    ``scope["root_path"]`` stripped when the ASGI server mounted the
    app under one. Reimplemented rather than imported since that
    helper lives in an underscored, private module.
    """
    path = request.scope["path"]
    root_path = request.scope.get("root_path", "")
    if not root_path or not path.startswith(root_path):
        return path
    if path == root_path:
        return ""
    return path[len(root_path) :]


def _matched_route_template(request: Request) -> str | None:
    """The matched route's fully-prefixed path template (e.g.
    ``/api/v1/auth/me``), used instead of the raw request path so a
    path parameter's value can never accidentally widen or narrow
    ``TEMPORARY_PASSWORD_ALLOWLIST``.

    ``request.scope["route"]`` (the same attribute
    ``app/api/errors.py``'s unhandled-exception handler already
    reads) only carries the *unprefixed* path on this FastAPI
    version once the route was reached through an included
    sub-router (see ``_iter_routes_with_full_path``), so the
    matched route's fully-prefixed candidates are looked up by
    identity against ``request.app``'s own routes to recover its
    effective path.

    The same ``APIRoute`` object is matched by identity alone when
    only one router mounts it, but a router that is
    ``include_router``-ed more than once (e.g. under an additional
    alias prefix) makes the *same* ``APIRoute`` object show up for
    more than one full path template (AUT-R33): identity is not
    enough to tell which of those templates this particular request
    actually took. Each identity-matching candidate's template is
    therefore compiled with ``starlette.routing.compile_path`` and
    matched against this request's actual path
    (``_route_path(request)``, which accounts for ``root_path`` the
    same way Starlette's own route matching does); only a template
    whose regex actually matches is returned.

    No candidate's template matching -- including the route not
    being found among ``request.app``'s routes at all -- reports
    ``None`` rather than falling back to some other path (e.g. the
    unprefixed ``route.path``). ``None`` never matches any entry in
    ``TEMPORARY_PASSWORD_ALLOWLIST`` (all of them are ``(method,
    template)`` pairs with a real template), so this keeps the gate
    fail-closed: a request whose effective path template cannot be
    confirmed is rejected rather than risk wrongly allowing it
    through.
    """
    route = request.scope.get("route")
    if route is None:
        return None
    route_path = _route_path(request)
    for candidate, path in _iter_routes_with_full_path(request.app.routes):
        if candidate is not route:
            continue
        path_regex, _, _ = compile_path(path)
        if path_regex.match(route_path):
            return path
    return None


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
        template = _matched_route_template(request)
        if (request.method, template) not in TEMPORARY_PASSWORD_ALLOWLIST:
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
