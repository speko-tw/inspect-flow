"""Route access-level declarations (AUT-R18~AUT-R23, AUT-R33).

AUT-R18 requires every ``/api/v1`` business route to declare exactly
one access level -- 公開 (public), 需登入 (login required), 需 Admin
(admin required), 需專案權限 (project permission) or 本人或 Admin
(self or admin) -- and an automated test to fail for any route that
does not. This module provides:

- One FastAPI dependency (or dependency *factory* when it needs a
  parameter) per access level. Each dependency
  callable carries a :class:`RouteAccessDeclaration` on a
  ``__route_access__`` attribute, so :func:`iter_route_access` can
  read a route's declared level back off its resolved dependency
  tree without any separate registry to keep in sync.
- :func:`iter_route_access`/:func:`check_route_access_declarations`:
  AUT-AC16's "list every route's declaration, and flag any route
  that does not have exactly one" mechanism.
- :data:`PUBLIC_ROUTES`: the single, centralized list of routes
  allowed to declare 公開 (plan.md's risk section: a new public route
  must touch this constant, making it visible in review).

Every level except 公開 is built on top of ``app.auth.dependencies
.require_login`` (``Depends(require_login)``), never a separate
login check of its own -- plan.md's risk section requires this so
T9's temporary-password gate (AUT-R33), which lives inside
``require_login``, keeps applying no matter which access level a
route declares (AUT-AC43). 公開 routes are the only ones that do not
go through ``require_login`` at all, and instead depend directly on
``bind_request_scope`` so a bare ``FastAPI()`` test app (which does
not get ``create_app()``'s app-level ``Depends(bind_request_scope)``
for free) still marks the request scope correctly.

A route's access level is read only from the *top level* of its
resolved dependency tree, not recursed into further -- verified
empirically that FastAPI does not fold ``require_login`` in as a
top-level entry when it is only reached *through* e.g.
``require_admin``'s own ``Depends(require_login)`` parameter; it
appears nested one level down, inside ``require_admin``'s own
``Dependant.dependencies``. Reading only the top level therefore
finds exactly the one dependency a route declared for itself, never
also the login check hiding underneath it.

That top level is *not* simply ``route.dependant.dependencies`` on
the original ``APIRoute`` -- verified empirically (FastAPI 0.141.1)
that a ``dependencies=[...]`` passed to ``app.include_router(...)``
or to an ``APIRouter(...)`` never gets folded into the original
route's own ``.dependant`` (that one is built once, at ``@router.get
(...)`` decoration time, before any ``include_router`` call exists to
contribute to it). It only lands in the separate ``Dependant``
FastAPI builds for the mounted ``_EffectiveRouteContext`` -- the same
object ``effective_candidates()`` yields and the one actually used to
handle a real request -- accumulated from every level (nested
``include_router`` calls' and ``APIRouter(...)``'s ``dependencies=``,
plus the route's own) via ``_RouterIncludeContext.combine()``. So
:func:`_route_declaration` reads that context's ``.dependant`` when
one exists, falling back to the route's own only for a route mounted
directly on ``app`` with no ``effective_candidates()`` wrapper. The
app-level ``Depends(bind_request_scope)`` (``create_app()``'s own
``FastAPI(dependencies=[...])``) rides along in that same merged list
too, but carries no ``__route_access__`` marker, so it never counts
as a declaration.
"""

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from enum import Enum, auto
from typing import Any

from fastapi import Depends, FastAPI, Request
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.dependencies import bind_request_scope, get_db, require_login
from app.models import (
    SystemRoleAssignment,
    SystemRoleCode,
    User,
)
from app.permission_codes import (
    is_permission_code_registered,
)
from app.services.permissions import (
    calculate_effective_access,
)


class AccessLevel(Enum):
    """Access levels used by routes under AUT-R18."""

    PUBLIC = auto()
    LOGIN_REQUIRED = auto()
    ADMIN_REQUIRED = auto()
    PROJECT_PERMISSION = auto()
    SELF_OR_ADMIN = auto()
    SYSTEM_ROLE_REQUIRED = auto()
    ADMIN_OR_SYSTEM_ROLE = auto()
    SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION = auto()


@dataclass(frozen=True)
class RouteAccessDeclaration:
    """One route's declared access level, plus whichever extra
    detail that level carries: the required project permission,
    system-role code, or path-parameter name where applicable. These
    are ``None`` for levels without extra detail.
    """

    level: AccessLevel
    permission_code: str | None = None
    param_name: str | None = None
    system_role_code: str | None = None


