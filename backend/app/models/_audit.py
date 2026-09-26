"""Shared ``created_by``/``updated_by`` audit columns (DBF-R14,
DBF-Q2).

A plain mixin, like ``app.db.base.TimestampedMixin``: not a
``DeclarativeBase`` subclass itself, only ``Mapped``/
``mapped_column`` attributes that whichever declarative base a
model combines it with picks up. ``User`` and ``Project`` both
point these columns at ``users.id`` -- including ``User`` itself,
whose first row's ``created_by``/``updated_by`` point at its own
id (DBF-Q2's decision; see plan.md's "第一筆 User 自我參照" risk)
-- so the foreign key target is always the literal string
``"users.id"`` regardless of which table this mixin lands on. That
string is resolved by SQLAlchemy at mapper-configuration time, not
at class-definition time, so it makes no difference whether
``User`` or ``Project`` is imported first.

Both columns are required (DBF-R14: "不得為空值"), enforced by the
database through ``nullable=False`` plus the foreign key
constraint -- never validated only in application code.
"""

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid


class AuditMixin:
    """Adds ``created_by``/``updated_by`` foreign keys to
    ``users.id``.

    Combine with ``app.db.base.TimestampedBase`` (which supplies
    ``id``/``created_at``/``updated_at``) to give a model all four
    audit columns DBF-R14 requires.
    """

    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    updated_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
