"""TPL-AC36～43：管理審核真 API／SQLite 與 PostgreSQL 共用驗收。"""

from copy import deepcopy
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.db.base import uuid7
from app.models import (
    AuditLog,
    TemplateCategory,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateSuggestion,
    TemplateSystem,
    UserModuleDelegation,
    UserModulePermission,
)
from app.services import template_suggestions as service
from app.services.permissions import calculate_effective_access
from tests.db.test_template_suggestion_api import (
    _counts,
    _create,
    _expected,
    _interleave_requests,
    _url,
)
from tests.db.test_template_suggestion_api import (
    _dispose_shared_engine as _dispose_shared_engine,
)
from tests.db.test_template_suggestion_api import (
    db_session as db_session,
)
from tests.db.test_template_suggestion_api import (
    engine as engine,
)
from tests.db.test_template_suggestion_api import (
    make_client as make_client,
)
from tests.db.test_template_suggestion_api import (
    migrated_url as migrated_url,
)
from tests.db.test_template_suggestion_api import (
    world as world,
)


@pytest.fixture
def review_world(db_session, world):
    """管理者無來源成員資格，第二審核者沿既有 Admin 身分測競爭。"""
    actor = world["users"]["admin"].id
    audit = {"created_by": actor, "updated_by": actor}
    category = TemplateCategory(name="核准工程類別", **audit)
    other = TemplateCategory(name="其他類別", **audit)
    db_session.add_all([category, other])
    db_session.flush()
    system = TemplateSystem(category_id=category.id, name="核准系統", **audit)
    empty = TemplateSystem(category_id=category.id, name="空系統", **audit)
    db_session.add_all([system, empty])
    db_session.add(
        UserModulePermission(
            user_id=world["users"]["reader"].id,
            permission_code="template.use",
            source="manual",
        )
    )
    db_session.add(
        UserModuleDelegation(
            user_id=world["users"]["delegate"].id,
            module="template",
        )
    )
    db_session.commit()
    return world | {
        "category": category,
        "system": system,
        "empty": empty,
        "other_category": other,
    }


def _destination(world):
    return {
        "category_id": str(world["category"].id),
        "system_id": str(world["system"].id),
    }


def _approve(world, data, client="manager", **destination):
    return world["clients"][client].post(
        _url(data, ":approve"),
        json={
            **_expected(data),
            **_destination(world),
            **destination,
        },
    )


def _revise(world, data, content, client="manager"):
    return world["clients"][client].post(
        _url(data, "/revisions"),
        json={
            **_expected(data),
            "content": content,
        },
    )


def _return(world, data, reason="請修正"):
    return world["clients"]["manager"].post(
        _url(data, ":return"),
        json={
            **_expected(data),
            "reason": reason,
        },
    )


def _compare(world, data, first, second, client="manager"):
    return world["clients"][client].get(
        _url(data, "/revisions:compare"),
        params={"from_revision_id": first, "to_revision_id": second},
    )


def _template_count(db):
    return db.scalar(select(func.count()).select_from(TemplateItem))


def _assert_materialized_snapshot(template, content):
    # TPL-R33：實體 UUID 重新配置，但每個結構欄位與受審快照一致。
    assert template["title"] == content["title"].strip()
    assert template["instruction"] == content["instruction"]
    assert len(template["inspection_points"]) == len(
        content["inspection_points"]
    )
    for actual, expected in zip(
        template["inspection_points"],
        content["inspection_points"],
        strict=True,
    ):
        assert actual["id"] != expected["logical_id"]
        for key in ("sequence", "title", "instruction", "text_standard"):
            assert actual[key] == expected[key]
        assert len(actual["measurement_fields"]) == len(
            expected["measurement_fields"]
        )
        identifiers = {}
        for a, b in zip(
            actual["measurement_fields"],
            expected["measurement_fields"],
            strict=True,
        ):
            assert a["id"] != b["logical_id"]
            identifiers[a["id"]] = b["logical_id"]
            assert a["name"] == b["name"]
            assert a["field_type"] == b["field_type"]
            numeric = expected["numeric_standard"]
            unit = (
                numeric["unit"]
                if numeric
                and numeric["measurement_field_logical_id"] == b["logical_id"]
                else b["unit"]
            )
            assert a["unit"] == unit
        numeric = actual["numeric_standard"]
        if numeric is not None:
            numeric = deepcopy(numeric)
            numeric["measurement_field_logical_id"] = identifiers[
                numeric.pop("measurement_field_id")
            ]
        assert numeric == expected["numeric_standard"]
        assert [
            {k: v for k, v in r.items() if k != "id"}
            for r in actual["evidence_requirements"]
        ] == expected["evidence_requirements"]


