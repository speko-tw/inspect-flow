"""TPL-AC33～36、41、42：同一組真 API 驗收跑 SQLite／PostgreSQL。"""

import base64
import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event
from time import monotonic
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, select
from sqlalchemy.exc import OperationalError

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db import clock
from app.db.engine import get_engine
from app.main import create_app
from app.models import (
    AuditLog,
    Project,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionPoint,
    ProjectMeasurementField,
    ProjectMember,
    ProjectMemberRole,
    ProjectNumericStandard,
    ProjectTextStandard,
    Role,
    RolePermission,
    TemplateSuggestion,
    TemplateSuggestionReview,
    TemplateSuggestionRevision,
    TemplateSuggestionTransition,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services import template_suggestions as service
from tests.db.conftest import create_root_user_with_company
from tests.db.test_planning_api_postgresql import (
    _dispose_shared_engine as _dispose_shared_engine,
)
from tests.db.test_planning_api_postgresql import (
    db_session as db_session,
)
from tests.db.test_planning_api_postgresql import (
    engine as engine,
)
from tests.db.test_planning_api_postgresql import (
    make_client as make_client,
)
from tests.db.test_planning_api_postgresql import (
    migrated_url as migrated_url,
)


@pytest.fixture
def world(db_session, make_client):
    users = {
        name: create_root_user_with_company(db_session, f"SUG803-{name}")
        for name in (
            "admin",
            "editor",
            "peer",
            "manager",
            "delegate",
            "field",
            "reader",
            "outsider",
            "member",
        )
    }
    users["admin"].is_admin = True
    admin = users["admin"].id
    audit = {"created_by": admin, "updated_by": admin}
    project = Project(
        project_code="SUG803",
        name="提議來源工程",
        client_name="業主",
        site_location="工地",
        **audit,
    )
    other_project = Project(
        project_code="OTHER803",
        name="其他工程",
        client_name="業主",
        site_location="工地",
        **audit,
    )
    db_session.add_all([project, other_project])
    db_session.flush()
    roles = {}
    for name, code in (
        ("edit", "project_inspection_item.edit"),
        ("field", "inspection_task.inspect"),
        ("read", "project.read"),
    ):
        role = Role(name=f"SUG803-{name}", **audit)
        role.permission_codes.append(RolePermission(code=code))
        db_session.add(role)
        db_session.flush()
        roles[name] = role
    for name, role_name in (
        ("editor", "edit"),
        ("peer", "edit"),
        ("field", "field"),
        ("reader", "read"),
        ("member", None),
    ):
        member = ProjectMember(
            project_id=project.id, user_id=users[name].id, **audit
        )
        if role_name:
            member.role_assignments.append(
                ProjectMemberRole(role_id=roles[role_name].id)
            )
        db_session.add(member)
    for name in ("editor", "peer", "field", "reader", "outsider", "member"):
        db_session.add(
            UserModulePermission(
                user_id=users[name].id,
                permission_code="inspection.use",
                source="manual",
            )
        )
    db_session.add_all(
        [
            UserModulePermission(
                user_id=users["manager"].id,
                permission_code=code,
                source="manual",
            )
            for code in ("template.use", "template.manage")
        ]
    )
    db_session.add(
        UserModuleDelegation(user_id=users["delegate"].id, module="inspection")
    )
    item = ProjectInspectionItem(
        project_id=project.id,
        sequence=1,
        title="原始查核項目",
        instruction="原始說明",
        source_template_name="原範本",
        applied_at=clock.utc_now(),
        **audit,
    )
    other = ProjectInspectionItem(
        project_id=other_project.id,
        sequence=1,
        title="其他專案項目",
        instruction="不可跨案",
        source_template_name="原範本",
        applied_at=clock.utc_now(),
        **audit,
    )
    db_session.add_all([item, other])
    db_session.flush()
    points = []
    for sequence in (1, 2):
        point = ProjectInspectionPoint(
            project_inspection_item_id=item.id,
            sequence=sequence,
            title=f"項次{sequence}",
            instruction="項次說明",
            **audit,
        )
        db_session.add(point)
        db_session.flush()
        points.append(point)
        db_session.add(
            ProjectEvidenceRequirement(
                project_inspection_item_id=item.id,
                inspection_point_id=point.id,
                min_count=sequence,
                **audit,
            )
        )
    db_session.add(
        ProjectTextStandard(
            project_inspection_item_id=item.id,
            inspection_point_id=points[0].id,
            text="表面完整",
            **audit,
        )
    )
    field = ProjectMeasurementField(
        project_inspection_item_id=item.id,
        inspection_point_id=points[1].id,
        name="長度",
        field_type="number",
        unit="mm",
        sort_order=0,
        **audit,
    )
    db_session.add(field)
    db_session.flush()
    db_session.add(
        ProjectNumericStandard(
            project_inspection_item_id=item.id,
            inspection_point_id=points[1].id,
            value="12.5",
            condition=">=",
            unit="mm",
            measurement_field_id=field.id,
            measurement_field_type="number",
            measurement_field_unit="mm",
            **audit,
        )
    )
    tokens = {}
    session_ids = {}
    for name, user in users.items():
        auth_session, tokens[name] = create_session(db_session, user)
        session_ids[name] = auth_session.id
    auth_session, tokens["editor_second"] = create_session(
        db_session, users["editor"]
    )
    session_ids["editor_second"] = auth_session.id
    db_session.commit()
    clients = {"anonymous": make_client()}
    for name, token in tokens.items():
        client = make_client()
        client.cookies.set(SESSION_COOKIE_NAME, token)
        clients[name] = client
    return {
        "users": users,
        "clients": clients,
        "session_ids": session_ids,
        "project": project,
        "other_project": other_project,
        "item": item,
        "other_item": other,
        "points": points,
        "field": field,
    }


def _counts(db):
    return tuple(
        db.scalar(select(func.count()).select_from(model))
        for model in (
            TemplateSuggestion,
            TemplateSuggestionRevision,
            TemplateSuggestionReview,
            TemplateSuggestionTransition,
            AuditLog,
        )
    )


def _create(world, name="editor", *, status=201):
    response = world["clients"][name].post(
        f"/api/v1/projects/{world['project'].id}/template-suggestions",
        json={"project_inspection_item_id": str(world["item"].id)},
    )
    assert response.status_code == status, response.text
    return response.json()


def _expected(data):
    return {
        "expected_revision_id": data["current_revision_id"],
        "expected_status": data["status"],
    }


def _url(data, action=""):
    return f"/api/v1/template-suggestions/{data['id']}{action}"


def _returned(db, world, data, reason="\u3000 請補充依據\t"):
    """T17 尚未實作：以 T15 合法資料安排 RETURNED，不增設管理端點。"""
    db.expire_all()
    row = db.get(TemplateSuggestion, UUID(data["id"]))
    assert row is not None and row.status == "PENDING"
    admin = world["users"]["admin"].id
    review = TemplateSuggestionReview(
        suggestion_id=row.id,
        revision_id=row.current_revision_id,
        decision="RETURNED",
        reason=reason,
        created_by=admin,
        updated_by=admin,
    )
    db.add(review)
    db.flush()
    log = AuditLog(
        created_by=admin,
        actor_snapshot="管理者",
        project_id=row.source_project_original_id,
        entity_type="template_suggestion",
        entity_id=row.id,
        event_type="template_suggestion.returned",
        before={"status": "PENDING"},
        after={
            "status": "RETURNED",
            "review_id": str(review.id),
            "reviewed_revision_id": str(row.current_revision_id),
            "reviewer_id": str(admin),
            "reason": review.reason,
        },
    )
    db.add(log)
    db.flush()
    db.add(
        TemplateSuggestionTransition(
            suggestion_id=row.id,
            revision_id=row.current_revision_id,
            from_status="PENDING",
            to_status="RETURNED",
            review_id=review.id,
            audit_log_id=log.id,
            created_by=admin,
            updated_by=admin,
        )
    )
    row.status = "RETURNED"
    row.updated_by = admin
    db.commit()
    response = world["clients"]["editor"].get(_url(data))
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize(
    "name",
    [
        "admin",
        "editor",
        "manager",
        "delegate",
        "field",
        "reader",
        "outsider",
        "member",
    ],
)
@pytest.mark.parametrize("inspection_use", [False, True])
def test_ac33_permission_matrix_no_suggestion_or_audit(
    db_session, world, name, inspection_use
):
    user = world["users"][name]
    db_session.execute(
        delete(UserModulePermission).where(
            UserModulePermission.user_id == user.id,
            UserModulePermission.permission_code == "inspection.use",
        )
    )
    if inspection_use:
        db_session.add(
            UserModulePermission(
                user_id=user.id,
                permission_code="inspection.use",
                source="manual",
            )
        )
    db_session.commit()
    before = _counts(db_session)
    allowed = name == "admin" or name == "editor" and inspection_use
    result = _create(world, name, status=201 if allowed else 403)
    after = _counts(db_session)
    if not allowed:
        assert result["error"]["code"] == "permission.denied"
        assert after == before
    else:
        assert result["proposer_id"] == str(user.id)
        assert after == tuple(
            v + delta for v, delta in zip(before, (1, 1, 0, 1, 1), strict=True)
        )


@pytest.mark.parametrize("name", ["admin", "editor"])
def test_ac33_inactive_source_requires_restoration(db_session, world, name):
    world["item"].is_active = False
    db_session.commit()
    before = _counts(db_session)
    result = _create(world, name, status=409)
    assert result["error"]["code"] == "project_inspection_item.inactive"
    assert _counts(db_session) == before
    world["item"].is_active = True
    db_session.commit()
    _create(world, name)


def test_ac34_complete_snapshot_and_source_isolation(db_session, world):
    source_state = [(p.id, p.title, p.instruction) for p in world["points"]]
    result = _create(world)
    content = result["content"]
    assert content["title"] == world["item"].title
    assert len(content["inspection_points"]) == 2
    first, second = content["inspection_points"]
    assert first["text_standard"] == {"text": "表面完整"}
    assert second["numeric_standard"]["value"] == "12.5"
    assert second["measurement_fields"][0]["unit"] is None
    assert (
        second["numeric_standard"]["measurement_field_logical_id"]
        == second["measurement_fields"][0]["logical_id"]
    )
    assert [
        p["evidence_requirements"][0]["min_count"]
        for p in content["inspection_points"]
    ] == [1, 2]
    source_ids = {str(p.id) for p in world["points"]} | {
        str(world["field"].id)
    }
    assert not any(
        identifier in json.dumps(content) for identifier in source_ids
    )
    assert [
        (p.id, p.title, p.instruction) for p in world["points"]
    ] == source_state
    world["item"].title = "來源日後修改"
    world["points"][0].instruction = "來源新說明"
    db_session.commit()
    client = world["clients"]["editor"]
    assert client.get(_url(result)).json()["content"] == content
    removed = world["clients"]["admin"].delete(
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}"
    )
    assert removed.status_code == 204, removed.text
    preserved = client.get(_url(result)).json()
    assert preserved["content"] == content
    assert preserved["source_item_title"] == "原始查核項目"
    assert preserved["source_item_id"] == str(world["item"].id)


