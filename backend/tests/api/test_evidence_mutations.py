"""FEV T5：真實 API 的修改、軟刪除、項目作廢及稽核交易。"""

from copy import deepcopy
from uuid import UUID

import pytest
from sqlalchemy import select

from app.models import AuditLog, Evidence, TaskInspectionItem
from app.services.evidence_images import default_layer
from tests.api.test_evidence_read import (
    _add_photo,
    _paths,
)
from tests.api.test_evidence_read import (
    read_world as read_world,
)


def _events(world, photo, kind):
    db = world["db"]
    db.expire_all()
    return db.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity_id == UUID(photo["id"]),
            AuditLog.event_type == f"evidence.{kind}",
        )
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()


def _change(world, *, reinspect=True, **changes):
    return world["admin"].patch(
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}",
        json={"title": "標準修訂", "reinspect": reinspect, **changes},
    )


def test_partial_patch_ownership_soft_delete_and_changed_only_audit(
    read_world,
):
    """AC13／14／21／29：省略不變、非拍照者拒絕、軟刪後仍可查。"""
    w = read_world
    photo = _add_photo(w, caption="原註記")
    base, field, url = _paths(w, photo)
    denied = w["field_two"].patch(url, json={"caption": "不可改"})
    assert denied.status_code == 403, denied.text
    changed = w["field"].patch(url, json={"caption": "新註記"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["point_ids"] == photo["point_ids"]
    assert "variants" not in changed.json()
    same = w["field"].patch(url, json={"caption": "新註記"})
    assert same.status_code == 200, same.text
    logs = _events(w, photo, "photo_updated")
    assert len(logs) == 1
    assert logs[0].before == {"caption": "原註記"}
    assert logs[0].after == {"caption": "新註記"}
    assert logs[0].project_id == w["project"].id
    assert logs[0].created_by == w["field_user"].id
    files = set(w["root"].iterdir())
    deleted = w["field"].delete(url)
    assert deleted.status_code == 204, deleted.text
    assert set(w["root"].iterdir()) == files
    row = w["db"].get(Evidence, UUID(photo["id"]))
    w["db"].refresh(row)
    assert row.deleted_at is not None
    assert row.deleted_by == w["field_user"].id
    assert len(_events(w, photo, "photo_deleted")) == 1
    assert w["field"].get(f"{field}/photos").json()["items"] == []
    assert (
        len(w["reader"].get(base, params={"deleted": True}).json()["items"])
        == 1
    )
    assert w["reader"].get(url).status_code == 200


def test_kd55_photo_only_item_voids_and_marks_reinspection(read_world):
    """AC16／26：只有有效照片也算已有結果，同交易標待重查。"""
    w = read_world
    photo = _add_photo(w)
    impact = (
        f"/api/v1/projects/{w['project'].id}/inspection-items/"
        f"{w['item'].id}/tasks"
    )
    assert w["admin"].get(impact).json()["items"][0]["has_result"] is True
    result = _change(w)
    assert result.status_code == 200, result.text
    row = w["db"].get(Evidence, UUID(photo["id"]))
    w["db"].refresh(row)
    assert row.void_reason == "STANDARD_CHANGED"
    item = w["db"].get(TaskInspectionItem, w["item_id"])
    w["db"].refresh(item)
    assert item.needs_reinspection is True
    base, field, url = _paths(w, photo)
    assert w["field"].get(f"{field}/photos").json()["items"] == []
    assert (
        len(w["reader"].get(base, params={"voided": True}).json()["items"])
        == 1
    )
    assert w["reader"].get(url).status_code == 200


def test_layer_audit_history_and_repeat_office_application(read_world):
    """AC21／36：每次套用都寫，實際圖層變動才寫完整歷程。"""
    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    layer = deepcopy(default_layer())
    layer["overrides"] = {"project_name": "修正工程"}
    for _ in range(2):
        result = w["admin"].put(f"{url}/office-version", json={"layer": layer})
        assert result.status_code == 200, result.text
    assert len(_events(w, photo, "office_version_edited")) == 2
    logs = _events(w, photo, "layer_updated")
    assert len(logs) == 1
    assert set(logs[0].before) == {"layer", "labels"}
    assert set(logs[0].after["labels"]) == {
        "project_name",
        "item_title",
        "location",
        "uploader_name",
        "uploaded_at",
    }
    history = w["reader"].get(url).json()["layer_history"]["items"]
    assert len(history) == 1
    assert history[0]["after"] == logs[0].after
    assert history[0]["actor"]["id"] == str(w["admin_user"].id)
    assert history[0]["occurred_at"].endswith("Z")
    assert logs[0].project_id == w["project"].id


def _source_points(w):
    response = w["admin"].get(
        f"/api/v1/projects/{w['project'].id}/inspection-items"
    )
    assert response.status_code == 200, response.text
    points = next(
        item["inspection_points"]
        for item in response.json()["items"]
        if item["id"] == str(w["item"].id)
    )
    # GET 帶有唯讀的 evidence_type／required；PATCH 只接受 min_count。
    for point in points:
        point["evidence_requirements"] = [
            {"min_count": row["min_count"]}
            for row in point["evidence_requirements"]
        ] or [{"min_count": 1}]
    return points


def _state(w):
    """記錄業務與檔案實值，故障時不只比對 HTTP 錯誤碼。"""
    from app.models import (
        EvidencePointLink,
        EvidenceVariant,
        InspectionTask,
        TaskRequirementSnapshot,
    )
    from app.storage import LocalStorage

    db = w["db"]
    db.expire_all()
    task = db.get(InspectionTask, UUID(w["task"]))
    store = LocalStorage(w["root"])
    files = {}
    for key in store.iter_keys():
        with store.open(key) as stream:
            files[str(key)] = stream.read()
    return deepcopy(
        {
            "task": (task.status, task.cancelled_from_status),
            "source": _source_points(w),
            "photos": [
                (
                    p.id,
                    p.caption,
                    p.label_source,
                    p.label_layer,
                    p.deleted_at,
                    p.deleted_by,
                    p.voided_at,
                    p.void_reason,
                )
                for p in db.scalars(select(Evidence).order_by(Evidence.id))
            ],
            "variants": [
                (p.id, p.storage_key, p.sha256, p.edit_params, p.label_rule)
                for p in db.scalars(
                    select(EvidenceVariant).order_by(EvidenceVariant.id)
                )
            ],
            "links": [
                (p.evidence_id, p.source_point_id)
                for p in db.scalars(
                    select(EvidencePointLink).order_by(EvidencePointLink.id)
                )
            ],
            "snapshots": [
                (p.id, p.revision, p.is_current, p.superseded_reason)
                for p in db.scalars(
                    select(TaskRequirementSnapshot).order_by(
                        TaskRequirementSnapshot.id
                    )
                )
            ],
            "items": [
                (p.id, p.needs_reinspection)
                for p in db.scalars(
                    select(TaskInspectionItem).order_by(TaskInspectionItem.id)
                )
            ],
            "logs": list(
                db.scalars(select(AuditLog.id).order_by(AuditLog.id))
            ),
            "files": files,
        }
    )


def test_mutation_status_matrix_and_priority(read_world):
    """AC12：封存優先於狀態，再到照片鎖與本文驗證。"""
    from app.models import InspectionPlan, InspectionTask

    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    db = w["db"]
    task = db.get(InspectionTask, UUID(w["task"]))
    plan = db.get(InspectionPlan, task.plan_id)
    for status in ("DRAFT", "PENDING", "COMPLETED", "CANCELLED"):
        task.status = status
        task.cancelled_from_status = (
            "IN_PROGRESS" if status == "CANCELLED" else None
        )
        task.cancellation_reason = "暫停" if status == "CANCELLED" else None
        db.commit()
        before = _state(w)
        for method in ("patch", "delete"):
            response = (
                w["field"].patch(url, content="not JSON")
                if method == "patch"
                else w["field"].delete(url)
            )
            expected = 404 if status == "DRAFT" else 409
            assert response.status_code == expected, response.text
            assert response.json()["error"]["code"] == (
                "resource.not_found"
                if status == "DRAFT"
                else "evidence.task_locked"
            )
        assert _state(w) == before
        plan.is_archived = True
        db.commit()
        response = w["admin"].patch(url, content="invalid")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "inspection_plan.archived"
        plan.is_archived = False
        db.commit()


def test_photo_locks_rejection_does_not_change_rows_or_files(read_world):
    """AC15：作廢、報告引用、已刪除依序守門，未註冊則可修改。"""
    from app.services import evidence_office as office

    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    db = w["db"]
    row = db.get(Evidence, UUID(photo["id"]))
    try:
        for reason in ("voided", "referenced_by_report", "deleted"):
            row.voided_at = row.created_at if reason == "voided" else None
            row.void_reason = (
                "STANDARD_CHANGED" if reason == "voided" else None
            )
            row.deleted_at = row.created_at if reason == "deleted" else None
            row.deleted_by = row.created_by if reason == "deleted" else None
            db.commit()
            office.register_report_reference_checker(
                (lambda session, photo: True)
                if reason == "referenced_by_report"
                else None
            )
            before = _state(w)
            responses = [
                w["field"].patch(url, json={"caption": "不允許"}),
                w["admin"].delete(url),
                w["admin"].put(f"{url}/office-version", json={}),
            ]
            for response in responses:
                assert response.status_code == 409, response.text
                assert (
                    response.json()["error"]["code"] == "evidence.photo_locked"
                )
                assert response.json()["error"]["details"] == [reason]
            assert _state(w) == before
        row.deleted_at = row.deleted_by = None
        db.commit()
        office.register_report_reference_checker(None)
        assert w["field"].patch(url, json={}).status_code == 200
    finally:
        office.register_report_reference_checker(None)


def test_permissions_module_gate_and_non_admin_manager(read_world):
    """AC13／14：U2、U3、U5、U6、U7 拒絕，U4 可刪他人照片。"""
    from sqlalchemy import delete

    from app.models import (
        ProjectMember,
        ProjectMemberRole,
        Role,
        RolePermission,
        UserModulePermission,
    )

    w = read_world
    db = w["db"]
    role = Role(
        name="T5 task-read only",
        created_by=w["admin_user"].id,
        updated_by=w["admin_user"].id,
        permission_codes=[RolePermission(code="inspection_task.read")],
    )
    db.add(role)
    db.flush()
    member = db.scalar(
        select(ProjectMember).where(
            ProjectMember.user_id == w["plain_user"].id,
            ProjectMember.project_id == w["project"].id,
        )
    )
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    db.commit()
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    for key in ("plain", "outsider", "reader", "field_two"):
        response = w[key].delete(url)
        assert response.status_code == 403, (key, response.text)
    anonymous = w["make_client"]().delete(url)
    assert anonymous.status_code == 401
    db = w["db"]
    db.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == w["field_user"].id
        )
    )
    db.commit()
    response = w["field"].patch(url, json={"caption": "無模組"})
    assert response.status_code == 403
    role = db.scalar(select(Role).where(Role.name == "API planning reader"))
    role.permission_codes.append(RolePermission(code="evidence.manage"))
    db.commit()
    response = w["reader"].patch(url, json={"caption": None})
    assert response.status_code == 200, response.text
    assert "variants" in response.json()
    assert "storage_key" not in response.text
    assert w["reader"].delete(url).status_code == 204