def test_ac36_three_versions_review_compare_and_approval(
    db_session, review_world
):
    w = review_world
    first = _create(w)
    old_content = deepcopy(first["content"])
    returned = _return(w, first, "\t補正原因\r\n\u3000")
    assert returned.status_code == 200, returned.text
    returned = returned.json()
    assert returned["return_reason"] == "補正原因"
    content = deepcopy(first["content"])
    content["title"] = "第 2 版範本"
    content["inspection_points"][0]["title"] = "第 2 版項次"
    second = _revise(w, returned, content, "editor")
    assert second.status_code == 201, second.text
    second = second.json()
    sent = w["clients"]["editor"].post(
        _url(second, ":submit"), json=_expected(second)
    )
    assert sent.status_code == 200, sent.text
    second = sent.json()
    content = deepcopy(second["content"])
    content["title"] = "第 3 版核准範本"
    content["inspection_points"][0]["instruction"] = "管理者補充"
    third = _revise(w, second, content)
    assert third.status_code == 201, third.text
    third = third.json()
    no_op = _revise(w, third, third["content"])
    assert no_op.status_code == 200
    assert no_op.json()["current_revision_id"] == third["current_revision_id"]
    for a, b in ((first, second), (second, third)):
        compared = _compare(
            w, third, a["current_revision_id"], b["current_revision_id"]
        )
        assert compared.status_code == 200, compared.text
        assert compared.json()["from_revision"]["content"] == a["content"]
        assert compared.json()["to_revision"]["content"] == b["content"]
        assert compared.json()["changes"]
    assert (
        _compare(
            w,
            third,
            first["current_revision_id"],
            third["current_revision_id"],
        ).status_code
        == 422
    )
    approved = _approve(w, third)
    assert approved.status_code == 200, approved.text
    approved = approved.json()
    template = (
        w["clients"]["manager"]
        .get("/api/v1/templates/" + approved["template_id"])
        .json()
    )
    _assert_materialized_snapshot(template, third["content"])
    assert approved["reviewed_revision_id"] == third["current_revision_id"]
    assert approved["approval"]["revision_id"] == third["current_revision_id"]
    assert approved["approval"]["reviewer_id"] == str(w["users"]["manager"].id)
    for who in ("editor", "manager"):
        history = w["clients"][who].get(
            _url(first, "/revisions"), params={"limit": 2}
        )
        assert history.status_code == 200
        body = history.json()
        assert len(body["items"]) == 2 and body["next_cursor"]
        tail = (
            w["clients"][who]
            .get(
                _url(first, "/revisions"),
                params={"cursor": body["next_cursor"]},
            )
            .json()["items"]
        )
        revisions = body["items"] + tail
        assert [r["revision_no"] for r in revisions] == [1, 2, 3]
        assert revisions[0]["content"] == old_content
        assert revisions[1]["content"] == second["content"]
        assert revisions[2]["content"] == third["content"]
        assert revisions[0]["reviews"][0]["reason"] == "補正原因"
        assert revisions[2]["status"] == "APPROVED"
        assert [r["editor_id"] for r in revisions] == [
            str(w["users"][n].id) for n in ("editor", "editor", "manager")
        ]
        assert all(r["created_at"] for r in revisions)
    for suffix in (":return", ":approve", "/revisions", ":withdraw"):
        if suffix == ":return":
            response = _return(w, approved)
        elif suffix == ":approve":
            response = _approve(w, approved)
        elif suffix == "/revisions":
            response = _revise(w, approved, content)
        else:
            response = w["clients"]["editor"].post(
                _url(approved, suffix), json=_expected(approved)
            )
        assert response.status_code == 409
    assert _template_count(db_session) == 1


