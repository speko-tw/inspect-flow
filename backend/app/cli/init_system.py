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
from app.models import Role, User, UserPassword
from app.services.setup_codes import issue_setup_code

Output = Callable[[str], None]
_TEMPLATE_ROLE_NAMES = ("內業整理", "現場查核", "唯讀")


class AlreadyInitializedError(RuntimeError):
    """The built-in admin already has a password."""


def initialize_system(session: Session) -> tuple[User, str]:
    """Create system rows once, or issue a replacement setup code."""
    try:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
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
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(admin)
    session.flush()

    for name in _TEMPLATE_ROLE_NAMES:
        session.add(
            Role(
                name=name,
                created_by=admin.id,
                updated_by=admin.id,
            )
        )
    session.flush()
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
