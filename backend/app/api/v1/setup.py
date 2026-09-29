"""Public initial-setup status and admin-password endpoints."""

import logging

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.api.errors import APIError, ErrorCode
from app.auth.access import PUBLIC
from app.auth.dependencies import get_db
from app.auth.password_service import PasswordLengthError, set_password
from app.auth.passwords import check_password_length
from app.auth.sessions import create_session, set_session_cookie
from app.models import User, UserPassword
from app.services.setup_codes import verify_setup_code, void_setup_code

router = APIRouter(prefix="/setup", tags=["setup"])
logger = logging.getLogger("app.auth")


class SetupStatusResponse(BaseModel):
    setup_required: bool


class AdminPasswordRequest(BaseModel):
    code: str
    password: str


def _get_admin(db: Session) -> User | None:
    return db.scalars(
        select(User).where(User.is_system.is_(True)).with_for_update()
    ).one_or_none()


def _has_password(db: Session, admin: User | None) -> bool:
    return (
        admin is not None
        and db.scalar(
            select(UserPassword.id).where(UserPassword.user_id == admin.id)
        )
        is not None
    )


@router.get(
    "/status", response_model=SetupStatusResponse, dependencies=[PUBLIC]
)
def get_setup_status(
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> SetupStatusResponse:
    """Report only whether the built-in admin still needs a password."""
    admin = _get_admin(db)
    return SetupStatusResponse(setup_required=not _has_password(db, admin))


@router.post("/admin-password", status_code=204, dependencies=[PUBLIC])
def set_initial_admin_password(
    body: AdminPasswordRequest,
    response: Response,
    db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI pattern
) -> Response:
    """Set the first admin password and return an authenticated Cookie."""
    admin = _get_admin(db)
    if _has_password(db, admin):
        raise APIError(ErrorCode.SETUP_ALREADY_COMPLETED, 409)

    if not check_password_length(body.password):
        raise APIError(ErrorCode.AUTH_PASSWORD_INVALID, 422)

    verified = verify_setup_code(db, body.code)
    if verified is None:
        # Return normally so get_db commits the failed-attempt counter.
        return JSONResponse(
            content={"error": {"code": ErrorCode.SETUP_INVALID_CODE.value}},
            status_code=401,
        )
    admin, setup_code = verified

    try:
        set_password(
            db,
            admin,
            body.password,
            is_temporary=False,
            system_event=True,
        )
    except PasswordLengthError as exc:
        # Keep the API's public error contract even if the service's
        # independently enforced length check changes in the future.
        raise APIError(ErrorCode.AUTH_PASSWORD_INVALID, 422) from exc

    void_setup_code(db, setup_code, admin)
    _session, token = create_session(db, admin)
    response.status_code = 204
    set_session_cookie(response, token)
    logger.info(
        "auth.login_succeeded",
        extra={
            "event": "auth.login_succeeded",
            "user_id": str(admin.id),
            "reason": None,
        },
    )
    return response