@pytest.mark.parametrize(
    "reason,accepted",
    [
        ("", False),
        ("\t\n\r\u3000", False),
        ("x" * 1001, False),
        ("\t\n\r\u3000" + "x" * 1000 + "\t\u3000", True),
        ("\t" + "x" * 1001 + "\n", False),
    ],
)
def test_ac37_reason_uses_model_whitespace(
    db_session, review_world, reason, accepted
):
    w = review_world
    data = _create(w)
    before = _counts(db_session)
    response = _return(w, data, reason)
    if accepted:
        assert response.status_code == 200, response.text
        assert response.json()["return_reason"] == "x" * 1000
    else:
        assert response.status_code == 422, response.text
        assert response.json()["error"]["fields"][0]["path"] == "/reason"
        assert _counts(db_session) == before
        db_session.expire_all()
        assert (
            db_session.get(TemplateSuggestion, UUID(data["id"])).status
            == "PENDING"
        )


@pytest.mark.parametrize("name", ["reader", "delegate", "editor", "anonymous"])
def test_ac37_permission_matrix_no_review_side_effects(
    db_session, review_world, name
):
    w = review_world
    data = _create(w)
    before = _counts(db_session)
    client = w["clients"][name]
    code = 401 if name == "anonymous" else 403
    for path in (
        "/api/v1/template-suggestions",
        "/api/v1/template-suggestions:pending-count",
    ):
        assert client.get(path).status_code == code
    assert _approve(w, data, name).status_code == code
    assert (
        client.post(
            _url(data, ":return"), json={**_expected(data), "reason": "原因"}
        ).status_code
        == code
    )
    assert (
        _compare(
            w,
            data,
            data["current_revision_id"],
            data["current_revision_id"],
            name,
        ).status_code
        == code
    )
    assert _counts(db_session) == before
    assert _template_count(db_session) == 0
    if name != "anonymous" and name != "editor":
        for suffix in ("", "/revisions"):
            assert client.get(_url(data, suffix)).status_code == 404
        assert _revise(w, data, data["content"], name).status_code == 404


def test_ac37_manager_has_no_source_write_or_withdraw_access(
    db_session, review_world
):
    w = review_world
    data = _create(w)
    access = calculate_effective_access(
        db_session,
        user_id=w["users"]["manager"].id,
        project_id=w["project"].id,
    )
    assert "template.manage" in access.module_permissions
    assert w["project"].id not in access.project_memberships
    assert not access.project_permissions
    manager = w["clients"]["manager"]
    assert manager.get(_url(data)).status_code == 200
    assert manager.get(_url(data, "/revisions")).status_code == 200
    assert (
        manager.post(_url(data, ":withdraw"), json=_expected(data)).status_code
        == 404
    )
    assert (
        manager.post(_url(data, ":submit"), json=_expected(data)).status_code
        == 404
    )
    project_item = (
        f"/api/v1/projects/{w['project'].id}/inspection-items/{w['item'].id}"
    )
    assert (
        manager.patch(project_item, json={"title": "不可改來源"}).status_code
        == 403
    )
    assert manager.delete(project_item).status_code == 403
    incomplete = _revise(w, data, {"title": "不完整"})
    assert incomplete.status_code == 422


@pytest.mark.parametrize(
    "target,code", [("category", 404), ("system", 404), ("mismatch", 422)]
)
def test_ac38_destination_errors_are_atomic(
    db_session, review_world, target, code
):
    w = review_world
    data = _create(w)
    before = _counts(db_session)
    destination = _destination(w)
    destination[
        {
            "category": "category_id",
            "system": "system_id",
            "mismatch": "category_id",
        }[target]
    ] = str(w["other_category"].id if target == "mismatch" else uuid7())
    response = _approve(w, data, **destination)
    assert response.status_code == code, response.text
    assert _counts(db_session) == before
    assert _template_count(db_session) == 0


