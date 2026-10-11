"""靜態鎖定 DOM-R60 與 DOM-R69 的權限服務責任邊界。"""

import ast
from pathlib import Path

BACKEND = Path(__file__).parents[2]


def _function_names(path: str, function_name: str) -> set[str]:
    tree = ast.parse((BACKEND / path).read_text(encoding="utf-8"))
    function = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    )
    return {
        node.id for node in ast.walk(function) if isinstance(node, ast.Name)
    }


def test_permission_calculation_delegates_person_data_to_dom_r60_service():
    path = BACKEND / "app/services/permissions.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    imports = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
        for alias in node.names
    }

    assert "query_person_access" in imports
    assert not names.intersection(
        {"User", "Company", "UserModulePermission", "InspectionTask"}
    )


def test_inspection_permission_entry_points_do_not_recompute_membership():
    api_path = "app/api/v1/inspection_planning.py"
    item_path = "app/api/v1/project_inspection_items.py"
    service_path = "app/services/inspection_planning.py"

    assert "calculate_effective_access" in _function_names(
        api_path, "_is_project_member"
    )
    assert "project_member_ids_with_permission" in _function_names(
        api_path, "assignees"
    )
    assert not _function_names(api_path, "assignees").intersection(
        {"ProjectMember", "ProjectMemberRole", "RolePermission"}
    )
    assert "calculate_effective_access" in _function_names(
        item_path, "list_project_inspection_items"
    )
    assert "calculate_effective_access" in _function_names(
        service_path, "_validate_assignee"
    )
    assignee_names = _function_names(service_path, "_validate_assignee")
    assert not assignee_names.intersection({"ProjectMember", "User"})
