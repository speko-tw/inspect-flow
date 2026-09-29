"""user and company account redesign, setup_codes table

Revision ID: e4b7a1c95d20
Revises: c1a8e5d13f62
Create Date: 2026-09-29 10:00:00.000000

Schema side of the account redesign (#259, implemented by #260):
domain-model DOM-R45~DOM-R50, DOM-R54 and authentication's
``SetupCode`` (AUT-R42, AUT-R45).

``users``: adds ``username`` (``NOT NULL``, unique, stored
lowercase); makes ``company_id``, ``department``, ``location``,
``employee_no``, ``name_en``, ``name_zh`` and ``email`` nullable;
replaces the global ``uq_users_employee_no`` with a per-company
``uq_users_company_id_employee_no``; and adds the CHECKs that keep
the nullable columns honest (lowercase and reserved usernames, both
``email`` and ``name_zh`` for every non-built-in account, no
employee number/department/location without a company, and the
built-in account's fixed shape). ``ix_users_email_lower`` is kept.

``companies``: drops ``code``, ``tax_id``, ``kind``, ``parent_id``
and every constraint on them, and adds the case-insensitive unique
index ``ix_companies_name_lower`` on ``lower(name)``.

``setup_codes``: a new table, created before any code exists.

Existing rows are migrated in Python between two schema steps (the
new ``NOT NULL``/unique/CHECK constraints can only be added after
the data satisfies them). Rules DOM-R54 and DOM-Q9 leave to this
migration:

- Built-in account (``is_system``): ``username = 'admin'``;
  ``company_id``, ``department``, ``location``, ``employee_no``,
  ``name_zh``, ``name_en`` are cleared and ``is_admin`` is set.
- Everyone else: the part of ``email`` before the first ``@``,
  lowercased. Characters outside ``[a-z0-9._-]`` become ``_``; a
  value that is empty or does not start with a letter gets a ``u``
  prepended; a value shorter than 3 characters is padded with ``0``;
  a value longer than 28 characters is cut to 28 (room for a
  numeric suffix inside the 32-character limit).
- A candidate that is a reserved word (``admin``/``system``/
  ``root``) or already taken gets the smallest number from 2 up
  appended (``anna.deng``, ``anna.deng2``, ...). Rows are handled
  oldest first (``created_at``, then ``id``), and the built-in
  account first of all, so the oldest holder keeps the plain name.
- Company names are trimmed. Names that only differ by case (or by
  surrounding whitespace) collide with the new unique index; the
  oldest keeps its name and each later one gets `` (2)``, `` (3)``,
  ... appended (cut short if needed to stay within 128 characters).
  An empty name becomes ``Company``.

Uses ``op.batch_alter_table`` (SQLite cannot alter constraints or
nullability in place) with ``PRAGMA foreign_keys`` off around the
table rebuilds, the same way ``600b0736442e`` does. Both expression
indexes are created with ``op.create_index`` outside the batch
blocks (SQLite cannot reflect an expression index, so a batch
rebuild would silently lose it); ``ix_users_email_lower`` is
dropped before and recreated after the rebuilds for the same reason.

Only SQLAlchemy built-in types are used, and no ``app`` import:
a migration must keep working after the models change.

The downgrade restores the old shape. It is lossy where the new
schema holds what the old one cannot: companies get a generated
``code`` (their id in hex) and ``kind`` ``'customer'`` (the oldest
company ``'internal'``); a user missing a value the old schema
required gets a placeholder (a shared ``Unassigned`` company,
``-`` for department/location, the username for the names, a
generated ``employee_no`` -- also for an employee number that
would collide across companies -- and
``<username>@unknown.invalid`` for ``email``).
"""

import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e4b7a1c95d20"
down_revision: str | Sequence[str] | None = "c1a8e5d13f62"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESERVED_USERNAMES = frozenset({"admin", "system", "root"})
_USERNAME_BASE_MAX = 28
_USERNAME_MIN = 3
_NAME_MAX = 128
_UNASSIGNED_COMPANY = "Unassigned"

