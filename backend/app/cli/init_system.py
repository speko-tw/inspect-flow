"""Initialize the built-in administrator and first-login flow."""

from __future__ import annotations

import sys
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import uuid7
from app.db.engine import get_session_factory
from app.db.unit_of_work import unit_of_work
from app.models import User, UserPassword
from app.services.default_permissions import ensure_default_permissions
from app.services.setup_codes import issue_setup_code

Output = Callable[[str], None]


class AlreadyInitializedError(RuntimeError):
    """The built-in admin already has a password."""


def initialize_system(session: Session) -> tuple[User, str]:
    """建立系統資料，或簽發新的首次登入代碼。

    DOM-R68 角色與權限組合和第一位管理員在同一交易內建立，避免初始化失敗
    時留下不完整的系統資料。
    """
    if session.get_bind().dialect.name == "sqlite":
        # SQLite ignores SELECT FOR UPDATE. Take its database writer
        # reservation before reading so concurrent initializers cannot
        # both read the same old active-code set and insert replacements.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
    try:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True)).with_for_update()
        ).one_or_none()
    except MultipleResultsFound as exc:
        raise RuntimeError("multiple built-in admin accounts exist") from exc

    if admin is not None:
        if (
            session.scalar(
                select(UserPassword.id).where(UserPassword.user_id == admin.id)
            )
            is not None
        ):
            raise AlreadyInitializedError("System is already initialized.")
        ensure_default_permissions(session, actor_id=admin.id)
        return admin, issue_setup_code(session, admin)

    admin_id = uuid7()
    admin = User(
        id=admin_id,
        username="admin",
        company_id=None,
        email=None,
        name_zh=None,
        name_en=None,
        department=None,
        location=None,
        employee_no=None,
        is_admin=True,
        is_system=True,
        is_external_collaborator=False,
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(admin)
    session.flush()

    ensure_default_permissions(session, actor_id=admin.id)

    return admin, issue_setup_code(session, admin)


def run(
    session_factory: sessionmaker[Session] | None = None,
    *,
    output: Output = print,
    error_output: Output | None = None,
) -> int:
    """Run the command in one transaction and print the code once."""
    try:
        with unit_of_work(session_factory) as session:
            _admin, code = initialize_system(session)
    except AlreadyInitializedError as exc:
        if error_output is None:
            print(str(exc), file=sys.stderr)
        else:
            error_output(str(exc))
        return 1
    output(f"First-login code: {code}")
    return 0


def main() -> int:
    return run(get_session_factory())


if __name__ == "__main__":
    raise SystemExit(main())
