"""Template detail lists batch-load children instead of per row (#462)."""

from uuid import UUID, uuid4

from sqlalchemy import event

from app.models import TemplateItem
from app.services.template_library import (
    _template_audit_snapshot,
    park_template_names,
)
from tests.api.query_count import select_count
from tests.api.test_template_library import (  # noqa: F401
    _template,
    _tree,
    clients,
)

_MAX_SELECTS = 30
# One batched SELECT each for points, measurement fields, text standards,
# numeric standards and evidence requirements.
_MAX_SNAPSHOT_SELECTS = 5


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


def _points(count: int) -> list[dict]:
    """Build points alternating numeric and text standards."""
    points = []
    for sequence in range(1, count + 1):
        point: dict = {
            "sequence": sequence,
            "title": f"Point {sequence}",
            "instruction": "Follow plan",
            "evidence_requirements": [{"min_count": 1}],
        }
        if sequence % 2:
            field_id = str(uuid4())
            point["numeric_standard"] = {
                "value": "10",
                "condition": ">=",
                "unit": "mm",
                "tolerance": "1",
                "measurement_field_client_id": field_id,
            }
            point["measurement_fields"] = [
                {
                    "client_id": field_id,
                    "name": "Thickness",
                    "field_type": "number",
                },
                {
                    "client_id": str(uuid4()),
                    "name": "Comment",
                    "field_type": "text",
                },
            ]
        else:
            point["text_standard"] = {"text": "As approved"}
        points.append(point)
    return points


def _selects_during(db_session, action):
    """Run ``action`` and return how many SELECTs it issued."""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", record)
    try:
        result = action()
    finally:
        event.remove(engine, "before_cursor_execute", record)
    return len(statements), result


def _create_templates(manager, system_id, point_counts):
    ids = []
    for index, count in enumerate(point_counts, start=1):
        body = _template(system_id, title=f"Snapshot {index}")
        body["sequence"] = index
        body["inspection_points"] = _points(count)
        response = manager.post("/api/v1/templates", json=body)
        assert response.status_code == 201, response.text
        ids.append(UUID(response.json()["id"]))
    return ids


def test_audit_snapshot_select_count_ignores_point_count(
    clients,  # noqa: F811
    db_session,
):
    """TPL-R25 snapshots batch-load point children (#732)."""
    manager = clients["manager"]
    _, system_id = _tree(manager)
    one, many = _create_templates(manager, system_id, [1, 6])
    counts = []
    snapshots = []
    for item_id in (one, many):
        db_session.expire_all()
        item = db_session.get(TemplateItem, item_id)
        count, snapshot = _selects_during(
            db_session,
            lambda item=item: _template_audit_snapshot(db_session, item),
        )
        counts.append(count)
        snapshots.append(snapshot)

    assert [len(s["inspection_points"]["items"]) for s in snapshots] == [1, 6]
    assert counts[0] == counts[1]
    assert counts[1] <= _MAX_SNAPSHOT_SELECTS


def test_park_template_names_select_count_ignores_item_count(
    clients,  # noqa: F811
    db_session,
):
    """Whole-system replacement snapshots every item in one pass (#732)."""
    manager = clients["manager"]
    _, system_id = _tree(manager)
    ids = _create_templates(manager, system_id, [2, 2, 2, 2])
    counts = []
    for chosen in (ids[:1], ids):
        db_session.expire_all()
        items = [db_session.get(TemplateItem, item_id) for item_id in chosen]
        count, snapshots = _selects_during(
            db_session,
            lambda items=items: park_template_names(db_session, items),
        )
        counts.append(count)
        assert set(snapshots) == set(chosen)

    assert counts[0] == counts[1]
    assert counts[1] <= _MAX_SNAPSHOT_SELECTS
