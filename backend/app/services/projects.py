"""專案的寫入與查詢入口（DOM-R14、DOM-R40-R44、DOM-R76）。"""

import uuid
from collections.abc import Sequence
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.company_roles import DEFAULT_COMPANY_ROLE, is_company_role_registered
from app.models import CreatorRoleSetting, Project
from app.services import UNSET, _Unset
from app.services.audit import record_audit_event
from app.services.module_permissions import (
    InvalidCreatorRoleUserError,
    query_person_access,
)
from app.services.operator import get_current_operator
from app.services.project_members import add_project_member

# DOM-R76：改本公司角色的原因，去除前後空白後 1～256 字元。
COMPANY_ROLE_REASON_MAX_LENGTH = 256


class InvalidProjectFieldError(ValueError):
    """送進來的專案欄位沒通過 model 驗證。"""


class ProjectUnchangedError(ValueError):
    """更新請求沒有帶任何專案欄位。"""


class InvalidCompanyRoleError(InvalidProjectFieldError):
    """DOM-R76：``company_role`` 不是登記表裡的值。

    獨立成子類別，是為了讓 API 能把錯誤指到 ``/company_role`` 欄位
    （ADM-R28 要求錯誤顯示在欄位旁），而不是只回整體驗證失敗。
    """


class CompanyRoleReasonTooLongError(InvalidProjectFieldError):
    """DOM-R76：改角色的原因去除前後空白後超過上限。

    與「缺原因」分開：過長是欄位格式問題，API 指到
    ``/company_role_change_reason``，缺原因則用專用錯誤碼。
    """


class CompanyRoleReasonRequiredError(ValueError):
    """DOM-R76：改了 ``company_role`` 卻沒給可用的原因。

    API 對應專用錯誤碼 ``project.company_role_reason_required``，
    前端靠它把提示放在原因欄旁。
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
    creator_role_user_id: uuid.UUID | None = None,
) -> Project:
    """建立專案並依 DOM-R65 在同一交易指派建立者角色。

    ``company_role`` 省略時為承攬施工方（DOM-R76）；帶 ``None`` 或
    未登記的值會被拒絕，未登記時丟 ``InvalidCompanyRoleError``。
    ``project.created`` 與專案同一交易寫入，兩者要嘛一起成功、要嘛
    一起回滾（DOM-R65、ALG-R28）。非 Admin 自動成員，Admin 可指定
    一位符合資格的人選；Admin 本人不自動成為成員。
    """
    _require_registered_role(company_role)
    fields: dict[str, object] = {
        "project_code": project_code,
        "name": name,
        "client_name": client_name,
        "site_location": site_location,
        "company_role": company_role,
    }
    operator = get_current_operator(session)
    actor_access = query_person_access(session, user_id=operator.id)
    if actor_access is None:
        raise InvalidProjectFieldError("Project creator does not exist")
    is_admin = actor_access.is_admin
    if creator_role_user_id is not None and not is_admin:
        raise InvalidCreatorRoleUserError(
            "Only Admin may select a creator-role user"
        )
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
    member_user_id = creator_role_user_id if is_admin else operator.id
    if member_user_id is not None:
        creator_role_id = session.scalar(
            select(CreatorRoleSetting.role_id).where(
                CreatorRoleSetting.setting_key == "creator_role"
            )
        )
        if creator_role_id is None:
            raise InvalidProjectFieldError(
                "Creator role setting has not been initialized"
            )
        try:
            add_project_member(
                session,
                project_id=project.id,
                user_id=member_user_id,
                role_ids=[creator_role_id],
                allow_self_assignment=not is_admin,
                require_creator_user=is_admin,
            )
        except InvalidCreatorRoleUserError:
            raise
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
    """驗證所有傳入欄位後更新專案。

    改 ``company_role``（值與目前不同）時必須同時給原因（DOM-R76）；
    值沒有變動不需要原因，免得前端每次整包送出都被迫填原因。
    有欄位真的變動時，同一交易寫一筆 ``project.updated``，只記有變動
    的欄位（ALG-R09、ALG-R28）。
    """
    _require_registered_role(None if company_role is UNSET else company_role)
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
            # 原因只進稽核的 after：它說明「為什麼改」，不是專案本身的
            # 屬性，不另開欄位保存。
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


def _require_registered_role(value: str | None) -> None:
    """DOM-R76：有給角色值時先查登記表，未登記丟專屬錯誤。

    必須在 model 驗證之前查：model 只會丟沒有欄位資訊的 ValueError，
    API 無法據此指出是哪個欄位錯。``None`` 交給呼叫端既有的檢查。
    """
    if value is not None and not is_company_role_registered(value):
        raise InvalidCompanyRoleError(
            f"company_role {value!r} is not a registered company role"
        )


def _checked_role_change_reason(
    reason: str | None | _Unset,
) -> str:
    """DOM-R76：缺原因或去空白後為空丟專用錯誤；過長丟欄位格式錯誤。

    回傳去除前後空白的原因，稽核與回應都用同一份，避免前端送的空白
    被寫進紀錄。
    """
    stripped = reason.strip() if isinstance(reason, str) else ""
    if not stripped:
        raise CompanyRoleReasonRequiredError(
            "company_role_change_reason is required when company_role "
            "changes (DOM-R76)"
        )
    if len(stripped) > COMPANY_ROLE_REASON_MAX_LENGTH:
        raise CompanyRoleReasonTooLongError(
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
    "CompanyRoleReasonTooLongError",
    "InvalidCompanyRoleError",
    "InvalidProjectFieldError",
    "ProjectUnchangedError",
    "create_project",
    "find_projects_by_code",
    "update_project",
]
