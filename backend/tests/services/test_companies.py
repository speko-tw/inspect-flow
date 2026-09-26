"""Tests for ``app/services/companies.py`` (DOM-AC10, DOM-AC23).

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``.
"""

from app.models import Company
from app.services.companies import (
    create_company,
    list_active_users,
    update_company,
)
from app.services.users import create_user


def _company_kwargs(code: str, **overrides) -> dict:
    kwargs = {"code": code, "name": f"Company {code}", "kind": "customer"}
    kwargs.update(overrides)
    return kwargs


def _user_kwargs(employee_no: str, company_id, **overrides) -> dict:
    kwargs = {
        "company_id": company_id,
        "department": "Operations",
        "location": "HQ",
        "employee_no": employee_no,
        "name_en": f"User {employee_no}",
        "name_zh": f"使用者{employee_no}",
        "email": f"{employee_no.lower()}@example.com",
    }
    kwargs.update(overrides)
    return kwargs


class TestDomAc10OperatorAttribution:
    """DOM-AC10: 透過 Service 層新增一筆 ``Company``，之後修改它；
    新增後 ``created_by``、``updated_by`` 都等於操作者的 UUID；修改
    後 ``updated_by`` 仍為操作者。
    """

    def test_create_and_update_are_attributed_to_the_operator(
        self, session, operator
    ):
        company = create_company(session, **_company_kwargs("C010"))
        session.commit()

        assert company.created_by == operator.id
        assert company.updated_by == operator.id

        update_company(session, company, name="Renamed Company")
        session.commit()

        assert company.name == "Renamed Company"
        assert company.created_by == operator.id
        assert company.updated_by == operator.id


class TestDomAc23ListActiveUsersAndDisable:
    """DOM-AC23: 公司 C 有兩筆啟用中、一筆已停用的 ``User``；公司 D
    沒有啟用中的人員。列出各自啟用中的人員與人數；停用 C 後，三筆
    ``User`` 的 ``is_active``、``company_id`` 都與停用前相同。
    """

    def test_list_counts_and_disabling_leaves_users_unchanged(
        self, session, operator
    ):
        company_c = create_company(session, **_company_kwargs("C023"))
        company_d = create_company(session, **_company_kwargs("D023"))
        session.flush()

        active_1 = create_user(session, **_user_kwargs("U023A", company_c.id))
        active_2 = create_user(session, **_user_kwargs("U023B", company_c.id))
        inactive = create_user(
            session,
            **_user_kwargs("U023C", company_c.id, is_active=False),
        )
        session.commit()

        c_users = list_active_users(session, company_c.id)
        d_users = list_active_users(session, company_d.id)

        assert {user.id for user in c_users} == {
            active_1.id,
            active_2.id,
        }
        assert len(c_users) == 2
        assert list(d_users) == []

        before = {
            user.id: (user.is_active, user.company_id)
            for user in (active_1, active_2, inactive)
        }

        update_company(session, company_c, is_active=False)
        session.commit()

        assert company_c.is_active is False
        for user in (active_1, active_2, inactive):
            session.refresh(user)
            assert (user.is_active, user.company_id) == before[user.id]

    def test_company_with_no_active_users_reports_empty(
        self, session, operator
    ):
        company_d = create_company(session, **_company_kwargs("D023B"))
        session.commit()

        assert list(list_active_users(session, company_d.id)) == []


def test_update_company_only_changes_passed_fields(session, operator):
    """Not itself an AC, but guards ``UNSET``'s contract: a field
    left out of the call keeps its previous value.
    """
    company = create_company(
        session, **_company_kwargs("C099", tax_id="12345678")
    )
    session.commit()

    update_company(session, company, name="New Name")
    session.commit()

    assert company.name == "New Name"
    assert company.tax_id == "12345678"
    assert isinstance(company, Company)