def test_ac38_normalized_conflict_numbering_and_snapshot_isolation(
    db_session, review_world
):
    w = review_world
    data = _create(w)
    manager = w["clients"]["manager"]
    renamed = _revise(w, data, {**data["content"], "title": " Straße "})
    assert renamed.status_code == 201, renamed.text
    data = renamed.json()
    actor = w["users"]["admin"].id
    existing = TemplateItem(
        system_id=w["system"].id,
        sequence=17,
        title="STRASSE",
        instruction="既有",
        created_by=actor,
        updated_by=actor,
    )
    db_session.add(existing)
    db_session.commit()
    before = _counts(db_session)
    conflict = _approve(w, data)
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["error"]["code"] == "template.name_conflict"
    assert _counts(db_session) == before
    assert _template_count(db_session) == 1
    data = _revise(
        w, data, {**data["content"], "title": " 新的核准項目 "}
    ).json()
    approved = _approve(w, data)
    assert approved.status_code == 200, approved.text
    approved = approved.json()
    template_id = approved["template_id"]
    template_url = "/api/v1/templates/" + template_id
    template = manager.get(template_url).json()
    assert template["title"] == "新的核准項目"
    assert template["sequence"] == 18
    assert len(template["inspection_points"]) == 2
    saved_approval = deepcopy(approved["approval"])
    changed = {**template, "title": "日後改名"}
    # 既有 PUT 本文不接受 DB 內部 ID，直接以模型更新只測歷史隔離。
    db_session.expire_all()
    row = db_session.get(TemplateItem, UUID(template_id))
    row.title = changed["title"]
    w["category"].name = "類別新名"
    w["system"].name = "系統新名"
    db_session.commit()
    assert manager.delete(template_url).status_code == 204
    after = manager.get(_url(data)).json()
    assert after["approval"] == saved_approval
    assert after["approved_template_id"] is None
    assert after["content"] == data["content"]
    assert after["status"] == "APPROVED"
    assert _approve(w, after).status_code == 409


def test_ac38_title_limit_and_empty_system(db_session, review_world):
    w = review_world
    data = _create(w)
    before = _counts(db_session)
    assert (
        _revise(w, data, {**data["content"], "title": "x" * 257}).status_code
        == 422
    )
    assert _counts(db_session) == before
    revised = _revise(w, data, {**data["content"], "title": "x" * 256})
    assert revised.status_code == 201, revised.text
    approved = _approve(w, revised.json(), system_id=str(w["empty"].id))
    assert approved.status_code == 200, approved.text
    row = db_session.get(TemplateItem, UUID(approved.json()["template_id"]))
    assert row.sequence == 1


def test_ac40_counts_all_pending_and_review_list_paging_search(
    db_session, review_world
):
    w = review_world
    items = [_create(w) for _ in range(4)]
    assert _return(w, items[1]).status_code == 200
    approved = _approve(w, items[2])
    assert approved.status_code == 200, approved.text
    withdrawn = w["clients"]["editor"].post(
        _url(items[3], ":withdraw"), json=_expected(items[3])
    )
    assert withdrawn.status_code == 200
    manager = w["clients"]["manager"]
    count_url = "/api/v1/template-suggestions:pending-count"
    assert manager.get(
        count_url, params={"limit": 1, "q": "找不到"}
    ).json() == {"pending_count": 1}
    assert (
        len(manager.get("/api/v1/template-suggestions").json()["items"]) == 1
    )
    assert (
        manager.get(
            "/api/v1/template-suggestions", params={"q": "找不到"}
        ).json()["items"]
        == []
    )
    for status in ("PENDING", "RETURNED", "APPROVED", "WITHDRAWN"):
        result = manager.get(
            "/api/v1/template-suggestions",
            params={"status": status, "limit": 1},
        )
        assert result.status_code == 200
        assert len(result.json()["items"]) == 1
        data = result.json()["items"][0]
        assert data["status"] == status
        assert manager.get(_url(data, "/revisions")).status_code == 200
    more = [_create(w), _create(w)]
    first = manager.get(
        "/api/v1/template-suggestions", params={"limit": 1}
    ).json()
    second = manager.get(
        "/api/v1/template-suggestions",
        params={"limit": 1, "cursor": first["next_cursor"]},
    ).json()
    assert first["items"][0]["id"] == more[1]["id"]
    assert second["items"][0]["id"] == more[0]["id"]
    assert manager.get(count_url).json() == {"pending_count": 3}
    for params in ({"limit": 101}, {"cursor": "bad"}, {"status": "BAD"}):
        assert (
            manager.get(
                "/api/v1/template-suggestions", params=params
            ).status_code
            == 422
        )