def test_ac34_cross_project_source_is_not_found(db_session, world):
    before = _counts(db_session)
    response = world["clients"]["editor"].post(
        f"/api/v1/projects/{world['project'].id}/template-suggestions",
        json={"project_inspection_item_id": str(world["other_item"].id)},
    )
    assert response.status_code == 404
    assert _counts(db_session) == before


def test_ac35_ac36_two_resubmissions_and_immutable_history(db_session, world):
    original = _create(world)
    data = original
    client = world["clients"]["editor"]
    for number in (2, 3):
        data = _returned(db_session, world, data)
        before = _counts(db_session)
        unchanged = client.post(_url(data, ":submit"), json=_expected(data))
        assert unchanged.status_code == 409
        assert unchanged.json()["error"]["code"] == (
            "template_suggestion.invalid_state"
        )
        noop = client.post(
            _url(data, "/revisions"),
            json={
                **_expected(data),
                "content": dict(reversed(list(data["content"].items()))),
            },
        )
        assert noop.status_code == 200, noop.text
        assert (
            noop.json()["current_revision_id"] == data["current_revision_id"]
        )
        assert _counts(db_session) == before
        content = deepcopy(data["content"])
        content["title"] = f"第{number}版"
        response = client.post(
            _url(data, "/revisions"),
            json={**_expected(data), "content": content},
        )
        assert response.status_code == 201, response.text
        data = response.json()
        assert data["status"] == "RETURNED" and data["revision_no"] == number
        response = client.post(_url(data, ":submit"), json=_expected(data))
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["status"] == "PENDING"
        assert data["id"] == original["id"]
    histories = []
    cursor = None
    for _ in range(3):
        params = {"limit": 1}
        if cursor:
            params["cursor"] = cursor
        response = client.get(_url(data, "/revisions"), params=params)
        assert response.status_code == 200, response.text
        histories.extend(response.json()["items"])
        cursor = response.json()["next_cursor"]
    assert cursor is None
    assert [r["revision_no"] for r in histories] == [1, 2, 3]
    assert histories[0]["content"] == original["content"]
    assert histories[0]["reviews"][0]["reason"] == "請補充依據"
    assert histories[0]["reviews"][0]["reviewer_id"] == str(
        world["users"]["admin"].id
    )
    assert [r["status"] for r in histories] == [
        "RETURNED",
        "RETURNED",
        "PENDING",
    ]
    logical = original["content"]["inspection_points"]
    assert all(r["content"]["inspection_points"] == logical for r in histories)
    assert client.put(
        _url(data, "/revisions/" + histories[0]["id"]), json={"content": {}}
    ).status_code in (404, 405)
    assert (
        client.patch(_url(data), json={"status": "APPROVED"}).status_code
        == 405
    )
    withdrawn = client.post(_url(data, ":withdraw"), json=_expected(data))
    assert withdrawn.status_code == 200, withdrawn.text
    terminal = withdrawn.json()
    before = _counts(db_session)
    for action in (":submit", ":withdraw", "/revisions"):
        body = _expected(terminal)
        if action == "/revisions":
            body["content"] = terminal["content"]
        response = client.post(_url(data, action), json=body)
        assert response.status_code == 409, response.text
    assert _counts(db_session) == before


