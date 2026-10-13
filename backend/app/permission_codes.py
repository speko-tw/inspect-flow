"""Permission code registry (DOM-R35).

``Role``/``RolePermission`` (``app/models/role.py``) must not be
able to store a permission code no feature spec has ever registered
-- but the registry itself is not a database table (DOM-R35): it is
kept in code, the same pattern ``app/api/errors.py``'s ``ErrorCode``
uses for KD-15's error codes (code paired with a human-readable
description, via the shared ``DescribedStrEnum`` base).

The registry contains only codes registered by frozen feature
specifications. `domain-model` registers
``project_member.manage`` for managing project members and their
roles; `template-system` registers
``project_inspection_item.edit`` for editing a project's inspection
items.

``is_permission_code_registered`` is the single query function
``app/models/role.py``'s ``RolePermission._check_code`` calls before
storing any code (DOM-R31's "one check per column, run before every
write" rule) -- so no write path can store an unregistered code any
more than it can store an over-length one.

Testing DOM-R35's registered/unregistered behavior also uses
test-only codes. An ``Enum``'s member set is fixed at class-definition
time -- Python has no supported way to add a member to an existing
``Enum`` subclass afterwards. Both query functions below therefore
read ``_active_registry``, a module-level reference that always points
at ``PermissionCode`` in production;
``tests/conftest.py``'s ``registered_permission_codes`` fixture is
the only thing that ever reassigns it, swapping in a throwaway
``DescribedStrEnum`` subclass for the duration of one test -- the
same "test-only enum standing in for the real one" pattern
``tests/contract/test_error_envelope.py``'s ``SupersetCode``/
``SwappedCode`` use for ``ErrorCode`` (API-AC10b). That fixture lives
at the top of ``backend/tests/`` rather than under ``tests/db/``
alone so the future T5 (``services/test_permissions.py``) and T7
(``services/test_roles.py``) tasks (plan.md) can reuse it without
duplicating the test enum.

The catalog is shared with the frontend, so permission metadata has
one source of truth. DOM-R30's format/length check remains on
``RolePermission`` in ``app/models/role.py``.
"""

import json
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, cast

from app.api.errors import DescribedStrEnum


class _PermissionCodeRegistry(Protocol):
    def __iter__(self) -> Iterator[DescribedStrEnum]: ...

    def __getattr__(self, name: str) -> DescribedStrEnum: ...


@dataclass(frozen=True)
class PermissionDefinition:
    """Metadata required to validate and route one permission code."""

    scope: str
    module: str
    external_allowed: bool = False


_permission_catalog = json.loads(
    Path(__file__)
    .with_name("permission_codes.json")
    .read_text(encoding="utf-8")
)["codes"]

# 共用 DOM-R35 權限目錄，避免前後端各自維護一份權限定義。
if TYPE_CHECKING:
    PermissionCode = cast(_PermissionCodeRegistry, None)
else:
    PermissionCode = DescribedStrEnum(
        "PermissionCode",
        {
            item["name"]: (item["code"], item["description"])
            for item in _permission_catalog
        },
        module=__name__,
    )


# Always ``PermissionCode`` in production. Only
# ``tests/conftest.py``'s ``registered_permission_codes`` fixture
# reassigns this, and only for the duration of one test.
_active_registry: _PermissionCodeRegistry = PermissionCode

MODULES = frozenset({"project", "inspection", "template"})

# Every production permission has explicit scope, owning module, and
# external-collaborator eligibility. Test-only registry entries use the
# conservative fallback below.
PERMISSION_DEFINITIONS = {
    item["code"]: PermissionDefinition(
        scope=item["scope"],
        module=item["module"],
        external_allowed=item["external_allowed"],
    )
    for item in _permission_catalog
}


def permission_code_scope(code: str) -> str | None:
    """Return the registered code scope: ``module`` or ``project``."""
    if not is_permission_code_registered(code):
        return None
    definition = PERMISSION_DEFINITIONS.get(code)
    return definition.scope if definition else "project"


def permission_code_module(code: str) -> str | None:
    """Return the module owning a registered code."""
    if permission_code_scope(code) is None:
        return None
    definition = PERMISSION_DEFINITIONS.get(code)
    if definition:
        return definition.module
    return code.split(".", 1)[0]


def permission_code_external_allowed(code: str) -> bool:
    definition = PERMISSION_DEFINITIONS.get(code)
    return bool(
        definition
        and is_permission_code_registered(code)
        and definition.external_allowed
    )


def is_permission_code_registered(code: str) -> bool:
    """DOM-R35: whether ``code`` is currently registered in
    whichever registry is active (``PermissionCode`` in production).
    """
    return code in {member.value for member in _active_registry}


def permission_code_descriptions() -> dict[str, str]:
    """A ``{code: description}`` snapshot of every code in the
    currently active registry, for a future admin screen or API to
    list the available codes -- mirrors
    ``app.api.errors.build_error_code_descriptions``.
    """
    return {member.value: member.description for member in _active_registry}
