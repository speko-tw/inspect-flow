"""Permission code registry (DOM-Q3, issue #131's ticket
decision) and the DOM-R24/KD-28 "has modify capability" judgment.

DOM-R30 fixes the *format* every ``RolePermission.code`` must match
(``^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$``, checked in
``app/models/role.py``). DOM-Q3 separately asks which of the
format-valid codes actually exist: a ``Role`` must not be able to
store a code no feature spec has ever registered. This module is
the single place that answers that question -- ``app/models/role.py``
calls :func:`is_permission_code_registered` from the same
``_check_code`` function that already checks length and format
(DOM-R31's "one check per column, run before every write" rule), so
no write path can store an unregistered code any more than it can
store an over-length one.

Why a plain module-level dict plus functions instead of
``app/api/errors.py``'s ``DescribedStrEnum`` (KD-15's pattern,
which this ticket's dispatch explicitly held up as the model to
follow): an ``Enum``'s member set is fixed at class-definition time
-- Python has no supported way to add a member to an existing
``Enum`` subclass afterwards. DOM-Q3's real list is empty today (no
feature spec has registered a code yet), and a test still needs to
register a *temporary* code to exercise the "unregistered code is
rejected" / "registered code is accepted" behavior without ever
adding a fake entry to the real, still-empty list a production
``Enum`` would have to carry permanently. A mutable registry with
``register_permission_code``/``unregister_permission_code`` (and
the ``temporarily_registered_permission_codes`` context manager
below for tests) supports that; a ``DescribedStrEnum`` subclass does
not. Each entry still keeps ``DescribedStrEnum``'s "code paired with
a human-readable description" shape (via :class:`PermissionCode`),
so a future feature spec registering its own codes reads the same
way ``ErrorCode`` does.

Out of scope here: DOM-R30's format/length check (lives on
``RolePermission`` itself, in ``app/models/role.py``); the effective-
permission union calculation (DOM-R26, plan.md T5); anything about
*which* codes a future feature spec should register -- this module
only provides the registry mechanism, not its eventual contents.
"""

from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PermissionCode:
    """A registered permission code paired with its description --
    the same "code + description" shape
    ``app.api.errors.DescribedStrEnum`` gives ``ErrorCode``, without
    being an ``Enum`` (see module docstring for why this module
    cannot use one).
    """

    code: str
    description: str


# DOM-Q3: the real, production list starts empty -- no functional
# area has registered a permission code yet. A future feature spec
# (e.g. the one introducing ``report.read``) calls
# ``register_permission_code`` at import time, the same way
# ``app/api/errors.py``'s ``ErrorCode`` grows a new member per
# feature. Tests must never add an entry here directly; use
# :func:`temporarily_registered_permission_codes` instead.
_REGISTRY: dict[str, PermissionCode] = {}


def register_permission_code(code: str, description: str) -> None:
    """Add ``code`` to the registry (or replace its description if
    already present). Does not check DOM-R30's format/length rule
    itself -- that is ``RolePermission``'s own job at write time;
    this only tracks which codes are known.
    """
    _REGISTRY[code] = PermissionCode(code=code, description=description)


def unregister_permission_code(code: str) -> None:
    """Remove ``code`` from the registry. A no-op if it was never
    registered -- test cleanup calls this unconditionally, without
    first checking membership.
    """
    _REGISTRY.pop(code, None)


def is_permission_code_registered(code: str) -> bool:
    """Whether ``code`` is currently registered (DOM-Q3): the check
    ``app/models/role.py``'s ``RolePermission`` runs before storing
    any code.
    """
    return code in _REGISTRY


def permission_code_descriptions() -> dict[str, str]:
    """A snapshot ``{code: description}`` mapping of every
    currently registered code, for a future admin screen or API to
    list the available codes -- mirrors
    ``app.api.errors.build_error_code_descriptions``.
    """
    return {code: entry.description for code, entry in _REGISTRY.items()}


@contextmanager
def temporarily_registered_permission_codes(
    *codes: tuple[str, str],
) -> Iterator[None]:
    """Register each ``(code, description)`` pair in ``codes`` for
    the duration of the ``with`` block, then remove them again --
    letting a test exercise DOM-Q3's registered/unregistered
    behavior (and DOM-R30's format checks, which need a registered,
    format-valid code to prove they still reject an over-length or
    malformed one) without ever adding a fake code to the real,
    still-empty production list ``_REGISTRY`` starts with.

    Restores each code to whatever it was before (unregistered, if
    it was not already present) even if the ``with`` block raises.
    """
    added = list(codes)
    try:
        for code, description in added:
            register_permission_code(code, description)
        yield
    finally:
        for code, _description in added:
            unregister_permission_code(code)


def has_modify_capability(codes: Iterable[str]) -> bool:
    """DOM-R24/KD-28's "has modify capability" judgment: ``True`` if
    any code's action segment (the part after the dot in its
    DOM-R30 ``<data>.<action>`` format) is not ``read``; ``False``
    for an empty collection or one where every code's action is
    ``read``.

    Takes a plain collection of code strings rather than a ``Role``
    object so this module never imports ``app.models.role`` --
    avoiding a circular import, since ``role.py`` imports this
    module for :func:`is_permission_code_registered`.
    ``Role.has_modify_capability`` (``app/models/role.py``) is the
    convenience wrapper that passes ``role.permissions`` here.

    Assumes every code already passed DOM-R30's format check (so
    ``code.split(".", 1)`` always yields exactly two parts) --
    ``RolePermission`` guarantees that for anything actually stored,
    and this function is not a second format validator.
    """
    return any(code.split(".", 1)[1] != "read" for code in codes)