def test_ac35_incomplete_draft_cannot_submit(db_session, world):
    data = _returned(db_session, world, _create(world))
    client = world["clients"]["editor"]
    response = client.post(
        _url(data, "/revisions"),
        json={**_expected(data), "content": {"title": ""}},
    )
    assert response.status_code == 201, response.text
    data = response.json()
    before = _counts(db_session)
    response = client.post(_url(data, ":submit"), json=_expected(data))
    assert response.status_code == 422, response.text
    assert response.json()["error"]["fields"]
    assert _counts(db_session) == before


@pytest.mark.parametrize("loss", ["module", "membership", "project"])
def test_ac41_history_and_withdraw_survive_permission_loss(
    db_session, world, loss
):
    data = _returned(db_session, world, _create(world))
    if loss == "module":
        db_session.execute(
            delete(UserModulePermission).where(
                UserModulePermission.user_id == world["users"]["editor"].id,
                UserModulePermission.permission_code == "inspection.use",
            )
        )
    elif loss == "membership":
        db_session.execute(
            delete(ProjectMember).where(
                ProjectMember.user_id == world["users"]["editor"].id
            )
        )
    else:
        # DOM-R25：專案成員並不隨專案 cascade，先依既有外鍵規則移除。
        db_session.execute(
            delete(ProjectMember).where(
                ProjectMember.project_id == world["project"].id
            )
        )
        db_session.delete(world["project"])
    db_session.commit()
    client = world["clients"]["editor"]
    for path in (
        _url(data),
        _url(data, "/revisions"),
        "/api/v1/me/template-suggestions",
    ):
        assert client.get(path).status_code == 200
    before = _counts(db_session)
    for action in ("/revisions", ":submit"):
        body = _expected(data)
        if action == "/revisions":
            body["content"] = data["content"]
        response = client.post(_url(data, action), json=body)
        assert response.status_code == 403, response.text
    assert _counts(db_session) == before
    response = client.post(_url(data, ":withdraw"), json=_expected(data))
    assert response.status_code == 200, response.text


