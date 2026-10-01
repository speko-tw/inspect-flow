"""``Role`` model (DOM-R15, DOM-R19, DOM-R20, DOM-R21, DOM-R23,
DOM-R30, DOM-R34) plus its permission-code subtable
``RolePermission``.

``Role`` shares the common structure DOM-R15 lists for it (UUID
primary key, ``created_at``/``updated_at``/``created_by``/
``updated_by`` via ``TimestampedBase``/``AuditMixin``, same as
``Company``): a unique ``name`` and a set of permission codes.

``name``'s case-insensitive uniqueness (DOM-R34) is enforced the
same way ``User.email``'s is (DOM-R02, ``app/models/user.py``): a
``lower(name)`` functional unique index (``ix_roles_name_lower``
below), with ``name`` itself stored exactly as typed. See that
module's docstring for why a functional index was chosen over a
second, normalized column.

Permission codes live in ``RolePermission``, not on ``Role`` itself
(DOM-R19's "同一個 Role 內的權限代碼不得重複，由資料庫約束保證" needs
a child row per code so the database can enforce that with a plain
``UniqueConstraint``, which a JSON or delimited-string column could
not -- see plan.md's "考慮過但沒採用的做法"). ``RolePermission`` is
deliberately *not* combined with ``AuditMixin``, unlike ``Role``
itself: DOM-R15 only lists ``User``/``Project``/``Company``/``Role``/
``ProjectMember`` as sharing the common structure, not either
entity's child table, and DOM-R20 already places the "who/when
changed this role's permissions" record on ``Role.updated_at``/
``updated_by`` -- a per-code ``created_by`` would have no
requirement to satisfy and no defined value to write. It still gets
``TimestampedBase`` (a UUID primary key plus ``created_at``/
``updated_at``, matching DOM-AC18's inspector check that both the
membership table and its role-assignment child table carry a UUID
primary key and created/updated timestamp columns), for the same
reason every table in this codebase gets a UUID surrogate key
instead of a composite one (see ``test_user_project.py``'s
``test_business_number_column_is_not_the_primary_key_column``).

Deleting a ``Role`` must remove its ``RolePermission`` rows (they
are meaningless without their parent) and, per DOM-R21, every
``ProjectMemberRole`` assignment pointing at it (``app/models/
project_member.py``) -- both via the database's own
``ON DELETE CASCADE``, not the ORM: the ``permission_codes``
relationship below sets ``passive_deletes=True`` so a
``session.delete(role)``
never tries to first ``UPDATE ... SET role_id = NULL`` on children
(which would fail outright, since ``role_id`` is ``NOT NULL``)
before the database cascade ever runs. No relationship connects
``Role`` to ``ProjectMemberRole`` at all -- that cascade only needs
the foreign key's own ``ON DELETE CASCADE``, verified in
``tests/db/test_role_member.py``.
"""

import re
import uuid

from sqlalchemy import ForeignKey, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString, validate_nullable
from app.permission_codes import is_permission_code_registered

_NAME_MAX_LENGTH = 64
_CODE_MAX_LENGTH = 64

# DOM-R30: "<資料>.<動作>", identical to API-AC09's error-code
# pattern -- lowercase letters/digits/underscore on each side of
# exactly one dot, each side starting with a letter.
_CODE_PATTERN = re.compile(r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*")


def _check_name(value: str) -> None:
    if len(value) > _NAME_MAX_LENGTH:
        raise ValueError(
            f"Role.name must be at most {_NAME_MAX_LENGTH} "
            f"characters; got {len(value)}"
        )


def _check_code(value: str) -> None:
    if len(value) > _CODE_MAX_LENGTH or not _CODE_PATTERN.fullmatch(value):
        raise ValueError(
            "RolePermission.code must be at most "
            f"{_CODE_MAX_LENGTH} characters, formatted as "
            f"'<data>.<action>' (DOM-R30); got {value!r}"
        )
    # DOM-R35: a format-valid code is still rejected if no feature
    # spec has registered it (see app/permission_codes.py).
    if not is_permission_code_registered(value):
        raise ValueError(
            f"RolePermission.code {value!r} is not a registered "
            "permission code (DOM-R35)"
        )


class Role(AuditMixin, TimestampedBase):
    """A system-wide, project-agnostic named set of permission
    codes (DOM-R19). All roles may be renamed, have their permission
    codes changed, and be deleted (DOM-R20); nothing here marks any
    row as protected. Admins add roles after initialization.
    """

    __tablename__ = "roles"

    name: Mapped[str] = mapped_column(
        BoundedString(_NAME_MAX_LENGTH, _check_name), nullable=False
    )

    permission_codes: Mapped[list["RolePermission"]] = relationship(
        back_populates="role",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        # DOM-R34: case-insensitive uniqueness on ``name``, without
        # normalizing the stored value -- see this module's
        # docstring and ``app/models/user.py``'s
        # ``ix_users_email_lower`` for the identical pattern.
        Index("ix_roles_name_lower", func.lower(name), unique=True),
    )

    @validates("name")
    def _validate_name(self, key: str, value: str | None) -> str | None:
        value = validate_nullable(self, key, value, "Role.name")
        if value is None:
            return value
        _check_name(value)
        return value


class RolePermission(TimestampedBase):
    """One permission code granted to a ``Role`` (DOM-R19's "一組
    權限代碼"). See this module's docstring for why this table gets
    ``TimestampedBase`` but not ``AuditMixin``, unlike ``Role``
    itself.
    """

    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(
        BoundedString(_CODE_MAX_LENGTH, _check_code), nullable=False
    )

    role: Mapped["Role"] = relationship(back_populates="permission_codes")

    __table_args__ = (
        # DOM-R19: no duplicate code within the same role.
        UniqueConstraint("role_id", "code"),
    )

    @validates("code")
    def _validate_code(self, key: str, value: str | None) -> str | None:
        value = validate_nullable(self, key, value, "RolePermission.code")
        if value is None:
            return value
        _check_code(value)
        return value
