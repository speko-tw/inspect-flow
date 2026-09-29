"""Set-password command (AUT-R24, AUT-R25, AUT-R26).

Run with ``python -m app.cli.set_password <email>`` (wired to
``make set-password EMAIL=...``; see the root ``Makefile``). Sets or
replaces the Argon2id password hash of one ``auth_source = local``
``User`` -- identified by ``email``, compared case-insensitively
(DOM-R02) -- including the built-in ``admin`` (``is_system = True``,
AUT-Q4's issue #146 decision: it may set a password and log in, as a
break-glass account for when the owner's personal account is
unusable).

``email`` is the command's one positional argument, chosen over an
``--email`` option: unlike ``init_system``'s several interactively
prompted fields, this command only ever needs the one value, and a
positional argument is what ``--help`` (AUT-AC25) shows with the
least noise. Every other value -- the new password -- is read from
the terminal or from piped standard input (below), never from a
command-line argument, an environment variable, or a config file
(AUT-R24): the command line defines no option that could carry a
password, so passing one (for example ``--password``) fails with
argparse's own "unrecognized arguments" error (AUT-AC25) instead of
being silently accepted.

Connected to a terminal (``sys.stdin.isatty()``), the new password is
read twice with ``getpass`` (not echoed). Otherwise -- piped
standard input, for automation and this module's own tests
(AUT-AC25 permits this) -- it is read as two lines. Either way,
mismatched entries, an incomplete read (EOF before both lines
arrive), an unknown or ``external`` email, or a password failing
AUT-R04's length rule (``app.auth.passwords.check_password_length``)
all report failure and leave every table involved unchanged.

The write itself -- hashing, inserting or updating the ``UserPassword``
row, marking it temporary or not (AUT-R37: any account other than the
built-in ``admin``, i.e. ``is_system = False``, is marked temporary),
deleting the account's existing ``AuthSession`` rows (AUT-R25), and
writing the ``user.password_set`` audit record (AUT-R39, AUT-AC49) --
is delegated entirely to :func:`app.auth.password_service.set_password`
(AUT-R36's Service-layer entry point; T11, issue #192). This command
only decides *whether* to mark the password temporary; everything
else, including ``created_by``/``updated_by`` (AUT-R26, via
``app.services.operator.get_current_operator``, which falls back to
the built-in admin outside of any HTTP request), lives in that one
shared function. :func:`set_user_password` below keeps its previous
signature purely so the rest of this module (``run``, and this
module's own tests) did not need to change when the delegation was
introduced (plan.md's "風險" section, "T11 改寫 T6 的指令"); per that
same plan.md ("AC 對應測試"), this command keeps passing AUT-AC04,
AUT-AC23~AUT-AC25 and AUT-AC32 after that change.
"""

from __future__ import annotations

import argparse
import getpass
import sys
from collections.abc import Callable, Iterable

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.password_service import set_password
from app.auth.passwords import (
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    check_password_length,
)
from app.db.unit_of_work import unit_of_work
from app.models import User, UserPassword

PasswordReader = Callable[[], tuple[str, str] | None]


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m app.cli.set_password",
        description=(
            "設定一個本地驗證帳號（auth_source=local，含內建 "
            "admin）的密碼（AUT-R24）。連接終端機時以 getpass 輸入"
            "兩次密碼（不回顯）；標準輸入為管線時改讀取兩行。密碼"
            "一律由終端機或標準輸入取得，指令列不提供任何接受密碼"
            "的選項，也不讀取環境變數或設定檔。"
        ),
    )
    parser.add_argument("email", help="要設定密碼之帳號的 email（不分大小寫）")
    return parser


def find_eligible_user(session: Session, email: str) -> User | None:
    """AUT-R24: the ``auth_source = local`` ``User`` matching
    ``email`` (case-insensitively, DOM-R02), or ``None`` when no
    such account exists or the matching account is
    ``auth_source = external`` -- either way, the command must
    reject without writing anything.
    """
    user = session.scalars(
        select(User).where(func.lower(User.email) == email.lower())
    ).one_or_none()
    if user is None or user.auth_source != "local":
        return None
    return user


