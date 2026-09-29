"""``Company`` model (DOM-R15, DOM-R32, DOM-R48, DOM-R49, DOM-Q7).

Company shares the same common structure as ``User``/``Project``
(UUID primary key, created/updated timestamps and audit columns,
see ``AuditMixin``), plus exactly two business columns (DOM-R48):
``name`` and an ``is_active`` flag that defaults to enabled (DOM-Q7,
issue #127). A company has no code, tax ID, kind or parent: branches
and subsidiaries with their own registration are independent
companies with no hierarchy between them.

``name`` (DOM-R49) is at most 128 characters with no format rule.
It is stored with surrounding whitespace removed (the ``@validates``
method below trims every assignment) and may not be empty after
trimming. Its uniqueness is case-insensitive and covers deactivated
companies too, while the column keeps the original casing: a
``lower(name)`` functional unique index (``ix_companies_name_lower``
below) enforces this at the database level, the same way
``ix_users_email_lower`` (``app/models/user.py``) and
``ix_roles_name_lower`` (``app/models/role.py``) do, without a
second, easy-to-desync normalized column.

The length rule (DOM-R31) lives in exactly one place --
``_check_name`` below -- and is enforced through two independent
layers (``@validates`` plus the ``BoundedString`` column type from
``app/models/_bounded_string.py``, see that module's docstring for
why) so no write path can skip it. ``_check_name`` also rejects a
value that is not already trimmed or is empty, which only a Core
statement (``@validates`` never sees those) can hand it. ``None`` is
passed through unchecked at bind time (``BoundedString`` never
checks it), but ``@validates`` calls ``validate_nullable`` first:
``name`` is ``NOT NULL``, so ``None`` is rejected with the same
``ValueError`` an invalid value gets.

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered by DOM-R31 here.
"""

from sqlalchemy import Boolean, Index, func, true
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString, validate_nullable

_NAME_MAX_LENGTH = 128


def _check_name(value: str) -> None:
    if value != value.strip() or not value:
        raise ValueError(
            "Company.name must not be empty and must not have leading "
            f"or trailing whitespace; got {value!r}"
        )
    if len(value) > _NAME_MAX_LENGTH:
        raise ValueError(
            f"Company.name must be at most {_NAME_MAX_LENGTH} "
            f"characters; got {len(value)}"
        )


class Company(AuditMixin, TimestampedBase):
    """A company known to InspectFlow. Only its name and whether it
    is active are recorded (DOM-R48).
    """

    __tablename__ = "companies"

    name: Mapped[str] = mapped_column(
        BoundedString(_NAME_MAX_LENGTH, _check_name), nullable=False
    )
    # ``server_default`` (issue #127/DOM-Q7) makes an unspecified
    # value default to enabled at the database level too -- not
    # only for inserts that go through this ORM model -- matching
    # the migration's own ``server_default``.
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )

    __table_args__ = (
        # DOM-R49: case-insensitive uniqueness on ``name``, without
        # normalizing the stored value -- see this module's
        # docstring.
        Index("ix_companies_name_lower", func.lower(name), unique=True),
    )

    @validates("name")
    def _validate_name(self, key: str, value: str | None) -> str | None:
        value = validate_nullable(self, key, value, "Company.name")
        if value is None:
            return value
        value = value.strip()
        _check_name(value)
        return value
