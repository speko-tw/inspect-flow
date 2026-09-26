"""``Project`` model: common structure only (DBF-R11, DBF-R12,
DBF-R13, DBF-R14).

Business columns are out of scope here and wait on OQ-01; see the
spec's "不包含" section and plan.md's task T4.

``project_code``'s length limit (currently 32, DBF-R12's common
structure, narrowed from an unbounded ``String`` by the
``22bfdd8a72a4`` migration, #140) is provisional pending OQ-01's
ruling on ``Project``'s own business columns -- see #121 and that
PR's description. PostgreSQL enforces the limit through the column
type below, but SQLite does not enforce ``String`` length at all, so
the limit is checked in Python and enforced through two independent
layers, the same way ``app/models/user.py``/``app/models/company.py``
do for their own DOM-R28/DOM-R29 columns (DOM-R31's two-layer
pattern, applied here for structural consistency though ``Project``
itself is not yet in scope for DOM-R31):

- ``@validates`` (``_validate_project_code``) runs on attribute
  assignment and on construction.
- ``_ProjectCodeType`` (a ``TypeDecorator``, same pattern as
  ``UTCDateTime`` in ``app/db/base.py``) runs in
  ``process_bind_param``, covering the paths ``@validates`` cannot
  see: ``session.execute(insert(Project).values(...))`` and
  ``session.execute(update(Project).values(...))``.

Both layers read the limit from ``_PROJECT_CODE_MAX_LENGTH`` below --
when OQ-01 settles on a final value, change only that constant.

This project has no existing domain/validation exception hierarchy,
so both layers raise the standard library's ``ValueError`` (which
SQLAlchemy wraps in a ``sqlalchemy.exc.StatementError`` when raised
from ``process_bind_param``), consistent with ``user.py`` and
``company.py``.

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered here.
"""

from sqlalchemy.orm import Mapped, mapped_column, validates
from sqlalchemy.types import String, TypeDecorator

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin

# Provisional per DOM-Q1's ruling (#121), carried over from
# ``employee_no`` pending Project's own business columns (OQ-01).
# Change this single constant when OQ-01 settles on a final value.
_PROJECT_CODE_MAX_LENGTH = 32


def _check_project_code(value: str) -> None:
    if len(value) > _PROJECT_CODE_MAX_LENGTH:
        raise ValueError(
            "Project.project_code must be at most "
            f"{_PROJECT_CODE_MAX_LENGTH} characters; got {len(value)}"
        )


class _ProjectCodeType(TypeDecorator):
    """Bind-time counterpart of ``_validate_project_code``: the
    column type itself, so ``insert(Project)``/``update(Project)``
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
        _check_project_code(value)
        return value


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
    # (#140). Length is checked in Python at two layers (module
    # docstring above); SQLite does not enforce ``String`` length on
    # its own (#168).
    project_code: Mapped[str] = mapped_column(
        _ProjectCodeType(_PROJECT_CODE_MAX_LENGTH),
        nullable=False,
        unique=True,
    )

    @validates("project_code")
    def _validate_project_code(self, key: str, value: str) -> str:
        _check_project_code(value)
        return value
