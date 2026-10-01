"""Reset the built-in admin password from a server-side command."""

from __future__ import annotations

import argparse
import getpass
import sys
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.password_service import PasswordLengthError, set_password
from app.db.engine import get_session_factory
from app.db.unit_of_work import unit_of_work
from app.models import User, UserPassword

ReadSecret = Callable[[str], str]
WriteText = Callable[[str], None]


def _find_admin(session: Session) -> User | None:
    return session.scalars(
        select(User).where(User.is_system.is_(True))
    ).one_or_none()


def run(
    first_password: str,
    second_password: str,
    session_factory: sessionmaker[Session] | None = None,
    *,
    output: WriteText = print,
) -> int:
    """Apply a password reset after collecting two matching values."""
    if first_password != second_password:
        output("Passwords do not match.")
        return 1

    try:
        with unit_of_work(session_factory) as session:
            admin = _find_admin(session)
            if admin is None:
                output("Run make init to create the built-in admin first.")
                return 1
            if (
                session.scalar(
                    select(UserPassword.id).where(
                        UserPassword.user_id == admin.id
                    )
                )
                is None
            ):
                output(
                    "Admin has no password; run make init to get a setup code."
                )
                return 1
            set_password(
                session,
                admin,
                first_password,
                is_temporary=False,
                system_event=True,
            )
    except PasswordLengthError:
        output("Password must contain 8 to 128 characters.")
        return 1

    output("Admin password reset.")
    return 0


def _read_secret_pair(reader: ReadSecret) -> tuple[str, str]:
    return reader("New admin password: "), reader("Repeat password: ")


def main() -> int:
    argparse.ArgumentParser(
        prog="python -m app.cli.reset_admin_password",
        description="Set a new password for the built-in admin.",
    ).parse_args()
    if sys.stdin.isatty():
        reader = getpass.getpass
    else:

        def read_stdin(_prompt: str) -> str:
            line = sys.stdin.readline()
            if line == "":
                raise EOFError
            return line.rstrip("\r\n")

        reader = read_stdin
    try:
        first, second = _read_secret_pair(reader)
    except (EOFError, KeyboardInterrupt):
        print("Password input cancelled.", file=sys.stderr)
        return 1
    return run(first, second, get_session_factory())


if __name__ == "__main__":
    raise SystemExit(main())