def test_ac41_compare_foreign_revision_and_forged_fields(
    db_session, review_world
):
    w = review_world
    first, other = _create(w), _create(w, "peer")
    assert (
        _compare(
            w,
            first,
            first["current_revision_id"],
            other["current_revision_id"],
        ).status_code
        == 404
    )
    before = _counts(db_session)
    for field in ("proposer_id", "reviewer_id", "status", "content"):
        response = w["clients"]["manager"].post(
            _url(first, ":approve"),
            json={**_expected(first), **_destination(w), field: "偽造"},
        )
        assert response.status_code == 422
    assert _counts(db_session) == before


def test_ac42_return_and_approval_audits_exact_shape(db_session, review_world):
    w = review_world
    data = _create(w)
    returned = _return(w, data, "  原因  ").json()
    log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "template_suggestion.returned"
        )
    )
    assert log.before == {"status": "PENDING"}
    assert log.project_id == w["project"].id
    assert log.after == {
        "status": "RETURNED",
        "review_id": returned["latest_review"]["id"],
        "reviewed_revision_id": data["current_revision_id"],
        "reviewer_id": str(w["users"]["manager"].id),
        "reason": "原因",
    }
    other = _create(w)
    approved = _approve(w, other)
    assert approved.status_code == 200, approved.text
    approved = approved.json()
    log = db_session.scalar(
        select(AuditLog).where(
            AuditLog.event_type == "template_suggestion.approved"
        )
    )
    assert log.project_id == w["project"].id
    assert log.before == {"status": "PENDING"}
    assert log.after == {
        "status": "APPROVED",
        "review_id": approved["approval"]["id"],
        "reviewed_revision_id": other["current_revision_id"],
        "reviewer_id": str(w["users"]["manager"].id),
        "template_id": approved["template_id"],
        **_destination(w),
    }
    created = db_session.scalar(
        select(AuditLog).where(AuditLog.event_type == "template_item.created")
    )
    assert created.project_id is None
    assert created.entity_id == UUID(approved["template_id"])
    assert created.before is None
    assert set(created.after) == {
        "system_id",
        "sequence",
        "title",
        "instruction",
        "inspection_points",
    }
    assert not ({"suggestion_id", "revision_id"} & created.after.keys())


@pytest.mark.parametrize(
    "stage", ["template", "review", "second_audit", "return_audit"]
)
def test_ac39_fault_injection_rolls_back_every_write(
    db_session, review_world, monkeypatch, stage
):
    w = review_world
    data = _create(w)
    before = _counts(db_session)
    original_template = service.create_template
    original_audit = service.record_audit_event

    def fail_template(*a, **kw):
        original_template(*a, **kw)
        raise RuntimeError("injected after template flush")

    def fail_finish(db, row, review, **kw):
        db.add(review)
        db.flush()
        raise RuntimeError("injected after review flush")

    def fail_audit(*a, **kw):
        original_audit(*a, **kw)
        raise RuntimeError("injected after suggestion audit flush")

    if stage == "template":
        monkeypatch.setattr(service, "create_template", fail_template)
    elif stage == "review":
        monkeypatch.setattr(service, "_finish_review", fail_finish)
    else:
        monkeypatch.setattr(service, "record_audit_event", fail_audit)
    with pytest.raises(RuntimeError, match="injected"):
        if stage == "return_audit":
            _return(w, data)
        else:
            _approve(w, data)
    assert _counts(db_session) == before
    assert _template_count(db_session) == 0
    db_session.expire_all()
    row = db_session.get(TemplateSuggestion, UUID(data["id"]))
    assert row.status == "PENDING"
    assert row.current_revision_id == UUID(data["current_revision_id"])
    assert row.approved_template_id is None


