"""靜態鎖定 DOM-R60 與 DOM-R69 的權限服務責任邊界。"""

import ast
from pathlib import Path

BACKEND = Path(__file__).parents[2]


def _function_names(
    path: str, function_name: str, *, enclosing: str | None = None
) -> set[str]:
    tree = ast.parse((BACKEND / path).read_text(encoding="utf-8"))
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    candidates = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    ]
    if enclosing is not None:
        candidates = [
            node
            for node in candidates
            if any(
                isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef))
                and parent.name == enclosing
                for parent in _ancestors(node, parents)
            )
        ]
    assert len(candidates) == 1
    function = candidates[0]
    return {
        node.id for node in ast.walk(function) if isinstance(node, ast.Name)
    }


def _ancestors(node: ast.AST, parents: dict[ast.AST, ast.AST]):
    current = parents.get(node)
    while current is not None:
        yield current
        current = parents.get(current)


def _query_model_names(path: str) -> set[str]:
    tree = ast.parse((BACKEND / path).read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(
            node.func, ast.Name
        ):
            continue
        if node.func.id not in {"select", "update", "delete"}:
            continue
        names.update(
            child.id for child in ast.walk(node) if isinstance(child, ast.Name)
        )
    return names


def _query_function_names(path: str, model_name: str) -> set[str]:
    tree = ast.parse((BACKEND / path).read_text(encoding="utf-8"))
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    function_names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        query_constructor = isinstance(node.func, ast.Name) and (
            node.func.id in {"select", "update", "delete"}
        )
        join_call = isinstance(
            node.func, ast.Attribute
        ) and node.func.attr in {"join", "outerjoin"}
        if not query_constructor and not join_call:
            continue
        if model_name not in {
            child.id for child in ast.walk(node) if isinstance(child, ast.Name)
        }:
            continue
        function_names.update(
            parent.name
            for parent in _ancestors(node, parents)
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef))
        )
    return function_names


def _function_query_models(
    path: str, function_name: str, *, enclosing: str | None = None
) -> set[str]:
    tree = ast.parse((BACKEND / path).read_text(encoding="utf-8"))
    parents: dict[ast.AST, ast.AST] = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent
    candidates = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    ]
    if enclosing is not None:
        candidates = [
            node
            for node in candidates
            if any(
                isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef))
                and parent.name == enclosing
                for parent in _ancestors(node, parents)
            )
        ]
    assert len(candidates) == 1
    function = candidates[0]
    models: set[str] = set()
    for node in ast.walk(function):
        if not isinstance(node, ast.Call):
            continue
        is_query = isinstance(node.func, ast.Name) and node.func.id in {
            "select",
            "update",
            "delete",
        }
        is_model_lookup = (
            isinstance(node.func, ast.Attribute) and node.func.attr == "get"
        )
        if is_query or is_model_lookup:
            models.update(
                child.id
                for child in ast.walk(node)
                if isinstance(child, ast.Name)
            )
    return models


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


def test_project_authorization_decisions_use_central_permission_entries():
    access_path = "app/auth/access.py"
    assert "calculate_effective_access" in _function_names(
        access_path, "_check", enclosing="require_project_permission"
    )
    for outer in (
        "require_admin_or_any_project_permission",
        "require_system_role_or_any_project_permission",
    ):
        assert "calculate_effective_access" in _function_names(
            access_path, "_check", enclosing=outer
        )

    planning_path = "app/services/inspection_planning.py"
    for function_name in (
        "project_permissions_for",
        "field_inspection_task_filters",
        "get_field_inspection_task",
        "start_inspection_task",
        "complete_inspection_task",
    ):
        names = _function_names(planning_path, function_name)
        assert names.intersection(
            {"calculate_effective_access", "effective_permissions"}
        ), function_name

    assert _function_names(
        "app/api/v1/inspection_planning.py",
        "check",
        enclosing="_resource_permission",
    ).intersection({"calculate_effective_access", "effective_permissions"})
    assert _function_names(
        "app/api/v1/inspection_planning.py",
        "check",
        enclosing="_task_read_permission",
    ).intersection({"calculate_effective_access", "effective_permissions"})