def test_ac41_existing_suggestion_does_not_recheck_inactive_source(
    db_session, world
):
    data = _returned(db_session, world, _create(world))
    world["item"].is_active = False
    db_session.commit()
    content = deepcopy(data["content"])
    content["instruction"] = "依保存的內容修訂"
    response = world["clients"]["editor"].post(
        _url(data, "/revisions"), json={**_expected(data), "content": content}
    )
    assert response.status_code == 201, response.text
    data = response.json()
    response = world["clients"]["editor"].post(
        _url(data, ":submit"), json=_expected(data)
    )
    assert response.status_code == 200, response.text


def test_ac41_other_owners_and_foreign_revision_are_isolated(
    db_session, world
):
    data = _returned(db_session, world, _create(world))
    peer = _create(world, "peer")
    before = _counts(db_session)
    client = world["clients"]["editor"]
    for suffix in ("", "/revisions"):
        assert client.get(_url(peer, suffix)).status_code == 404
    for suffix in (":withdraw", ":submit", "/revisions"):
        body = _expected(peer)
        if suffix == "/revisions":
            body["content"] = data["content"]
        assert client.post(_url(peer, suffix), json=body).status_code == 404
    forged = {
        **_expected(data),
        "expected_revision_id": peer["current_revision_id"],
    }
    response = client.post(_url(data, ":withdraw"), json=forged)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "template_suggestion.changed"
    assert _counts(db_session) == before