@pytest.mark.parametrize("race", ["approve", "withdraw", "revise"])
@pytest.mark.parametrize("approval_first", [True, False])
def test_ac39_fixed_interleaving_one_matching_action(
    engine, db_session, review_world, race, approval_first
):
    w = review_world
    data = _create(w)
    before = _counts(db_session)

    def approval():
        return _approve(w, data, "manager")

    def competitor():
        if race == "approve":
            return _approve(w, data, "admin")
        if race == "withdraw":
            return w["clients"]["editor"].post(
                _url(data, ":withdraw"), json=_expected(data)
            )
        return _revise(
            w, data, {**data["content"], "title": "競爭修改"}, "admin"
        )

    def match(sql):
        return sql.startswith("SELECT") and "FROM template_suggestions" in sql

    name = "editor" if race == "withdraw" else "admin"
    winner, loser = _interleave_requests(
        engine,
        w,
        approval if approval_first else competitor,
        competitor if approval_first else approval,
        holder_after=match,
        waiter_before=match,
        waiter_session=name if approval_first else "manager",
    )
    assert winner.status_code == (
        201 if race == "revise" and not approval_first else 200
    ), winner.text
    assert loser.status_code == 409, loser.text
    assert loser.json()["error"]["code"] == "template_suggestion.changed"
    approved = approval_first or race == "approve"
    assert _template_count(db_session) == int(approved)
    db_session.expire_all()
    row = db_session.get(TemplateSuggestion, UUID(data["id"]))
    assert row.status == (
        "APPROVED"
        if approved
        else "WITHDRAWN"
        if race == "withdraw"
        else "PENDING"
    )
    assert _counts(db_session)[1] == before[1] + int(
        race == "revise" and not approval_first
    )
    assert _counts(db_session)[2] == before[2] + int(approved)


def test_ac43_approved_source_edit_delete_preserves_structure(
    db_session, review_world
):
    w = review_world
    data = _create(w)
    approved = _approve(w, data)
    assert approved.status_code == 200, approved.text
    approved = approved.json()
    manager = w["clients"]["manager"]
    template_url = "/api/v1/templates/" + approved["template_id"]
    template = manager.get(template_url).json()
    history = manager.get(_url(data, "/revisions")).json()
    source_url = (
        f"/api/v1/projects/{w['project'].id}/inspection-items/{w['item'].id}"
    )
    changed = w["clients"]["editor"].patch(
        source_url, json={"title": "後改來源", "instruction": "來源變動"}
    )
    assert changed.status_code == 200, changed.text
    assert w["clients"]["admin"].delete(source_url).status_code == 204
    assert manager.get(template_url).json() == template
    after = manager.get(_url(data)).json()
    for field in (
        "content",
        "status",
        "current_revision_id",
        "approval",
        "return_reason",
        "source_project_name",
        "source_item_title",
    ):
        assert after[field] == approved[field]
    assert manager.get(_url(data, "/revisions")).json() == history
    ids = set(db_session.scalars(select(TemplateInspectionPoint.id)))
    assert ids
    assert (
        not {
            UUID(p["logical_id"]) for p in data["content"]["inspection_points"]
        }
        & ids
    )


