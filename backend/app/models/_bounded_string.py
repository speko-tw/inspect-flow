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
bind time: a column's ``NOT NULL`` constraint is the backstop for
values written through paths ``@validates`` cannot see (see above).

For paths ``@validates`` *can* see, ``None`` handling is consistent
across every column instead of being decided ad hoc per column:
``validate_nullable`` below is the single source of truth for "is
``None`` legal here", reading the column's own ``nullable`` flag
(``obj.__table__.c[key].nullable``) instead of a second,
hand-maintained list that could drift from the column definition
itself. A ``NOT NULL`` column's ``@validates`` method therefore
rejects ``None`` immediately -- with the same ``ValueError`` every
other invalid value gets -- rather than raising a ``TypeError`` out
of ``len(None)`` inside the column's ``_check_*`` function or
silently deferring to the database's constraint.

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

from app.db.base import Base


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
        # ``TypeDecorator.__init__`` only stores ``length`` on
        # ``self.impl`` (the wrapped ``String``), not on ``self``
        # itself. SQLAlchemy's compiled-statement cache key
        # (``TypeEngine._static_cache_key``) is built from
        # ``__init__`` parameter names that are also present in
        # ``self.__dict__``, so without this assignment two
        # ``BoundedString`` instances with the same ``check`` but
        # different ``length`` would collide on the same cache key
        # and a cached ``CAST`` from one column's length could leak
        # into another's compiled SQL.
        self.length = length

    def process_bind_param(
        self, value: str | None, dialect: object
    ) -> str | None:
        if value is None:
            return None
        self.check(value)
        return value


def validate_nullable(
    obj: Base, key: str, value: str | None, label: str
) -> str | None:
    """Shared "is ``None`` legal on this column" check for a
    model's ``@validates`` method (module docstring above explains
    why this lives here instead of being decided per column).

    Reads ``obj.__table__.c[key].nullable`` -- the column's own
    ``nullable`` flag is the single source of truth, so a column's
    ``None`` behaviour cannot drift from its ``mapped_column``
    definition. Returns ``value`` unchanged when it is not ``None``
    or the column allows ``None``; raises ``ValueError`` when the
    column is ``NOT NULL`` and ``value`` is ``None``.
    """
    if value is not None:
        return value
    if obj.__table__.c[key].nullable:
        return None
    raise ValueError(f"{label} must not be None")
