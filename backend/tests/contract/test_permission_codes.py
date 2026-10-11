"""Contract checks for feature-registered permission codes (DOM-R35)."""

import pytest

from app.models.role import PermissionCodeValidationError, RolePermission
from app.permission_codes import (
    MODULES,
    PERMISSION_DEFINITIONS,
    PermissionCode,
    permission_code_descriptions,
    permission_code_external_allowed,
    permission_code_module,
    permission_code_scope,
)


def test_tpl_r09_registers_project_inspection_item_edit() -> None:
    assert (
        PermissionCode.PROJECT_INSPECTION_ITEM_EDIT.value
        == "project_inspection_item.edit"
    )
    assert (
        permission_code_descriptions()["project_inspection_item.edit"]
        == "編輯專案查核項目"
    )


def test_registered_codes_have_scope_module_and_external_policy() -> None:
    registered = {member.value for member in PermissionCode}
    assert registered == set(PERMISSION_DEFINITIONS)
    assert len(registered) == len(PERMISSION_DEFINITIONS)
    assert all(
        definition.scope in {"project", "module"}
        and definition.module in MODULES
        for definition in PERMISSION_DEFINITIONS.values()
    )
    assert permission_code_scope("project.read") == "project"
    assert permission_code_module("project.read") == "project"
    assert permission_code_external_allowed("project.read") is True
    assert permission_code_external_allowed("inspection_task.inspect") is False
    assert permission_code_external_allowed("project.use") is True


def test_role_rejects_module_scoped_permission_code() -> None:
    with pytest.raises(PermissionCodeValidationError):
        RolePermission(code="project.create")
