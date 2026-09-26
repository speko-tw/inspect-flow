"""``Company`` model (DOM-R15, DOM-R16, DOM-R17, DOM-Q7).

Company shares the same common structure as ``User``/``Project``
(UUID primary key, created/updated timestamps and audit columns,
see ``AuditMixin``), plus its own business columns: a unique
``code``, a ``name``, an optional but unique ``tax_id``, a ``kind``
restricted to ``internal``/``customer``, a self-referential
``parent_id`` (which a database CHECK forbids pointing at its own
row), and an ``is_active`` flag that defaults to enabled (DOM-Q7,
issue #127).

DOM-Q1/DOM-R29 fixes ``code``/``name``/``tax_id`` length limits and
``code``/``tax_id`` formats. PostgreSQL enforces the length limits
through the column types below (DOM-R31), but SQLite does not
enforce ``String`` length at all, and neither backend's column type
enforces the character-class format restrictions. The rules
themselves (length + format) live in exactly one place each --
``_check_code``/``_check_name``/``_check_tax_id`` below -- and are
enforced through two independent layers so no write path can skip
them:

- ``@validates`` (``_validate_code``/``_validate_name``/
  ``_validate_tax_id``) runs on attribute assignment and on
  construction (SQLAlchemy calls it for constructor keyword
  arguments too), giving immediate feedback when code builds or
  mutates a ``Company`` object directly.
- ``_CodeType``/``_NameType``/``_TaxIdType`` (``TypeDecorator``
  subclasses, same pattern as ``UTCDateTime`` in
  ``app/db/base.py``) run in ``process_bind_param``, which SQLAlchemy
  calls whenever a value is bound to the column -- covering not only
  the unit-of-work flush that ``@validates`` already catches, but
  also the paths ``@validates`` cannot see because they never touch
  a mapped attribute: ``session.execute(insert(Company).values(...))``
  and ``session.execute(update(Company).values(...))`` (both a
  single-row and a bulk/Core statement). Only ``None`` is passed
  through unchecked at bind time -- ``tax_id`` may legitimately be
  NULL, and a NULL ``code``/``name`` is left for the columns'
  ``NOT NULL`` constraints to reject, not for these checks.

This project has no existing domain/validation exception hierarchy,
so both layers raise the standard library's ``ValueError`` (which
SQLAlchemy wraps in a ``sqlalchemy.exc.StatementError`` when raised
from ``process_bind_param``), consistent with how a constructor
already rejects bad input elsewhere in this codebase
(``UTCDateTime.process_bind_param`` in ``app/db/base.py``).

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered by DOM-R31 here.
"""

import re
import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, true
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import TypeDecorator, Uuid

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin

_CODE_MAX_LENGTH = 32
_NAME_MAX_LENGTH = 128
_TAX_ID_LENGTH = 8

# ``\w``/``\d`` also match non-ASCII characters (e.g. full-width
# digits, CJK letters) in Python's ``re`` by default, which
# DOM-R29's "只能是英文字母、數字、``-``、``_``" and "恰為 8 位數字"
# both rule out, so the character classes are spelled out instead.
_CODE_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
_TAX_ID_PATTERN = re.compile(r"[0-9]{8}")


def _check_code(value: str) -> None:
    if len(value) > _CODE_MAX_LENGTH or not _CODE_PATTERN.fullmatch(value):
        raise ValueError(
            f"Company.code must be 1-{_CODE_MAX_LENGTH} characters "
            f"of letters, digits, '-' or '_'; got {value!r}"
        )


def _check_name(value: str) -> None:
    if len(value) > _NAME_MAX_LENGTH:
        raise ValueError(
            f"Company.name must be at most {_NAME_MAX_LENGTH} "
            f"characters; got {len(value)}"
        )


def _check_tax_id(value: str) -> None:
    if not _TAX_ID_PATTERN.fullmatch(value):
        raise ValueError(
            f"Company.tax_id must be exactly {_TAX_ID_LENGTH} "
            f"digits; got {value!r}"
        )


class _CodeType(TypeDecorator):
    """Bind-time counterpart of ``_validate_code`` (DOM-R31): the
    column type itself, so ``insert(Company)``/``update(Company)``
    Core statements and any other bind path are checked too, not
    only attribute assignment.
    """

    impl = String
    cache_ok = True

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        _check_code(value)
        return value


class _NameType(TypeDecorator):
    """Bind-time counterpart of ``_validate_name`` (DOM-R31)."""

    impl = String
    cache_ok = True

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        _check_name(value)
        return value


class _TaxIdType(TypeDecorator):
    """Bind-time counterpart of ``_validate_tax_id`` (DOM-R31).
    ``None`` (an absent ``tax_id``) is always allowed through.
    """

    impl = String
    cache_ok = True

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        _check_tax_id(value)
        return value


class Company(AuditMixin, TimestampedBase):
    """A company known to InspectFlow: InspectFlow's own
    organization (``kind = "internal"``) or a customer
    (``kind = "customer"``), optionally grouped under a parent
    company via ``parent_id``.
    """

    __tablename__ = "companies"

    code: Mapped[str] = mapped_column(
        _CodeType(_CODE_MAX_LENGTH), nullable=False, unique=True
    )
    name: Mapped[str] = mapped_column(
        _NameType(_NAME_MAX_LENGTH), nullable=False
    )
    tax_id: Mapped[str | None] = mapped_column(
        _TaxIdType(_TAX_ID_LENGTH), nullable=True, unique=True
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("companies.id"), nullable=True
    )
    # ``server_default`` (issue #127/DOM-Q7) makes an unspecified
    # value default to enabled at the database level too -- not
    # only for inserts that go through this ORM model -- matching
    # the migration's own ``server_default``.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )

    # Names passed here are the naming convention's
    # ``%(constraint_name)s`` placeholder, not the final constraint
    # name -- ``app.db.base.NAMING_CONVENTION`` already prefixes it
    # with ``ck_%(table_name)s_``, so passing an already-prefixed
    # name (e.g. ``"ck_companies_kind"``) would double the prefix.
    __table_args__ = (
        CheckConstraint("kind IN ('internal', 'customer')", name="kind"),
        CheckConstraint("parent_id <> id", name="parent_id_not_self"),
    )

    @validates("code")
    def _validate_code(self, key: str, value: str) -> str:
        _check_code(value)
        return value

    @validates("name")
    def _validate_name(self, key: str, value: str) -> str:
        _check_name(value)
        return value

    @validates("tax_id")
    def _validate_tax_id(self, key: str, value: str | None) -> str | None:
        if value is None:
            return value
        _check_tax_id(value)
        return value
