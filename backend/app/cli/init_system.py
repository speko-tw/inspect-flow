"""System initialization command (DOM-R11, DOM-R12, DOM-R13,
DOM-R14).

Run with ``python -m app.cli.init_system`` (wired to ``make init``;
see the root ``Makefile``). Prompts interactively for the company's
``code``/``name`` and both accounts' required basic fields (DOM-R01,
``is_active`` excluded -- it defaults to enabled) via the plain
``input()`` builtin, which reads ``sys.stdin`` either way: an
operator typing at a terminal, or a test/deployment script piping
answers in through stdin non-interactively. No value or default for
any of these fields lives anywhere in this source file (DOM-R12);
:data:`_TEMPLATE_ROLE_NAMES` is not one of them -- it names which
three roles to create, not any of their field values, and
``kind="internal"`` is a fixed business rule (DOM-R11), not a
value DOM-R12 requires as input.

:func:`initialize_system` does the actual writes, in the one order
that satisfies ``User.company_id``'s ``DEFERRABLE INITIALLY
DEFERRED`` foreign key into the company being created in the very
same transaction (see ``app/models/user.py`` and plan.md's "風險"
section): both ``User`` rows first (each pointing ``company_id`` at
an app-generated id the ``Company`` row does not have yet), then the
``Company`` row (whose ``created_by``/``updated_by`` point at the
already-flushed admin row), then the three template roles. It
raises :class:`AlreadyInitializedError` without writing anything
when an ``is_system = True`` User already exists (DOM-R13) -- this
check runs again here, inside the write transaction, even though
:func:`run` already made the same check before prompting. Neither
``SELECT`` actually closes the race against a concurrent run by
itself; :func:`run` tells a losing run's resulting
``IntegrityError`` (from the template roles' global unique name
index, DOM-R34) apart from a real failure.

:func:`run` wraps one attempt in :func:`app.db.unit_of_work.unit_of_work`,
the same commit-or-rollback-everything unit the Service layer uses,
so "任何一步失敗時，整批都不生效" (DOM-R11) holds for every failure
this command can hit: a length/format ``ValueError`` raised by a
model's own ``@validates`` method while a field is being assigned
(before the row is even added to the session), or an
:class:`~sqlalchemy.exc.IntegrityError` raised by a database
constraint (a duplicate email, a duplicate ``employee_no``, ...) at
``flush()``/``commit()``. Per DOM-R22, none of this writes an audit
log entry -- there is no audit log table yet for this task to write
to (see plan.md's task table).
"""

from __future__ import annotations

import sys
from collections.abc import Callable, Iterable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.db.base import uuid7
from app.db.unit_of_work import unit_of_work
from app.models import Company, Role, User

InputReader = Callable[[str], str]

# DOM-R11: the three template roles the initialization command
# creates, in this fixed order. Their permission codes are
# intentionally left empty (DOM-Q4's issue #124 decision): Admin
# checks boxes for each on a future admin screen.
_TEMPLATE_ROLE_NAMES = ("內業整理", "現場查核", "唯讀")

# DOM-R01's required basic fields, excluding ``is_active`` (defaults
# to enabled) and ``company_id`` (both accounts share the one
# company built alongside them, not a separately prompted value).
# Each entry is (attribute name, prompt text); prompt text is
# display copy, not a business default -- DOM-R12 only forbids a
# default *value*.
_ACCOUNT_FIELDS: tuple[tuple[str, str], ...] = (
    ("department", "部門 department"),
    ("location", "地點 location"),
    ("employee_no", "工號 employee_no"),
    ("name_en", "英文姓名 name_en"),
    ("name_zh", "中文姓名 name_zh"),
    ("email", "email"),
)

_COMPANY_FIELDS: tuple[tuple[str, str], ...] = (
    ("code", "代碼 code"),
    ("name", "名稱 name"),
)