def read_password_pair() -> tuple[str, str] | None:
    """Read the new password twice (AUT-R24).

    Connected to a terminal: ``getpass`` twice, not echoed. A
    piped/non-tty standard input (automation, this module's own
    tests): two lines, trailing newline stripped. Either way,
    returns ``None`` on an incomplete read -- EOF before both
    entries arrive -- which the caller must treat as failure,
    leaving every table unchanged.
    """
    if sys.stdin.isatty():
        try:
            first = getpass.getpass("新密碼: ")
            second = getpass.getpass("再輸入一次新密碼: ")
        except EOFError:
            return None
        return first, second

    first = sys.stdin.readline()
    second = sys.stdin.readline()
    if first == "" or second == "":
        # ``readline()`` only ever returns the empty string at EOF
        # -- an empty *line* still comes back as ``"\n"`` -- so this
        # is genuinely "fewer than two lines were available", not a
        # blank password.
        return None
    return first.rstrip("\n"), second.rstrip("\n")


def set_user_password(
    session: Session, user: User, password: str
) -> UserPassword:
    """Set ``user``'s password through the Service-layer entry point
    (AUT-R36, ``app.auth.password_service.set_password``), marking it
    temporary unless ``user`` is the built-in ``admin`` (AUT-R37:
    ``is_system = True`` accounts are never marked temporary -- the
    password stays the one deployment personnel manage directly).

    Kept as a thin wrapper -- rather than inlining the call at this
    function's one call site in :func:`run` -- purely so this
    module's own tests keep calling a stable name (plan.md's "風險"
    section, "T11 改寫 T6 的指令"): everything the previous,
    self-contained version of this function did (hashing, writing
    ``UserPassword``, deleting ``AuthSession`` rows) now lives in
    :func:`set_password`, which also writes the ``user.password_set``
    audit record this command previously skipped (AUT-R39, AUT-AC49).
    """
    return set_password(
        session, user, password, is_temporary=not user.is_system
    )


def run(
    argv: Iterable[str] | None = None,
    *,
    password_reader: PasswordReader | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> int:
    """Drive one set-password attempt end to end: parse ``argv``,
    check the target account is eligible (AUT-R24), read the new
    password, validate it, then perform one all-or-nothing write.
    Returns a process-style exit code (0 for success, 1 for any
    failure). ``password_reader`` and ``session_factory`` are only
    ever overridden by tests; ``None`` (the default, also what
    :func:`main` uses) picks :func:`read_password_pair` and the
    database configured for the process, respectively.
    """
    parsed_argv = list(argv) if argv is not None else None
    args = _build_parser().parse_args(parsed_argv)
    reader = password_reader or read_password_pair

    with unit_of_work(session_factory) as session:
        eligible = find_eligible_user(session, args.email) is not None
    if not eligible:
        print(
            "設定密碼失敗：查無此 email，或帳號並非本地驗證來源"
            "（auth_source=local）。",
            file=sys.stderr,
        )
        return 1

    passwords = reader()
    if passwords is None:
        print("輸入不完整，設定密碼失敗。", file=sys.stderr)
        return 1
    first, second = passwords
    if first != second:
        print("兩次輸入的密碼不同，設定密碼失敗。", file=sys.stderr)
        return 1
    if not check_password_length(first):
        print(
            f"密碼長度須介於 {MIN_PASSWORD_LENGTH} 至 "
            f"{MAX_PASSWORD_LENGTH} 個字元（Unicode 字元數）之間，"
            "設定密碼失敗。",
            file=sys.stderr,
        )
        return 1

    with unit_of_work(session_factory) as session:
        user = find_eligible_user(session, args.email)
        if user is None:
            # AUT-R24's race: eligible above, no longer eligible
            # now (deleted, or converted to external, between the
            # two checks). Treated the same as the first check's
            # failure -- nothing about this transaction has written
            # anything yet.
            print(
                "設定密碼失敗：查無此 email，或帳號並非本地驗證來源"
                "（auth_source=local）。",
                file=sys.stderr,
            )
            return 1
        set_user_password(session, user, first)

    print("密碼設定完成。")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    """Entry point for ``python -m app.cli.set_password`` / ``make
    set-password``.
    """
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
