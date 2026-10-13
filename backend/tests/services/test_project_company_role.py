"""本公司角色在服務層的規則（DOM-R76、ALG-AC28）。

測 ``create_project``／``update_project`` 的角色檢查、改角色必填原因，
以及 ``project.created``／``project.updated`` 稽核事件與專案寫入同一
交易。這層獨立測，是因為 API 層的 Pydantic 會先處理部分輸入，服務
層規則（例如全空白原因、過長原因）仍要自己成立，其他呼叫端
（腳本、之後的任務）才不會繞過。
"""

import pytest
from sqlalchemy import select

from app.models import AuditLog
from app.services.projects import (
    CompanyRoleReasonRequiredError,
    CompanyRoleReasonTooLongError,
    InvalidCompanyRoleError,
    InvalidProjectFieldError,
    create_project,
    update_project,
)


def _project(session, **kwargs):
    return create_project(
        session,
        project_code="DEMO",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
        **kwargs,
    )


def _events(session, event_type):
    return list(
        session.scalars(
            select(AuditLog)
            .where(AuditLog.event_type == event_type)
            .order_by(AuditLog.created_at, AuditLog.id)
        )
    )


def test_create_defaults_to_contractor_and_writes_project_created(
    session, operator
):
    project = _project(session)

    assert project.company_role == "contractor"
    [event] = _events(session, "project.created")
    assert event.entity_id == project.id
    assert event.project_id == project.id
    assert event.after == {
        "project_code": "DEMO",
        "name": "示範工程",
        "company_role": "contractor",
    }


def test_create_with_supervisor_and_invalid_values(session, operator):
    assert _project(session, company_role="supervisor").company_role == (
        "supervisor"
    )
    with pytest.raises(InvalidProjectFieldError):
        _project(session, company_role=None)
    for bad in ("unknown", ""):
        # 未登記的值用專屬子類別，API 才能把錯誤指到角色欄。
        with pytest.raises(InvalidCompanyRoleError):
            _project(session, company_role=bad)
    # 被拒絕的建立不留下事件（ALG-R14）：只有成功的那一筆。
    assert len(_events(session, "project.created")) == 1


def test_changing_role_requires_a_reason_and_leaves_data_unchanged(
    session, operator
):
    project = _project(session)
    session.commit()

    for reason in (None, "", "   \n"):
        with pytest.raises(CompanyRoleReasonRequiredError):
            update_project(
                session,
                project,
                company_role="supervisor",
                company_role_change_reason=reason,
            )
    with pytest.raises(CompanyRoleReasonRequiredError):
        update_project(session, project, company_role="supervisor")

    assert project.company_role == "contractor"
    assert _events(session, "project.updated") == []


def test_reason_length_boundary(session, operator):
    project = _project(session)

    with pytest.raises(CompanyRoleReasonTooLongError):
        update_project(
            session,
            project,
            company_role="supervisor",
            company_role_change_reason="字" * 257,
        )
    assert project.company_role == "contractor"

    # 去除前後空白後 256 字元可通過（DOM-R76）。
    update_project(
        session,
        project,
        company_role="supervisor",
        company_role_change_reason=f"  {'字' * 256}  ",
    )
    [event] = _events(session, "project.updated")
    assert event.after["company_role_change_reason"] == "字" * 256


def test_role_change_writes_before_after_and_reason_in_one_event(
    session, operator
):
    project = _project(session)

    update_project(
        session,
        project,
        company_role="supervisor",
        company_role_change_reason="  合約改為監造  ",
    )

    assert project.company_role == "supervisor"
    [event] = _events(session, "project.updated")
    assert event.entity_id == project.id
    assert event.project_id == project.id
    assert event.before == {"company_role": "contractor"}
    assert event.after == {
        "company_role": "supervisor",
        "company_role_change_reason": "合約改為監造",
    }


def test_same_role_needs_no_reason_and_writes_no_event(session, operator):
    project = _project(session)

    update_project(session, project, company_role="contractor")
    update_project(
        session,
        project,
        company_role="contractor",
        company_role_change_reason="不需要",
    )

    assert _events(session, "project.updated") == []


def test_other_field_change_event_has_no_reason(session, operator):
    project = _project(session)

    update_project(session, project, name="新名稱")

    [event] = _events(session, "project.updated")
    assert event.before == {"name": "示範工程"}
    assert event.after == {"name": "新名稱"}


def test_role_and_name_changed_together_share_one_event(session, operator):
    project = _project(session)

    update_project(
        session,
        project,
        name="新名稱",
        company_role="supervisor",
        company_role_change_reason="改為監造",
    )

    [event] = _events(session, "project.updated")
    assert event.before == {"name": "示範工程", "company_role": "contractor"}
    assert event.after == {
        "name": "新名稱",
        "company_role": "supervisor",
        "company_role_change_reason": "改為監造",
    }


def test_unregistered_role_is_rejected_even_with_a_reason(session, operator):
    project = _project(session)

    with pytest.raises(InvalidCompanyRoleError):
        update_project(
            session,
            project,
            company_role="unknown",
            company_role_change_reason="原因",
        )
    assert project.company_role == "contractor"


def test_temporary_role_needs_only_a_registry_entry(
    session, operator, extra_company_role
):
    project = _project(session, company_role=extra_company_role)

    assert project.company_role == extra_company_role
