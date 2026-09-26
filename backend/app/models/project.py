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

    # No length is specified: the maximum length of a project code
    # is undecided (domain-model's DOM-Q1, same open question as
    # User.employee_no). An unbounded String avoids guessing a
    # limit that a later migration would then have to narrow or
    # widen.
    project_code: Mapped[str] = mapped_column(
        String, nullable=False, unique=True
    )