def test_partial_patch_targets_and_validation(read_world):
    """AC29：欄位驗證、總覽與項次互斥，合法空註記與省略不變。"""
    from uuid import uuid4

    w = read_world
    photo = _add_photo(w, caption="保留")
    _, _, url = _paths(w, photo)
    before = _state(w)
    for raw in (
        {"caption": "字" * 501},
        {"caption": 123},
        {"point_ids": []},
        {"point_ids": [str(uuid4())]},
        {"is_overview": True},
        {"point_ids": "bad"},
        {"point_ids": [False]},
        {"item_id": str(uuid4())},
    ):
        response = w["field"].patch(url, json=raw)
        assert response.status_code == 422, response.text
        assert _state(w) == before
    empty = w["field"].patch(url, json={"caption": None})
    assert empty.status_code == 200 and empty.json()["caption"] is None
    assert empty.json()["point_ids"] == photo["point_ids"]
    overview = _add_photo(w, is_overview="true", point_ids=[])
    _, _, overview_url = _paths(w, overview)
    rejected = w["field"].patch(
        overview_url, json={"point_ids": photo["point_ids"]}
    )
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "evidence.invalid_target"


def test_cancel_restore_defers_invalidation_and_is_atomic(read_world):
    """AC18／27：取消時唯讀且不作廢，恢復的同一交易才作廢。"""
    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    task = f"/api/v1/inspection-tasks/{w['task']}"
    assert (
        w["admin"].post(task + ":cancel", json={"reason": "暫停"}).status_code
        == 200
    )
    assert w["field"].patch(url, json={}).status_code == 409
    assert w["reader"].get(url).status_code == 200
    # 未修改標準的恢復仍可現場寫入。
    assert w["admin"].post(task + ":restore").status_code == 200
    assert (
        w["field"].patch(url, json={"caption": "恢復可寫"}).status_code == 200
    )
    assert (
        w["admin"]
        .post(task + ":cancel", json={"reason": "待改標準"})
        .status_code
        == 200
    )
    assert _change(w).status_code == 200
    row = w["db"].get(Evidence, UUID(photo["id"]))
    w["db"].refresh(row)
    assert row.voided_at is None
    before = _state(w)
    assert before["task"][0] == "CANCELLED"
    _assert_rollback(w, "restore", before)
    restored = w["admin"].post(task + ":restore")
    assert restored.status_code == 200, restored.text
    w["db"].refresh(row)
    assert row.void_reason == "STANDARD_CHANGED"
    item = w["db"].get(TaskInspectionItem, w["item_id"])
    w["db"].refresh(item)
    assert item.needs_reinspection


