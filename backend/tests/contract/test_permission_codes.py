"""Contract checks for feature-registered permission codes (DOM-R35)."""

from app.permission_codes import PermissionCode, permission_code_descriptions


def test_tpl_r09_registers_project_inspection_item_edit() -> None:
    assert (
        PermissionCode.PROJECT_INSPECTION_ITEM_EDIT.value
        == "project_inspection_item.edit"
    )
    assert (
        permission_code_descriptions()["project_inspection_item.edit"]
        == "編輯專案查核項目"
    )
