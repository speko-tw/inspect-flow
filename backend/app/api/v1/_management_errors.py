"""Translate known management uniqueness constraints to API codes."""

from sqlalchemy.exc import IntegrityError

from app.api.errors import ErrorCode

_CONFLICT_CODES = {
    ErrorCode.USER_USERNAME_CONFLICT,
    ErrorCode.USER_EMAIL_CONFLICT,
    ErrorCode.USER_EMPLOYEE_NO_CONFLICT,
    ErrorCode.COMPANY_NAME_CONFLICT,
}


def management_error_status(code: ErrorCode) -> int:
    """Return the HTTP status for a translated management error."""
    return 409 if code in _CONFLICT_CODES else 422


def integrity_error_code(exc: IntegrityError) -> ErrorCode | None:
    """Recognize input constraints; unknown database failures stay 500."""
    diagnostic = getattr(exc.orig, "diag", None)
    constraint = getattr(diagnostic, "constraint_name", None)
    details = str(exc.orig).lower()
    if constraint == "uq_users_username" or "users.username" in details:
        return ErrorCode.USER_USERNAME_CONFLICT
    if constraint == "ix_users_email_lower" or (
        "ix_users_email_lower" in details
    ):
        return ErrorCode.USER_EMAIL_CONFLICT
    if constraint == "uq_users_company_id_employee_no" or (
        "users.company_id, users.employee_no" in details
    ):
        return ErrorCode.USER_EMPLOYEE_NO_CONFLICT
    if constraint == "ix_companies_name_lower" or (
        "ix_companies_name_lower" in details
    ):
        return ErrorCode.COMPANY_NAME_CONFLICT
    validation_constraints = (
        "ck_users_company_fields_need_company",
        "ck_users_email_and_name_zh_required",
        "ck_users_username_reserved",
        "ck_users_username_lower",
        "ck_users_system_account",
    )
    if constraint in validation_constraints or any(
        name in details for name in validation_constraints
    ):
        return ErrorCode.REQUEST_VALIDATION_FAILED
    return None
