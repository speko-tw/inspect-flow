"""Service layer: the only supported way to write ``User`` and
``Company`` rows (DOM-R04, DOM-R06, DOM-R07; see plan.md's "Service
層規則被繞過" risk -- direct ORM writes skip these protections
entirely). Every mutating entry point in this package fills
``created_by``/``updated_by`` from
:func:`app.services.operator.get_current_operator`; callers must
never pass those columns themselves.

:data:`UNSET` is the sentinel the update entry points
(``companies.py``, ``users.py``) use to tell "this keyword argument
was not passed" apart from "explicitly passed as ``None``", since
several optional columns (``Company.tax_id``, ``User.mobile``, ...)
legitimately accept ``None``.
"""

from enum import Enum, auto
from typing import Final


class _Unset(Enum):
    """Sentinel type for :data:`UNSET`, spelled as a one-member
    ``Enum`` rather than a plain singleton instance: pyright narrows
    a ``str | _Unset`` parameter down to ``str`` after an
    ``is not UNSET`` check for an ``Enum`` member, but not for an
    ordinary object identity check.
    """

    UNSET = auto()

    def __repr__(self) -> str:
        return "UNSET"


UNSET: Final = _Unset.UNSET

__all__ = ["UNSET", "_Unset"]
