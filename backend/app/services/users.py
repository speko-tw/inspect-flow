"""``User`` create and manual-modification Service entry points
(DOM-R04, DOM-R14, DOM-R18, DOM-R32).

Modifying ``User`` must always go through here: direct ORM writes
skip DOM-R04's "外部帳號拒絕人工修改基本欄位" entirely (see plan.md's
"Service 層規則被繞過" risk). This module covers only creation
(:func:`create_user`) and the *manual* modification path
(:func:`update_user_manual`) -- DOM-R04 explicitly distinguishes
"人工修改" from ``external-identity-sync``'s sync path, which is out
of scope here and gets its own entry point in that spec. Also out
of scope, per this task's ticket: ``is_admin``/``is_active``
modification (DOM-R06/DOM-R07's protections, left to T7) and any
authorization check (whether the operator is Admin or the user
themselves -- left to ``authentication``, which only calls into
this module once it has already decided the caller may).
"""

import uuid

from sqlalchemy.orm import Session

from app.models import Company, User
from app.services import UNSET, _Unset
from app.services.operator import get_current_operator


class CompanyNotActiveError(ValueError):
    """DOM-R32: refused because the target ``Company`` is disabled
    (``is_active = False``). Raised before any attribute on the
    ``User`` is touched, so a caller inside a still-open transaction
    is left with no partial write.
    """


class ExternalBasicFieldModificationError(ValueError):
    """DOM-R04: an ``auth_source = external`` account's basic
    fields may only be changed by ``external-identity-sync``, never
    by a manual entry point. Raised before any attribute on the
    ``User`` is touched, so none of the fields in the same call --
    including ones that would otherwise have been allowed -- are
    written.
    """


def _reject_if_company_inactive(
    session: Session, company_id: uuid.UUID
) -> None:
    company = session.get(Company, company_id)
    # A company_id with no matching row at all is left to the
    # (deferred) foreign key constraint to reject at commit time,
    # same as every other dangling foreign key in this codebase --
    # this check only concerns a company that exists but is
    # disabled.
    if company is not None and not company.is_active:
        raise CompanyNotActiveError(
            f"Company {company_id} is not active (DOM-R32); a User "
            "cannot be created or reassigned to it"
        )


def create_user(
    session: Session,
    *,
    company_id: uuid.UUID,
    department: str,
    location: str,
    employee_no: str,
    name_en: str,
    name_zh: str,
    email: str,
    is_active: bool = True,
    auth_source: str = "local",
    external_source: str | None = None,
    external_id: str | None = None,
    extension_1: str | None = None,
    extension_2: str | None = None,
    mobile: str | None = None,
    line_id: str | None = None,
    wechat_id: str | None = None,
    responsibilities: str | None = None,
) -> User:
    """Add a ``User`` (DOM-R01, DOM-R03, DOM-R08), filling
    ``created_by``/``updated_by`` from the current operator
    (DOM-R14). Refuses a ``company_id`` pointing at a disabled
    ``Company`` (DOM-R32).
    """
    _reject_if_company_inactive(session, company_id)
    operator = get_current_operator(session)
    user = User(
        company_id=company_id,
        department=department,
        location=location,
        employee_no=employee_no,
        name_en=name_en,
        name_zh=name_zh,
        email=email,
        is_active=is_active,
        auth_source=auth_source,
        external_source=external_source,
        external_id=external_id,
        extension_1=extension_1,
        extension_2=extension_2,
        mobile=mobile,
        line_id=line_id,
        wechat_id=wechat_id,
        responsibilities=responsibilities,
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(user)
    session.flush()
    return user


def update_user_manual(
    session: Session,
    user: User,
    *,
    company_id: uuid.UUID | _Unset = UNSET,
    department: str | _Unset = UNSET,
    location: str | _Unset = UNSET,
    employee_no: str | _Unset = UNSET,
    name_en: str | _Unset = UNSET,
    name_zh: str | _Unset = UNSET,
    email: str | _Unset = UNSET,
    extension_1: str | None | _Unset = UNSET,
    extension_2: str | None | _Unset = UNSET,
    mobile: str | None | _Unset = UNSET,
    line_id: str | None | _Unset = UNSET,
    wechat_id: str | None | _Unset = UNSET,
    responsibilities: str | None | _Unset = UNSET,
) -> User:
    """Manually modify a ``User`` (DOM-R04, DOM-R18, DOM-R32).

    Basic fields (``company_id``, ``department``, ``location``,
    ``employee_no``, ``name_en``, ``name_zh``, ``email``) are
    rejected outright -- with no change to any field passed in the
    same call -- when ``user.auth_source == "external"`` (DOM-R04).
    For any other account, changing ``company_id`` additionally
    requires the target ``Company`` to be active (DOM-R18, DOM-R32);
    the other basic fields have no such restriction here (DOM-R04
    leaves "who may change a ``local`` account's basic fields" --
    Admin only -- to ``authentication``'s authorization check, not
    this function).

    Contact and supplementary fields (``extension_1``,
    ``extension_2``, ``mobile``, ``line_id``, ``wechat_id``,
    ``responsibilities``) are always allowed regardless of
    ``auth_source``; but when the same call is rejected for a
    basic field, none of its fields -- contact fields included --
    are written.

    Only keyword arguments actually passed are changed -- see
    :data:`app.services.UNSET`.
    """
    basic_fields = {
        "company_id": company_id,
        "department": department,
        "location": location,
        "employee_no": employee_no,
        "name_en": name_en,
        "name_zh": name_zh,
        "email": email,
    }
    changed_basic_fields = {
        field: value
        for field, value in basic_fields.items()
        if value is not UNSET
    }

    if changed_basic_fields and user.auth_source == "external":
        raise ExternalBasicFieldModificationError(
            "User "
            f"{user.id} is an external account; its basic fields "
            f"({', '.join(sorted(changed_basic_fields))}) may only "
            "be changed by external-identity-sync (DOM-R04)"
        )
    if "company_id" in changed_basic_fields:
        _reject_if_company_inactive(
            session, changed_basic_fields["company_id"]
        )

    operator = get_current_operator(session)
    for field, value in changed_basic_fields.items():
        setattr(user, field, value)
    contact_fields = {
        "extension_1": extension_1,
        "extension_2": extension_2,
        "mobile": mobile,
        "line_id": line_id,
        "wechat_id": wechat_id,
        "responsibilities": responsibilities,
    }
    for field, value in contact_fields.items():
        if value is not UNSET:
            setattr(user, field, value)
    user.updated_by = operator.id
    session.flush()
    return user


__all__ = [
    "CompanyNotActiveError",
    "ExternalBasicFieldModificationError",
    "create_user",
    "update_user_manual",
]
