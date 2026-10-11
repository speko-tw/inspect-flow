"""``User`` model: common structure (DBF-R11, DBF-R12, DBF-R13,
DBF-R14) plus its business columns (DOM-R02, DOM-R03, DOM-R05,
DOM-R08, DOM-R28, DOM-R31, DOM-R45, DOM-R46, DOM-R47, DOM-R50).

Basic fields (DOM-R46): ``username`` (``NOT NULL``, stored in
lowercase, unique, see DOM-R45 below), ``is_active`` (``NOT NULL``,
defaults to enabled, DOM-Q7's issue #127 decision, same as
``Company.is_active``), and the optional-at-the-database-level
``email``/``name_zh`` (a CHECK requires both unless ``is_system``),
``name_en``, ``company_id`` (a ``DEFERRABLE INITIALLY DEFERRED``
foreign key into ``companies.id`` -- see the "circular foreign keys"
risk in plan.md: ``User`` and ``Company`` reference each other, so at
least one of the two foreign keys involved must defer its check to
commit time), ``department``, ``location`` and ``employee_no``
(defined by DBF-R12; unique per company, DOM-R47). ``department``,
``location`` and ``employee_no`` may only hold a value while
``company_id`` does (DOM-R47), and the built-in ``admin``
(``is_system``, DOM-R50) has no company, no names and no
department/location/employee number; these cross-field rules are
database CHECK constraints (DOM-R46 lets the plan choose between a
CHECK and a pre-write check, and a CHECK covers every write path
through the ORM and Core alike).

Contact and supplementary fields (DOM-R03, all optional):
``extension_1``, ``extension_2``, ``mobile``, ``line_id``,
``wechat_id``, ``responsibilities``.

System fields (DOM-R05): ``is_admin``, ``is_system``, both
``NOT NULL`` booleans defaulting to ``False``.

Reserved external identity fields (DOM-R08): ``auth_source``
(``NOT NULL``, restricted to ``local``/``external``, defaults to
``local``), ``external_source``, ``external_id`` (both optional,
required together when ``auth_source = external``, and unique as a
pair when both have a value), ``external_synced_at`` (optional).
``external_source``/``external_id`` have no length limit per
DOM-R28 (which does not list one for them), matching
an unbounded ``String``.

``username`` (DOM-R45) is 3-32 characters, starts with a letter and
otherwise holds only letters, digits, ``.``, ``_`` and ``-``; the
``@validates`` method lowercases it before it is stored or compared,
so a plain unique constraint is already case-insensitive, and a
CHECK (``username = lower(username)``) keeps Core writes honest. The
reserved words ``admin``/``system``/``root`` are rejected by a CHECK
too, except ``admin`` for the built-in account (which must use it).

``email``'s uniqueness (DOM-R02) is case-insensitive while the
column itself keeps the value exactly as typed: a ``lower(email)``
functional unique index (``ix_users_email_lower`` below) enforces
this at the database level without a second, easy-to-desync
normalized column -- see plan.md's "風險" section for why a
normalized column was rejected (a Core ``update()`` touching only
``email`` could leave it stale).

DOM-Q1/DOM-R28 fixes every string column's length limit (and, for
``email``, its format: must contain ``@``, must not contain any
whitespace). The rules themselves (length + format) live in exactly
one place each -- ``_check_string_field`` below -- and are enforced
through two independent layers (``@validates`` plus the
``BoundedString`` column type from ``app/models/_bounded_string.py``,
see that module's docstring for why) so no write path can skip them:

- ``@validates`` (``_validate_string_field``, registered for every
  DOM-R28 column in one method via ``@validates(*_MAX_LENGTHS)``)
  runs on attribute assignment and on construction.
- ``_bounded_string`` below builds one ``BoundedString`` instance
  per column (parametrized by field name instead of one
  near-identical ``TypeDecorator`` subclass per field, unlike
  ``company.py``'s pre-#183 three separate classes), each fixed for
  the lifetime of the mapped class -- so ``BoundedString``'s
  ``cache_ok = True`` is safe here for the same reason it is in
  ``company.py``/``project.py``: a given column's type instance
  never changes behavior between two compilations of the same
  statement.

``None`` is passed through unchecked at bind time (``BoundedString``
never checks it), but ``_validate_string_field`` calls
``validate_nullable`` (``app/models/_bounded_string.py``) first for
every one of these string columns: ``username`` is the only
``NOT NULL`` one and rejects ``None`` with the same ``ValueError`` an
invalid value gets, while the rest are nullable (a missing
``email``/``name_zh`` on an ordinary account is caught by the
``email_and_name_zh_required`` CHECK instead).

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered by DOM-R31 here.
"""

import re
import uuid
from datetime import date, datetime
from functools import partial

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString, validate_nullable

