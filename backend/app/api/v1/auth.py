"""Login, logout and current-user endpoints (AUT-R05~AUT-R14).

The temporary-password gate (AUT-R33), the "本人或 Admin" etc.
access-level decorations (AUT-R18~AUT-R22) and the change-password
route (AUT-R34) are later tasks (T9, T4, T11); this module only
wires up the three routes T3 owns.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.dependencies import get_db, require_login
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
    """The login and current-user response body (AUT-R08, AUT-R10).

    Exactly these five keys for this task (T9 adds
    ``must_change_password`` back on top -- see plan.md's T3 row).
    """

    id: UUID
    email: str
    name_en: str
    name_zh: str
    is_admin: bool


def _current_user_response(user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        name_en=user.name_en,
        name_zh=user.name_zh,
        is_admin=user.is_admin,
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


@router.post("/login", response_model=CurrentUserResponse)
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
    return _current_user_response(user)


@router.post("/logout", status_code=204)
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


@router.get("/me", response_model=CurrentUserResponse)
def get_me(
    user: User = Depends(require_login),  # noqa: B008 -- FastAPI's DI
) -> CurrentUserResponse:
    """AUT-R08: the current user, or 401 ``auth.not_authenticated``
    (raised by the ``require_login`` dependency itself) when not
    logged in.
    """
    return _current_user_response(user)
