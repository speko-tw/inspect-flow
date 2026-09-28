"""Tests for ``app/services/users.py`` (DOM-AC04, DOM-AC05, DOM-AC06,
DOM-AC13, DOM-AC22).

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``.
"""

import pytest
from sqlalchemy import func, select

from app.models import AuditLog, User
from app.services.companies import create_company, update_company
from app.services.users import (
    AdminStatusUnchangedError,
    BuiltInAccountModificationError,
    CompanyNotActiveError,
    ExternalBasicFieldModificationError,
    LastActiveAdminRemovalError,
    create_user,
    set_is_active,
    set_is_admin,
    update_user_manual,
)
from tests.db.conftest import create_root_user_with_company
from tests.services.conftest import snapshot_persisted_columns


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

    def test_dom_r04_external_account_company_id_rejected(
        self, session, operator
    ):
        """DOM-AC04／DOM-R04：``external`` 帳號經人工修改入口改
        ``company_id`` 被拒絕，整列（含 ``updated_at``、
        ``updated_by``）不變。目標公司為啟用中，排除 DOM-R32 的
        拒絕原因。
        """
        company_a = create_company(session, **_company_kwargs("C004A"))
        company_b = create_company(session, **_company_kwargs("C004B"))
        session.flush()
        external_user = create_user(
            session,
            **_user_kwargs(
                "U004C",
                company_a.id,
                auth_source="external",
                external_source="ldap",
                external_id="ext-004c",
            ),
        )
        session.commit()
        before = snapshot_persisted_columns(external_user)

        with pytest.raises(ExternalBasicFieldModificationError):
            update_user_manual(session, external_user, company_id=company_b.id)

        # In-session state first: expire_all() would discard any
        # unflushed change and hide it from the assertion.
        assert snapshot_persisted_columns(external_user) == before
        session.commit()
        session.expire_all()
        after = snapshot_persisted_columns(external_user)
        assert after == before
        assert after["company_id"] == company_a.id
        assert after["updated_at"] == before["updated_at"]
        assert after["updated_by"] == before["updated_by"]

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

        total_users_before = session.scalar(
            select(func.count()).select_from(User)
        )
        user_u_before = snapshot_persisted_columns(user_u)

        with pytest.raises(CompanyNotActiveError):
            create_user(session, **_user_kwargs("U022NEW", company_b.id))

        with pytest.raises(CompanyNotActiveError):
            update_user_manual(session, user_u, company_id=company_b.id)

        # In-session state first: expire_all() would discard any
        # unflushed change and hide it from the assertion.
        assert snapshot_persisted_columns(user_u) == user_u_before
        session.commit()
        session.expire_all()
        total_users_after = session.scalar(
            select(func.count()).select_from(User)
        )
        assert total_users_after == total_users_before
        assert snapshot_persisted_columns(user_u) == user_u_before
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


def _audit_rows_for(session, entity_id) -> list[AuditLog]:
    return list(
        session.scalars(
            select(AuditLog).where(AuditLog.entity_id == entity_id)
        ).all()
    )


class TestDomAc05BuiltInAccountProtected:
    """DOM-AC05: initialized database (built-in ``admin`` plus
    another Admin); through the Service layer, try to disable
    ``admin`` and to take away its ``is_admin`` -- both rejected,
    ``admin``'s data unchanged.
    """

    def test_builtin_account_rejects_deactivation_and_admin_removal(
        self, session, operator
    ):
        # ``operator`` is the built-in admin (is_system=True, set by
        # this directory's conftest); DOM-AC05's precondition also
        # needs it to already be an Admin.
        operator.is_admin = True
        session.flush()
        second_admin = create_root_user_with_company(session, "ADMIN05")
        second_admin.is_admin = True
        session.commit()
        before = snapshot_persisted_columns(operator)

        with pytest.raises(BuiltInAccountModificationError):
            set_is_active(session, operator, False)
        assert snapshot_persisted_columns(operator) == before

        with pytest.raises(BuiltInAccountModificationError):
            set_is_admin(session, operator, False)
        assert snapshot_persisted_columns(operator) == before

        session.commit()
        assert operator.is_active is True
        assert operator.is_admin is True
        assert _audit_rows_for(session, operator.id) == []


class TestDomAc06LastActiveAdminProtected:
    """DOM-AC06: a database with exactly one active, non-built-in
    Admin; taking away its ``is_admin`` and deactivating it are both
    rejected; after a second Admin is added, taking away the first
    one's ``is_admin`` succeeds.
    """

    def test_last_admin_protected_until_second_admin_exists(
        self, session, operator
    ):
        lone_admin = create_root_user_with_company(session, "LONE06")
        lone_admin.is_admin = True
        session.commit()
        assert lone_admin.is_active is True

        with pytest.raises(LastActiveAdminRemovalError):
            set_is_admin(session, lone_admin, False)
        assert lone_admin.is_admin is True

        with pytest.raises(LastActiveAdminRemovalError):
            set_is_active(session, lone_admin, False)
        assert lone_admin.is_active is True
        assert _audit_rows_for(session, lone_admin.id) == []

        second_admin = create_root_user_with_company(session, "SECOND06")
        second_admin.is_admin = True
        session.commit()

        set_is_admin(session, lone_admin, False)
        session.commit()

        assert lone_admin.is_admin is False
        rows = _audit_rows_for(session, lone_admin.id)
        assert len(rows) == 1
        assert rows[0].event_type == "user.admin_changed"
        assert rows[0].before == {"is_admin": True}
        assert rows[0].after == {"is_admin": False}
        assert rows[0].created_by == operator.id


class TestSetIsAdminUnchangedRejected:
    def test_same_value_raises_and_writes_nothing(self, session, operator):
        company = create_company(session, **_company_kwargs("C-ADMU"))
        session.flush()
        user = create_user(session, **_user_kwargs("U-ADMU", company.id))
        session.commit()
        before = snapshot_persisted_columns(user)

        with pytest.raises(AdminStatusUnchangedError):
            set_is_admin(session, user, False)

        assert snapshot_persisted_columns(user) == before
        assert _audit_rows_for(session, user.id) == []


class TestSetIsActiveWritesNoAuditEvent:
    """DOM-R22: ``is_active`` changes are outside the audited event
    scope, unlike ``is_admin``.
    """

    def test_is_active_change_has_no_audit_event(self, session, operator):
        company = create_company(session, **_company_kwargs("C-ACTU"))
        session.flush()
        user = create_user(session, **_user_kwargs("U-ACTU", company.id))
        session.commit()

        set_is_active(session, user, False)
        session.commit()
        assert user.is_active is False

        set_is_active(session, user, True)
        session.commit()
        assert user.is_active is True

        assert _audit_rows_for(session, user.id) == []
