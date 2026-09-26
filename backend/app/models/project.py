"""``Project`` model: common structure only (DBF-R11, DBF-R12,
DBF-R13, DBF-R14).

Business columns are out of scope here and wait on OQ-01; see the
spec's "不包含" section and plan.md's task T4.

``project_code``'s length limit (currently 32, DBF-R12's common
structure, narrowed from an unbounded ``String`` by the
``22bfdd8a72a4`` migration, #140) is provisional pending OQ-01's
ruling on ``Project``'s own business columns -- see #121 and that
PR's description. The limit is checked in Python and enforced
through two independent layers -- ``@validates``
(``_validate_project_code``) plus the ``BoundedString`` column type
from ``app/models/_bounded_string.py`` (see that module's docstring
for why) -- the same pattern ``app/models/user.py``/
``app/models/company.py`` use for their own DOM-R28/DOM-R29 columns
(DOM-R31's two-layer pattern, applied here for structural
consistency though ``Project`` itself is not yet in scope for
DOM-R31).

Both layers read the limit from ``_PROJECT_CODE_MAX_LENGTH`` below --
when OQ-01 settles on a final value, change only that constant.

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered here.
"""

from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString

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
        BoundedString(_PROJECT_CODE_MAX_LENGTH, _check_project_code),
        nullable=False,
        unique=True,
    )

    @validates("project_code")
    def _validate_project_code(self, key: str, value: str) -> str:
        _check_project_code(value)
        return value