_USERS = sa.table(
    "users",
    sa.column("id", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("username", sa.String()),
    sa.column("email", sa.String()),
    sa.column("is_system", sa.Boolean()),
    sa.column("is_admin", sa.Boolean()),
    sa.column("company_id", sa.Uuid()),
    sa.column("department", sa.String()),
    sa.column("location", sa.String()),
    sa.column("employee_no", sa.String()),
    sa.column("name_zh", sa.String()),
    sa.column("name_en", sa.String()),
)
_COMPANIES = sa.table(
    "companies",
    sa.column("id", sa.Uuid()),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("updated_at", sa.DateTime(timezone=True)),
    sa.column("created_by", sa.Uuid()),
    sa.column("updated_by", sa.Uuid()),
    sa.column("name", sa.String()),
    sa.column("is_active", sa.Boolean()),
    sa.column("code", sa.String()),
    sa.column("kind", sa.String()),
)

_USER_CHECKS = (
    (
        "ck_users_username_lower",
        "username = lower(username)",
    ),
    (
        "ck_users_username_reserved",
        "username NOT IN ('admin', 'system', 'root') OR "
        "(is_system AND username = 'admin')",
    ),
    (
        "ck_users_email_and_name_zh_required",
        "is_system OR (email IS NOT NULL AND name_zh IS NOT NULL)",
    ),
    (
        "ck_users_company_fields_need_company",
        "company_id IS NOT NULL OR (employee_no IS NULL AND "
        "department IS NULL AND location IS NULL)",
    ),
    (
        "ck_users_system_account",
        "NOT is_system OR (username = 'admin' AND is_admin AND "
        "company_id IS NULL AND name_zh IS NULL AND name_en IS NULL)",
    ),
)


def _unique_name(base: str, taken: set[str], max_length: int, fmt: str) -> str:
    """``base`` if free, else ``fmt`` (with ``{base}``/``{n}``) for
    the smallest ``n >= 2`` that is free; ``base`` is cut so the
    result stays within ``max_length``.
    """
    if base.lower() not in taken:
        return base
    n = 2
    while True:
        suffix = fmt.format(base="", n=n)
        candidate = fmt.format(base=base[: max_length - len(suffix)], n=n)
        if candidate.lower() not in taken:
            return candidate
        n += 1


def _username_base(email: str | None) -> str:
    local = (email or "").split("@", 1)[0].lower()
    base = re.sub(r"[^a-z0-9._-]", "_", local)
    if not base or not ("a" <= base[0] <= "z"):
        base = "u" + base
    return base[:_USERNAME_BASE_MAX].ljust(_USERNAME_MIN, "0")


def _backfill_companies(conn: sa.Connection) -> None:
    rows = conn.execute(
        sa.select(_COMPANIES.c.id, _COMPANIES.c.name).order_by(
            _COMPANIES.c.created_at, _COMPANIES.c.id
        )
    ).all()
    taken: set[str] = set()
    for company_id, name in rows:
        base = (name or "").strip()[:_NAME_MAX].strip() or "Company"
        new_name = _unique_name(base, taken, _NAME_MAX, "{base} ({n})")
        taken.add(new_name.lower())
        if new_name != name:
            conn.execute(
                sa.update(_COMPANIES)
                .where(_COMPANIES.c.id == company_id)
                .values(name=new_name)
            )


def _backfill_users(conn: sa.Connection) -> None:
    rows = conn.execute(
        sa.select(_USERS.c.id, _USERS.c.email, _USERS.c.is_system).order_by(
            _USERS.c.is_system.desc(), _USERS.c.created_at, _USERS.c.id
        )
    ).all()
    taken: set[str] = set(_RESERVED_USERNAMES)
    builtin_seen = False
    for user_id, email, is_system in rows:
        if is_system and not builtin_seen:
            builtin_seen = True
            conn.execute(
                sa.update(_USERS)
                .where(_USERS.c.id == user_id)
                .values(
                    username="admin",
                    is_admin=True,
                    company_id=None,
                    department=None,
                    location=None,
                    employee_no=None,
                    name_zh=None,
                    name_en=None,
                )
            )
            continue
        username = _unique_name(_username_base(email), taken, 32, "{base}{n}")
        taken.add(username)
        conn.execute(
            sa.update(_USERS)
            .where(_USERS.c.id == user_id)
            .values(username=username)
        )


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "setup_codes",
        sa.Column("code_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "failed_attempts",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "failure_window_started_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_setup_codes_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_setup_codes_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_setup_codes")),
    )

    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    # Rebuilding ``users`` would lose this expression index on
    # SQLite (module docstring); recreated below.
    op.drop_index("ix_users_email_lower", table_name="users")
    if is_sqlite:
        op.execute("PRAGMA foreign_keys=OFF")
    try:
        # -- step 1: relax and add columns, drop what must go ------
        with op.batch_alter_table("users") as batch_op:
            batch_op.add_column(
                sa.Column("username", sa.String(length=32), nullable=True)
            )
            for column, length in (
                ("department", 64),
                ("location", 64),
                ("employee_no", 16),
                ("name_en", 128),
                ("name_zh", 64),
                ("email", 254),
            ):
                batch_op.alter_column(
                    column,
                    existing_type=sa.String(length=length),
                    nullable=True,
                )
            batch_op.alter_column(
                "company_id", existing_type=sa.Uuid(), nullable=True
            )
            batch_op.drop_constraint(
                batch_op.f("uq_users_employee_no"), type_="unique"
            )
        with op.batch_alter_table("companies") as batch_op:
            batch_op.drop_constraint(
                batch_op.f("ck_companies_parent_id_not_self"),
                type_="check",
            )
            batch_op.drop_constraint(
                batch_op.f("ck_companies_kind"), type_="check"
            )
            batch_op.drop_constraint(
                batch_op.f("fk_companies_parent_id_companies"),
                type_="foreignkey",
            )
            batch_op.drop_constraint(
                batch_op.f("uq_companies_tax_id"), type_="unique"
            )
            batch_op.drop_constraint(
                batch_op.f("uq_companies_code"), type_="unique"
            )
            batch_op.drop_column("parent_id")
            batch_op.drop_column("kind")
            batch_op.drop_column("tax_id")
            batch_op.drop_column("code")

        # -- step 2: data ------------------------------------------
        _backfill_companies(conn)
        _backfill_users(conn)

        # -- step 3: constraints that need the data to be clean ----
        with op.batch_alter_table("users") as batch_op:
            batch_op.alter_column(
                "username", existing_type=sa.String(length=32), nullable=False
            )
            batch_op.create_unique_constraint(
                batch_op.f("uq_users_username"), ["username"]
            )
            batch_op.create_unique_constraint(
                batch_op.f("uq_users_company_id_employee_no"),
                ["company_id", "employee_no"],
            )
            for name, condition in _USER_CHECKS:
                batch_op.create_check_constraint(batch_op.f(name), condition)
    finally:
        if is_sqlite:
            op.execute("PRAGMA foreign_keys=ON")

    op.create_index(
        "ix_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
    )
    op.create_index(
        "ix_companies_name_lower",
        "companies",
        [sa.text("lower(name)")],
        unique=True,
    )


def _restore_companies(conn: sa.Connection) -> uuid.UUID | None:
    """Fill the re-added ``code``/``kind`` and return the id of a
    placeholder company when some user needs one (else ``None``).
    """
    rows = conn.execute(
        sa.select(_COMPANIES.c.id).order_by(
            _COMPANIES.c.created_at, _COMPANIES.c.id
        )
    ).all()
    for index, (company_id,) in enumerate(rows):
        conn.execute(
            sa.update(_COMPANIES)
            .where(_COMPANIES.c.id == company_id)
            .values(
                code=company_id.hex,
                kind="internal" if index == 0 else "customer",
            )
        )
    needs_placeholder = conn.execute(
        sa.select(sa.func.count())
        .select_from(_USERS)
        .where(_USERS.c.company_id.is_(None))
    ).scalar_one()
    if not needs_placeholder:
        return None
    actor = conn.execute(
        sa.select(_USERS.c.id)
        .order_by(_USERS.c.is_system.desc(), _USERS.c.created_at, _USERS.c.id)
        .limit(1)
    ).scalar_one()
    placeholder_id = uuid.uuid4()
    now = datetime.now(UTC)
    existing = {
        name.lower()
        for (name,) in conn.execute(sa.select(_COMPANIES.c.name)).all()
    }
    name = _unique_name(
        _UNASSIGNED_COMPANY, existing, _NAME_MAX, "{base} ({n})"
    )
    conn.execute(
        sa.insert(_COMPANIES).values(
            id=placeholder_id,
            name=name,
            is_active=True,
            code=placeholder_id.hex,
            kind="customer",
            created_at=now,
            updated_at=now,
            created_by=actor,
            updated_by=actor,
        )
    )
    return placeholder_id


def _restore_users(
    conn: sa.Connection, placeholder_id: uuid.UUID | None
) -> None:
    rows = conn.execute(
        sa.select(
            _USERS.c.id,
            _USERS.c.username,
            _USERS.c.email,
            _USERS.c.company_id,
            _USERS.c.department,
            _USERS.c.location,
            _USERS.c.employee_no,
            _USERS.c.name_zh,
            _USERS.c.name_en,
        ).order_by(_USERS.c.created_at, _USERS.c.id)
    ).all()
    seen_employee_nos: set[str] = set()
    for (
        user_id,
        username,
        email,
        company_id,
        department,
        location,
        employee_no,
        name_zh,
        name_en,
    ) in rows:
        if employee_no is None or employee_no in seen_employee_nos:
            employee_no = "U" + user_id.hex[:15]
        seen_employee_nos.add(employee_no)
        conn.execute(
            sa.update(_USERS)
            .where(_USERS.c.id == user_id)
            .values(
                company_id=company_id or placeholder_id,
                department=department or "-",
                location=location or "-",
                employee_no=employee_no,
                name_zh=name_zh or username[:64],
                name_en=name_en or username,
                email=email or f"{username}@unknown.invalid",
            )
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("setup_codes")
    op.drop_index("ix_companies_name_lower", table_name="companies")
    op.drop_index("ix_users_email_lower", table_name="users")

    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    if is_sqlite:
        op.execute("PRAGMA foreign_keys=OFF")
    try:
        with op.batch_alter_table("companies") as batch_op:
            batch_op.add_column(
                sa.Column("code", sa.String(length=32), nullable=True)
            )
            batch_op.add_column(
                sa.Column("tax_id", sa.String(length=8), nullable=True)
            )
            batch_op.add_column(sa.Column("kind", sa.String(), nullable=True))
            batch_op.add_column(
                sa.Column("parent_id", sa.Uuid(), nullable=True)
            )
        with op.batch_alter_table("users") as batch_op:
            for name, _condition in reversed(_USER_CHECKS):
                batch_op.drop_constraint(batch_op.f(name), type_="check")
            batch_op.drop_constraint(
                batch_op.f("uq_users_company_id_employee_no"),
                type_="unique",
            )

        placeholder_id = _restore_companies(conn)
        _restore_users(conn, placeholder_id)

        with op.batch_alter_table("companies") as batch_op:
            batch_op.alter_column(
                "code", existing_type=sa.String(length=32), nullable=False
            )
            batch_op.alter_column(
                "kind", existing_type=sa.String(), nullable=False
            )
            batch_op.create_unique_constraint(
                batch_op.f("uq_companies_code"), ["code"]
            )
            batch_op.create_unique_constraint(
                batch_op.f("uq_companies_tax_id"), ["tax_id"]
            )
            batch_op.create_foreign_key(
                batch_op.f("fk_companies_parent_id_companies"),
                "companies",
                ["parent_id"],
                ["id"],
            )
            batch_op.create_check_constraint(
                batch_op.f("ck_companies_kind"),
                "kind IN ('internal', 'customer')",
            )
            batch_op.create_check_constraint(
                batch_op.f("ck_companies_parent_id_not_self"),
                "parent_id <> id",
            )
        with op.batch_alter_table("users") as batch_op:
            batch_op.drop_constraint(
                batch_op.f("uq_users_username"), type_="unique"
            )
            batch_op.drop_column("username")
            for column, length in (
                ("department", 64),
                ("location", 64),
                ("employee_no", 16),
                ("name_en", 128),
                ("name_zh", 64),
                ("email", 254),
            ):
                batch_op.alter_column(
                    column,
                    existing_type=sa.String(length=length),
                    nullable=False,
                )
            batch_op.alter_column(
                "company_id", existing_type=sa.Uuid(), nullable=False
            )
            batch_op.create_unique_constraint(
                batch_op.f("uq_users_employee_no"), ["employee_no"]
            )
    finally:
        if is_sqlite:
            op.execute("PRAGMA foreign_keys=ON")

    op.create_index(
        "ix_users_email_lower",
        "users",
        [sa.text("lower(email)")],
        unique=True,
    )