def test_project_routes_do_not_join_permission_tables_for_recalculation():
    project_routes = (
        "app/api/v1/projects.py",
        "app/api/v1/inspection_planning.py",
        "app/api/v1/project_inspection_items.py",
        "app/api/v1/me.py",
        "app/services/inspection_planning.py",
        "app/services/access_summary.py",
    )
    forbidden_join_models = {
        "RolePermission",
        "UserModulePermission",
        "UserModuleDelegation",
    }
    for relative_path in project_routes:
        tree = ast.parse((BACKEND / relative_path).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in {"join", "outerjoin"}
            ):
                names = {
                    child.id
                    for child in ast.walk(node)
                    if isinstance(child, ast.Name)
                }
                assert not names.intersection(forbidden_join_models), (
                    relative_path,
                    node.lineno,
                )

        role_assignment_queries = _query_function_names(
            relative_path, "ProjectMemberRole"
        )
        expected_display_queries = (
            {"list_my_projects"}
            if relative_path == "app/api/v1/me.py"
            else set()
        )
        assert role_assignment_queries == expected_display_queries

        permission_queries = _query_function_names(
            relative_path, "RolePermission"
        )
        expected_role_code_display = (
            {"list_assignable_roles", "render"}
            if relative_path == "app/api/v1/projects.py"
            else set()
        )
        assert permission_queries == expected_role_code_display

    # 此端點只連接角色資料來序列化角色名稱；有效權限仍由中央服務計算。
    assert _query_function_names("app/api/v1/me.py", "ProjectMemberRole") == {
        "list_my_projects"
    }
    assert "calculate_effective_access" in _function_names(
        "app/api/v1/me.py", "list_my_projects"
    )
    assert "calculate_effective_access" in _function_names(
        "app/services/access_summary.py", "summarize_access"
    )

    authorization_functions = (
        ("app/auth/access.py", "_check", "require_project_permission"),
        (
            "app/api/v1/inspection_planning.py",
            "_is_project_member",
            None,
        ),
        ("app/api/v1/inspection_planning.py", "assignees", None),
        (
            "app/api/v1/inspection_planning.py",
            "check",
            "_resource_permission",
        ),
        (
            "app/api/v1/inspection_planning.py",
            "check",
            "_task_read_permission",
        ),
        (
            "app/api/v1/project_inspection_items.py",
            "list_project_inspection_items",
            None,
        ),
        ("app/services/inspection_planning.py", "_validate_assignee", None),
        (
            "app/services/inspection_planning.py",
            "field_inspection_task_filters",
            None,
        ),
    )
    person_models = {
        "Company",
        "UserModulePermission",
        "UserModuleDelegation",
        "PermissionBundle",
    }
    for relative_path, function_name, enclosing in authorization_functions:
        names = _function_names(
            relative_path, function_name, enclosing=enclosing
        )
        assert not names.intersection(person_models), (
            relative_path,
            function_name,
        )
        query_models = _function_query_models(
            relative_path, function_name, enclosing=enclosing
        )
        assert not query_models.intersection(
            {
                "User",
                "Company",
                "UserModulePermission",
                "UserModuleDelegation",
                "PermissionBundle",
            }
        ), (relative_path, function_name, query_models)

    # Role code reads in this endpoint are response serialization, not an
    # authorization calculation; reject permission-table reads elsewhere.
    project_query_models = _query_model_names("app/api/v1/projects.py")
    assert "RolePermission" in project_query_models


def test_project_routes_do_not_import_inspection_data_models():
    tree = ast.parse(
        (BACKEND / "app/api/v1/projects.py").read_text(encoding="utf-8")
    )
    model_names = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module == "app.models"
        for alias in node.names
    }
    assert not any(
        name.startswith(("Inspection", "TaskInspection"))
        for name in model_names
    )