def _mark(
    func: Callable[..., Any], declaration: RouteAccessDeclaration
) -> Callable[..., Any]:
    """Attach ``declaration`` to ``func`` as ``__route_access__`` and
    return ``func`` unchanged, so this can wrap a ``def``/``async
    def`` statement's result in one line.
    """
    # Functions accept arbitrary attributes at runtime; pyright
    # cannot see this one on the ``Callable`` type.
    func.__route_access__ = declaration  # type: ignore[attr-defined]
    return func


def _declaration_of(
    call: Callable[..., Any] | None,
) -> RouteAccessDeclaration | None:
    if call is None:
        return None
    declaration = getattr(call, "__route_access__", None)
    if isinstance(declaration, RouteAccessDeclaration):
        return declaration
    return None


def _parse_uuid(raw: object) -> uuid.UUID | None:
    """Parse a path-parameter value as a UUID, or ``None`` if it is
    missing or invalid. This helper does not choose an HTTP response;
    callers map parse failures to their route's error contract.
    """
    if not isinstance(raw, str):
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def _has_system_role(
    db: Session, user: User, role_code: SystemRoleCode
) -> bool:
    assignment_id = db.scalar(
        select(SystemRoleAssignment.id).where(
            SystemRoleAssignment.user_id == user.id,
            SystemRoleAssignment.role_code == role_code.value,
        )
    )
    return assignment_id is not None


def is_admin_or_system_role(
    db: Session, user: User, role_code: SystemRoleCode
) -> bool:
    """Return whether the user is Admin or has the selected system role."""
    return user.is_admin or _has_system_role(db, user, role_code)


# -- 公開 (AUT-R18) -----------------------------------------------


def _public_marker(
    _scope: None = Depends(bind_request_scope),  # noqa: B008
) -> None:
    """Declares 公開: depends directly on ``bind_request_scope``
    (not ``require_login``) so a bare ``FastAPI()`` test app -- which
    does not get ``create_app()``'s app-level dependency for free --
    still marks the request scope correctly for a public route.
    FastAPI caches a dependency's result per request by callable
    identity, so on the real application this resolves to the same
    cached run ``create_app()``'s app-level dependency already
    performed, never a second one.
    """
    return None


_mark(_public_marker, RouteAccessDeclaration(level=AccessLevel.PUBLIC))

# Use as ``dependencies=[PUBLIC]`` on a route decorator/router to
# declare the 公開 access level.
PUBLIC: Any = Depends(_public_marker)

# AUT-R18/plan.md's risk section: the single, centralized list of
# routes allowed to declare 公開. A new public route must be added
# here too, or AUT-AC16 fails and the addition is visible in review.
PUBLIC_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("GET", "/api/v1/health"),
        ("GET", "/api/v1/version"),
        ("POST", "/api/v1/auth/login"),
        ("POST", "/api/v1/auth/logout"),
        ("GET", "/api/v1/setup/status"),
        ("POST", "/api/v1/setup/admin-password"),
    }
)


# -- 需登入 (AUT-R18) -----------------------------------------------


def require_login_access(
    user: User = Depends(require_login),  # noqa: B008
) -> User:
    """Declares 需登入: a thin, identifiable wrapper around
    ``require_login`` (AUT-R14/AUT-R33) -- it re-checks nothing on
    its own, only forwards the logged-in ``User``.
    """
    return user


_mark(
    require_login_access,
    RouteAccessDeclaration(level=AccessLevel.LOGIN_REQUIRED),
)


# -- 需 Admin (AUT-R20) ---------------------------------------------


def require_admin(
    user: User = Depends(require_login),  # noqa: B008
) -> User:
    """Declares 需 Admin: only ``user.is_admin`` passes, otherwise
    403 ``permission.denied`` (AUT-R20). Layered on ``require_login``
    so AUT-R33's temporary-password gate still applies (AUT-AC43).
    """
    if not user.is_admin:
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)
    return user


_mark(require_admin, RouteAccessDeclaration(level=AccessLevel.ADMIN_REQUIRED))


def require_system_role(
    role_code: SystemRoleCode,
) -> Callable[..., User]:
    """Build a login-gated dependency for one fixed system role."""

    def _check(
        user: User = Depends(require_login),  # noqa: B008
        db: Session = Depends(get_db),  # noqa: B008
    ) -> User:
        if not _has_system_role(db, user, role_code):
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.SYSTEM_ROLE_REQUIRED,
            permission_code=role_code.value,
        ),
    )


