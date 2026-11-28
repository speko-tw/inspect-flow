"""#863：下載用項次序號由照片保存快照解析，不用目前序號推測。"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select

from app.main import create_app
from app.models import (
    Evidence,
    EvidencePointLink,
    TaskRequirementSnapshot,
    TaskSnapshotPoint,
)
from tests.api.test_evidence_read import _add_photo, _paths
from tests.api.test_evidence_read import read_world as read_world


def test_office_download_sequences_follow_saved_revision(read_world):
    """作廢／刪除照片沿用舊修訂的多項次，現場回應不增加內業欄位。"""
    w = read_world
    photo = _add_photo(w)
    db = w["db"]
    saved = db.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == w["item_id"],
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    actor = w["admin_user"].id
    point_b = UUID(int=1)
    db.add(
        TaskSnapshotPoint(
            snapshot_id=saved.id,
            source_point_id=point_b,
            sequence=2,
            title="第二項次",
            instruction="歷史序號",
            created_by=actor,
            updated_by=actor,
        )
    )
    db.add(
        EvidencePointLink(
            evidence_id=UUID(photo["id"]),
            source_point_id=point_b,
            created_by=actor,
            updated_by=actor,
        )
    )
    db.commit()
    office, field, detail = _paths(w, photo)
    # point_b 的 UUID 排在前面，仍按序號而不是 UUID 回傳 1、2。
    assert w["reader"].get(detail).json()["point_sequences"] == [1, 2]
    assert (
        "point_sequences"
        not in (w["field"].get(field + "/photos").json()["items"][0])
    )

    overview = _add_photo(w, is_overview="true", point_ids=[])
    assert (
        w["reader"].get(_paths(w, overview)[2]).json()["point_sequences"] == []
    )

    saved.is_current = False
    saved.superseded_reason = "STANDARD_CHANGED"
    saved.superseded_at = datetime.now(UTC)
    db.flush()
    current = TaskRequirementSnapshot(
        task_inspection_item_id=saved.task_inspection_item_id,
        revision=saved.revision + 1,
        source_standard_revision=saved.source_standard_revision + 1,
        title=saved.title,
        instruction=saved.instruction,
        source_template_name=saved.source_template_name,
        is_current=True,
        created_by=actor,
        updated_by=actor,
    )
    db.add(current)
    db.flush()
    for point_id, sequence in ((w["point_id"], 9), (point_b, 3)):
        db.add(
            TaskSnapshotPoint(
                snapshot_id=current.id,
                source_point_id=point_id,
                sequence=sequence,
                title="重排後",
                instruction="不能取代舊照片序號",
                created_by=actor,
                updated_by=actor,
            )
        )
    row = db.get(Evidence, UUID(photo["id"]))
    row.voided_at = datetime.now(UTC)
    row.void_reason = "STANDARD_CHANGED"
    row.deleted_at = datetime.now(UTC)
    row.deleted_by = actor
    db.commit()
    for data in (
        w["reader"].get(detail).json(),
        next(
            item
            for item in w["reader"].get(office).json()["items"]
            if item["id"] == photo["id"]
        ),
    ):
        assert data["point_sequences"] == [1, 2]
        assert data["snapshot_revision"] == saved.revision
        assert data["deleted_at"] and data["voided_at"]


def test_office_download_schema_requires_sequences():
    """OpenAPI 具名宣告清單與詳情共用的新欄位，不只靠手寫 dict。"""
    schema = create_app().openapi()
    components = schema["components"]["schemas"]
    photo = components["OfficePhotoReadResponse"]
    assert "point_sequences" in photo["required"]
    assert photo["properties"]["point_sequences"]["items"]["type"] == (
        "integer"
    )
    page = components["OfficePhotoPageResponse"]
    assert page["properties"]["items"]["items"]["$ref"].endswith(
        "/OfficePhotoReadResponse"
    )