def test_ac36_compare_logical_identity_add_remove_edit_and_reorder(
    review_world,
):
    w = review_world
    data = _create(w)
    content = deepcopy(data["content"])
    identifiers = [str(uuid7()) for _ in range(4)]
    content["inspection_points"][0]["measurement_fields"] = [
        {
            "logical_id": ident,
            "name": f"欄位{index}",
            "field_type": "text",
            "unit": None,
            "sort_order": index,
        }
        for index, ident in enumerate(identifiers[:3])
    ]
    extra = deepcopy(content["inspection_points"][0])
    extra.update(
        logical_id=str(uuid7()),
        sequence=3,
        title="移除項次",
        measurement_fields=[],
    )
    content["inspection_points"].append(extra)
    response = _revise(w, data, content)
    assert response.status_code == 201, response.text
    second = response.json()
    before = deepcopy(second["content"])
    content = deepcopy(before)
    point = content["inspection_points"][0]
    fields = point["measurement_fields"]
    point["measurement_fields"] = [
        fields[1],
        fields[0],
        {
            "logical_id": identifiers[3],
            "name": "新增欄位",
            "field_type": "text",
            "unit": None,
            "sort_order": 2,
        },
    ]
    point["measurement_fields"][0]["name"] = "修改欄位"
    for i, field in enumerate(point["measurement_fields"]):
        field["sort_order"] = i
    point["title"] = "修改項次"
    new_point = deepcopy(extra)
    new_point.update(logical_id=str(uuid7()), title="新增項次")
    content["inspection_points"] = [
        content["inspection_points"][1],
        point,
        new_point,
    ]
    for i, p in enumerate(content["inspection_points"], 1):
        p["sequence"] = i
    response = _revise(w, second, content)
    assert response.status_code == 201, response.text
    third = response.json()
    result = _compare(
        w, third, second["current_revision_id"], third["current_revision_id"]
    )
    assert result.status_code == 200, result.text
    changes = result.json()["changes"]
    for entity in ("inspection_point", "measurement_field"):
        assert {c["kind"] for c in changes if c["entity"] == entity} == {
            "added",
            "removed",
            "modified",
            "reordered",
        }
    fields = [c for c in changes if c["entity"] == "measurement_field"]
    assert all(c["parent_logical_id"] == point["logical_id"] for c in fields)
    assert (
        next(c for c in fields if c["kind"] == "removed")["logical_id"]
        == identifiers[2]
    )
    assert (
        next(c for c in fields if c["kind"] == "added")["logical_id"]
        == identifiers[3]
    )
    assert result.json()["from_revision"]["content"] == before
    assert _approve(w, second).status_code == 409


def test_ac38_parallel_distinct_suggestions_allocate_system_sequence(
    engine, db_session, review_world
):
    w = review_world
    first, second = _create(w), _create(w)
    response = _revise(
        w, second, {**second["content"], "title": "另一個獨立建議"}
    )
    assert response.status_code == 201, response.text
    second = response.json()

    def match(sql):
        return sql.startswith("SELECT") and "FROM template_systems" in sql

    one, two = _interleave_requests(
        engine,
        w,
        lambda: _approve(w, first, "manager"),
        lambda: _approve(w, second, "admin"),
        holder_after=match,
        waiter_before=match,
        waiter_session="admin",
    )
    assert one.status_code == two.status_code == 200, (one.text, two.text)
    db_session.expire_all()
    sequences = db_session.scalars(
        select(TemplateItem.sequence).order_by(TemplateItem.sequence)
    ).all()
    assert sequences == [1, 2]
    assert _template_count(db_session) == 2


def test_ac36_compare_sequence_only_reordering(review_world):
    """TPL-AC36：陣列位置不變的合法序號變更也必須顯示差異。"""
    w = review_world
    first = _create(w)
    content = deepcopy(first["content"])
    points = content["inspection_points"]
    points[0]["sequence"], points[1]["sequence"] = (
        points[1]["sequence"],
        points[0]["sequence"],
    )
    response = _revise(w, first, content)
    assert response.status_code == 201, response.text
    second = response.json()
    original_points = first["content"]["inspection_points"]
    revised_points = second["content"]["inspection_points"]
    assert [p["logical_id"] for p in revised_points] == [
        p["logical_id"] for p in original_points
    ]
    result = _compare(
        w, second, first["current_revision_id"], second["current_revision_id"]
    )
    assert result.status_code == 200, result.text
    compared = result.json()
    assert compared["from_revision"]["content"] == first["content"]
    assert compared["to_revision"]["content"] == second["content"]
    changes = compared["changes"]
    assert len(changes) == 2
    by_id = {c["logical_id"]: c for c in changes}
    for before, after in zip(original_points, revised_points, strict=True):
        change = by_id[before["logical_id"]]
        assert change["entity"] == "inspection_point"
        assert change["kind"] == "modified"
        assert change["before"]["sequence"] == before["sequence"]
        assert change["after"]["sequence"] == after["sequence"]
        assert before["sequence"] != after["sequence"]
    approved = _approve(w, second)
    assert approved.status_code == 200, approved.text
    template = w["clients"]["manager"].get(
        "/api/v1/templates/" + approved.json()["template_id"]
    )
    assert template.status_code == 200, template.text
    assert [p["title"] for p in template.json()["inspection_points"]] == [
        p["title"] for p in reversed(original_points)
    ]
