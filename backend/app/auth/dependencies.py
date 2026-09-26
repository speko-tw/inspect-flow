"""FastAPI dependencies for the database session and the "需登入"
access level (AUT-R14, AUT-R18).

Only the "需登入" layer lives here; T4 builds "需 Admin"、"需專案
權限"、"本人或 Admin" on top of it (plan.md's risk section requires
those to sit above this same dependency so T9's temporary-password
gate, once added here, applies to every layer).
"""

from collections.abc import Generator

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


def require_login(
    request: Request,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> User:
    """The "需登入" access level (AUT-R14, AUT-R18).

    Resolves the session Cookie to its ``User``, rejecting with
    401 ``auth.not_authenticated`` when the Cookie is missing or
    ``validate_and_touch_session`` reports the login state is no
    longer valid (unknown token, expired, or the account is no
    longer active).

    Also stashes the resolved user on ``request.state.current_user``
    -- the request-scoped interface this task hands to T5's rewrite
    of the "目前操作者" entry point (DOM-R14/AUT-R09). ``request``
    is the same object for every dependency and the route handler
    within one request, so this attribute is reliably visible to
    anything that itself receives ``request`` (directly, or via its
    own ``Depends`` chain). It is **not** automatically visible to
    plain Service-layer functions that take no ``request``/``Request``
    parameter at all -- T5's entry point will need to either accept
    that parameter along its own call chain, or add its own
    mechanism (for example a ``contextvar`` set from an ``async``
    boundary) to reach code that has no such parameter; see this
    task's handback report for the full caveat.
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is None:
        raise APIError(ErrorCode.AUTH_NOT_AUTHENTICATED, 401)

    user = validate_and_touch_session(db, token)
    if user is None:
        raise APIError(ErrorCode.AUTH_NOT_AUTHENTICATED, 401)

    request.state.current_user = user
    return user
