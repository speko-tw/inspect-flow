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

Out of scope here: DOM-R30's format/length check (lives on
``RolePermission`` itself, in ``app/models/role.py``); the effective-
permission union calculation and the DOM-R24 "has modify capability"
judgment (plan.md T5, ``app/services/permissions.py``, issue #133);
anything about *which* codes a future feature spec should register
-- this module only provides the registry mechanism, not its
eventual contents.
"""

from app.api.errors import DescribedStrEnum


class PermissionCode(DescribedStrEnum):
    """DOM-R35 registry of permission codes a ``Role`` may store."""

    PROJECT_MEMBER_MANAGE = (
        "project_member.manage",
        "管理專案成員與其角色",
    )
    PROJECT_INSPECTION_ITEM_EDIT = (
        "project_inspection_item.edit",
        "編輯專案查核項目",
    )


# Always ``PermissionCode`` in production. Only
# ``tests/conftest.py``'s ``registered_permission_codes`` fixture
# reassigns this, and only for the duration of one test.
_active_registry: type[DescribedStrEnum] = PermissionCode


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
