"""Login, logout, current-user and change-password endpoints
(AUT-R05~AUT-R14, AUT-R32~AUT-R34, AUT-R18).

T3 owns login/logout/``me`` plus the ``must_change_password`` field
T9 adds to their response body; T4's access-level declarations
(login and logout are 公開; ``me`` and change-password are 需登入).
T11 (issue #192) adds the change-password route itself.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.auth.access import PUBLIC, require_login_access
from app.auth.dependencies import (
    get_db,
    has_effective_temporary_password_flag,
    register_temporary_password_allowed,
)
from app.auth.lockout import (
    clear_after_successful_check,
    is_locked,
    record_failure,
)
from app.auth.login import authenticate
from app.auth.password_service import set_password
from app.auth.passwords import check_password_length, verify_password
from app.auth.sessions import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session_by_token,
    hash_token,
    set_session_cookie,
)
from app.models import AuthSession, Company, User, UserPassword
from app.services.access_summary import summarize_access

router = APIRouter(prefix="/auth", tags=["auth"])

# AUT-R40, AUT-R41: same fixed logger name as ``app.auth.login``,
# used here only for ``auth.logout`` (login/login-failure logging
# lives in ``authenticate`` itself, the only place that knows the
# failure reason).
logger = logging.getLogger("app.auth")


class LoginRequest(BaseModel):
    """``POST /api/v1/auth/login`` request body."""

    login: str
    password: str


class ChangePasswordRequest(BaseModel):
    """``POST /api/v1/auth/password`` request body (AUT-R34)."""

    current_password: str
    new_password: str


class CurrentUserResponse(BaseModel):
    """The identity part shared by every current-user body (AUT-R08,
    AUT-R10)."""

    id: UUID
    username: str
    # Nullable since #260 (DOM-R46/DOM-R50): the built-in account has
    # no email or names, and ``name_en`` is optional for everyone.
    email: str | None
    name_en: str | None
    name_zh: str | None
    is_admin: bool
    must_change_password: bool


class CompanyRef(BaseModel):
    """The linked company shown in ``GET /auth/me`` (AUT-R08)."""

    id: UUID
    name: str


class MeResponse(CurrentUserResponse):
    """The login and ``GET /api/v1/auth/me`` body (AUT-R05, AUT-R08):
    identity plus the company link and company-related profile fields
    the personal workspace page shows (#290). ``company`` is ``None``
    for an account with no linked company (including the built-in
    admin). Both endpoints build it with ``_me_response`` so the two
    bodies can never differ.
    """

    company: CompanyRef | None
    department: str | None
    location: str | None
    employee_no: str | None
    # #480: which UI areas the user can use, computed by the backend so
    # the frontend never guesses from ``is_admin`` alone.
    has_office_access: bool
    has_field_access: bool
    has_template_access: bool
    module_permissions: list[str]


def _current_user_response(db: Session, user: User) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        name_en=user.name_en,
        name_zh=user.name_zh,
        is_admin=user.is_admin,
        must_change_password=has_effective_temporary_password_flag(db, user),
    )


def _me_response(db: Session, user: User) -> MeResponse:
    company = (
        db.get(Company, user.company_id)
        if user.company_id is not None
        else None
    )
    base = _current_user_response(db, user)
    access = summarize_access(db, user)
    return MeResponse(
        **base.model_dump(),
        company=(
            CompanyRef(id=company.id, name=company.name)
            if company is not None
            else None
        ),
        department=user.department,
        location=user.location,
        employee_no=user.employee_no,
        has_office_access=access.has_office_access,
        has_field_access=access.has_field_access,
        has_template_access=access.has_template_access,
        module_permissions=sorted(access.module_permissions),
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        httponly=True,
        secure=True,
        samesite="strict",
    )


@router.post("/login", response_model=MeResponse, dependencies=[PUBLIC])
def login(
    body: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> MeResponse:
    """AUT-R05, AUT-R06: on success, issues a new login state
    (AUT-R13) and returns it as a Cookie plus the current user
    body. On failure, every one of AUT-R06's five scenarios raises
    the exact same error -- no ``AuthSession`` is created and no
    ``Set-Cookie`` header is sent.
    """
    user = authenticate(db, body.login, body.password)
    if user is None:
        # A raised APIError rolls back get_db's unit of work. Persist
        # the failure counter and any user.locked event first.
        db.commit()
        raise APIError(ErrorCode.AUTH_INVALID_CREDENTIALS, 401)

    _session, token = create_session(db, user)
    set_session_cookie(response, token)
    return _me_response(db, user)


@router.post("/logout", status_code=204, dependencies=[PUBLIC])
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> None:
    """AUT-R07: deletes the Cookie's login state (if any) and asks
    the browser to clear the Cookie either way -- idempotent, so a
    request with no Cookie at all still succeeds.

    AUT-R40: logs exactly one ``auth.logout`` entry regardless --
    with no Cookie, or a token that no longer resolves to a row,
    ``user_id`` is logged as ``None``. The owning ``user_id`` is
    read before deletion since the row (and the only place it is
    recorded) disappears afterwards; the token itself is never
    logged (AUT-R41).
    """
    token = request.cookies.get(SESSION_COOKIE_NAME)
    user_id: UUID | None = None
    if token is not None:
        user_id = db.scalar(
            select(AuthSession.user_id).where(
                AuthSession.token_hash == hash_token(token)
            )
        )
        delete_session_by_token(db, token)
    _clear_session_cookie(response)
    logger.info(
        "auth.logout",
        extra={
            "event": "auth.logout",
            "user_id": str(user_id) if user_id is not None else None,
            "reason": None,
        },
    )


# AUT-R33: registers the exact function object above (the same one
# the ``@router.post`` decorator returned unchanged and FastAPI's
# ``APIRoute.endpoint`` will hold) as one of the temporary-password
# gate's allowed operations. T11 (#192) registers the change-password
# route's handler the same way.
register_temporary_password_allowed("POST", logout)


@router.get("/me", response_model=MeResponse)
def get_me(
    user: User = Depends(require_login_access),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> MeResponse:
    """AUT-R08: the current user, or 401 ``auth.not_authenticated``
    (raised by ``require_login`` underneath ``require_login_access``)
    when not logged in.
    """
    return _me_response(db, user)


register_temporary_password_allowed("GET", get_me)


@router.post("/password", status_code=204)
def change_password(
    body: ChangePasswordRequest,
    response: Response,
    user: User = Depends(require_login_access),  # noqa: B008
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> None:
    """AUT-R34: change the logged-in user's own password.

    Checks, in order, leaving every table unchanged on any failure:
    (1) ``user.auth_source == "local"``, otherwise 403
    ``permission.denied`` -- an external account never has a usable
    local password to verify or replace; (2) the current password
    verifies against the stored hash, otherwise 400
    ``auth.current_password_incorrect``; (3) the new password passes
    AUT-R04's length rule, otherwise 422 ``auth.password_invalid``;
    (4) when the account's password is currently temporary
    (AUT-R32), the new password must differ from the current one,
    otherwise 422 ``auth.password_unchanged`` (a temporary password
    "changed" to itself would defeat AUT-R33's forced change).

    T8 (#156) handoff -- AUT-AC47, AUT-R28's shared failure counter:
    neither exists yet. Once T8 merges ``app.auth.lockout``, whichever
    of T8/T11 merges second must add, right here before step (2)
    above: reject with the same 400 ``auth.current_password_incorrect``
    (data unchanged, nothing counted) while this account is locked;
    and after step (2) fails, record one failed attempt against the
    same per-account counter ``app.auth.login.authenticate`` records
    against, so the two entry points keep sharing one counter.

    On success, delegates the write itself -- hashing, updating
    ``UserPassword``, clearing ``must_change_password``, deleting
    every existing ``AuthSession`` (AUT-R25) and writing the
    ``user.password_set`` audit record (AUT-R39) -- to
    :func:`app.auth.password_service.set_password` with
    ``is_temporary=False``, the same entry point the set-password
    command uses. That call already deletes this request's own
    login state along with every other one, so a fresh ``AuthSession``
    is then created for this request and returned as a new Cookie
    (AUT-R35) -- the caller does not have to log in again.
    """
    if user.auth_source != "local":
        raise APIError(ErrorCode.PERMISSION_DENIED, 403)

    user_password = db.scalar(
        select(UserPassword).where(UserPassword.user_id == user.id)
    )
    if is_locked(db, user.id):
        raise APIError(ErrorCode.AUTH_CURRENT_PASSWORD_INCORRECT, 400)
    if user_password is None or not verify_password(
        user_password.password_hash, body.current_password
    ):
        user_id = user.id
        db.commit()
        record_failure(db, user_id)
        db.commit()
        raise APIError(ErrorCode.AUTH_CURRENT_PASSWORD_INCORRECT, 400)

    if not check_password_length(body.new_password):
        raise APIError(ErrorCode.AUTH_PASSWORD_INVALID, 422)

    if user_password.must_change_password and verify_password(
        user_password.password_hash, body.new_password
    ):
        raise APIError(ErrorCode.AUTH_PASSWORD_UNCHANGED, 422)

    # The pre-verification lock lookup can become stale while Argon2 runs.
    # Recheck under the per-account write lock before changing the password
    # or creating a replacement login state.
    # End the read transaction first: a WAL snapshot cannot be upgraded
    # after the concurrent failure commits its lockout write.
    user_id = user.id
    db.commit()
    if not clear_after_successful_check(db, user_id):
        raise APIError(ErrorCode.AUTH_CURRENT_PASSWORD_INCORRECT, 400)

    set_password(db, user, body.new_password, is_temporary=False)

    _session, token = create_session(db, user)
    set_session_cookie(response, token)


# AUT-R33: the allowlist's third and final entry (AUT-AC36) -- a
# still-temporary password must be able to reach this route, or
# AUT-R33's forced change could never happen.
register_temporary_password_allowed("POST", change_password)