@pytest.mark.parametrize("field", ["proposer_id", "reviewer_id", "status"])
def test_ac41_reject_forged_identity_or_status(db_session, world, field):
    before = _counts(db_session)
    response = world["clients"]["editor"].post(
        f"/api/v1/projects/{world['project'].id}/template-suggestions",
        json={
            "project_inspection_item_id": str(world["item"].id),
            field: str(world["users"]["peer"].id),
        },
    )
    assert response.status_code == 422
    assert _counts(db_session) == before


def test_list_mine_filters_counts_and_descending_cursor(db_session, world):
    first, second, third = [_create(world) for _ in range(3)]
    _create(world, "peer")
    client = world["clients"]["editor"]
    response = client.post(_url(second, ":withdraw"), json=_expected(second))
    assert response.status_code == 200
    ids, cursor = [], None
    for _ in range(3):
        params = {"limit": 1}
        if cursor:
            params["cursor"] = cursor
        response = client.get("/api/v1/me/template-suggestions", params=params)
        assert response.status_code == 200, response.text
        page = response.json()
        assert page["total_count"] == 3
        ids.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
    assert cursor is None and ids == [third["id"], second["id"], first["id"]]
    filtered = client.get(
        "/api/v1/me/template-suggestions",
        params={
            "status": "PENDING",
            "source_project_id": str(world["project"].id),
        },
    )
    assert filtered.json()["total_count"] == 2
    empty = client.get(
        "/api/v1/me/template-suggestions",
        params={"source_project_id": str(world["other_project"].id)},
    )
    assert empty.json()["total_count"] == 0
    assert (
        world["clients"]["admin"]
        .get("/api/v1/me/template-suggestions")
        .json()["total_count"]
        == 0
    )


def test_ac42_audit_shapes_and_no_full_content(db_session, world):
    data = _create(world)
    first_id = data["current_revision_id"]
    data = _returned(db_session, world, data)
    content = deepcopy(data["content"])
    content["title"] = "修訂名稱"
    client = world["clients"]["editor"]
    response = client.post(
        _url(data, "/revisions"), json={**_expected(data), "content": content}
    )
    assert response.status_code == 201, response.text
    data = response.json()
    data = client.post(_url(data, ":submit"), json=_expected(data)).json()
    client.post(_url(data, ":withdraw"), json=_expected(data))
    logs = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.entity_id == UUID(data["id"]))
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()
    owner_logs = [
        log for log in logs if log.event_type != "template_suggestion.returned"
    ]
    assert [log.event_type for log in owner_logs] == [
        "template_suggestion.submitted",
        "template_suggestion.revised",
        "template_suggestion.submitted",
        "template_suggestion.withdrawn",
    ]
    assert owner_logs[0].before is None
    assert set(owner_logs[0].after) == {
        "proposer_id",
        "source_project_id",
        "source_item_id",
        "revision_id",
        "content_sha256",
        "status",
    }
    assert owner_logs[1].before["revision_id"] == first_id
    assert set(owner_logs[1].after) == {"revision_id", "content_sha256"}
    assert owner_logs[2].before == {"status": "RETURNED"}
    assert owner_logs[2].after == {"status": "PENDING"}
    assert owner_logs[3].after == {"status": "WITHDRAWN"}
    assert all(log.project_id == world["project"].id for log in logs)
    assert all(
        log.created_by == world["users"]["editor"].id for log in owner_logs
    )
    assert "inspection_points" not in json.dumps([log.after for log in logs])
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(TemplateSuggestionTransition)
            .where(
                TemplateSuggestionTransition.audit_log_id == owner_logs[2].id
            )
        )
        == 1
    )


