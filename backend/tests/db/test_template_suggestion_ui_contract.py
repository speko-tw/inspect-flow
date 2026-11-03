"""TPL-AC36／40：T19 UI 取用的真契約，同時在 SQLite／PostgreSQL 驗證。"""

from datetime import timedelta

from app.db import clock
from tests.db.test_template_suggestion_review import (
    _approve,
    _create,
    _expected,
    _return,
    _revise,
    _url,
)
from tests.db.test_template_suggestion_review import (
    _dispose_shared_engine as _dispose_shared_engine,
)
from tests.db.test_template_suggestion_review import (
    db_session as db_session,
)
from tests.db.test_template_suggestion_review import (
    engine as engine,
)
from tests.db.test_template_suggestion_review import (
    make_client as make_client,
)
from tests.db.test_template_suggestion_review import (
    migrated_url as migrated_url,
)
from tests.db.test_template_suggestion_review import (
    review_world as review_world,
)
from tests.db.test_template_suggestion_review import (
    world as world,
)


def test_ui_wire_history_names_and_recent_submission_paging(
    db_session, review_world
):
    """較舊件重送排在較新件前，管理者改版不能改送審排序。"""
    w = review_world
    w["users"]["editor"].name_zh = "林小姐"
    w["users"]["manager"].name_zh = "吳經理"
    db_session.commit()
    base = clock.utc_now()

    def at(minutes):
        clock.set_clock(lambda: base + timedelta(minutes=minutes))

    try:
        at(1)
        old = _create(w)
        at(2)
        newer = _create(w)
        at(3)
        response = _return(w, old, "請補充")
        assert response.status_code == 200, response.text
        returned = response.json()
        at(4)
        response = _revise(
            w, returned, {**old["content"], "title": "最近重送"}, "editor"
        )
        assert response.status_code == 201, response.text
        revised = response.json()
        at(5)
        response = w["clients"]["editor"].post(
            _url(revised, ":submit"), json=_expected(revised)
        )
        assert response.status_code == 200, response.text
        sent = response.json()
        assert "content" in sent and "current_revision" not in sent
        assert sent["proposer_name"] == "林小姐"
        assert sent["last_editor_name"] == "林小姐"
        assert sent["title"] == "最近重送"
        manager = w["clients"]["manager"]
        listing = "/api/v1/template-suggestions"
        pending = manager.get(listing).json()["items"]
        assert [r["id"] for r in pending] == [old["id"], newer["id"]]
        assert (
            pending[0]["last_submitted_at"] > pending[1]["last_submitted_at"]
        )
        at(6)
        withdrawn = _create(w)
        response = w["clients"]["editor"].post(
            _url(withdrawn, ":withdraw"), json=_expected(withdrawn)
        )
        assert response.status_code == 200, response.text
        at(7)
        response = _revise(
            w, sent, {**sent["content"], "title": "最近重送管理版"}
        )
        assert response.status_code == 201, response.text
        edited = response.json()
        assert edited["last_editor_name"] == "吳經理"
        assert edited["last_submitted_at"] == sent["last_submitted_at"]
        ids = []
        cursor = None
        while True:
            params = {"status": "ALL", "limit": 1}
            if cursor:
                params["cursor"] = cursor
            page = manager.get(listing, params=params)
            assert page.status_code == 200, page.text
            body = page.json()
            ids.extend(r["id"] for r in body["items"])
            cursor = body["next_cursor"]
            if not cursor:
                break
        assert ids == [withdrawn["id"], old["id"], newer["id"]]
        mine = (
            w["clients"]["editor"]
            .get("/api/v1/me/template-suggestions")
            .json()
        )
        assert [r["id"] for r in mine["items"]] == [
            withdrawn["id"],
            newer["id"],
            old["id"],
        ]
        matched = manager.get(
            listing, params={"status": "ALL", "q": "最近重送"}
        ).json()
        assert [r["id"] for r in matched["items"]] == [old["id"]]
        assert manager.get(
            "/api/v1/template-suggestions:pending-count"
        ).json() == {"pending_count": 2}
        history = manager.get(_url(old, "/revisions")).json()["items"]
        assert [r["editor_name"] for r in history] == [
            "林小姐",
            "林小姐",
            "吳經理",
        ]
        assert "events" not in history[0]
        assert history[0]["reviews"][0]["reviewer_name"] == "吳經理"
        assert [t["operator_name"] for t in history[0]["transitions"]] == [
            "林小姐",
            "吳經理",
        ]
        compared = manager.get(
            _url(old, "/revisions:compare"),
            params={
                "from_revision_id": history[1]["id"],
                "to_revision_id": history[2]["id"],
            },
        ).json()
        assert compared["from_revision"]["editor_name"] == "林小姐"
        assert compared["to_revision"]["editor_name"] == "吳經理"
        # 無變更保存仍須經真後端，回完整主件且保持同一修訂 ID。
        response = _revise(w, edited, edited["content"])
        assert response.status_code == 200, response.text
        assert (
            response.json()["current_revision_id"]
            == edited["current_revision_id"]
        )
        response = _approve(w, edited)
        assert response.status_code == 200, response.text
        approval = response.json()["approval"]
        assert (
            approval["approved_template_title"] == edited["content"]["title"]
        )
        assert approval["target_category_name"] == w["category"].name
        assert approval["target_system_name"] == w["system"].name
        assert approval["reviewer_name"] == "吳經理"
    finally:
        clock.reset_clock()