def require_admin_or_system_role(
    role_code: SystemRoleCode,
) -> Callable[..., User]:
    """Allow Admins and users assigned the selected fixed system role."""

    def _check(
        user: User = Depends(require_login),  # noqa: B008
        db: Session = Depends(get_db),  # noqa: B008
    ) -> User:
        if not is_admin_or_system_role(db, user, role_code):
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.ADMIN_OR_SYSTEM_ROLE,
            permission_code=role_code.value,
        ),
    )


def require_system_role_or_any_project_permission(
    role_code: SystemRoleCode, permission_code: str
) -> Callable[..., User]:
    """Allow Admin, the fixed role, or permission in any project."""
    if not is_permission_code_registered(permission_code):
        raise ValueError(f"unregistered permission code: {permission_code}")

    def _check(
        user: User = Depends(require_login),  # noqa: B008
        db: Session = Depends(get_db),  # noqa: B008
    ) -> User:
        if user.is_admin or _has_system_role(db, user, role_code):
            return user
        access = calculate_effective_access(db, user_id=user.id)
        if not any(
            permission_code in codes
            for codes in access.project_permissions_by_project.values()
        ):
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION,
            permission_code=permission_code,
            system_role_code=role_code.value,
        ),
    )


def require_admin_or_any_project_permission(
    permission_code: str,
) -> Callable[..., User]:
    """Allow Admin or a user holding a permission in any project."""
    if not is_permission_code_registered(permission_code):
        raise ValueError(f"unregistered permission code: {permission_code}")

    def _check(
        user: User = Depends(require_login),  # noqa: B008
        db: Session = Depends(get_db),  # noqa: B008
    ) -> User:
        if user.is_admin:
            return user
        access = calculate_effective_access(db, user_id=user.id)
        if not any(
            permission_code in codes
            for codes in access.project_permissions_by_project.values()
        ):
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.SYSTEM_ROLE_OR_ANY_PROJECT_PERMISSION,
            permission_code=permission_code,
            system_role_code="admin",
        ),
    )


# -- 需專案權限 (AUT-R19) --------------------------------------------


def require_project_permission(
    code: str,
    *,
    param_name: str = "project_id",
    uuid_path_params: tuple[str, ...] = (),
) -> Callable[..., User]:
    """Build a dependency declaring 需專案權限 for ``code``, read
    from the path parameter named ``param_name`` (default
    ``project_id``).

    AUT-R19's order: (1) the ``param_name`` and declared
    ``uuid_path_params`` path parameters are parsed as UUIDs *first*,
    before any Admin check -- an invalid UUID fails with 422
    ``request.validation_failed`` regardless of ``user.is_admin``, so
    Admin can never bypass malformed input to reach the permission
    check; (2) once parsed,
    ``user.is_admin`` passes regardless of membership or ``code``;
    (3) otherwise the union of the caller's project roles'
    permission codes (recomputed fresh on every call, never cached
    across requests -- ``effective_permissions`` itself already runs
    inside ``session.no_autoflush`` and only reflects already-flushed
    rows) must contain ``code``; (4) a non-member's empty set also
    fails closed with 403 ``permission.denied`` -- a nonexistent
    project simply matches zero membership rows, so it needs no
    separate check.

    ``code`` is checked against DOM-R35's registry *here*, at
    declaration time (fail fast): an unregistered code raises
    ``ValueError`` immediately rather than being used as a query
    value later, matching ``app/models/role.py``'s ``RolePermission``
    -- a query would otherwise silently match nothing for an
    unregistered code instead of surfacing the mistake.
    """
    if not is_permission_code_registered(code):
        raise ValueError(
            f"require_project_permission: {code!r} is not a "
            "registered permission code (DOM-R35)"
        )

    def _check(
        request: Request,
        user: User = Depends(require_login),  # noqa: B008
        db: Session = Depends(get_db),  # noqa: B008
    ) -> User:
        for name in uuid_path_params:
            raw_value = request.path_params.get(name)
            if raw_value is not None and _parse_uuid(raw_value) is None:
                raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        project_id = _parse_uuid(request.path_params.get(param_name))
        if project_id is None:
            raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
        if user.is_admin:
            return user
        access = calculate_effective_access(
            db, user_id=user.id, project_id=project_id
        )
        if code not in access.project_permissions:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.PROJECT_PERMISSION,
            permission_code=code,
            param_name=param_name,
        ),
    )


# -- 本人或 Admin (AUT-R21) ------------------------------------------


