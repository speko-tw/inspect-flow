"""Tests for ``app/services/users.py`` (DOM-AC04, DOM-AC13,
DOM-AC22).

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``.
"""

import pytest
from sqlalchemy import select

from app.models import User
from app.services.companies import create_company, update_company
from app.services.users import (
    CompanyNotActiveError,
    ExternalBasicFieldModificationError,
    create_user,
    update_user_manual,
)


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


class TestDomAc04ExternalAccountBasicFieldsRejected:
    """DOM-AC04: 一筆 ``external`` 帳號、一筆 ``local`` 帳號；分別
    修改兩者的 ``department`` 與 ``mobile``；``external`` 帳號的
    ``department`` 修改被拒絕、值不變，``mobile`` 修改成功；
    ``local`` 帳號兩者都修改成功。
    """

    def test_external_account_department_rejected_mobile_allowed(
        self, session, operator
    ):
        company = create_company(session, **_company_kwargs("C004"))
        session.flush()
        external_user = create_user(
            session,
            **_user_kwargs(
                "U004E",
                company.id,
                auth_source="external",
                external_source="ldap",
                external_id="ext-004",
            ),
        )
        session.commit()
        original_department = external_user.department

        with pytest.raises(ExternalBasicFieldModificationError):
            update_user_manual(
                session, external_user, department="New Department"
            )
        assert external_user.department == original_department

        update_user_manual(session, external_user, mobile="0911-000-004")
        session.commit()
        assert external_user.mobile == "0911-000-004"
        assert external_user.department == original_department

    def test_local_account_department_and_mobile_both_succeed(
        self, session, operator
    ):
        company = create_company(session, **_company_kwargs("C004L"))
        session.flush()
        local_user = create_user(session, **_user_kwargs("U004L", company.id))
        session.commit()

        update_user_manual(session, local_user, department="New Department")
        update_user_manual(session, local_user, mobile="0911-000-005")
        session.commit()

        assert local_user.department == "New Department"
        assert local_user.mobile == "0911-000-005"


class TestDomAc13LocalAccountCompanyChangeIgnoresKind:
    """DOM-AC13: 一筆 ``local`` 帳號屬於一間 ``kind = customer`` 的
    公司；透過 Service 層把他的 ``company_id`` 改為一間
    ``kind = internal`` 的公司；修改成功。
    """

    def test_company_change_across_kinds_succeeds(self, session, operator):
        customer_company = create_company(
            session, **_company_kwargs("C013CUST", kind="customer")
        )
        internal_company = create_company(
            session, **_company_kwargs("C013INT", kind="internal")
        )
        session.flush()
        user = create_user(
            session, **_user_kwargs("U013", customer_company.id)
        )
        session.commit()

        update_user_manual(session, user, company_id=internal_company.id)
        session.commit()

        assert user.company_id == internal_company.id


class TestDomAc22DisabledCompanyIsRejectedOnlyForCompanyAssignment:
    """DOM-AC22: 啟用中的公司 A、停用中的公司 B（B 啟用時建立，之
    後才停用）；``local`` 帳號 U 屬於 A，``local`` 帳號 V 屬於 B。
    新增一筆 ``company_id`` 為 B 的 ``User``、把 U 的 ``company_id``
    改為 B 都被拒絕，``User`` 筆數與 U 的資料不變；修改 V 的
    ``department``、``mobile`` 成功，``is_active`` 仍為 ``true``；
    把 V 的 ``company_id`` 改為 A 成功。
    """

    def test_disabled_company_blocks_assignment_not_other_fields(
        self, session, operator
    ):
        company_a = create_company(
            session, **_company_kwargs("A022", is_active=True)
        )
        company_b = create_company(
            session, **_company_kwargs("B022", is_active=True)
        )
        session.flush()

        user_u = create_user(session, **_user_kwargs("U022U", company_a.id))
        user_v = create_user(session, **_user_kwargs("U022V", company_b.id))
        session.commit()

        # B is disabled only after V was already assigned to it.
        update_company(session, company_b, is_active=False)
        session.commit()

        with pytest.raises(CompanyNotActiveError):
            create_user(session, **_user_kwargs("U022NEW", company_b.id))

        with pytest.raises(CompanyNotActiveError):
            update_user_manual(session, user_u, company_id=company_b.id)

        user_count = session.scalars(
            select(User).where(User.employee_no.like("U022%"))
        ).all()
        assert len(user_count) == 2
        assert user_u.company_id == company_a.id

        update_user_manual(
            session,
            user_v,
            department="Reassigned Department",
            mobile="0911-000-022",
        )
        session.commit()
        assert user_v.is_active is True
        assert user_v.department == "Reassigned Department"
        assert user_v.mobile == "0911-000-022"

        update_user_manual(session, user_v, company_id=company_a.id)
        session.commit()
        assert user_v.company_id == company_a.id
