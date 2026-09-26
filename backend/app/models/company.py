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
enforces the character-class format restrictions -- so
``_validate_code``/``_validate_tax_id``/``_validate_name`` below
re-check both length and format in Python before a value ever
reaches the database, on every insert and every attribute
assignment (SQLAlchemy's ``@validates`` runs on both). This project
has no existing domain/validation exception hierarchy, so these
raise the standard library's ``ValueError``, consistent with how a
constructor already rejects bad input elsewhere in this codebase
(``UTCDateTime.process_bind_param`` in ``app/db/base.py``).
"""

import re
import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, true
from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import Uuid

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


class Company(AuditMixin, TimestampedBase):
    """A company known to InspectFlow: InspectFlow's own
    organization (``kind = "internal"``) or a customer
    (``kind = "customer"``), optionally grouped under a parent
    company via ``parent_id``.
    """

    __tablename__ = "companies"

    code: Mapped[str] = mapped_column(
        String(_CODE_MAX_LENGTH), nullable=False, unique=True
    )
    name: Mapped[str] = mapped_column(String(_NAME_MAX_LENGTH), nullable=False)
    tax_id: Mapped[str | None] = mapped_column(
        String(_TAX_ID_LENGTH), nullable=True, unique=True
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
        if len(value) > _CODE_MAX_LENGTH or not _CODE_PATTERN.fullmatch(value):
            raise ValueError(
                f"Company.code must be 1-{_CODE_MAX_LENGTH} characters "
                "of letters, digits, '-' or '_'; got "
                f"{value!r}"
            )
        return value

    @validates("name")
    def _validate_name(self, key: str, value: str) -> str:
        if len(value) > _NAME_MAX_LENGTH:
            raise ValueError(
                f"Company.name must be at most {_NAME_MAX_LENGTH} "
                f"characters; got {len(value)}"
            )
        return value

    @validates("tax_id")
    def _validate_tax_id(self, key: str, value: str | None) -> str | None:
        if value is None:
            return value
        if not _TAX_ID_PATTERN.fullmatch(value):
            raise ValueError(
                f"Company.tax_id must be exactly {_TAX_ID_LENGTH} "
                f"digits; got {value!r}"
            )
        return value
