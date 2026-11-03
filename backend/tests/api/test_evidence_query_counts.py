"""FEV T3：照片、項次與圖層歷程數量不造成 N+1 查詢。"""

from uuid import UUID, uuid4

from sqlalchemy import event, select

from app.db.engine import get_engine
from app.models import (
    AuditLog,
    EvidencePointLink,
    TaskRequirementSnapshot,
    TaskSnapshotEvidenceRequirement,
    TaskSnapshotPoint,
)
from tests.api.query_count import select_count
from tests.api.test_evidence_read import _add_photo, _clone_photos, _paths
from tests.api.test_evidence_read import read_world as read_world


def _detail_count(client, url, **params):
    statements = []

    def record(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(url, params=params)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    return len(statements), response.json()


def _add_history(w, photo, count):
    actor, project = w["admin_user"].id, w["project"].id
    w["db"].add_all(
        AuditLog(
            created_by=actor,
            actor_snapshot="查詢數測試",
            project_id=project,
            event_type="evidence.layer_updated",
            entity_type="evidence",
            entity_id=UUID(photo["id"]),
            before={"layer": photo["layer"], "labels": photo["labels"]},
            after={"layer": photo["layer"], "labels": photo["labels"]},
        )
        for _ in range(count)
    )
    w["db"].commit()


def test_batched_reads_have_constant_select_count(read_world):
    w = read_world
    photo = _add_photo(w)
    _add_history(w, photo, 1)
    base, field, detail = _paths(w, photo)
    probes = (
        (w["reader"], base),
        (w["field"], field + "/photos"),
        (w["field"], field + "/evidence"),
    )
    small = [select_count(client, path, limit=100) for client, path in probes]
    assert all(count > 0 and size == 1 for count, size in small)
    small_detail = _detail_count(w["reader"], detail, layer_history_limit=100)
    assert small_detail[0] > 0
    assert len(small_detail[1]["point_ids"]) == 1
    assert len(small_detail[1]["layer_history"]["items"]) == 1
    _clone_photos(w, 99)
    db = w["db"]
    actor = w["admin_user"].id
    snapshot = db.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == w["item_id"],
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    for index in range(2, 101):
        point = TaskSnapshotPoint(
            snapshot_id=snapshot.id,
            source_point_id=uuid4(),
            sequence=index,
            title=f"批次項次 {index}",
            instruction="確認分批讀取",
            created_by=actor,
            updated_by=actor,
        )
        db.add(point)
        db.flush()
        db.add(
            TaskSnapshotEvidenceRequirement(
                point_id=point.id,
                evidence_type="photo",
                required=True,
                min_count=1,
                created_by=actor,
                updated_by=actor,
            )
        )
        db.add(
            EvidencePointLink(
                evidence_id=UUID(photo["id"]),
                source_point_id=point.source_point_id,
                created_by=actor,
                updated_by=actor,
            )
        )
    db.commit()
    _add_history(w, photo, 99)
    large = [select_count(client, path, limit=100) for client, path in probes]
    assert [size for _, size in large] == [100, 100, 1]
    assert [count for count, _ in small] == [count for count, _ in large]
    coverage = w["field"].get(field + "/evidence").json()
    assert len(coverage["items"][0]["points"]) == 100
    large_detail = _detail_count(w["reader"], detail, layer_history_limit=100)
    assert large_detail[0] == small_detail[0]
    assert len(large_detail[1]["point_ids"]) == 100
    assert len(large_detail[1]["layer_history"]["items"]) == 100
    first_count, first = _detail_count(
        w["reader"], detail, layer_history_limit=1
    )
    assert first_count == small_detail[0]
    cursor = first["layer_history"]["next_cursor"]
    assert cursor
    next_count, next_page = _detail_count(
        w["reader"],
        detail,
        layer_history_limit=100,
        layer_history_cursor=cursor,
    )
    assert next_count == small_detail[0]
    assert len(next_page["layer_history"]["items"]) == 99
