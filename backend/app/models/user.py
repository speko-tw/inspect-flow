"""``User`` model: common structure only (DBF-R11, DBF-R12,
DBF-R13, DBF-R14).

Business columns (name, organization fields, ``is_admin``,
``is_system``, ...) are out of scope here and land in a later
``domain-model`` migration; see the spec's "不包含" section and
plan.md's task T4.
"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin


class User(AuditMixin, TimestampedBase):
    """A person who can act in InspectFlow.

    Only the structure shared with ``Project`` lives here: the UUID
    primary key (from ``TimestampedBase``), the ``employee_no``
    business number, and the ``created_by``/``updated_by`` audit
    columns (from ``AuditMixin``, both pointing at ``users.id`` --
    including this table's own primary key, so a ``User`` row can
    reference itself).
    """

    # PostgreSQL reserves the bare word "user"; naming the table
    # "users" avoids it.
    __tablename__ = "users"

    # Length 16 per DOM-Q1's ruling (#121); narrowed from an
    # unbounded String by the ``22bfdd8a72a4`` migration (#140).
    employee_no: Mapped[str] = mapped_column(
        String(16), nullable=False, unique=True
    )
