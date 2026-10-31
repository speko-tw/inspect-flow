"""TPL-AC34～36、39 的資料層驗收；API 與交易流程由 T16／T17 驗收。"""

import uuid
from collections.abc import Generator
from copy import deepcopy
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import (
    JSON,
    Engine,
    delete,
    insert,
    inspect,
    select,
    text,
    update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db import clock
from app.db.engine import create_engine_from_settings
from app.models import (
    AuditLog,
    Project,
    ProjectInspectionItem,
    TemplateCategory,
    TemplateItem,
    TemplateSuggestion,
    TemplateSuggestionReview,
    TemplateSuggestionRevision,
    TemplateSuggestionTransition,
    TemplateSystem,
)
from tests.db.conftest import create_root_user_with_company


def _get[T](session: Session, model: type[T], key: uuid.UUID) -> T:
    row = session.get(model, key)
    assert row is not None
    return row


_CONFIG = Path(__file__).resolve().parents[2] / "alembic.ini"
_HEAD = "e802a1b2c3d4"
_PREVIOUS = "e790a1b2c3d4"
_TABLES = (
    "template_suggestions",
    "template_suggestion_revisions",
    "template_suggestion_reviews",
    "template_suggestion_transitions",
)


def _content() -> dict:
    field = str(uuid.uuid4())
    return {
        "title": "結構快照",
        "instruction": "說明",
        "inspection_points": [
            {
                "logical_id": str(uuid.uuid4()),
                "sequence": 1,
                "title": "量測",
                "text_standard": {"text": "外觀完整"},
                "numeric_standard": {
                    "value": "5",
                    "condition": "gte",
                    "measurement_field_logical_id": field,
                },
                "measurement_fields": [
                    {"logical_id": field, "name": "長度", "unit": "mm"}
                ],
                "evidence_requirements": [
                    {"evidence_type": "photo", "required": True}
                ],
            }
        ],
    }


@pytest.fixture
def engine(db_url: str) -> Generator[Engine, None, None]:
    command.upgrade(Config(str(_CONFIG)), _HEAD)
    result = create_engine_from_settings(db_url)
    try:
        yield result
    finally:
        result.dispose()


@pytest.fixture
def records(engine: Engine) -> dict:
    with Session(engine) as session:
        user = create_root_user_with_company(session, "TPL802")
        actor = user.id
        audit = {"created_by": actor, "updated_by": actor}
        project = Project(
            name="來源工程",
            project_code="TPL802",
            client_name="業主",
            site_location="工地",
            **audit,
        )
        session.add(project)
        session.flush()
        item = ProjectInspectionItem(
            project_id=project.id,
            sequence=1,
            title="來源項目",
            instruction="來源說明",
            source_template_name="原範本",
            applied_at=clock.utc_now(),
            **audit,
        )
        category = TemplateCategory(name="目的分類", **audit)
        session.add_all([item, category])
        session.flush()
        system = TemplateSystem(
            category_id=category.id, name="目的系統", **audit
        )
        session.add(system)
        session.flush()
        template = TemplateItem(
            system_id=system.id,
            sequence=1,
            title="核准名稱",
            instruction="獨立範本",
            **audit,
        )
        session.add(template)
        session.flush()
        result = {
            "actor": actor,
            "project": project.id,
            "item": item.id,
            "category": category.id,
            "system": system.id,
            "template": template.id,
        }
        session.commit()
    return result


def _suggestion(
    session: Session, records: dict
) -> tuple[uuid.UUID, uuid.UUID]:
    suggestion_id, revision_id = uuid.uuid4(), uuid.uuid4()
    audit = {"created_by": records["actor"], "updated_by": records["actor"]}
    session.add(
        TemplateSuggestion(
            id=suggestion_id,
            proposer_id=records["actor"],
            source_project_id=records["project"],
            source_item_id=records["item"],
            source_project_original_id=records["project"],
            source_item_original_id=records["item"],
            source_project_name="來源工程",
            source_item_title="來源項目",
            current_revision_id=revision_id,
            **audit,
        )
    )
    # 延後的複合外鍵讓主件與第 1 版在同一交易內成對建立。
    session.flush()
    session.add(
        TemplateSuggestionRevision(
            id=revision_id,
            suggestion_id=suggestion_id,
            revision_no=1,
            content=_content(),
            content_sha256="a" * 64,
            **audit,
        )
    )
    session.flush()
    return suggestion_id, revision_id


def _review(
    records: dict,
    sid: uuid.UUID,
    rid: uuid.UUID,
    decision: str = "RETURNED",
    **overrides,
) -> TemplateSuggestionReview:
    values = {
        "id": uuid.uuid4(),
        "suggestion_id": sid,
        "revision_id": rid,
        "decision": decision,
        "reason": "請補充依據",
        "created_by": records["actor"],
        "updated_by": records["actor"],
    }
    if decision == "APPROVED":
        values.update(
            reason=None,
            approved_template_id=records["template"],
            approved_template_title="核准名稱",
            target_category_id=records["category"],
            target_category_name="目的分類",
            target_system_id=records["system"],
            target_system_name="目的系統",
        )
    values.update(overrides)
    return TemplateSuggestionReview(**values)


def _transition(
    session: Session,
    records: dict,
    sid: uuid.UUID,
    rid: uuid.UUID,
    before: str | None,
    after: str,
    review_id: uuid.UUID | None = None,
    **overrides,
) -> TemplateSuggestionTransition:
    log = AuditLog(
        created_by=records["actor"],
        actor_snapshot="提議人",
        project_id=records["project"],
        event_type="template_item.created",
        entity_type="template_item",
        entity_id=records["template"],
    )
    session.add(log)
    session.flush()
    values = {
        "suggestion_id": sid,
        "revision_id": rid,
        "from_status": before,
        "to_status": after,
        "review_id": review_id,
        "audit_log_id": log.id,
        "created_by": records["actor"],
        "updated_by": records["actor"],
    }
    values.update(overrides)
    return TemplateSuggestionTransition(**values)


def test_populated_upgrade_downgrade_reupgrade(engine: Engine, records: dict):
    """有自我參照修訂與歷程時也能回退，既有來源資料不得被刪除。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        revision = TemplateSuggestionRevision(
            suggestion_id=sid,
            revision_no=2,
            based_on_revision_id=rid,
            content={"title": "未完成退回稿"},
            content_sha256="b" * 64,
            created_by=records["actor"],
            updated_by=records["actor"],
        )
        session.add(revision)
        session.flush()
        session.execute(
            update(TemplateSuggestion)
            .where(TemplateSuggestion.id == sid)
            .values(current_revision_id=revision.id, status="RETURNED")
        )
        review = _review(records, sid, rid)
        session.add(review)
        session.flush()
        session.add(
            _transition(
                session, records, sid, rid, "PENDING", "RETURNED", review.id
            )
        )
        session.commit()
    assert set(_TABLES) <= set(inspect(engine).get_table_names())
    content_column = next(
        column
        for column in inspect(engine).get_columns(
            "template_suggestion_revisions"
        )
        if column["name"] == "content"
    )
    assert isinstance(content_column["type"], JSON)
    assert not any("version" in name for name in _TABLES)
    command.downgrade(Config(str(_CONFIG)), _PREVIOUS)
    assert set(_TABLES).isdisjoint(inspect(engine).get_table_names())
    with Session(engine) as session:
        assert session.get(ProjectInspectionItem, records["item"]) is not None
    command.upgrade(Config(str(_CONFIG)), _HEAD)
    assert set(_TABLES) <= set(inspect(engine).get_table_names())


@pytest.mark.parametrize("source", [ProjectInspectionItem, Project])
def test_source_deletion_preserves_snapshot(
    engine: Engine, records: dict, source
):
    """TPL-AC34：來源改名與刪除不改建議快照與邏輯 ID。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        snapshot = deepcopy(
            _get(session, TemplateSuggestionRevision, rid).content
        )
        session.commit()
        session.execute(update(ProjectInspectionItem).values(title="已改名"))
        key = "project" if source is Project else "item"
        session.execute(delete(source).where(source.id == records[key]))
        session.commit()
        suggestion = _get(session, TemplateSuggestion, sid)
        session.refresh(suggestion)
        assert suggestion.source_item_id is None
        assert suggestion.source_project_original_id == records["project"]
        assert suggestion.source_item_original_id == records["item"]
        assert suggestion.source_item_title == "來源項目"
        assert (
            _get(session, TemplateSuggestionRevision, rid).content == snapshot
        )


def test_approval_snapshot_survives_target_deletion(
    engine: Engine, records: dict
):
    """TPL-R33、AC39：刪除目的地後仍只能有一筆核准。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        review = _review(records, sid, rid, "APPROVED")
        session.add(review)
        session.execute(
            update(TemplateSuggestion)
            .where(TemplateSuggestion.id == sid)
            .values(
                status="APPROVED", approved_template_id=records["template"]
            )
        )
        session.commit()
        session.execute(
            delete(TemplateCategory).where(
                TemplateCategory.id == records["category"]
            )
        )
        session.commit()
        session.refresh(review)
        suggestion = _get(session, TemplateSuggestion, sid)
        assert suggestion.approved_template_id is None
        assert review.approved_template_id == records["template"]
        assert review.approved_template_title == "核准名稱"
        assert review.target_system_name == "目的系統"
        assert review.target_category_id == records["category"]
        session.add(
            _review(
                records,
                sid,
                rid,
                "APPROVED",
                approved_template_id=uuid.uuid4(),
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


@pytest.mark.parametrize(
    "model",
    [
        TemplateSuggestionRevision,
        TemplateSuggestionReview,
        TemplateSuggestionTransition,
    ],
)
@pytest.mark.parametrize("path", ["orm", "core", "raw"])
@pytest.mark.parametrize("action", ["update", "delete"])
def test_history_immutable(engine: Engine, records: dict, model, path, action):
    """TPL-AC36：三種寫入入口皆不能覆寫／刪除歷程。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        review = _review(records, sid, rid)
        session.add(review)
        session.flush()
        transition = _transition(
            session, records, sid, rid, "PENDING", "RETURNED", review.id
        )
        session.add(transition)
        session.commit()
        row = session.scalars(select(model)).one()
        row_id = row.id
        original = row.created_by
        with pytest.raises(IntegrityError, match="history immutable"):
            if path == "orm":
                if action == "update":
                    row.created_by = records["actor"]
                    row.updated_by = uuid.uuid4()
                else:
                    session.delete(row)
                session.commit()
            elif path == "core":
                statement = (
                    update(model).values(created_by=original)
                    if action == "update"
                    else delete(model)
                )
                session.execute(statement.where(model.id == row_id))
                session.commit()
            else:
                table = model.__tablename__
                statement = (
                    f"UPDATE {table} SET created_by = created_by"
                    if action == "update"
                    else f"DELETE FROM {table}"
                )
                session.execute(text(statement))
                session.commit()
        session.rollback()
        session.expire_all()
        assert _get(session, model, row_id).created_by == original


def test_postgres_truncate_guard(engine: Engine, records: dict):
    """PostgreSQL 的 TRUNCATE 不會觸發逐列 DELETE，必須另行保護。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("PostgreSQL-only TRUNCATE")
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        session.add(_transition(session, records, sid, rid, None, "PENDING"))
        session.commit()
        with pytest.raises(IntegrityError, match="history immutable"):
            session.execute(text("TRUNCATE template_suggestion_transitions"))
        session.rollback()
        assert session.scalar(select(TemplateSuggestionTransition)) is not None


@pytest.mark.parametrize(
    "values",
    [
        {"status": "INVALID"},
        {"current_revision_id": uuid.uuid4()},
        {"source_project_name": "改寫歷史"},
        {"source_item_original_id": uuid.uuid4()},
        {"approved_template_id": uuid.uuid4()},
    ],
)
def test_main_constraints(engine: Engine, records: dict, values):
    with Session(engine) as session:
        sid, _ = _suggestion(session, records)
        session.commit()
        with pytest.raises(IntegrityError):
            session.execute(
                update(TemplateSuggestion)
                .where(TemplateSuggestion.id == sid)
                .values(**values)
            )
            session.commit()
        session.rollback()


def test_cross_suggestion_references(engine: Engine, records: dict):
    """TPL-AC36：目前版本、前版及審核均不得跨件引用。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        other, other_revision = _suggestion(session, records)
        session.commit()
        attempts = [
            update(TemplateSuggestion)
            .where(TemplateSuggestion.id == sid)
            .values(current_revision_id=other_revision),
            TemplateSuggestionRevision(
                suggestion_id=sid,
                revision_no=2,
                based_on_revision_id=other_revision,
                content={},
                content_sha256="b" * 64,
                created_by=records["actor"],
                updated_by=records["actor"],
            ),
            _review(records, other, rid),
        ]
        for attempt in attempts:
            with pytest.raises(IntegrityError):
                if isinstance(
                    attempt,
                    (TemplateSuggestionRevision, TemplateSuggestionReview),
                ):
                    session.add(attempt)
                else:
                    session.execute(attempt)
                session.commit()
            session.rollback()


@pytest.mark.parametrize("reason", [None, "", "   ", "x" * 1001])
def test_return_reason_constraints(engine: Engine, records: dict, reason):
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        session.commit()
        session.add(_review(records, sid, rid, reason=reason))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


@pytest.mark.parametrize(
    "before,after",
    [
        (None, "RETURNED"),
        (None, "WITHDRAWN"),
        ("PENDING", "PENDING"),
        ("APPROVED", "WITHDRAWN"),
        ("WITHDRAWN", "PENDING"),
        ("RETURNED", "APPROVED"),
    ],
)
def test_illegal_edges(engine: Engine, records: dict, before, after):
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        session.commit()
        session.add(_transition(session, records, sid, rid, before, after))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_legal_edges_and_review_context(engine: Engine, records: dict):
    """歷程能保存多次退回／重送；審核必須釘選同件同版及決策。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        session.add(_transition(session, records, sid, rid, None, "PENDING"))
        for _ in range(2):
            review = _review(records, sid, rid)
            session.add(review)
            session.flush()
            session.add(
                _transition(
                    session,
                    records,
                    sid,
                    rid,
                    "PENDING",
                    "RETURNED",
                    review.id,
                )
            )
            session.flush()
            session.add(
                _transition(session, records, sid, rid, "RETURNED", "PENDING")
            )
            session.flush()
        session.commit()
        # 相同審核不可重用，也不能讓 RETURNED 審核對應 APPROVED。
        session.add(
            _transition(
                session, records, sid, rid, "PENDING", "APPROVED", review.id
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(_transition(session, records, sid, rid, None, "PENDING"))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_revision_identity_and_unique_stale_writes(
    engine: Engine, records: dict
):
    """TPL-AC36、39：穩定邏輯 ID 與同件版號唯一，過期寫入不能覆蓋。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        content = deepcopy(
            _get(session, TemplateSuggestionRevision, rid).content
        )
        session.commit()
    # 兩個 session 各自讀到同一舊版；winner 提交後，loser 的同版號寫入失敗。
    with Session(engine) as winner, Session(engine) as loser:
        assert _get(winner, TemplateSuggestion, sid).current_revision_id == rid
        assert _get(loser, TemplateSuggestion, sid).current_revision_id == rid
        loser.rollback()  # SQLite 釋放讀鎖；保留呼叫端讀到的舊版本。
        for session in (winner, loser):
            edited = deepcopy(content)
            edited["title"] = "新版"
            revision = TemplateSuggestionRevision(
                suggestion_id=sid,
                revision_no=2,
                based_on_revision_id=rid,
                content=edited,
                content_sha256="b" * 64,
                created_by=records["actor"],
                updated_by=records["actor"],
            )
            session.add(revision)
            if session is winner:
                session.commit()
            else:
                with pytest.raises(IntegrityError):
                    session.commit()
                session.rollback()
    with Session(engine) as session:
        versions = session.scalars(
            select(TemplateSuggestionRevision)
            .where(TemplateSuggestionRevision.suggestion_id == sid)
            .order_by(TemplateSuggestionRevision.revision_no)
        ).all()
        assert len(versions) == 2
        assert versions[0].content == content
        assert (
            versions[0].content["inspection_points"]
            == versions[1].content["inspection_points"]
        )


@pytest.mark.parametrize(
    "key", ["id", "project_id", "actual_value", "photos", "task_id"]
)
def test_snapshot_rejects_source_rows_and_field_data(key):
    content = _content()
    content["inspection_points"][0][key] = "must not be copied"
    with pytest.raises(ValueError):
        TemplateSuggestionRevision(content=content)


def test_snapshot_logical_references_and_copy():
    content = _content()
    revision = TemplateSuggestionRevision(content=content)
    content["title"] = "呼叫端修改"
    assert revision.content["title"] == "結構快照"
    invalid = _content()
    invalid["inspection_points"][0]["numeric_standard"][
        "measurement_field_logical_id"
    ] = str(uuid.uuid4())
    with pytest.raises(ValueError):
        TemplateSuggestionRevision(content=invalid)
    duplicate = _content()
    duplicate["inspection_points"].append(
        deepcopy(duplicate["inspection_points"][0])
    )
    with pytest.raises(ValueError):
        TemplateSuggestionRevision(content=duplicate)


@pytest.mark.sqlite_only
@pytest.mark.parametrize("table", _TABLES)
def test_sqlite_replace_cannot_overwrite(
    engine: Engine, records: dict, table: str
):
    """即使 recursive_triggers 關閉，REPLACE 仍不能抹去舊內容。"""
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        review = _review(records, sid, rid)
        session.add(review)
        session.flush()
        session.add(
            _transition(
                session, records, sid, rid, "PENDING", "RETURNED", review.id
            )
        )
        session.commit()
        assert session.execute(text("PRAGMA recursive_triggers")).scalar() == 0
        with pytest.raises(IntegrityError, match="history immutable"):
            session.execute(
                text(f"INSERT OR REPLACE INTO {table} SELECT * FROM {table}")
            )
            session.commit()
        session.rollback()
        assert (
            session.execute(text(f"SELECT count(*) FROM {table}")).scalar()
            == 1
        )


@pytest.mark.parametrize("revision_no,parent", [(0, None), (2, None)])
def test_revision_number_parent_constraints(
    engine: Engine, records: dict, revision_no, parent
):
    with Session(engine) as session:
        sid, _ = _suggestion(session, records)
        session.commit()
        session.add(
            TemplateSuggestionRevision(
                suggestion_id=sid,
                revision_no=revision_no,
                based_on_revision_id=parent,
                content={},
                content_sha256="a" * 64,
                created_by=records["actor"],
                updated_by=records["actor"],
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()


def test_transition_review_and_audit_foreign_keys(
    engine: Engine, records: dict
):
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        other_sid, other_rid = _suggestion(session, records)
        review = _review(records, other_sid, other_rid)
        session.add(review)
        session.commit()
        review_id = review.id
        invalid = [
            {"before": "PENDING", "after": "RETURNED", "review_id": review_id},
            {"before": None, "after": "PENDING", "audit_log_id": uuid.uuid4()},
            {"before": "PENDING", "after": "RETURNED"},
        ]
        for values in invalid:
            transition = _transition(session, records, sid, rid, **values)
            session.add(transition)
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()


@pytest.mark.parametrize(
    "before,after",
    [
        (None, "PENDING"),
        ("PENDING", "RETURNED"),
        ("PENDING", "APPROVED"),
        ("PENDING", "WITHDRAWN"),
        ("RETURNED", "PENDING"),
        ("RETURNED", "WITHDRAWN"),
    ],
)
def test_each_legal_edge(engine: Engine, records: dict, before, after):
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        review_id = None
        if after in {"RETURNED", "APPROVED"}:
            review = _review(records, sid, rid, after)
            session.add(review)
            session.flush()
            review_id = review.id
        session.add(
            _transition(session, records, sid, rid, before, after, review_id)
        )
        session.commit()
        assert session.scalars(select(TemplateSuggestionTransition)).one()


def test_three_revisions_keep_reviewed_content(engine: Engine, records: dict):
    """TPL-AC36：退回釘選第 1 版，核准釘選管理者改寫的第 3 版。"""
    with Session(engine) as session:
        sid, first = _suggestion(session, records)
        original = deepcopy(
            _get(session, TemplateSuggestionRevision, first).content
        )
        session.add(_review(records, sid, first))
        previous = first
        for number in (2, 3):
            content = deepcopy(original)
            content["title"] = f"第 {number} 版"
            revision = TemplateSuggestionRevision(
                suggestion_id=sid,
                revision_no=number,
                based_on_revision_id=previous,
                content=content,
                content_sha256=str(number) * 64,
                created_by=records["actor"],
                updated_by=records["actor"],
            )
            session.add(revision)
            session.flush()
            previous = revision.id
        session.add(_review(records, sid, previous, "APPROVED"))
        session.execute(
            update(TemplateSuggestion)
            .where(TemplateSuggestion.id == sid)
            .values(
                current_revision_id=previous,
                status="APPROVED",
                approved_template_id=records["template"],
            )
        )
        session.commit()
        reviews = session.scalars(
            select(TemplateSuggestionReview).where(
                TemplateSuggestionReview.suggestion_id == sid
            )
        ).all()
        assert {row.decision: row.revision_id for row in reviews} == {
            "RETURNED": first,
            "APPROVED": previous,
        }
        assert (
            _get(session, TemplateSuggestionRevision, first).content
            == original
        )
        assert (
            _get(session, TemplateSuggestionRevision, previous).content[
                "inspection_points"
            ]
            == original["inspection_points"]
        )


@pytest.mark.parametrize("path", ["orm", "core"])
@pytest.mark.parametrize(
    "whitespace",
    ["\t", "\n", "\r", "\u3000", "\t\n\r\u3000", "\u00a0\u2003\u202f"],
    ids=["tab", "lf", "cr", "ideographic", "mixed", "unicode"],
)
@pytest.mark.parametrize("size", [0, 1000, 1001])
def test_return_reason_unicode_boundaries(
    engine: Engine, records: dict, path: str, whitespace: str, size: int
):
    """TPL-R32：ORM 與繞過模型的 DB 寫入均以去空白後字元數判斷。"""
    content = "字" * size
    raw = whitespace + content + whitespace
    with Session(engine) as session:
        sid, rid = _suggestion(session, records)
        session.commit()

        def persist() -> None:
            if path == "orm":
                session.add(_review(records, sid, rid, reason=raw))
            else:
                session.connection().execute(
                    insert(TemplateSuggestionReview).values(
                        suggestion_id=sid,
                        revision_id=rid,
                        decision="RETURNED",
                        reason=raw,
                        created_by=records["actor"],
                        updated_by=records["actor"],
                    )
                )
            session.commit()

        if size == 1000:
            persist()
            stored = session.scalars(select(TemplateSuggestionReview)).one()
            # DB CHECK 驗證正規化長度；原生寫入不負責改寫儲存值。
            assert stored.reason == (content if path == "orm" else raw)
        else:
            with pytest.raises(IntegrityError):
                persist()
            session.rollback()
            assert session.scalar(select(TemplateSuggestionReview)) is None


def test_return_reason_normalizes_only_outer_whitespace():
    """TPL-R32：保存可讀原因，保留內文空白並允許核准的空值。"""
    review = TemplateSuggestionReview(
        reason="\t\n\r\u3000 原因\t內文 \u3000\r\n"
    )
    assert review.reason == "原因\t內文"
    review.reason = None
    assert review.reason is None
