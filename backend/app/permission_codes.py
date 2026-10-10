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

from dataclasses import dataclass

from app.api.errors import DescribedStrEnum


@dataclass(frozen=True)
class PermissionDefinition:
    """Metadata required to validate and route one permission code."""

    scope: str
    module: str
    external_allowed: bool = False


class PermissionCode(DescribedStrEnum):
    """DOM-R35 registry of permission codes a ``Role`` may store."""

    PROJECT_MEMBER_MANAGE = (
        "project_member.manage",
        "管理專案成員與其角色",
    )
    PROJECT_UPDATE = ("project.update", "調整專案")
    PROJECT_READ = ("project.read", "檢視專案")
    PROJECT_USE = ("project.use", "使用專案模組")
    PROJECT_CREATE = ("project.create", "開設專案")
    ALL_PROJECT_PROGRESS_READ = (
        "all_project_progress.read",
        "檢視所有專案進度",
    )
    INSPECTION_USE = ("inspection.use", "使用查核模組")
    TEMPLATE_USE = ("template.use", "使用範本模組")
    TEMPLATE_MANAGE = ("template.manage", "管理範本庫")
    PROJECT_INSPECTION_ITEM_EDIT = (
        "project_inspection_item.edit",
        "編輯專案查核項目",
    )
    PROJECT_INSPECTION_ITEM_READ = (
        "project_inspection_item.read",
        "讀取專案查核項目",
    )
    PROJECT_ZONE_READ = ("project_zone.read", "讀取專案分區")
    PROJECT_ZONE_MANAGE = ("project_zone.manage", "管理專案分區")
    INSPECTION_PLAN_READ = ("inspection_plan.read", "讀取查核計畫")
    INSPECTION_PLAN_CREATE = ("inspection_plan.create", "建立查核計畫")
    INSPECTION_PLAN_MANAGE = ("inspection_plan.manage", "管理查核計畫")
    INSPECTION_PLAN_ARCHIVE = ("inspection_plan.archive", "封存查核計畫")
    INSPECTION_PLAN_UNARCHIVE = (
        "inspection_plan.unarchive",
        "取消封存查核計畫",
    )
    INSPECTION_TASK_READ = ("inspection_task.read", "讀取查核任務")
    INSPECTION_TASK_MANAGE = ("inspection_task.manage", "管理查核任務")
    INSPECTION_TASK_CREATE = ("inspection_task.create", "建立查核任務")
    INSPECTION_TASK_DISPATCH = ("inspection_task.dispatch", "派出查核任務")
    INSPECTION_TASK_ASSIGN = ("inspection_task.assign", "指派查核任務")
    INSPECTION_TASK_INSPECT = ("inspection_task.inspect", "執行現場查核")
    INSPECTION_TASK_DELETE_DRAFT = (
        "inspection_task.delete_draft",
        "刪除草稿查核任務",
    )
    INSPECTION_TASK_CANCEL = ("inspection_task.cancel", "取消或恢復查核任務")


# Always ``PermissionCode`` in production. Only
# ``tests/conftest.py``'s ``registered_permission_codes`` fixture
# reassigns this, and only for the duration of one test.
_active_registry: type[DescribedStrEnum] = PermissionCode

MODULES = frozenset({"project", "inspection", "template"})

# Every production permission has explicit scope, owning module, and
# external-collaborator eligibility. Test-only registry entries use the
# conservative fallback below.
_PROJECT_CODES = {
    "project_member.manage": "project",
    "project.update": "project",
    "project.read": "project",
    "project_inspection_item.edit": "inspection",
    "project_inspection_item.read": "inspection",
    "project_zone.read": "inspection",
    "project_zone.manage": "inspection",
    "inspection_plan.read": "inspection",
    "inspection_plan.create": "inspection",
    "inspection_plan.manage": "inspection",
    "inspection_plan.archive": "inspection",
    "inspection_plan.unarchive": "inspection",
    "inspection_task.read": "inspection",
    "inspection_task.manage": "inspection",
    "inspection_task.create": "inspection",
    "inspection_task.dispatch": "inspection",
    "inspection_task.assign": "inspection",
    "inspection_task.inspect": "inspection",
    "inspection_task.delete_draft": "inspection",
    "inspection_task.cancel": "inspection",
}
_MODULE_CODE_MODULES = {
    "project.use": "project",
    "project.create": "project",
    "all_project_progress.read": "project",
    "inspection.use": "inspection",
    "template.use": "template",
    "template.manage": "template",
}
_EXTERNAL_ALLOWED_CODES = frozenset(
    {
        "project.read",
        "project_inspection_item.read",
        "project_zone.read",
        "inspection_plan.read",
        "inspection_task.read",
        "project.use",
        "inspection.use",
        "template.use",
    }
)
PERMISSION_DEFINITIONS = {
    **{
        code: PermissionDefinition(
            scope="project",
            module=module,
            external_allowed=code in _EXTERNAL_ALLOWED_CODES,
        )
        for code, module in _PROJECT_CODES.items()
    },
    **{
        code: PermissionDefinition(
            scope="module",
            module=module,
            external_allowed=code in _EXTERNAL_ALLOWED_CODES,
        )
        for code, module in _MODULE_CODE_MODULES.items()
    },
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