@pytest.mark.parametrize("action", ["create", "revise", "submit", "withdraw"])
def test_ac42_audit_failure_rolls_back_entire_action(
    db_session, world, monkeypatch, action
):
    data = None
    if action != "create":
        data = _create(world)
        if action in ("revise", "submit"):
            data = _returned(db_session, world, data)
        if action == "submit":
            content = deepcopy(data["content"])
            content["title"] = "新修訂"
            response = world["clients"]["editor"].post(
                _url(data, "/revisions"),
                json={**_expected(data), "content": content},
            )
            assert response.status_code == 201, response.text
            data = response.json()
    before = _counts(db_session)
    original = service.record_audit_event

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("injected audit failure")

    monkeypatch.setattr(service, "record_audit_event", fail_after_write)
    client = TestClient(
        create_app(),
        base_url="https://testserver",
        raise_server_exceptions=False,
    )
    client.cookies.update(world["clients"]["editor"].cookies)
    if action == "create":
        url = f"/api/v1/projects/{world['project'].id}/template-suggestions"
        body = {"project_inspection_item_id": str(world["item"].id)}
    else:
        assert data is not None
        url = _url(data, "/revisions" if action == "revise" else ":" + action)
        body = _expected(data)
        if action == "revise":
            body["content"] = {**data["content"], "title": "應回滾修訂"}
    response = client.post(url, json=body)
    assert response.status_code == 500, response.text
    db_session.expire_all()
    assert _counts(db_session) == before
    if data:
        after = world["clients"]["editor"].get(_url(data)).json()
        assert after["status"] == data["status"]
        assert after["current_revision_id"] == data["current_revision_id"]
        assert after["content"] == data["content"]


def test_login_and_request_boundaries(db_session, world):
    data = _create(world)
    anonymous = world["clients"]["anonymous"]
    requests = [
        (
            "post",
            f"/api/v1/projects/{world['project'].id}/template-suggestions",
            {"project_inspection_item_id": str(world["item"].id)},
        ),
        ("get", "/api/v1/me/template-suggestions", None),
        ("get", _url(data), None),
        ("get", _url(data, "/revisions"), None),
        (
            "post",
            _url(data, "/revisions"),
            {**_expected(data), "content": data["content"]},
        ),
        ("post", _url(data, ":submit"), _expected(data)),
        ("post", _url(data, ":withdraw"), _expected(data)),
    ]
    before = _counts(db_session)
    for method, url, body in requests:
        response = anonymous.request(method, url, json=body)
        assert response.status_code == 401, response.text
    assert _counts(db_session) == before
    client = world["clients"]["editor"]
    for params in (
        {"limit": 101},
        {"limit": 0},
        {"status": "UNKNOWN"},
        {"cursor": "not-a-cursor"},
    ):
        assert (
            client.get(
                "/api/v1/me/template-suggestions", params=params
            ).status_code
            == 422
        )
    bad_cursor = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "suggestion_id": data["id"],
                    "n": 1,
                    "id": 123,
                }
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    assert (
        client.get(
            _url(data, "/revisions"), params={"cursor": bad_cursor}
        ).status_code
        == 422
    )


def _interleave_requests(
    engine,
    world,
    first,
    second,
    *,
    holder_after,
    waiter_before,
    waiter_session,
):
    """以 SQL 事件與實際鎖狀態交錯，不用 sleep 猜測請求先後。"""
    shared = get_engine()
    entered, attempted, release = Event(), Event(), Event()
    holder = {}
    waiter = {}

    def before(connection, cursor, statement, parameters, context, many):
        if not entered.is_set() or connection is holder.get("connection"):
            return
        if shared.dialect.name == "postgresql":
            match = waiter_before(statement)
            if match:
                waiter["pid"] = connection.exec_driver_sql(
                    "SELECT pg_backend_pid()"
                ).scalar_one()
        else:
            # SQLite HTTP 驗證會先更新獨立的登入列，該寫入即受全域鎖保護。
            session_id = world["session_ids"][waiter_session].hex
            match = (
                statement.startswith("UPDATE auth_sessions")
                and session_id in repr(parameters).replace("-", "")
            ) or statement == "BEGIN IMMEDIATE"
        if match:
            attempted.set()

    def after(connection, cursor, statement, parameters, context, many):
        if entered.is_set() or not holder_after(statement):
            return
        holder["connection"] = connection
        if shared.dialect.name == "postgresql":
            holder["pid"] = connection.exec_driver_sql(
                "SELECT pg_backend_pid()"
            ).scalar_one()
        entered.set()
        assert release.wait(10), "controller did not release the holder"

    event.listen(shared, "before_cursor_execute", before)
    event.listen(shared, "after_cursor_execute", after)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            winner = pool.submit(first)
            try:
                assert entered.wait(10), (
                    "holder never entered critical section"
                )
                loser = pool.submit(second)
                assert attempted.wait(10), "waiter did not attempt its write"
                if shared.dialect.name == "postgresql":
                    # 以實際阻擋者確認來源／主件鎖，而非請求排序巧合。
                    deadline = monotonic() + 10
                    with engine.connect() as observer:
                        while True:
                            blockers = observer.scalar(
                                select(func.pg_blocking_pids(waiter["pid"]))
                            )
                            if holder["pid"] in blockers:
                                break
                            assert not loser.done(), (
                                "request bypassed the lock"
                            )
                            assert monotonic() < deadline, "no lock contention"
                else:
                    # db-dependency: sqlite；立即失敗的探針證明全域寫鎖已取得。
                    with engine.connect() as observer:
                        observer.exec_driver_sql("PRAGMA busy_timeout=0")
                        with pytest.raises(OperationalError, match="locked"):
                            observer.exec_driver_sql("BEGIN IMMEDIATE")
                release.set()
                return winner.result(10), loser.result(10)
            finally:
                release.set()
    finally:
        event.remove(shared, "before_cursor_execute", before)
        event.remove(shared, "after_cursor_execute", after)


