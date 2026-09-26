"""Shared bind-time length/format check for string columns
(DOM-R31): a single ``TypeDecorator`` parametrized by length and a
``check`` callable, used by ``app/models/company.py``,
``app/models/project.py`` and ``app/models/user.py`` instead of one
near-identical ``TypeDecorator`` subclass per column.

Why two independent layers -- this module's ``BoundedString`` plus
each model's own ``@validates`` method -- instead of one:
PostgreSQL enforces a column's length limit through its
``VARCHAR(n)`` type, but SQLite does not enforce ``String`` length
at all, and neither backend enforces the character-class or format
restrictions some columns need (e.g. ``Company.code``'s
letters/digits/``-``/``_`` restriction, ``User.email``'s
``@``-and-no-whitespace rule). So each model keeps its own rule in
exactly one place -- a ``_check_*`` function -- and enforces it
through two independent layers so no write path can skip it:

- ``@validates`` runs on attribute assignment and on construction
  (SQLAlchemy calls it for constructor keyword arguments too),
  giving immediate feedback when code builds or mutates a mapped
  object directly.
- ``BoundedString`` (this class, same pattern as ``UTCDateTime`` in
  ``app/db/base.py``) runs in ``process_bind_param``, which
  SQLAlchemy calls whenever a value is bound to the column --
  covering not only the unit-of-work flush that ``@validates``
  already catches, but also the paths ``@validates`` cannot see
  because they never touch a mapped attribute:
  ``session.execute(insert(Model).values(...))`` and
  ``session.execute(update(Model).values(...))`` (both a
  single-row and a bulk/Core statement).

``BoundedString`` itself always passes ``None`` through unchecked at
bind time -- whether ``None`` is a legitimate value for a given
column (and thus needs the same pass-through in that column's
``@validates`` method) is each model's own decision, not this
module's; a column that must never be ``None`` still has the
database's ``NOT NULL`` constraint as a backstop.

This project has no existing domain/validation exception hierarchy,
so ``check`` is expected to raise the standard library's
``ValueError``, which SQLAlchemy wraps in a
``sqlalchemy.exc.StatementError`` when raised from
``process_bind_param``, consistent with how a constructor already
rejects bad input elsewhere in this codebase
(``UTCDateTime.process_bind_param`` in ``app/db/base.py``).

Out of scope: raw SQL issued through ``text()`` bypasses the ORM
column type entirely and is not covered by DOM-R31 here.
"""

from collections.abc import Callable

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator


class BoundedString(TypeDecorator):
    """A ``String(length)`` column whose bind-time value is passed
    to ``check`` before being sent to the database (module
    docstring above explains the two-layer pattern this belongs
    to). ``check`` is expected to raise ``ValueError`` on an invalid
    value and return ``None`` otherwise; it is never called with
    ``None`` itself.
    """

    impl = String
    cache_ok = True

    def __init__(self, length: int, check: Callable[[str], None]) -> None:
        super().__init__(length)
        self.check = check

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        self.check(value)
        return value
