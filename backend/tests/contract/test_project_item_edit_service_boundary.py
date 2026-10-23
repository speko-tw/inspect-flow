"""Keep project item persistence out of the HTTP endpoint (DBF-R09)."""

import ast
from pathlib import Path


def test_project_item_patch_endpoint_delegates_orm_work_to_service():
    """Ensure the route delegates edits without issuing ORM operations."""
    api_path = (
        Path(__file__).parents[2]
        / "app"
        / "api"
        / "v1"
        / "inspection_planning.py"
    )
    tree = ast.parse(api_path.read_text())
    endpoint = next(
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "patch_project_item"
    )
    referenced_names = {
        node.id for node in ast.walk(endpoint) if isinstance(node, ast.Name)
    }
    orm_calls = {
        node.func.attr
        for node in ast.walk(endpoint)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    } & {"scalar", "scalars", "add", "delete", "flush", "execute"}

    assert "edit_project_inspection_item" in referenced_names
    assert orm_calls == set()