# DOM-R28's length limits, one entry per string column this model
# defines. ``employee_no`` was previously narrowed to 16 by the
# ``22bfdd8a72a4`` migration (#140) but, unlike the other columns
# here, had no Python-side check at all before this task -- DOM-R31
# requires one for every DOM-R28 column, so it is folded into the
# same table instead of being treated as a special case.
_MAX_LENGTHS = {
    "username": 32,
    "employee_no": 16,
    "department": 64,
    "location": 64,
    "name_en": 128,
    "name_zh": 64,
    "email": 254,
    "extension_1": 64,
    "extension_2": 64,
    "mobile": 64,
    "line_id": 64,
    "wechat_id": 64,
    "responsibilities": 2000,
}


# DOM-R45. Spelled out instead of ``\w`` for the same reason
# ``Company``'s old code pattern was: ``\w`` also matches non-ASCII
# letters in Python's ``re``.
_USERNAME_MIN_LENGTH = 3
_USERNAME_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9._-]*")


def _check_string_field(field_name: str, value: str) -> None:
    max_length = _MAX_LENGTHS[field_name]
    if field_name == "username" and (
        len(value) < _USERNAME_MIN_LENGTH
        or len(value) > max_length
        or not _USERNAME_PATTERN.fullmatch(value)
    ):
        raise ValueError(
            f"User.username must be {_USERNAME_MIN_LENGTH}-{max_length} "
            "characters, start with a letter and contain only letters, "
            f"digits, '.', '_' or '-'; got {value!r}"
        )
    if len(value) > max_length:
        raise ValueError(
            f"User.{field_name} must be at most {max_length} "
            f"characters; got {len(value)}"
        )
    if field_name == "email":
        # DOM-R28: "必須含 @，且不得含任何空白字元" -- ``isspace()``
        # covers space, tab, newline and other Unicode whitespace,
        # not just ASCII space.
        if "@" not in value or any(c.isspace() for c in value):
            raise ValueError(
                f"User.email must contain '@' and no whitespace "
                f"characters; got {value!r}"
            )


def _bounded_string(field_name: str) -> BoundedString:
    """A ``BoundedString`` for one DOM-R28 column, parametrized by
    field name so a single call site covers every column
    instead of one near-identical ``TypeDecorator`` subclass per
    field.
    """

    return BoundedString(
        _MAX_LENGTHS[field_name], partial(_check_string_field, field_name)
    )