@pytest.mark.parametrize("copy_first", [True, False])
def test_ac34_copy_delete_fixed_interleaving(
    engine, db_session, world, copy_first
):
    """TPL-AC34：複製先到完整保存；刪除先到 404，沒有空件或成功稽核。"""
    item_id = world["item"].id
    create_url = f"/api/v1/projects/{world['project'].id}/template-suggestions"
    delete_url = (
        f"/api/v1/projects/{world['project'].id}/inspection-items/"
        f"{world['item'].id}"
    )

    def copy():
        return world["clients"]["editor"].post(
            create_url,
            json={"project_inspection_item_id": str(item_id)},
        )

    def remove():
        return world["clients"]["admin"].delete(delete_url)

    def source_select(sql):
        return (
            sql.startswith("SELECT") and "FROM project_inspection_items" in sql
        )

    def source_delete(sql):
        return sql.startswith("DELETE FROM project_inspection_items")

    if copy_first:
        copied, removed = _interleave_requests(
            engine,
            world,
            copy,
            remove,
            holder_after=source_select,
            waiter_before=source_select,
            waiter_session="admin",
        )
        assert copied.status_code == 201, copied.text
        assert len(copied.json()["content"]["inspection_points"]) == 2
        assert removed.status_code == 204, removed.text
        preserved = world["clients"]["editor"].get(_url(copied.json()))
        assert preserved.json()["content"] == copied.json()["content"]
        assert _counts(db_session)[:2] == (1, 1)
    else:
        removed, copied = _interleave_requests(
            engine,
            world,
            remove,
            copy,
            holder_after=source_delete,
            waiter_before=source_select,
            waiter_session="editor",
        )
        assert removed.status_code == 204, removed.text
        assert copied.status_code == 404, copied.text
        assert _counts(db_session)[:4] == (0, 0, 0, 0)
        assert (
            db_session.scalar(
                select(func.count())
                .select_from(AuditLog)
                .where(AuditLog.event_type.like("template_suggestion.%"))
            )
            == 0
        )
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item_id) is None


@pytest.mark.parametrize("revision_first", [True, False])
def test_expected_writes_serialize_with_independent_login_sessions(
    engine, db_session, world, revision_first
):
    """TPL-R31：兩份登入列避免登入列鎖掩蓋主件鎖，過期動作只能 409。"""
    data = _returned(db_session, world, _create(world))
    before = _counts(db_session)

    def revise():
        return world["clients"]["editor"].post(
            _url(data, "/revisions"),
            json={
                **_expected(data),
                "content": {**data["content"], "title": "競爭修訂"},
            },
        )

    def withdraw():
        return world["clients"]["editor_second"].post(
            _url(data, ":withdraw"), json=_expected(data)
        )

    def match(sql):
        return sql.startswith("SELECT") and "FROM template_suggestions" in sql

    first, second = (
        (revise, withdraw) if revision_first else (withdraw, revise)
    )
    winner, loser = _interleave_requests(
        engine,
        world,
        first,
        second,
        holder_after=match,
        waiter_before=match,
        waiter_session="editor_second" if revision_first else "editor",
    )
    assert winner.status_code == (201 if revision_first else 200), winner.text
    assert loser.status_code == 409, loser.text
    assert loser.json()["error"]["code"] == "template_suggestion.changed"
    after = _counts(db_session)
    expected_delta = (0, 1, 0, 0, 1) if revision_first else (0, 0, 0, 1, 1)
    assert after == tuple(
        v + d for v, d in zip(before, expected_delta, strict=True)
    )