def _assert_rollback(w, action, before, *, fault="audit"):
    import pytest
    from sqlalchemy import event
    from sqlalchemy.orm import Session

    event_type = {
        "patch": "evidence.photo_updated",
        "delete": "evidence.photo_deleted",
        "office": "evidence.layer_updated",
        "change": "project_inspection_item.updated",
        "restore": "inspection_task.restored",
    }[action]

    def at_flush(session, *_):
        if any(
            isinstance(row, AuditLog) and row.event_type == event_type
            for row in session.new
        ):
            if fault == "audit":
                raise RuntimeError("injected T5 audit failure")
            session.info["w794_commit_fault"] = True

    def at_commit(session):
        if session.info.pop("w794_commit_fault", False):
            raise RuntimeError("injected T5 commit failure")

    photo = next(p for p in before["photos"] if str(p[0]))
    url = f"/api/v1/inspection-tasks/{w['task']}/photos/{photo[0]}"
    event.listen(Session, "before_flush", at_flush)
    event.listen(Session, "before_commit", at_commit)
    try:
        with pytest.raises(RuntimeError, match="injected T5"):
            if action == "patch":
                w["field"].patch(url, json={"caption": "應回滾"})
            elif action == "delete":
                w["field"].delete(url)
            elif action == "office":
                w["admin"].put(
                    f"{url}/office-version",
                    json={"layer": dict(default_layer(), corner="top_right")},
                )
            elif action == "change":
                _change(w)
            else:
                w["admin"].post(
                    f"/api/v1/inspection-tasks/{w['task']}:restore"
                )
    finally:
        event.remove(Session, "before_flush", at_flush)
        event.remove(Session, "before_commit", at_commit)
    assert _state(w) == before


