"""Template detail lists batch-load children instead of per row (#462)."""

from tests.api.query_count import select_count
from tests.api.test_template_library import (  # noqa: F401
    _template,
    _tree,
    clients,
)

_MAX_SELECTS = 30


def test_system_template_list_select_count_does_not_grow(clients):  # noqa: F811
    manager = clients["manager"]
    _, system_id = _tree(manager)
    for index in range(5):
        body = _template(system_id, title=f"Template {index}")
        body["sequence"] = index + 1
        response = manager.post("/api/v1/templates", json=body)
        assert response.status_code == 201, response.text
    url = f"/api/v1/template-systems/{system_id}/templates"

    small, small_items = select_count(manager, url, limit=1)
    middle, middle_items = select_count(manager, url, limit=2)
    large, large_items = select_count(manager, url, limit=100)

    assert (small_items, middle_items, large_items) == (1, 2, 5)
    assert small == middle == large
    assert large <= _MAX_SELECTS


def test_single_template_detail_select_count_ignores_point_count(
    clients,  # noqa: F811
):
    manager = clients["manager"]
    _, system_id = _tree(manager)
    one_point = _template(system_id, title="One point")
    one_point["inspection_points"] = one_point["inspection_points"][:1]
    two_points = _template(system_id, title="Two points")
    two_points["sequence"] = 2
    counts = []
    for body in (one_point, two_points):
        response = manager.post("/api/v1/templates", json=body)
        assert response.status_code == 201, response.text
        count, _ = select_count(
            manager, f"/api/v1/templates/{response.json()['id']}"
        )
        counts.append(count)

    assert counts[0] == counts[1]
    assert counts[1] <= _MAX_SELECTS