def test_ac34_task_and_photo_metadata_are_not_copied_or_changed(
    db_session, world
):
    """TPL-R30：真 Task／照片留在現場側，提議只讀來源結構。"""
    from app.models import (
        InspectionPlan,
        InspectionTask,
        TaskInspectionItem,
        TaskRequirementSnapshot,
        TaskSnapshotPoint,
    )
    from tests.db.test_evidence import _photo

    actor = world["users"]["admin"]
    audit = {"created_by": actor.id, "updated_by": actor.id}
    plan = InspectionPlan(
        project_id=world["project"].id, name="現場計畫", **audit
    )
    db_session.add(plan)
    db_session.flush()
    task = InspectionTask(
        project_id=world["project"].id,
        plan_id=plan.id,
        name="現場任務",
        **audit,
    )
    db_session.add(task)
    db_session.flush()
    item = TaskInspectionItem(
        project_id=world["project"].id,
        task_id=task.id,
        project_inspection_item_id=world["item"].id,
        **audit,
    )
    db_session.add(item)
    db_session.flush()
    snapshot = TaskRequirementSnapshot(
        task_inspection_item_id=item.id,
        revision=1,
        source_standard_revision=1,
        title="現場既有快照",
        instruction="任務說明",
        source_template_name="範本",
        **audit,
    )
    db_session.add(snapshot)
    db_session.flush()
    point = TaskSnapshotPoint(
        snapshot_id=snapshot.id,
        source_point_id=world["points"][0].id,
        sequence=1,
        title="現場項次",
        instruction="現場說明",
        **audit,
    )
    db_session.add(point)
    db_session.flush()
    photo = _photo(
        (
            db_session,
            actor,
            world["project"],
            plan,
            task,
            item,
            snapshot,
            point,
        ),
        caption="現場照片備註99.9",
    )
    photo_id, task_id, snapshot_id = photo.id, task.id, snapshot.id
    caption, label, fingerprint = (
        photo.caption,
        deepcopy(photo.label_source),
        (photo.request_fingerprint),
    )
    db_session.commit()
    statements = []

    def collect(connection, cursor, statement, parameters, context, many):
        statements.append(statement)

    shared = get_engine()
    event.listen(shared, "before_cursor_execute", collect)
    try:
        data = _create(world)
    finally:
        event.remove(shared, "before_cursor_execute", collect)
    content = json.dumps(data["content"], ensure_ascii=False)
    assert all(
        str(identifier) not in content
        for identifier in (photo_id, task_id, snapshot_id)
    )
    assert caption is not None and caption not in content
    assert not any(
        "FROM evidence" in sql or "FROM task_" in sql for sql in statements
    )
    db_session.expire_all()
    assert photo.caption == caption and photo.label_source == label
    assert photo.request_fingerprint == fingerprint
    assert snapshot.title == "現場既有快照" and task.name == "現場任務"
    assert (
        db_session.scalar(
            select(func.count())
            .select_from(TaskInspectionItem)
            .where(
                TaskInspectionItem.project_inspection_item_id
                == world["item"].id
            )
        )
        == 1
    )


@pytest.mark.parametrize("number", [2**100, 2**31, 0, -1, True, "1"])
def test_revision_cursor_rejects_invalid_or_unrepresentable_numbers(
    db_session, world, number
):
    """TPL-R32：外部游標不能讓版本比較溢位或以錯誤型別查詢 DB。"""
    data = _create(world)
    cursor = (
        base64.urlsafe_b64encode(
            json.dumps(
                {
                    "suggestion_id": data["id"],
                    "n": number,
                    "id": data["current_revision_id"],
                },
                separators=(",", ":"),
            ).encode()
        )
        .decode()
        .rstrip("=")
    )
    before = _counts(db_session)
    response = world["clients"]["editor"].get(
        _url(data, "/revisions"), params={"cursor": cursor}
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "request.validation_failed"
    assert "fields" not in response.json()["error"]
    assert _counts(db_session) == before