class AlreadyInitializedError(RuntimeError):
    """DOM-R13: an ``is_system = True`` ``User`` already exists, so
    the initialization command must not write anything.
    """


class CompanyInput:
    """The company's ``code``/``name``, as read from the operator
    (DOM-R12). A plain attribute holder, not a mapped model: nothing
    here is written to the database directly.
    """

    def __init__(self, *, code: str, name: str) -> None:
        self.code = code
        self.name = name


class AccountInput:
    """One account's required basic fields (DOM-R01), as read from
    the operator (DOM-R12). A plain attribute holder, not a mapped
    model.
    """

    def __init__(
        self,
        *,
        department: str,
        location: str,
        employee_no: str,
        name_en: str,
        name_zh: str,
        email: str,
    ) -> None:
        self.department = department
        self.location = location
        self.employee_no = employee_no
        self.name_en = name_en
        self.name_zh = name_zh
        self.email = email


def is_system_initialized(session: Session) -> bool:
    """DOM-R13: whether an ``is_system = True`` ``User`` already
    exists in the database ``session`` is connected to.
    """
    return (
        session.scalars(
            select(User.id).where(User.is_system.is_(True)).limit(1)
        ).first()
        is not None
    )


def read_company_input(input_fn: InputReader) -> CompanyInput:
    """Prompt for the company's ``code``/``name`` via ``input_fn``
    (DOM-R12)."""
    values = {
        field: input_fn(f"公司{label}: ") for field, label in _COMPANY_FIELDS
    }
    return CompanyInput(**values)


def read_account_input(input_fn: InputReader, label: str) -> AccountInput:
    """Prompt for one account's required basic fields via
    ``input_fn`` (DOM-R01, DOM-R12); ``label`` distinguishes the
    prompts for the two accounts this command creates.
    """
    values = {
        field: input_fn(f"{label} {prompt}: ")
        for field, prompt in _ACCOUNT_FIELDS
    }
    return AccountInput(**values)


