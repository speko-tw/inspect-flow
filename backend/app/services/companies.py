"""``Company`` create/update Service entry points (DOM-R14,
DOM-R32, DOM-R33).

Every write to ``Company`` must go through :func:`create_company`/
:func:`update_company` so ``created_by``/``updated_by`` are always
filled from :func:`app.services.operator.get_current_operator` --
callers must not pass those two columns themselves.

Disabling a company (``is_active = False`` through
:func:`update_company`) has exactly one effect elsewhere in the
system: ``users.py``'s create and manual-update entry points refuse
to point a ``User`` at a disabled company (DOM-R32). This module
never touches any ``User`` row as a side effect of a ``Company``
update, matching DOM-R32's "停用公司不得改變旗下 User 的任何資料".
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Company, User
from app.services import UNSET, _Unset
from app.services.operator import get_current_operator


def create_company(
    session: Session,
    *,
    code: str,
    name: str,
    kind: str,
    tax_id: str | None = None,
    parent_id: uuid.UUID | None = None,
    is_active: bool = True,
) -> Company:
    """Add a ``Company`` (DOM-R16), filling ``created_by``/
    ``updated_by`` from the current operator (DOM-R14).
    """
    operator = get_current_operator(session)
    company = Company(
        code=code,
        name=name,
        kind=kind,
        tax_id=tax_id,
        parent_id=parent_id,
        is_active=is_active,
        created_by=operator.id,
        updated_by=operator.id,
    )
    session.add(company)
    session.flush()
    return company


def update_company(
    session: Session,
    company: Company,
    *,
    code: str | _Unset = UNSET,
    name: str | _Unset = UNSET,
    tax_id: str | None | _Unset = UNSET,
    kind: str | _Unset = UNSET,
    parent_id: uuid.UUID | None | _Unset = UNSET,
    is_active: bool | _Unset = UNSET,
) -> Company:
    """Modify a ``Company`` (DOM-R16, DOM-R33's "停用公司" is this
    function's ``is_active=False``), filling ``updated_by`` from
    the current operator (DOM-R14). Only keyword arguments actually
    passed are changed -- see :data:`app.services.UNSET`.
    """
    operator = get_current_operator(session)
    if code is not UNSET:
        company.code = code
    if name is not UNSET:
        company.name = name
    if tax_id is not UNSET:
        company.tax_id = tax_id
    if kind is not UNSET:
        company.kind = kind
    if parent_id is not UNSET:
        company.parent_id = parent_id
    if is_active is not UNSET:
        company.is_active = is_active
    company.updated_by = operator.id
    session.flush()
    return company


def list_active_users(
    session: Session, company_id: uuid.UUID
) -> Sequence[User]:
    """DOM-R33: the ``User`` rows currently active (``is_active =
    True``) in a ``Company``, so a caller about to disable it can
    display "這家公司還有 N 位啟用中的人員" (``N = len(result)``) and
    let the operator choose which of them to also disable. Users
    not returned here (already inactive) are left untouched either
    way.
    """
    return session.scalars(
        select(User).where(
            User.company_id == company_id, User.is_active.is_(True)
        )
    ).all()
