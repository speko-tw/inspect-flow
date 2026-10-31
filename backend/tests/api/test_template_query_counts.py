"""Template detail lists batch-load children instead of per row (#462)."""

from uuid import UUID, uuid4

from sqlalchemy import event

from app.models import TemplateItem
from app.services import batch_load
from app.services.template_library import (
    _template_audit_snapshot,
    _template_audit_snapshots,
    park_template_names,
)
from tests.api.query_count import select_count
from tests.api.test_template_library import (  # noqa: F401
    _template,
    _tree,
    clients,
)

_MAX_SELECTS = 30
# 點位、量測欄位、文字標準、數值標準與佐證需求各一次批次 SELECT。
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
    """建立數值標準與文字標準交錯的點位。"""
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
    """執行 ``action``，回傳它發出的 SELECT 次數與執行結果。"""
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
    """TPL-R25 快照以批次載入點位子表（#732）。"""
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
    """整系統覆蓋一次為所有項目取快照（#732）。"""
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


def _load_items(db_session, item_ids):
    db_session.expire_all()
    return [db_session.get(TemplateItem, item_id) for item_id in item_ids]


def test_audit_snapshot_chunks_large_point_sets(
    clients,  # noqa: F811
    db_session,
    monkeypatch,
):
    """點位數超過分段大小時分段查詢，輸出不變（TPL-R25、#732）。

    整系統 PUT 的點位可達 40000，單一 IN 會超過舊版 SQLite 的 bind
    參數上限；分段大小縮成 2 即可用 5 個點位模擬。
    """
    manager = clients["manager"]
    _, system_id = _tree(manager)
    (item_id,) = _create_templates(manager, system_id, [5])

    items = _load_items(db_session, [item_id])
    whole_count, whole = _selects_during(
        db_session, lambda: _template_audit_snapshots(db_session, items)
    )
    monkeypatch.setattr(batch_load, "_CHUNK_SIZE", 2)
    chunk_count, chunked = _selects_during(
        db_session, lambda: _template_audit_snapshots(db_session, items)
    )

    assert chunked == whole
    assert len(chunked[item_id]["inspection_points"]["items"]) == 5
    # 項次表 1 次（只有 1 個項目）；其餘 4 張子表各 ceil(5 / 2) = 3 次，
    # 查詢數隨段數線性成長。
    assert whole_count == 5
    assert chunk_count == 1 + 4 * 3


def test_audit_snapshot_content_for_mixed_template(
    clients,  # noqa: F811
    db_session,
):
    """含數值、文字與無標準點位的範本，快照內容逐欄相符（TPL-R25）。"""
    manager = clients["manager"]
    _, system_id = _tree(manager)
    numeric_field = str(uuid4())
    body = _template(system_id, title="Mixed")
    body["inspection_points"] = [
        {
            "sequence": 1,
            "title": "Numeric point",
            "instruction": "Measure",
            "numeric_standard": {
                "value": "10",
                "condition": ">=",
                "unit": "mm",
                "tolerance": "1",
                "measurement_field_client_id": numeric_field,
            },
            "measurement_fields": [
                {
                    "client_id": numeric_field,
                    "name": "Thickness",
                    "field_type": "number",
                },
                {
                    "client_id": str(uuid4()),
                    "name": "Comment",
                    "field_type": "text",
                },
            ],
            "evidence_requirements": [{"min_count": 2}],
        },
        {
            "sequence": 2,
            "title": "Text point",
            "instruction": "Read",
            "text_standard": {"text": "As approved"},
            "evidence_requirements": [{"min_count": 1}],
        },
        {
            "sequence": 3,
            "title": "Plain point",
            "instruction": "Look",
            "evidence_requirements": [{"min_count": 3}],
        },
    ]
    response = manager.post("/api/v1/templates", json=body)
    assert response.status_code == 201, response.text
    item_id = UUID(response.json()["id"])

    snapshot = _template_audit_snapshots(
        db_session, _load_items(db_session, [item_id])
    )[item_id]

    assert snapshot == {
        "system_id": UUID(system_id),
        "sequence": 1,
        "title": "Mixed",
        "instruction": "Inspect carefully",
        "inspection_points": {
            "items": [
                {
                    "sequence": 1,
                    "title": "Numeric point",
                    "instruction": "Measure",
                    "measurement_fields": [
                        {
                            "name": "Thickness",
                            "field_type": "number",
                            "unit": "mm",
                            "sort_order": 0,
                        },
                        {
                            "name": "Comment",
                            "field_type": "text",
                            "unit": None,
                            "sort_order": 1,
                        },
                    ],
                    "evidence_requirements": [
                        {
                            "evidence_type": "photo",
                            "required": True,
                            "min_count": 2,
                            "max_count": None,
                        }
                    ],
                    "numeric_standard": {
                        "value": "10",
                        "condition": ">=",
                        "unit": "mm",
                        "tolerance": "1",
                        "range_form": None,
                        "lower_bound": None,
                        "upper_bound": None,
                        "measurement_field": "Thickness",
                    },
                },
                {
                    "sequence": 2,
                    "title": "Text point",
                    "instruction": "Read",
                    "measurement_fields": [],
                    "evidence_requirements": [
                        {
                            "evidence_type": "photo",
                            "required": True,
                            "min_count": 1,
                            "max_count": None,
                        }
                    ],
                    "text_standard": {"text": "As approved"},
                },
                {
                    "sequence": 3,
                    "title": "Plain point",
                    "instruction": "Look",
                    "measurement_fields": [],
                    "evidence_requirements": [
                        {
                            "evidence_type": "photo",
                            "required": True,
                            "min_count": 3,
                            "max_count": None,
                        }
                    ],
                },
            ]
        },
    }


def test_batch_snapshots_equal_single_item_snapshots(
    clients,  # noqa: F811
    db_session,
):
    """多項目一次取快照，與逐一取單筆快照的結果相同（TPL-R25）。"""
    manager = clients["manager"]
    _, system_id = _tree(manager)
    ids = _create_templates(manager, system_id, [1, 3, 4])

    batch = _template_audit_snapshots(db_session, _load_items(db_session, ids))
    single = {
        item.id: _template_audit_snapshot(db_session, item)
        for item in _load_items(db_session, ids)
    }

    assert batch == single
