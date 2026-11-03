"""FEV-AC13：真實端點的兩層權限、資源隱藏與失效照片契約。"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, select

from app.models import (
    Evidence,
    InspectionTask,
    Role,
    RolePermission,
    UserModulePermission,
)
from tests.api.test_evidence_read import (
    _add_photo,
    _paths,
)
from tests.api.test_evidence_read import (
    read_world as read_world,
)
from tests.api.test_inspection_planning_api import _dispatched_field_task


def test_ac13_two_layer_role_matrix_and_u7_ruling(read_world):
    w = read_world
    photo = _add_photo(w)
    base, field, detail = _paths(w, photo)
    paths = [
        field + "/evidence",
        field + "/photos",
        base,
        detail,
        detail + "/image",
        detail + "/image?variant=office",
    ]
    expected = {
        "field": [200, 200, 403, 403, 200, 403],
        "reader": [404, 404, 200, 200, 200, 200],
        "plain": [404, 404, 403, 403, 403, 403],
        "outsider": [404, 404, 403, 403, 403, 403],
        "admin": [200] * 6,
    }
    for name, statuses in expected.items():
        for path, status in zip(paths, statuses, strict=True):
            response = w[name].get(path)
            assert response.status_code == status, (name, path, response.text)
    anonymous = w["make_client"]()
    for path in paths:
        assert anonymous.get(path).status_code == 401
    anonymous.close()
    db = w["db"]
    task_reader = db.scalar(
        select(Role).where(Role.name == "API field planning reader")
    )
    task_reader.permission_codes = [
        RolePermission(code="inspection_task.read")
    ]
    db.commit()
    for path, status in zip(
        paths, [404, 404, 403, 403, 403, 403], strict=True
    ):
        assert w["field_reader"].get(path).status_code == status
    role = db.scalar(select(Role).where(Role.name == "API planning reader"))
    role.permission_codes.append(RolePermission(code="evidence.manage"))
    db.commit()
    assert all(w["reader"].get(path).status_code == 200 for path in paths[2:])
    db.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == w["field_user"].id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    db.commit()
    # 負責人裁定：U7 在 /field/ 亦回 403，缺專案／Task 才隱藏 404。
    for path in paths:
        response = w["field"].get(path)
        assert response.status_code == 403, response.text


@pytest.mark.parametrize("kind", ["deleted", "voided"])
def test_ac10_ac11_invalidated_photos_visible_only_to_office(read_world, kind):
    w = read_world
    photo = _add_photo(w)
    db = w["db"]
    row = db.get(Evidence, UUID(photo["id"]))
    if kind == "deleted":
        actor_id = w["field_user"].id
        row.deleted_at = datetime.now(UTC)
        row.deleted_by = actor_id
    else:
        row.voided_at = datetime.now(UTC)
        row.void_reason = "STANDARD_CHANGED"
    db.commit()
    base, field, detail = _paths(w, photo)
    assert w["field"].get(field + "/photos").json()["items"] == []
    coverage = w["field"].get(field + "/evidence").json()
    assert coverage["items"][0]["points"][0]["photo_count"] == 0
    assert w["field"].get(detail + "/image").status_code == 404
    for path in (detail, detail + "/image", detail + "/image?variant=office"):
        response = w["reader"].get(path)
        assert response.status_code == 200, response.text
    assert len(w["reader"].get(base).json()["items"]) == 1
    assert len(w["reader"].get(base, params={kind: True}).json()["items"]) == 1
    assert w["reader"].get(base, params={kind: False}).json()["items"] == []


def test_cross_task_resources_and_draft_are_hidden(read_world):
    w = read_world
    photo = _add_photo(w)
    _add_photo(w)
    _, other_task = _dispatched_field_task(w, "另一任務", w["field_user"].id)
    base, field, detail = _paths(w, photo)
    for suffix in ("", "/image"):
        path = detail.replace(w["task"], other_task) + suffix
        assert w["reader"].get(path).status_code == 404
        assert w["admin"].get(path).status_code == 404
    cursor = w["reader"].get(base, params={"limit": 1}).json()["next_cursor"]
    assert cursor is not None
    other_list = base.replace(w["task"], other_task)
    assert (
        w["reader"].get(other_list, params={"cursor": cursor}).status_code
        == 422
    )
    missing = str(uuid4())
    assert (
        w["reader"].get(detail.replace(photo["id"], missing)).status_code
        == 404
    )
    assert (
        w["field"]
        .get(field.replace(w["task"], missing) + "/photos")
        .status_code
        == 404
    )
    db = w["db"]
    task = db.get(InspectionTask, UUID(w["task"]))
    task.status = "DRAFT"
    db.commit()
    for path in (field + "/photos", field + "/evidence", detail + "/image"):
        assert w["field"].get(path).status_code == 404
    assert w["reader"].get(base).status_code == 200
