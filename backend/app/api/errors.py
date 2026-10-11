"""Shared error envelope and exception handlers.

Implements the dot-namespace error codes and the single
generation function required by KD-15: ``ErrorCode`` is the only
source of truth for the code -> description mapping produced by
``build_error_code_descriptions``. No other file may hand-maintain
an equivalent table.
"""

import logging
import traceback
import types
import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated, Any, Union, get_args, get_origin

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.params import Form
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
    """Every dot-namespace error code used across the backend
    (API-R07 / KD-15).

    ``request.*``, ``resource.*`` and ``server.*`` are the three
    shared, cross-cutting namespaces used by the handlers below for
    problems that are not tied to one feature. Each feature spec
    (for example ``authentication``'s ``auth.*`` members) adds its
    own members here rather than maintaining a separate table, so
    ``build_error_code_descriptions`` stays the single source of
    truth API-R07 requires.
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
    SERVER_TEMPORARILY_UNAVAILABLE = (
        "server.temporarily_unavailable",
        "The server is temporarily unavailable. Please retry.",
    )
    AUTH_NOT_AUTHENTICATED = (
        "auth.not_authenticated",
        "Authentication is required for this request.",
    )
    AUTH_INVALID_CREDENTIALS = (
        "auth.invalid_credentials",
        "The email or password is incorrect.",
    )
    AUTH_PASSWORD_CHANGE_REQUIRED = (
        "auth.password_change_required",
        "The temporary password must be changed before this "
        "request can proceed.",
    )
    PERMISSION_DENIED = (
        "permission.denied",
        "You do not have permission to perform this request.",
    )
    AUTH_CURRENT_PASSWORD_INCORRECT = (
        "auth.current_password_incorrect",
        "The current password is incorrect.",
    )
    AUTH_PASSWORD_INVALID = (
        "auth.password_invalid",
        "The new password does not meet the length requirement.",
    )
    AUTH_PASSWORD_UNCHANGED = (
        "auth.password_unchanged",
        "The new password must differ from the current temporary password.",
    )
    ROLE_NOT_FOUND = (
        "role.not_found",
        "The requested role does not exist.",
    )
    ROLE_NAME_CONFLICT = (
        "role.name_conflict",
        "A role with this name already exists.",
    )
    ROLE_PERMISSION_CODE_INVALID = (
        "role.permission_code_invalid",
        "One or more permission codes are invalid or unavailable.",
    )
    ROLE_EXTERNAL_ALLOWED_INVALID = (
        "role.external_allowed_invalid",
        "This role cannot be marked for external collaborators.",
    )
    ROLE_EXTERNAL_IN_USE = (
        "role.external_in_use",
        "External collaborators currently hold this role.",
    )
    ROLE_CREATOR_ROLE_IN_USE = (
        "role.creator_role_in_use",
        "The designated creator role cannot be deleted.",
    )
    ROLE_CREATOR_ROLE_REQUIRES_PERMISSIONS = (
        "role.creator_role_requires_permissions",
        "The designated creator role must retain its required permissions.",
    )
    PROJECT_EXTERNAL_ROLE_NOT_ALLOWED = (
        "project.external_role_not_allowed",
        "This role is not allowed for external collaborators.",
    )
    USER_EXTERNAL_NOT_QUALIFIED = (
        "user.external_not_qualified",
        "This user does not qualify as an external collaborator.",
    )
    SETUP_INVALID_CODE = (
        "setup.invalid_code",
        "The first-login code is invalid.",
    )
    SETUP_ALREADY_COMPLETED = (
        "setup.already_completed",
        "Initial setup has already been completed.",
    )
    USER_BUILTIN_PROTECTED = (
        "user.builtin_protected",
        "The built-in administrator account cannot be changed this way.",
    )
    USER_LAST_ADMIN = (
        "user.last_admin",
        "The last active administrator cannot be removed.",
    )
    USER_EXTERNAL_MANAGED = (
        "user.external_managed",
        "This account's basic fields are managed externally.",
    )
    COMPANY_INACTIVE = (
        "company.inactive",
        "Users cannot be assigned to an inactive company.",
    )
    USER_USERNAME_CONFLICT = (
        "user.username_conflict",
        "The username is already in use.",
    )
    USER_EMAIL_CONFLICT = (
        "user.email_conflict",
        "The email is already in use.",
    )
    USER_EMPLOYEE_NO_CONFLICT = (
        "user.employee_no_conflict",
        "The employee number is already in use at this company.",
    )
    COMPANY_NAME_CONFLICT = (
        "company.name_conflict",
        "The company name is already in use.",
    )
    PROJECT_MEMBER_CONFLICT = (
        "project.member_conflict",
        "The user is already a member of this project.",
    )
    PROJECT_MEMBER_COMPANY_MISMATCH = (
        "project.member_company_mismatch",
        "A non-admin can only add users of their own company.",
    )
    PROJECT_MEMBER_ROLES_REQUIRED = (
        "project.member_roles_required",
        "A project member must have at least one role.",
    )
    INSPECTION_PLAN_NOT_FOUND = (
        "inspection_plan.not_found",
        "The inspection plan was not found.",
    )
    INSPECTION_PLAN_INVALID_NAME = (
        "inspection_plan.invalid_name",
        "The inspection plan name is invalid.",
    )
    INSPECTION_PLAN_ARCHIVED = (
        "inspection_plan.archived",
        "The inspection plan is archived.",
    )
    INSPECTION_TASK_NOT_FOUND = (
        "inspection_task.not_found",
        "The inspection task was not found.",
    )
    INSPECTION_TASK_INVALID_TRANSITION = (
        "inspection_task.invalid_transition",
        "The inspection task cannot make this transition.",
    )
    INSPECTION_TASK_LOCATION_LOCKED = (
        "inspection_task.location_locked",
        "The task location is read-only.",
    )
    INSPECTION_TASK_ITEMS_REQUIRED = (
        "inspection_task.items_required",
        "At least one project inspection item is required.",
    )
    INSPECTION_TASK_INVALID_ITEM = (
        "inspection_task.invalid_project_item",
        "A selected item does not belong to this project.",
    )
    INSPECTION_TASK_INVALID_ZONE = (
        "inspection_task.invalid_zone",
        "The selected zone is invalid for this project.",
    )
    INSPECTION_TASK_INVALID_ASSIGNEE = (
        "inspection_task.invalid_assignee",
        "The suggested assignee is not a project member.",
    )
    INSPECTION_TASK_INVALID_LOCATION = (
        "inspection_task.invalid_location",
        "The task location text is invalid.",
    )
    INSPECTION_TASK_ITEMS_INCOMPLETE = (
        "inspection_task.items_incomplete",
        "Task items requiring reinspection are incomplete.",
    )
    PROJECT_ZONE_NOT_FOUND = (
        "project_zone.not_found",
        "The project zone was not found.",
    )
    PROJECT_ZONE_INVALID_NAME = (
        "project_zone.invalid_name",
        "The project zone name is invalid.",
    )
    PROJECT_ZONE_NAME_CONFLICT = (
        "project_zone.name_conflict",
        "The project already has a zone with this name.",
    )
    PROJECT_ZONE_IN_USE = (
        "project_zone.in_use",
        "The project zone is referenced by a task.",
    )
    INSPECTION_TASK_REASON_REQUIRED = (
        "inspection_task.reason_required",
        "A cancellation reason is required.",
    )
    PROJECT_ITEM_REINSPECTION_CHOICE_REQUIRED = (
        "project_inspection_item.reinspection_choice_required",
        "Choose whether affected tasks must be reinspected.",
    )
    PROJECT_INSPECTION_ITEM_STRUCTURE_LOCKED = (
        "project_inspection_item.structure_locked",
        "Changing the inspection structure requires reinspection.",
    )
    PROJECT_INSPECTION_ITEM_POINTS_REQUIRED = (
        "project_inspection_item.points_required",
        "An inspection item used by a task must have inspection points.",
    )
    TEMPLATE_NAME_CONFLICT = (
        "template.name_conflict",
        "A template library name is already in use at this level.",
    )
    PROJECT_INSPECTION_ITEM_DUPLICATE_NAME = (
        "project_inspection_item.duplicate_name",
        "One or more inspection item names already exist in this project.",
    )
    TEMPLATE_CATEGORY_NOT_EMPTY = (
        "template.category_not_empty",
        "The category still contains systems.",
    )
    TEMPLATE_SYSTEM_NOT_EMPTY = (
        "template.system_not_empty",
        "The system still contains template items.",
    )


class FieldErrorCode(DescribedStrEnum):
    """Stable codes for request-body field errors (API-R12)."""

    REQUIRED = ("field.required", "A value is required.")
    INVALID = ("field.invalid", "The value is invalid.")
    TOO_LONG = ("field.too_long", "The value is too long.")
    TOO_SHORT = ("field.too_short", "The value is too short.")
    OUT_OF_RANGE = ("field.out_of_range", "The value is out of range.")
    DUPLICATE = ("field.duplicate", "The value is duplicated.")
    TEMPLATE_PHOTO_REQUIREMENT_COUNT = (
        "template.photo_requirement_count",
        "A template inspection point must have exactly one photo requirement.",
    )
    TEMPLATE_NUMERIC_FIELD_UNBOUND = (
        "template.numeric_field_unbound",
        "The numeric standard must reference one numeric measurement field.",
    )
    TEMPLATE_BOUND_FIELD_UNIT_FORBIDDEN = (
        "template.bound_field_unit_forbidden",
        "A field bound to a numeric standard cannot set its own unit.",
    )
    TEMPLATE_NUMERIC_UNIT_REQUIRED = (
        "template.numeric_unit_required",
        "A numeric measurement field requires a unit.",
    )
    TEMPLATE_TEXT_UNIT_FORBIDDEN = (
        "template.text_unit_forbidden",
        "A text measurement field cannot set a unit.",
    )
    TEMPLATE_SEQUENCE_DUPLICATE = (
        "template.sequence_duplicate",
        "Inspection point sequence values must be unique.",
    )
    TEMPLATE_CLIENT_ID_DUPLICATE = (
        "template.client_id_duplicate",
        "Measurement field client identifiers must be unique.",
    )


def _field_code(error_type: str) -> FieldErrorCode:
    if error_type == "missing":
        return FieldErrorCode.REQUIRED
    if error_type in {"string_too_long", "list_too_long", "too_long"}:
        return FieldErrorCode.TOO_LONG
    if error_type in {"string_too_short", "list_too_short", "too_short"}:
        return FieldErrorCode.TOO_SHORT
    if error_type in {
        "greater_than",
        "greater_than_equal",
        "less_than",
        "less_than_equal",
    }:
        return FieldErrorCode.OUT_OF_RANGE
    return FieldErrorCode.INVALID


def _non_null_types(annotation: Any) -> tuple[Any, ...]:
    origin = get_origin(annotation)
    if origin is Annotated:
        annotation = get_args(annotation)[0]
        origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        return tuple(
            arg for arg in get_args(annotation) if arg is not type(None)
        )
    return (annotation,)


def _json_pointer(parts: list[str | int]) -> str:
    return "".join(
        "/" + str(part).replace("~", "~0").replace("/", "~1") for part in parts
    )


def _body_field_error(
    body_model: Any, location: tuple[Any, ...], error_type: str
) -> dict[str, str] | None:
    """Resolve a Pydantic location using only declared model fields.

    Dynamic mapping keys, extra keys and ambiguous union branches stop at
    their containing field and receive the generic invalid code.
    """
    if not location or location[0] != "body":
        return None
    parts: list[str | int] = []
    annotation = body_model
    remaining = list(location[1:])
    generic = False
    while remaining:
        choices = _non_null_types(annotation)
        if len(choices) > 1:
            generic = True
            break
        if not choices:
            generic = True
            break
        annotation = choices[0]
        origin = get_origin(annotation)
        if isinstance(annotation, type) and hasattr(
            annotation, "model_fields"
        ):
            part = remaining.pop(0)
            if not isinstance(part, str):
                generic = True
                break
            model_field = next(
                (
                    field
                    for name, field in annotation.model_fields.items()
                    if part in (name, field.alias, field.validation_alias)
                ),
                None,
            )
            if model_field is None:
                generic = True
                break
            parts.append(part)
            annotation = model_field.annotation
            continue
        if origin in (list, tuple):
            part = remaining.pop(0)
            if isinstance(part, int) or (
                isinstance(part, str) and part.isdecimal()
            ):
                parts.append(int(part))
                args = get_args(annotation)
                annotation = args[0] if args else Any
                continue
            generic = True
            break
        if origin in (dict, Mapping):
            generic = True
            break
        generic = True
        break
    if remaining:
        generic = True
    code = FieldErrorCode.INVALID if generic else _field_code(error_type)
    return {"path": _json_pointer(parts), "code": code.value}


def _request_body_model(request: Request) -> Any | None:
    route = request.scope.get("route")
    dependant = getattr(route, "dependant", None)
    body_params = getattr(dependant, "body_params", ())
    if len(body_params) != 1:
        return None
    body_param = body_params[0]
    return getattr(body_param, "type_", None) or getattr(
        body_param.field_info, "annotation", None
    )


def _request_field_errors(
    request: Request, exc: RequestValidationError
) -> list[dict[str, str]] | None:
    route = request.scope.get("route")
    body_field = getattr(route, "body_field", None)
    if isinstance(getattr(body_field, "field_info", None), Form):
        return None
    content_type = request.headers.get("content-type", "").split(";", 1)[0]
    if not (
        content_type == "application/json" or content_type.endswith("+json")
    ):
        return None
    model = _request_body_model(request)
    if model is None:
        return None
    fields: list[dict[str, str]] = []
    for error in exc.errors():
        if error.get("type") == "json_invalid":
            return None
        item = _body_field_error(
            model,
            tuple(error.get("loc", ())),
            str(error.get("type", "")),
        )
        if item is not None:
            fields.append(item)
            if len(fields) == 100:
                break
    return fields or None


def build_error_code_descriptions(
    enum_cls: type[DescribedStrEnum],
) -> dict[str, str]:
    """Generate a code -> description mapping from an enum.

    This is the single source of truth for error code
    descriptions (API-R07 / KD-15): no separate hand-maintained
    table exists anywhere in the repository.
    """
    return {member.value: member.description for member in enum_cls}


FIELD_ERROR_CODE_DESCRIPTIONS = build_error_code_descriptions(FieldErrorCode)


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
        *,
        headers: dict[str, str] | None = None,
        details: list[str] | None = None,
        fields: list[dict[str, str]] | None = None,
    ) -> None:
        self.code = code
        self.status_code = status_code
        self.message = message
        self.headers = headers
        self.details = details
        self.fields = fields
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

    Every handler includes ``error.code``. Only an ``APIError``
    explicitly given details also includes ``error.details``;
    messages and raw exception data are never returned.
    """

    @app.exception_handler(APIError)
    async def handle_api_error(
        request: Request, exc: APIError
    ) -> JSONResponse:
        error: dict[str, object] = {"code": exc.code.value}
        if exc.details is not None:
            error["details"] = exc.details
        if exc.status_code == 422 and exc.fields:
            error["fields"] = [
                {"path": field["path"], "code": field["code"]}
                for field in exc.fields[:100]
            ]
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": error},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        error: dict[str, object] = {
            "code": ErrorCode.REQUEST_VALIDATION_FAILED.value
        }
        fields = _request_field_errors(request, exc)
        if fields is not None:
            error["fields"] = fields
        return JSONResponse(
            status_code=422,
            content={"error": error},
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
        # Do not format the exception, traceback source lines, locals,
        # request path, headers, or body: any can contain credentials.
        # Frame metadata provides actionable stack locations without
        # serializing application data (RG-M17).
        route = request.scope.get("route")
        template = getattr(route, "path", None)
        if not isinstance(template, str):
            template = "<unmatched>"
        request_id = uuid.uuid4().hex
        frames = []
        if exc.__traceback__ is not None:
            for frame, line_number in traceback.walk_tb(exc.__traceback__):
                frames.append(
                    f"{frame.f_code.co_filename.rsplit('/', 1)[-1]}:"
                    f"{line_number} in {frame.f_code.co_name}"
                )
        safe_traceback = " -> ".join(frames) or "<no frames>"
        logger.error(
            "Unhandled exception request_id=%s method=%s type=%s "
            "route=%s traceback=%s",
            request_id,
            request.method,
            type(exc).__name__,
            template,
            safe_traceback,
        )
        return JSONResponse(
            status_code=500,
            content={"error": {"code": ErrorCode.SERVER_INTERNAL_ERROR.value}},
            headers={"X-Request-ID": request_id},
        )