def initialize_system(
    session: Session,
    *,
    company: CompanyInput,
    admin: AccountInput,
    owner: AccountInput,
) -> tuple[Company, User, User, list[Role]]:
    """DOM-R11: create the company, the built-in ``admin``, the
    owner's personal account, and the three empty template roles, in
    ``session``'s current transaction. Raises
    :class:`AlreadyInitializedError` without writing anything when
    DOM-R13's guard trips. Flushes as it builds each row but never
    commits or rolls back -- that is the caller's job (:func:`run`
    uses :func:`app.db.unit_of_work.unit_of_work` for this).
    """
    if is_system_initialized(session):
        raise AlreadyInitializedError(
            "an is_system=True User already exists; the "
            "initialization command must not write anything (DOM-R13)"
        )

    admin_id = uuid7()
    owner_id = uuid7()
    company_id = uuid7()

    # Write order per plan.md's "風險" section: ``User.company_id``
    # is the ``DEFERRABLE INITIALLY DEFERRED`` side of the circular
    # foreign key with ``Company.created_by``/``updated_by`` (both
    # checked immediately), so both ``User`` rows -- pointing
    # ``company_id`` at the not-yet-written ``Company`` via its
    # app-generated id -- are written first; the deferred check only
    # runs at COMMIT, by which point the caller has also written the
    # matching ``Company`` row.
    admin_user = User(
        id=admin_id,
        company_id=company_id,
        department=admin.department,
        location=admin.location,
        employee_no=admin.employee_no,
        name_en=admin.name_en,
        name_zh=admin.name_zh,
        email=admin.email,
        is_admin=True,
        is_system=True,
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(admin_user)
    session.flush()

    owner_user = User(
        id=owner_id,
        company_id=company_id,
        department=owner.department,
        location=owner.location,
        employee_no=owner.employee_no,
        name_en=owner.name_en,
        name_zh=owner.name_zh,
        email=owner.email,
        is_admin=True,
        is_system=False,
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(owner_user)
    session.flush()

    company_row = Company(
        id=company_id,
        code=company.code,
        name=company.name,
        kind="internal",
        created_by=admin_id,
        updated_by=admin_id,
    )
    session.add(company_row)
    session.flush()

    roles = [
        Role(name=name, created_by=admin_id, updated_by=admin_id)
        for name in _TEMPLATE_ROLE_NAMES
    ]
    session.add_all(roles)
    session.flush()

    return company_row, admin_user, owner_user, roles


def run(
    input_fn: InputReader | None = None,
    session_factory: sessionmaker[Session] | None = None,
) -> int:
    """Drive one initialization attempt end to end: a friendly
    already-initialized check before prompting, then prompting, then
    one all-or-nothing write. Returns a process-style exit code (0
    for success or "already initialized", 1 for any failure).
    ``session_factory`` is only ever overridden by tests; ``None``
    (the default, also what :func:`main` uses) makes
    :func:`~app.db.unit_of_work.unit_of_work` build a session
    against the configured database.

    ``input_fn`` defaults to ``None`` -- resolved to the ``input``
    builtin *inside* this function, rather than as the parameter's
    default value -- so that a caller (or a test) that replaces
    ``builtins.input`` after this module is imported still takes
    effect: a default value bound at ``def run(...)`` time would
    instead keep pointing at whatever ``input`` was when Python
    first read this function definition.
    """
    if input_fn is None:
        input_fn = input
    # DOM-R13: checking before prompting is friendlier (an operator
    # re-running this command against an already-initialized
    # database is not asked to retype every field first), but --
    # like the repeated check inside the write transaction that
    # ``initialize_system`` makes -- it is still just a ``SELECT``:
    # neither check by itself closes the race against a concurrent
    # run. What actually closes it is below, where a losing run's
    # ``IntegrityError`` is told apart from a real failure.
    with unit_of_work(session_factory) as precheck_session:
        if is_system_initialized(precheck_session):
            print("系統已初始化，未寫入任何資料。")
            return 0

    try:
        company = read_company_input(input_fn)
        admin = read_account_input(input_fn, "內建 admin 帳號")
        owner = read_account_input(input_fn, "負責人個人帳號")
    except EOFError:
        print("輸入不完整，初始化失敗。", file=sys.stderr)
        return 1

    try:
        with unit_of_work(session_factory) as session:
            initialize_system(
                session, company=company, admin=admin, owner=owner
            )
    except AlreadyInitializedError:
        print("系統已初始化，未寫入任何資料。")
        return 0
    except ValueError as exc:
        print(f"初始化失敗：{exc}", file=sys.stderr)
        return 1
    except IntegrityError as exc:
        # DOM-R13: both checks above are plain ``SELECT``s, so two
        # concurrent runs can each pass both before either commits.
        # The three template role names are fixed and
        # ``ix_roles_name_lower`` (DOM-R34) is a *global* unique
        # index, so whichever run's role rows reach the database
        # second always hits an ``IntegrityError`` there -- that
        # index, not either ``SELECT``, is the actual serialization
        # point. ``unit_of_work`` already rolled this run's
        # transaction back; re-check with a fresh session to tell
        # "the other run won" apart from a real failure (e.g. two
        # accounts sharing one email, which stays a failure since
        # nothing was ever committed for either run).
        with unit_of_work(session_factory) as recheck_session:
            if is_system_initialized(recheck_session):
                print("系統已初始化，未寫入任何資料。")
                return 0
        print(f"初始化失敗：{exc}", file=sys.stderr)
        return 1

    print("系統初始化完成。")
    return 0


def main(argv: Iterable[str] | None = None) -> int:
    """Entry point for ``python -m app.cli.init_system`` / ``make
    init``. ``argv`` is accepted for symmetry with other CLI entry
    points but currently unused: this command takes no arguments,
    only interactive/piped input.
    """
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