class User(AuditMixin, TimestampedBase):
    """A person who can act in InspectFlow.

    Combines the structure shared with ``Project`` (the UUID
    primary key from ``TimestampedBase``, and the ``created_by``/
    ``updated_by`` audit columns from ``AuditMixin``, both pointing
    at ``users.id`` -- including this table's own primary key, so a
    ``User`` row can reference itself) with the business columns
    DOM-R01, DOM-R03, DOM-R05 and DOM-R08 define.
    """

    # PostgreSQL reserves the bare word "user"; naming the table
    # "users" avoids it.
    __tablename__ = "users"

    # DOM-R45: stored in lowercase (the ``@validates`` method below
    # lowercases every assignment), unique across every ``User``
    # including deactivated ones.
    username: Mapped[str] = mapped_column(
        _bounded_string("username"), nullable=False, unique=True
    )
    # DOM-R47/DBF-R12/DBF-R13: optional, only meaningful while
    # ``company_id`` is set, and unique within one company (the
    # ``uq_users_company_id_employee_no`` constraint below; a
    # ``NULL`` in either column never collides).
    employee_no: Mapped[str | None] = mapped_column(
        _bounded_string("employee_no"), nullable=True
    )

    # -- DOM-R46: basic fields -----------------------------------
    # ``deferrable``/``initially`` (DEFERRABLE INITIALLY DEFERRED):
    # ``Company.created_by`` also points back at ``users.id`` and is
    # checked immediately, so the first row of each written in the
    # same transaction (T6's initialization command) must write the
    # ``User`` row first, with ``company_id`` pointing at a
    # not-yet-written ``Company`` row whose id the application
    # already generated -- only a deferred check on this side lets
    # that ``INSERT`` succeed before the matching ``Company`` row
    # exists, with the reference verified at COMMIT instead (see
    # plan.md's "風險" section).
    company_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid,
        ForeignKey("companies.id", deferrable=True, initially="DEFERRED"),
        nullable=True,
    )
    department: Mapped[str | None] = mapped_column(
        _bounded_string("department"), nullable=True
    )
    location: Mapped[str | None] = mapped_column(
        _bounded_string("location"), nullable=True
    )
    name_en: Mapped[str | None] = mapped_column(
        _bounded_string("name_en"), nullable=True
    )
    # ``name_zh``/``email`` are nullable at the database level only
    # so the built-in ``admin`` can leave them empty: the
    # ``email_and_name_zh_required`` CHECK below demands both from
    # every other account.
    name_zh: Mapped[str | None] = mapped_column(
        _bounded_string("name_zh"), nullable=True
    )
    # No ``unique=True`` here: uniqueness is case-insensitive
    # (DOM-R02) and enforced by ``ix_users_email_lower`` below, not
    # by a plain column-level unique constraint on the stored,
    # as-typed value.
    email: Mapped[str | None] = mapped_column(
        _bounded_string("email"), nullable=True
    )
    # ``server_default`` (DOM-Q7/issue #127) makes an unspecified
    # value default to enabled at the database level too, matching
    # ``Company.is_active`` and the migration's own
    # ``server_default``.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )

    # -- DOM-R03: contact and supplementary fields (all optional) -
    extension_1: Mapped[str | None] = mapped_column(
        _bounded_string("extension_1"), nullable=True
    )
    extension_2: Mapped[str | None] = mapped_column(
        _bounded_string("extension_2"), nullable=True
    )
    mobile: Mapped[str | None] = mapped_column(
        _bounded_string("mobile"), nullable=True
    )
    line_id: Mapped[str | None] = mapped_column(
        _bounded_string("line_id"), nullable=True
    )
    wechat_id: Mapped[str | None] = mapped_column(
        _bounded_string("wechat_id"), nullable=True
    )
    responsibilities: Mapped[str | None] = mapped_column(
        _bounded_string("responsibilities"), nullable=True
    )

    # -- DOM-R05: system fields -----------------------------------
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    is_external_collaborator: Mapped[bool] = mapped_column(
        Boolean, nullable=False
    )
    account_expires_on: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )

    # -- DOM-R08: reserved external identity fields ----------------
    auth_source: Mapped[str] = mapped_column(
        String, nullable=False, default="local", server_default="local"
    )
    # No length limit: DOM-R28 does not list one for these two
    # columns (see DOM-Q1's "落地" note).
    external_source: Mapped[str | None] = mapped_column(String, nullable=True)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    external_synced_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )

    # Names passed to ``CheckConstraint`` are the naming
    # convention's ``%(constraint_name)s`` placeholder, not the
    # final constraint name -- ``app.db.base.NAMING_CONVENTION``
    # already prefixes it with ``ck_%(table_name)s_`` (see
    # ``company.py`` for the same pattern). ``UniqueConstraint``
    # and ``Index`` need no explicit name: the naming convention's
    # ``uq``/``ix`` templates derive one from the table and column
    # names.
    __table_args__ = (
        CheckConstraint(
            "auth_source IN ('local', 'external')", name="auth_source"
        ),
        CheckConstraint(
            "auth_source <> 'external' OR "
            "(external_source IS NOT NULL AND external_id IS NOT NULL)",
            name="external_fields_required",
        ),
        UniqueConstraint("external_source", "external_id"),
        # DOM-R47/DBF-R13: unique within one company. ``NULL``
        # ``company_id`` or ``employee_no`` is never compared (SQL
        # unique constraints ignore rows with a ``NULL`` in any
        # column, on both SQLite and PostgreSQL).
        UniqueConstraint(
            "company_id",
            "employee_no",
            name="uq_users_company_id_employee_no",
        ),
        # DOM-R45: lowercase storage and reserved words. Only the
        # built-in account may (and must, see the ``system_account``
        # CHECK) use ``admin``.
        CheckConstraint("username = lower(username)", name="username_lower"),
        CheckConstraint(
            "username NOT IN ('admin', 'system', 'root') OR "
            "(is_system AND username = 'admin')",
            name="username_reserved",
        ),
        # DOM-R46: an ordinary account needs both; the built-in
        # account may have neither.
        CheckConstraint(
            "is_system OR (email IS NOT NULL AND name_zh IS NOT NULL)",
            name="email_and_name_zh_required",
        ),
        CheckConstraint(
            "is_external_collaborator OR account_expires_on IS NULL",
            name="external_expiry_only",
        ),
        # DOM-R47: no company, no employee number/department/location.
        CheckConstraint(
            "company_id IS NOT NULL OR (employee_no IS NULL AND "
            "department IS NULL AND location IS NULL)",
            name="company_fields_need_company",
        ),
        # DOM-R50: the built-in account is ``admin``, always an
        # Admin, and belongs to no company and has no names (its
        # department/location/employee number are already covered by
        # the CHECK above).
        CheckConstraint(
            "NOT is_system OR (username = 'admin' AND is_admin AND "
            "company_id IS NULL AND name_zh IS NULL AND name_en IS NULL)",
            name="system_account",
        ),
        # DOM-R02: case-insensitive uniqueness on ``email``, without
        # normalizing the stored value -- see this module's
        # docstring and plan.md's "風險" section.
        Index("ix_users_email_lower", func.lower(email), unique=True),
    )

    @validates(*_MAX_LENGTHS)
    def _validate_string_field(
        self, key: str, value: str | None
    ) -> str | None:
        value = validate_nullable(self, key, value, f"User.{key}")
        if value is None:
            return value
        if key == "username":
            # DOM-R45: any case is accepted on input, but it is
            # always stored and compared in lowercase.
            value = value.lower()
        _check_string_field(key, value)
        return value