def test_audit_and_commit_failure_roll_back_metadata_events_and_files(
    read_world,
):
    """AC16／21／36：真正 flush／commit 失敗時稽核與影像一併回滾。"""
    w = read_world
    _add_photo(w)
    for action in ("patch", "delete", "office", "change"):
        for fault in ("audit", "commit"):
            _assert_rollback(w, action, _state(w), fault=fault)


def test_stable_points_text_reorder_and_deleted_point_invalidation(read_world):
    """AC17：真 PATCH 保留點位身分；選不要時鎖結構，選要則作廢。"""
    from uuid import uuid4

    from tests.api.test_evidence_upload import _jpeg, _upload

    w = read_world
    points = _source_points(w)
    extra = deepcopy(points[0])
    extra.pop("id")
    extra["sequence"] = 2
    extra["title"] = "第二項次"
    expanded = _change(w, inspection_points=points + [extra])
    assert expanded.status_code == 200, expanded.text
    points = _source_points(w)
    response = _upload(
        w, w["task"], w["item_id"], [p["id"] for p in points], _jpeg(), uuid4()
    )
    assert response.status_code == 201, response.text
    photo = response.json()
    _, field, url = _paths(w, photo)
    # AC14／21／29：真 PATCH 成功重設對應，只記對應差異，註記不變。
    selected = photo["point_ids"][0]
    changed = w["field"].patch(url, json={"point_ids": [selected]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["caption"] == photo["caption"]
    point_counts = {
        point["id"]: point["photo_count"]
        for item in w["field"].get(field + "/evidence").json()["items"]
        for point in item["points"]
    }
    assert point_counts[selected] == 1
    assert sum(point_counts.values()) == 1
    logs = _events(w, photo, "photo_updated")
    assert len(logs) == 1
    assert logs[0].before == {"point_ids": sorted(photo["point_ids"])}
    assert logs[0].after == {"point_ids": [selected]}
    restored = w["field"].patch(url, json={"point_ids": photo["point_ids"]})
    assert restored.status_code == 200, restored.text
    assert len(_events(w, photo, "photo_updated")) == 2
    coverage = w["field"].get(field + "/evidence").json()
    points.reverse()
    for sequence, point in enumerate(points, 1):
        point.update(sequence=sequence, title=f"更正文案 {sequence}")
    corrected = _change(w, reinspect=False, inspection_points=points)
    assert corrected.status_code == 200, corrected.text
    assert set(w["reader"].get(url).json()["point_ids"]) == set(
        photo["point_ids"]
    )
    # 只重排文字不影響每個穩定項次的實際覆蓋數。
    after = w["field"].get(field + "/evidence").json()

    def counts(body):
        return {
            point["id"]: (point["photo_count"], point["satisfied"])
            for item in body["items"]
            for point in item["points"]
        }

    assert counts(coverage) == counts(after)
    denied = _change(w, reinspect=False, inspection_points=points[:1])
    assert denied.status_code == 422
    assert (
        denied.json()["error"]["code"]
        == "project_inspection_item.structure_locked"
    )
    assert w["reader"].get(url).json()["voided_at"] is None
    changed = _change(w, inspection_points=points[:1])
    assert changed.status_code == 200, changed.text
    assert w["reader"].get(url).json()["void_reason"] == "STANDARD_CHANGED"


def test_maintenance_cli_records_system_actor_reason_and_rules(read_world):
    """AC21／31：真正 CLI 逐次重產，系統 admin、原因與規則同交易。"""
    import subprocess
    import sys

    from tests.db.conftest import make_system_admin

    w = read_world
    photo = _add_photo(w)
    make_system_admin(w["admin_user"])
    w["db"].commit()
    for _ in range(2):
        result = subprocess.run(
            [sys.executable, "-m", "app.cli.regenerate_office_versions"],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
    logs = _events(w, photo, "office_version_edited")
    assert len(logs) == 2
    for log in logs:
        assert log.created_by == w["admin_user"].id
        assert log.project_id == w["project"].id
        assert log.after["reason"] == "label_rule_change"
        assert log.after["rule"]["render_state"]
    assert _events(w, photo, "layer_updated") == []


def test_actual_layer_history_pagination_preserves_full_text_and_scope(
    read_world,
):
    """AC36：實際寫出的事件由非 Admin 分頁讀回，不接受跨照片 cursor。"""
    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    for value in ("甲" * 999, "乙" * 998):
        layer = default_layer()
        layer["overrides"] = {"project_name": value, "item_name": ""}
        result = w["admin"].put(f"{url}/office-version", json={"layer": layer})
        assert result.status_code == 200, result.text
    first = w["reader"].get(url, params={"layer_history_limit": 1})
    assert first.status_code == 200, first.text
    history = first.json()["layer_history"]
    assert len(history["items"]) == 1 and history["next_cursor"]
    latest = history["items"][0]
    assert latest["after"]["labels"]["project_name"] == "乙" * 998
    assert latest["after"]["labels"]["item_title"] == ""
    assert latest["after"]["labels"]["uploaded_at"].endswith("Z")
    second = w["reader"].get(
        url,
        params={
            "layer_history_limit": 1,
            "layer_history_cursor": history["next_cursor"],
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["layer_history"]["items"][0]["id"] != latest["id"]
    other = _add_photo(w)
    _, _, other_url = _paths(w, other)
    rejected = w["reader"].get(
        other_url,
        params={
            "layer_history_cursor": history["next_cursor"],
        },
    )
    assert rejected.status_code == 422
    assert w["outsider"].get(url).status_code == 403


@pytest.mark.parametrize("scope", ["module", "project"])
def test_streaming_patch_rechecks_revoked_permissions(read_world, scope):
    """FEV-R12：本文尚未送完時撤權，第二階段必須拒絕且不寫資料。"""
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    from sqlalchemy.orm import Session

    from app.models import (
        ProjectMember,
        ProjectMemberRole,
        UserModulePermission,
    )

    w = read_world
    photo = _add_photo(w, caption="撤權前")
    _, _, url = _paths(w, photo)
    user_id, project_id = w["field_user"].id, w["project"].id
    member_id = w["db"].scalar(
        select(ProjectMember.id).where(
            ProjectMember.user_id == user_id,
            ProjectMember.project_id == project_id,
        )
    )
    assert member_id is not None
    before = _state(w)
    w["db"].commit()
    ready, release = Event(), Event()

    def body():
        yield b'{"caption":'
        ready.set()
        assert release.wait(15), "PATCH body was not released"
        yield b'"revoked"}'

    try:
        with ThreadPoolExecutor(max_workers=1) as executor:
            request = executor.submit(
                w["field"].patch,
                url,
                content=body(),
                headers={"Content-Type": "application/json"},
            )
            assert ready.wait(10)
            with Session(w["engine"]) as other:
                if scope == "module":
                    rows = list(
                        other.scalars(
                            select(UserModulePermission).where(
                                UserModulePermission.user_id == user_id,
                                UserModulePermission.permission_code
                                == "inspection.use",
                            )
                        )
                    )
                else:
                    rows = list(
                        other.scalars(
                            select(ProjectMemberRole).where(
                                ProjectMemberRole.project_member_id
                                == member_id
                            )
                        )
                    )
                assert rows, "revocation must remove an existing grant"
                for row in rows:
                    other.delete(row)
                other.commit()
            release.set()
            response = request.result(20)
    finally:
        release.set()
    assert response.status_code == 403, (scope, response.text)
    assert response.json()["error"]["code"] == "permission.denied"
    assert _state(w) == before


def test_kd55_keeps_soft_deleted_photo_deleted_only(read_world):
    """依抽查意見與 IP-R04，已刪除照片不再改標標準變更作廢。"""
    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    assert w["field"].delete(url).status_code == 204
    result = _change(w)
    assert result.status_code == 200, result.text
    row = w["db"].get(Evidence, UUID(photo["id"]))
    w["db"].refresh(row)
    assert row.deleted_at is not None
    assert row.voided_at is None
    assert row.void_reason is None
    for response in (
        w["field"].delete(url),
        w["admin"].put(url + "/office-version", json={}),
    ):
        assert response.status_code == 409, response.text
        assert response.json()["error"]["code"] == "evidence.photo_locked"
        assert response.json()["error"]["details"] == ["deleted"]
