"""``User`` model: common structure (DBF-R11, DBF-R12, DBF-R13,
DBF-R14) plus its business columns (DOM-R01, DOM-R02, DOM-R03,
DOM-R05, DOM-R08, DOM-R28, DOM-R31).

Basic fields (DOM-R01, all ``NOT NULL``): ``company_id`` (a
``DEFERRABLE INITIALLY DEFERRED`` foreign key into ``companies.id``
-- see the "circular foreign keys" risk in plan.md: ``User`` and
``Company`` reference each other, so at least one of the two
foreign keys involved must defer its check to commit time),
``department``, ``location``, ``employee_no`` (already present, see
below), ``name_en``, ``name_zh``, ``email`` and ``is_active``
(defaults to enabled, DOM-Q7's issue #127 decision, same as
``Company.is_active``).

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
``Company.kind``'s unbounded ``String`` in ``app/models/company.py``.

``email``'s uniqueness (DOM-R02) is case-insensitive while the
column itself keeps the value exactly as typed: a ``lower(email)``
functional unique index (``ix_users_email_lower`` below) enforces
this at the database level without a second, easy-to-desync
normalized column -- see plan.md's "風險" section for why a
normalized column was rejected (a Core ``update()`` touching only
``email`` could leave it stale).

DOM-Q1/DOM-R28 fixes every string column's length limit (and, for
``email``, its format: must contain ``@``, must not contain any
whitespace). Exactly like ``app/models/company.py``'s
``_CodeType``/``_NameType``/``_TaxIdType``, PostgreSQL enforces the
length limits through the column types below (DOM-R31), but SQLite
does not enforce ``String`` length at all, and neither backend's
column type checks ``email``'s format restriction, so the rules
themselves (length + format) live in exactly one place each --
``_check_string_field`` below -- and are enforced through two
independent layers so no write path can skip them:

- ``@validates`` (``_validate_string_field``, registered for every
  DOM-R28 column in one method via ``@validates(*_MAX_LENGTHS)``)
  runs on attribute assignment and on construction.
- ``_BoundedStringType`` (a ``TypeDecorator``, same pattern as
  ``UTCDateTime`` in ``app/db/base.py``) runs in
  ``process_bind_param``, covering the paths ``@validates`` cannot
  see: ``session.execute(insert(User).values(...))`` and
  ``session.execute(update(User).values(...))``. One instance is
  built per column (parametrized by field name instead of one
  near-identical subclass per field, unlike ``company.py``'s three
  separate classes), each fixed for the lifetime of the mapped
  class the same way ``_CodeType(_CODE_MAX_LENGTH)`` is -- so
  ``cache_ok = True`` is safe here for the same reason it is there:
  a given column's type instance never changes behavior between
  two compilations of the same statement.

Only ``None`` is passed through unchecked at both layers --
``employee_no``/``department``/``location``/``name_en``/
``name_zh``/``email`` are left for the columns' ``NOT NULL``
constraints to reject a missing value, not for these checks, and
the remaining fields (DOM-R03) may legitimately be ``NULL``.

This project has no existing domain/validation exception hierarchy,
so both layers raise the standard library's ``ValueError`` (which
SQLAlchemy wraps in a ``sqlalchemy.exc.StatementError`` when raised
from ``process_bind_param``), consistent with ``company.py`` and
``UTCDateTime.process_bind_param`` in ``app/db/base.py``.

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered by DOM-R31 here.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import TypeDecorator, Uuid

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin

# DOM-R28's length limits, one entry per string column this model
# defines. ``employee_no`` was previously narrowed to 16 by the
# ``22bfdd8a72a4`` migration (#140) but, unlike the other columns
# here, had no Python-side check at all before this task -- DOM-R31
# requires one for every DOM-R28 column, so it is folded into the
# same table instead of being treated as a special case.
_MAX_LENGTHS = {
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


def _check_string_field(field_name: str, value: str) -> None:
    max_length = _MAX_LENGTHS[field_name]
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


class _BoundedStringType(TypeDecorator):
    """Bind-time counterpart of ``_validate_string_field`` (DOM-R31)
    for one DOM-R28 string column, parametrized by field name so a
    single class covers all twelve columns instead of one
    near-identical ``TypeDecorator`` subclass per field.
    """

    impl = String
    cache_ok = True

    def __init__(self, field_name: str) -> None:
        super().__init__(_MAX_LENGTHS[field_name])
        self._field_name = field_name

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        _check_string_field(self._field_name, value)
        return value


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

    employee_no: Mapped[str] = mapped_column(
        _BoundedStringType("employee_no"), nullable=False, unique=True
    )

    # -- DOM-R01: basic fields -----------------------------------
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
    company_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("companies.id", deferrable=True, initially="DEFERRED"),
        nullable=False,
    )
    department: Mapped[str] = mapped_column(
        _BoundedStringType("department"), nullable=False
    )
    location: Mapped[str] = mapped_column(
        _BoundedStringType("location"), nullable=False
    )
    name_en: Mapped[str] = mapped_column(
        _BoundedStringType("name_en"), nullable=False
    )
    name_zh: Mapped[str] = mapped_column(
        _BoundedStringType("name_zh"), nullable=False
    )
    # No ``unique=True`` here: uniqueness is case-insensitive
    # (DOM-R02) and enforced by ``ix_users_email_lower`` below, not
    # by a plain column-level unique constraint on the stored,
    # as-typed value.
    email: Mapped[str] = mapped_column(
        _BoundedStringType("email"), nullable=False
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
        _BoundedStringType("extension_1"), nullable=True
    )
    extension_2: Mapped[str | None] = mapped_column(
        _BoundedStringType("extension_2"), nullable=True
    )
    mobile: Mapped[str | None] = mapped_column(
        _BoundedStringType("mobile"), nullable=True
    )
    line_id: Mapped[str | None] = mapped_column(
        _BoundedStringType("line_id"), nullable=True
    )
    wechat_id: Mapped[str | None] = mapped_column(
        _BoundedStringType("wechat_id"), nullable=True
    )
    responsibilities: Mapped[str | None] = mapped_column(
        _BoundedStringType("responsibilities"), nullable=True
    )

    # -- DOM-R05: system fields -----------------------------------
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    is_system: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    # -- DOM-R08: reserved external identity fields ----------------
    auth_source: Mapped[str] = mapped_column(
        String, nullable=False, default="local", server_default="local"
    )
    # No length limit: DOM-R28 does not list one for these two
    # columns (see DOM-Q1's "落地" note), matching the unbounded
    # ``String`` ``Company.kind`` uses in ``app/models/company.py``.
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
        # DOM-R02: case-insensitive uniqueness on ``email``, without
        # normalizing the stored value -- see this module's
        # docstring and plan.md's "風險" section.
        Index("ix_users_email_lower", func.lower(email), unique=True),
    )

    @validates(*_MAX_LENGTHS)
    def _validate_string_field(
        self, key: str, value: str | None
    ) -> str | None:
        if value is None:
            return value
        _check_string_field(key, value)
        return value
