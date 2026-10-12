"""Project write and lookup entry points (DOM-R14, DOM-R40-R44, DOM-R76)."""

from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.company_roles import DEFAULT_COMPANY_ROLE
from app.models import Project
from app.services import UNSET, _Unset
from app.services.audit import record_audit_event
from app.services.operator import get_current_operator

# DOM-R76：改本公司角色的原因，去除前後空白後 1～256 字元。
COMPANY_ROLE_REASON_MAX_LENGTH = 256


class InvalidProjectFieldError(ValueError):
    """A submitted Project field failed model validation."""


class ProjectUnchangedError(ValueError):
    """An update contained no Project fields."""


class CompanyRoleReasonRequiredError(ValueError):
    """DOM-R76: ``company_role`` changed without a usable reason.

    The API maps this to the dedicated error code
    ``project.company_role_reason_required``; a reason that is too long
    is a plain ``InvalidProjectFieldError`` (shared validation error).
    """


def create_project(
    session: Session,
    *,
    project_code: str,
    name: str,
    client_name: str,
    site_location: str,
    company_role: str | None = DEFAULT_COMPANY_ROLE,
    planned_start_date: date | None = None,
    planned_completion_date: date | None = None,
) -> Project:
    """Create a Project and fill its audit operator fields (DOM-R14).

    ``company_role`` 省略時為承攬施工方（DOM-R76）；帶 ``None`` 或
    未登記的值由 model 驗證拒絕。同一交易寫 ``project.created``
    （DOM-R65、ALG-R28）。
    """
    fields: dict[str, object] = {
        "project_code": project_code,
        "name": name,
        "client_name": client_name,
        "site_location": site_location,
        "company_role": company_role,
    }
    operator = get_current_operator(session)
    try:
        project = Project(
            **fields,
            planned_start_date=planned_start_date,
            planned_completion_date=planned_completion_date,
            created_by=operator.id,
            updated_by=operator.id,
        )
    except ValueError as exc:
        raise InvalidProjectFieldError from exc
    session.add(project)
    session.flush()
    record_audit_event(
        session,
        "project.created",
        entity_id=project.id,
        before=None,
        after={
            "project_code": project.project_code,
            "name": project.name,
            "company_role": project.company_role,
        },
        project_id=project.id,
    )
    return project


def update_project(
    session: Session,
    project: Project,
    *,
    project_code: str | _Unset = UNSET,
    name: str | _Unset = UNSET,
    client_name: str | _Unset = UNSET,
    site_location: str | _Unset = UNSET,
    company_role: str | None | _Unset = UNSET,
    company_role_change_reason: str | None | _Unset = UNSET,
    planned_start_date: date | None | _Unset = UNSET,
    planned_completion_date: date | None | _Unset = UNSET,
) -> Project:
    """Update provided Project fields after validating all strings.

    改 ``company_role``（值與目前不同）時必須同時給原因（DOM-R76）；
    值沒有變動不需要原因。有欄位真的變動時，同一交易寫一筆
    ``project.updated``，只記有變動的欄位（ALG-R09、ALG-R28）。
    """
    fields: dict[str, object] = {
        field: value
        for field, value in {
            "project_code": project_code,
            "name": name,
            "client_name": client_name,
            "site_location": site_location,
            "company_role": company_role,
        }.items()
        if value is not UNSET
    }
    dates: dict[str, date | None] = {
        field: value
        for field, value in {
            "planned_start_date": planned_start_date,
            "planned_completion_date": planned_completion_date,
        }.items()
        if value is not UNSET
    }
    if not fields and not dates:
        raise ProjectUnchangedError("No Project fields were provided")
    operator = get_current_operator(session)
    fields.update(dates)
    candidate_values: dict[str, object] = {
        "project_code": project.project_code,
        "name": project.name,
        "client_name": project.client_name,
        "site_location": project.site_location,
        "company_role": project.company_role,
        "planned_start_date": project.planned_start_date,
        "planned_completion_date": project.planned_completion_date,
        "created_by": project.created_by,
        "updated_by": project.updated_by,
    }
    candidate_values.update(fields)
    try:
        Project(**candidate_values)
    except ValueError as exc:
        raise InvalidProjectFieldError from exc
    role_changed = (
        "company_role" in fields
        and fields["company_role"] != project.company_role
    )
    reason = (
        _checked_role_change_reason(company_role_change_reason)
        if role_changed
        else None
    )
    before = {
        field: getattr(project, field)
        for field, value in fields.items()
        if value != getattr(project, field)
    }
    for field, value in fields.items():
        setattr(project, field, value)
    project.updated_by = operator.id
    session.flush()
    if before:
        after = {field: fields[field] for field in before}
        if reason is not None:
            # 原因只進稽核的 after，不是 Project 上保存的欄位。
            after["company_role_change_reason"] = reason
        record_audit_event(
            session,
            "project.updated",
            entity_id=project.id,
            before=before,
            after=after,
            project_id=project.id,
        )
    return project


def _checked_role_change_reason(
    reason: str | None | _Unset,
) -> str:
    """DOM-R76：缺少或去除前後空白後為空 -> 專用錯誤；過長 -> 共用驗證錯誤。"""
    stripped = reason.strip() if isinstance(reason, str) else ""
    if not stripped:
        raise CompanyRoleReasonRequiredError(
            "company_role_change_reason is required when company_role "
            "changes (DOM-R76)"
        )
    if len(stripped) > COMPANY_ROLE_REASON_MAX_LENGTH:
        raise InvalidProjectFieldError(
            "company_role_change_reason must be at most "
            f"{COMPANY_ROLE_REASON_MAX_LENGTH} characters"
        )
    return stripped


def find_projects_by_code(
    session: Session, project_code: str
) -> Sequence[Project]:
    """Return every project with this code without changing rows."""
    with session.no_autoflush:
        return session.scalars(
            select(Project).where(Project.project_code == project_code)
        ).all()


__all__ = [
    "COMPANY_ROLE_REASON_MAX_LENGTH",
    "CompanyRoleReasonRequiredError",
    "InvalidProjectFieldError",
    "ProjectUnchangedError",
    "create_project",
    "find_projects_by_code",
    "update_project",
]
