"""Login, logout and current-user endpoints (AUT-R05~AUT-R14,
AUT-R32~AUT-R33, AUT-R18).

The change-password route (AUT-R34) is a later task (T11); this
module wires up the three routes T3 owns plus the
``must_change_password`` field T9 adds to their response body and
T4's access-level declarations (login and logout are 公開; ``me`` is
需登入).
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import PUBLIC, require_login_access
from app.auth.dependencies import (
    get_db,
    has_effective_temporary_password_flag,
    register_temporary_password_allowed,
)
from app.auth.login import authenticate
from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session_by_token,
)
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    """``POST /api/v1/auth/login`` request body."""

    email: str
    password: str


class CurrentUserResponse(BaseModel):
    """The login and current-user response body (AUT-R08, AUT-R10)."""

    id: UUID
    email: str
    name_en: str
    name_zh: str
    is_admin: bool
    must_change_password: bool


def _current_user_response(db: Session, user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        name_en=user.name_en,
        name_zh=user.name_zh,
        is_admin=user.is_admin,
        must_change_password=has_effective_temporary_password_flag(db, user),
    )


def _set_session_cookie(response: Response, token: str) -> None:
    """AUT-R12: ``HttpOnly``, ``Secure``, ``SameSite=Strict``,
    ``Path=/``, no ``Domain`` -- required for the ``__Host-``
    prefix to be honored by the browser.
    """
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=True,
        samesite="strict",
    )


@router.post(
    "/login", response_model=CurrentUserResponse, dependencies=[PUBLIC]
)
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> CurrentUserResponse:
    """AUT-R05, AUT-R06: on success, issues a new login state
    (AUT-R13) and returns it as a Cookie plus the current user
    body. On failure, every one of AUT-R06's five scenarios raises
    the exact same error -- no ``AuthSession`` is created and no
    ``Set-Cookie`` header is sent.
    """
    user = authenticate(db, body.email, body.password)
    if user is None:
        raise APIError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401)

    _session, token = create_session(db, user)
    _set_session_cookie(response, token)
    return _current_user_response(db, user)


@router.post("/logout", status_code=204, dependencies=[PUBLIC])
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> None:
    """AUT-R07: deletes the Cookie's login state (if any) and asks
    the browser to clear the Cookie either way -- idempotent, so a
    request with no Cookie at all still succeeds.
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if token is not None:
        delete_session_by_token(db, token)
    _clear_session_cookie(response)


# AUT-R33: registers the exact function object above (the same one
# the ``@router.post`` decorator returned unchanged and FastAPI's
# ``APIRoute.endpoint`` will hold) as one of the temporary-password
# gate's allowed operations. T11 (#192) registers the change-password
# route's handler the same way.
register_temporary_password_allowed("POST", logout)


@router.get("/me", response_model=CurrentUserResponse)
def get_me(
    user: User = Depends(require_login_access),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> CurrentUserResponse:
    """AUT-R08: the current user, or 401 ``auth.not_authenticated``
    (raised by ``require_login`` underneath ``require_login_access``)
    when not logged in.
    """
    return _current_user_response(db, user)


register_temporary_password_allowed("GET", get_me)
