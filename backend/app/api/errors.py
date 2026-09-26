"""Shared error envelope and exception handlers.

Implements the dot-namespace error codes and the single
generation function required by KD-15: ``ErrorCode`` is the only
source of truth for the code -> description mapping produced by
``build_error_code_descriptions``. No other file may hand-maintain
an equivalent table.
"""

import logging
from enum import StrEnum

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)


class DescribedStrEnum(StrEnum):
    """A string enum whose members also carry a description.

    Subclasses pass ``description`` as the second ``__new__``
    argument (after the enum value itself). This is the shared
    base ``build_error_code_descriptions`` accepts, so pyright can
    check callers without needing ``type: ignore``.
    """

    description: str

    def __new__(cls, value: str, description: str) -> "DescribedStrEnum":
        member = str.__new__(cls, value)
        member._value_ = value
        member.description = description
        return member


class ErrorCode(DescribedStrEnum):
    """The three dot-namespace error codes used by the shared
    error handlers (API-R07 / KD-15).

    Each member's namespace matches its cause: ``request.*`` for
    problems with the request itself, ``resource.*`` for
    resource-related errors not tied to one resource, and
    ``server.*`` for server-side failures. No other codes exist
    here; resource-specific codes (e.g. ``task.not_found``) are
    decided by each feature spec.
    """

    REQUEST_VALIDATION_FAILED = (
        "request.validation_failed",
        "The request failed validation.",
    )
    RESOURCE_NOT_FOUND = (
        "resource.not_found",
        "The requested resource was not found.",
    )
    SERVER_INTERNAL_ERROR = (
        "server.internal_error",
        "An unexpected server error occurred.",
    )


def build_error_code_descriptions(
    enum_cls: type[DescribedStrEnum],
) -> dict[str, str]:
    """Generate a code -> description mapping from an enum.

    This is the single source of truth for error code
    descriptions (API-R07 / KD-15): no separate hand-maintained
    table exists anywhere in the repository.
    """
    return {member.value: member.description for member in enum_cls}


ERROR_CODE_DESCRIPTIONS: dict[str, str] = build_error_code_descriptions(
    ErrorCode
)


class APIError(Exception):
    """An application error carrying a dot-namespace error code.

    Handlers translate this into the shared JSON envelope
    ``{"error": {"code": ...}}`` with the given status code.
    """

    def __init__(
        self,
        code: ErrorCode,
        status_code: int,
        message: str = "",
    ) -> None:
        self.code = code
        self.status_code = status_code
        self.message = message
        super().__init__(message or code.value)


def _http_exception_code(exc: StarletteHTTPException) -> ErrorCode:
    """Map a Starlette/FastAPI HTTPException to an error code.

    Only three formal codes exist. A 404 maps to
    ``resource.not_found`` and any 5xx maps to
    ``server.internal_error``; every other 4xx (framework-raised,
    e.g. 405/406/415) is not tied to one resource so it is folded
    into the ``request.*`` namespace as
    ``request.validation_failed``.
    """
    if exc.status_code == 404:
        return ErrorCode.RESOURCE_NOT_FOUND
    if exc.status_code >= 500:
        return ErrorCode.SERVER_INTERNAL_ERROR
    return ErrorCode.REQUEST_VALIDATION_FAILED


def register_error_handlers(app: FastAPI) -> None:
    """Register the shared exception handlers on ``app``.

    Every handler responds with
    ``{"error": {"code": "<dot.namespace>"}}`` only -- no message
    or exception detail is included in the response body.
    """

    @app.exception_handler(APIError)
    async def handle_api_error(
        request: Request, exc: APIError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": exc.code.value}},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": {"code": ErrorCode.REQUEST_VALIDATION_FAILED.value}
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        code = _http_exception_code(exc)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": code.value}},
            headers=exc.headers,
        )

    @app.exception_handler(Exception)
    async def handle_unhandled_exception(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.exception("Unhandled exception while processing request")
        return JSONResponse(
            status_code=500,
            content={"error": {"code": ErrorCode.SERVER_INTERNAL_ERROR.value}},
        )
