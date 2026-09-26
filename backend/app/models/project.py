"""``Project`` model: common structure only (DBF-R11, DBF-R12,
DBF-R13, DBF-R14).

Business columns are out of scope here and wait on OQ-01; see the
spec's "不包含" section and plan.md's task T4.
"""

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin


class Project(AuditMixin, TimestampedBase):
    """A project tracked in InspectFlow.

    Only the structure shared with ``User`` lives here: the UUID
    primary key (from ``TimestampedBase``), the ``project_code``
    business number, and the ``created_by``/``updated_by`` audit
    columns (from ``AuditMixin``, pointing at ``users.id``).
    """

    __tablename__ = "projects"

    # Length 32 per DOM-Q1's ruling (#121): provisional, carried
    # over from ``employee_no`` pending Project's own business
    # columns (OQ-01) -- see #121 and the PR description. Narrowed
    # from an unbounded String by the ``22bfdd8a72a4`` migration
    # (#140).
    project_code: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True
    )