def require_self_or_admin(
    *, param_name: str = "user_id"
) -> Callable[..., User]:
    """Build a dependency declaring 本人或 Admin, read from the path
    parameter named ``param_name`` (default ``user_id``): the target
    path parameter is parsed as a UUID *first*, before any Admin
    check -- missing or not a valid UUID fails closed with 403
    ``permission.denied`` regardless of ``user.is_admin``, so Admin
    can never bypass a malformed request to reach the identity check
    (AUT-R21). Once parsed, it passes when the logged-in user's own
    id equals the target id, or when ``user.is_admin``; otherwise 403
    ``permission.denied``.
    """

    def _check(
        request: Request,
        user: User = Depends(require_login),  # noqa: B008
    ) -> User:
        target_id = _parse_uuid(request.path_params.get(param_name))
        if target_id is None:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        if user.is_admin:
            return user
        if target_id != user.id:
            raise APIError(ErrorCode.PERMISSION_DENIED, 403)
        return user

    return _mark(
        _check,
        RouteAccessDeclaration(
            level=AccessLevel.SELF_OR_ADMIN, param_name=param_name
        ),
    )


# -- Listing and checking declarations (AUT-AC16) -------------------


def _iter_business_routes(
    app: FastAPI,
) -> Iterator[tuple[APIRoute, str, list[Any]]]:
    """Yield every business ``APIRoute`` mounted on ``app`` together
    with its effective, fully-prefixed path and its *effective*
    top-level dependencies -- the ones that actually run for a real
    request, after any ``include_router(...)``/``APIRouter(...)``
    level ``dependencies=[...]`` have been folded in (see this
    module's docstring: those never reach the original route's own
    ``.dependant``).

    Deliberately the same duck-typed ``effective_candidates()``
    traversal ``tests/contract/test_route_conventions.py``'s helper
    of the same name uses for API-AC01 (see that module's docstring
    for why: an included router's routes are grouped behind an
    internal node on ``app.routes`` rather than flattened onto it).
    Kept as a separate copy here rather than imported from the tests
    package -- production code must not import from ``tests/``.
    """
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route, route.path, route.dependant.dependencies
            continue
        effective_candidates = getattr(route, "effective_candidates", None)
        if not callable(effective_candidates):
            continue
        candidates: Any = effective_candidates()
        for context in candidates:
            original_route = getattr(context, "original_route", None)
            path = getattr(context, "path", None)
            if isinstance(original_route, APIRoute) and isinstance(path, str):
                effective_dependant = (
                    getattr(context, "dependant", None)
                    or original_route.dependant
                )
                yield (
                    original_route,
                    path,
                    effective_dependant.dependencies,
                )


@dataclass(frozen=True)
class RouteAccessInfo:
    """One (method, path) business route together with whichever
    single :class:`RouteAccessDeclaration` its top-level dependency
    tree carries -- ``None`` when zero or more than one were found
    (AUT-R18: both count as "not declared").
    """

    method: str
    path: str
    declaration: RouteAccessDeclaration | None


def _route_declaration(
    dependencies: list[Any],
) -> RouteAccessDeclaration | None:
    """Find the single access-level declaration among a route's
    effective top-level ``dependencies`` (see this module's and
    :func:`_iter_business_routes`'s docstrings for why that list is
    not simply the original route's own ``.dependant.dependencies``)
    -- ``None`` when zero or more than one were found, both of which
    AUT-R18 counts as "not declared".
    """
    found = [
        declaration
        for dependant in dependencies
        if (declaration := _declaration_of(dependant.call)) is not None
    ]
    if len(found) == 1:
        return found[0]
    return None


def iter_route_access(app: FastAPI) -> Iterator[RouteAccessInfo]:
    """Yield a :class:`RouteAccessInfo` for every (method, path) pair
    across every business route mounted on ``app`` (AUT-AC16's
    "程式介面：列出所有路由宣告的方式").
    """
    for route, path, dependencies in _iter_business_routes(app):
        declaration = _route_declaration(dependencies)
        for method in sorted(route.methods or set()):
            yield RouteAccessInfo(
                method=method, path=path, declaration=declaration
            )


def undeclared_routes(app: FastAPI) -> list[str]:
    """``"METHOD path"`` for every business route on ``app`` that
    does not carry exactly one access-level declaration (AUT-AC16).
    Empty means every route is properly declared.
    """
    return [
        f"{info.method} {info.path}"
        for info in iter_route_access(app)
        if info.declaration is None
    ]


def declared_public_routes(app: FastAPI) -> frozenset[tuple[str, str]]:
    """The (method, path) pairs on ``app`` whose declaration is 公開
    -- compared against :data:`PUBLIC_ROUTES` by AUT-AC16.
    """
    return frozenset(
        (info.method, info.path)
        for info in iter_route_access(app)
        if info.declaration is not None
        and info.declaration.level is AccessLevel.PUBLIC
    )
