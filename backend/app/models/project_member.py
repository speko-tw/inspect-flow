"""``ProjectMember`` model (DOM-R15, DOM-R25) plus its role-
assignment subtable ``ProjectMemberRole``.

``ProjectMember`` shares the common structure DOM-R15 lists for it
(UUID primary key, ``created_at``/``updated_at``/``created_by``/
``updated_by`` via ``TimestampedBase``/``AuditMixin``, same as
``Company``/``Role``): a ``Project``/``User`` pair, unique per
DOM-R25, optionally holding any number of ``Role`` assignments.

A member may have zero roles (issue #131's ticket, DOM-Q5): there is
no ``NOT NULL`` or minimum-count constraint tying a ``ProjectMember``
to any ``ProjectMemberRole`` row -- an empty ``role_assignments``
collection is exactly as valid as a populated one, and DOM-R26's
effective-permission union over zero rows is simply the empty set.

``ProjectMemberRole`` (the role-assignment table) is deliberately
*not* combined with ``AuditMixin``, for the same reason
``app/models/role.py``'s ``RolePermission`` is not: DOM-R15 only
lists ``ProjectMember`` itself (not its child table) as sharing the
common structure, and neither DOM-R25 nor DOM-Q5 defines a "who/when"
value for a single assignment row. It still gets ``TimestampedBase``
(a UUID primary key plus ``created_at``/``updated_at``), matching
DOM-AC18's inspector check that both tables carry a UUID primary key
and created/updated timestamp columns, and the same "every table
gets a UUID surrogate key" convention ``RolePermission`` follows.

Removing either side of an assignment must remove the assignment
itself, both per issue #131's ticket (DOM-Q5: deleting a
``ProjectMember`` removes its role assignments) and per DOM-R21
(deleting a ``Role`` removes every ``ProjectMember``'s assignment to
it, without disturbing the member row itself or its other role
assignments). Both are enforced by the database's own
``ON DELETE CASCADE`` on ``ProjectMemberRole``'s two foreign keys,
not by the ORM: the ``role_assignments`` relationship below sets
``passive_deletes=True`` so a ``session.delete(member)`` never tries
to first ``UPDATE ... SET project_member_id = NULL`` on its
assignments (which would fail outright, since that column is
``NOT NULL``) before the database cascade ever runs. No relationship
connects ``Role`` to ``ProjectMemberRole`` at all (see
``app/models/role.py``'s docstring) -- DOM-R21's cascade only needs
the ``role_id`` foreign key's own ``ON DELETE CASCADE``, verified in
``tests/db/test_role_member.py``.
"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin

if TYPE_CHECKING:
    # Only for the ``Mapped["Role"]`` forward reference below --
    # importing ``app.models.role`` for real would be circular
    # (``role.py`` does not import this module, but both are
    # imported by ``app/models/__init__.py``, and this avoids
    # depending on import order between the two).
    from app.models.role import Role


class ProjectMember(AuditMixin, TimestampedBase):
    """One ``User``'s participation in one ``Project`` (DOM-R25).
    ``project_id``/``user_id`` are both required and unique as a
    pair; a member's ``Role`` assignments live in
    ``ProjectMemberRole`` (``role_assignments`` below), and may be
    empty (DOM-Q5).
    """

    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("projects.id"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )

    role_assignments: Mapped[list["ProjectMemberRole"]] = relationship(
        back_populates="member",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        # DOM-R25: one membership row per (project, user) pair.
        UniqueConstraint("project_id", "user_id"),
    )


class ProjectMemberRole(TimestampedBase):
    """One ``Role`` assigned to one ``ProjectMember`` (DOM-R25's
    "得指派多個 Role，同一個 Role 在同一筆成員上不得重複指派"). See
    this module's docstring for why this table gets
    ``TimestampedBase`` but not ``AuditMixin``, unlike
    ``ProjectMember`` itself.
    """

    __tablename__ = "project_member_roles"

    project_member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("project_members.id", ondelete="CASCADE"),
        nullable=False,
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
    )

    member: Mapped["ProjectMember"] = relationship(
        back_populates="role_assignments"
    )
    # No back-reference on ``Role`` (see ``app/models/role.py``'s
    # docstring): nothing here needs to walk from a ``Role`` to its
    # assignments through the ORM, only through DOM-R23's influence-
    # range query (plan.md T5), which reads this table directly.
    role: Mapped["Role"] = relationship()

    __table_args__ = (
        # DOM-R25: no duplicate role assignment on the same member.
        UniqueConstraint("project_member_id", "role_id"),
    )
