"""add template suggestion history

Revision ID: e802a1b2c3d4
Revises: e790a1b2c3d4
Create Date: 2026-10-31 16:44:17.772212

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# 歷史 migration 僅使用內建型別，避免日後模型異動影響重播。
# revision identifiers, used by Alembic.
revision: str = "e802a1b2c3d4"
down_revision: str | Sequence[str] | None = "e790a1b2c3d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# TPL-R32：凍結與模型相同的 Unicode 空白集合，歷史 migration 不匯入模型。
_REASON_WHITESPACE = (
    " \t\n\r\v\f\x1c\x1d\x1e\x1f\x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
    "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
)


def upgrade() -> None:
    """TPL-R30～R33：建立建議快照與不可變歷程。"""
    op.create_table(
        "template_suggestions",
        sa.Column("proposer_id", sa.Uuid(), nullable=False),
        sa.Column("source_project_id", sa.Uuid(), nullable=True),
        sa.Column("source_item_id", sa.Uuid(), nullable=True),
        sa.Column("source_project_original_id", sa.Uuid(), nullable=False),
        sa.Column("source_item_original_id", sa.Uuid(), nullable=False),
        sa.Column("source_project_name", sa.String(), nullable=False),
        sa.Column("source_item_title", sa.String(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            server_default="PENDING",
            nullable=False,
        ),
        sa.Column("current_revision_id", sa.Uuid(), nullable=False),
        sa.Column(
            "first_submitted_at", sa.DateTime(timezone=True), nullable=False
        ),
        sa.Column("approved_template_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "approved_template_id IS NULL OR status = 'APPROVED'",
            name=op.f("ck_template_suggestions_approved_link_status"),
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'RETURNED', 'APPROVED', 'WITHDRAWN')",
            name=op.f("ck_template_suggestions_status_valid"),
        ),
        sa.CheckConstraint(
            "source_item_id IS NULL OR source_item_id = "
            "source_item_original_id",
            name=op.f("ck_template_suggestions_item_identity_matches"),
        ),
        sa.CheckConstraint(
            "source_project_id IS NULL OR source_project_id = "
            "source_project_original_id",
            name=op.f("ck_template_suggestions_project_identity_matches"),
        ),
        sa.ForeignKeyConstraint(
            ["approved_template_id"],
            ["template_items.id"],
            name=op.f(
                "fk_template_suggestions_approved_template_id_template_items"
            ),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_template_suggestions_created_by_users"),
        ),
        *(
            [
                sa.ForeignKeyConstraint(
                    ["id", "current_revision_id"],
                    [
                        "template_suggestion_revisions.suggestion_id",
                        "template_suggestion_revisions.id",
                    ],
                    name="fk_suggestion_current_revision",
                    initially="DEFERRED",
                    deferrable=True,
                    use_alter=True,
                ),
            ]
            if op.get_bind().dialect.name == "sqlite"
            else []
        ),
        sa.ForeignKeyConstraint(
            ["proposer_id"],
            ["users.id"],
            name=op.f("fk_template_suggestions_proposer_id_users"),
        ),
        sa.ForeignKeyConstraint(
            ["source_item_id", "source_project_id"],
            [
                "project_inspection_items.id",
                "project_inspection_items.project_id",
            ],
            name="fk_suggestion_source_item_project",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["source_item_id"],
            ["project_inspection_items.id"],
            name=op.f(
                "fk_template_suggestions_source_item_id_"
                "project_inspection_items"
            ),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["source_project_id"],
            ["projects.id"],
            name=op.f("fk_template_suggestions_source_project_id_projects"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_template_suggestions_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_template_suggestions")),
        sa.UniqueConstraint(
            "approved_template_id",
            name=op.f("uq_template_suggestions_approved_template_id"),
        ),
    )
    with op.batch_alter_table("template_suggestions", schema=None) as batch_op:
        batch_op.create_index(
            "ix_suggestions_proposer_created",
            ["proposer_id", "created_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_suggestions_source_project",
            ["source_project_original_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_suggestions_status_created",
            ["status", "created_at", "id"],
            unique=False,
        )

    op.create_table(
        "template_suggestion_revisions",
        sa.Column("suggestion_id", sa.Uuid(), nullable=False),
        sa.Column("revision_no", sa.Integer(), nullable=False),
        sa.Column("based_on_revision_id", sa.Uuid(), nullable=True),
        sa.Column("content", sa.JSON(none_as_null=True), nullable=False),
        sa.Column("content_sha256", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(revision_no = 1 AND based_on_revision_id IS NULL) OR "
            "(revision_no > 1 AND based_on_revision_id IS NOT NULL AND "
            "based_on_revision_id <> id)",
            name=op.f("ck_template_suggestion_revisions_parent_consistent"),
        ),
        sa.CheckConstraint(
            "length(content_sha256) = 64",
            name=op.f("ck_template_suggestion_revisions_hash_length"),
        ),
        sa.CheckConstraint(
            "revision_no >= 1",
            name=op.f("ck_template_suggestion_revisions_revision_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_revisions_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id", "based_on_revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_revision_parent",
            initially="DEFERRED",
            deferrable=True,
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id"],
            ["template_suggestions.id"],
            name=op.f(
                "fk_template_suggestion_revisions_suggestion_id_"
                "template_suggestions"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_revisions_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_template_suggestion_revisions")
        ),
        sa.UniqueConstraint(
            "suggestion_id", "id", name="uq_suggestion_revision_owner"
        ),
        sa.UniqueConstraint(
            "suggestion_id",
            "revision_no",
            name=op.f("uq_template_suggestion_revisions_suggestion_id"),
        ),
    )
    # db-dependency: PostgreSQL 必須等參照表存在後才建立循環外鍵；
    # SQLite 不支援 ALTER ADD CONSTRAINT，已於主表內宣告延後檢查。
    if op.get_bind().dialect.name == "postgresql":
        op.create_foreign_key(
            "fk_suggestion_current_revision",
            "template_suggestions",
            "template_suggestion_revisions",
            ["id", "current_revision_id"],
            ["suggestion_id", "id"],
            deferrable=True,
            initially="DEFERRED",
        )
    op.create_table(
        "template_suggestion_reviews",
        sa.Column("suggestion_id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("decision", sa.String(length=8), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("approved_template_id", sa.Uuid(), nullable=True),
        sa.Column("approved_template_title", sa.String(), nullable=True),
        sa.Column("target_category_id", sa.Uuid(), nullable=True),
        sa.Column("target_category_name", sa.String(), nullable=True),
        sa.Column("target_system_id", sa.Uuid(), nullable=True),
        sa.Column("target_system_name", sa.String(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(decision = 'RETURNED' AND reason IS NOT NULL AND "
            f"length(trim(reason, '{_REASON_WHITESPACE}')) "
            "BETWEEN 1 AND 1000 AND "
            "approved_template_id IS NULL AND approved_template_title "
            "IS NULL AND target_category_id IS NULL AND "
            "target_category_name IS NULL AND target_system_id IS NULL "
            "AND target_system_name IS NULL) OR (decision = 'APPROVED' "
            "AND reason IS NULL AND approved_template_id IS NOT NULL "
            "AND approved_template_title IS NOT NULL AND "
            "target_category_id IS NOT NULL AND target_category_name "
            "IS NOT NULL AND target_system_id IS NOT NULL AND "
            "target_system_name IS NOT NULL)",
            name=op.f(
                "ck_template_suggestion_reviews_decision_snapshot_consistent"
            ),
        ),
        sa.CheckConstraint(
            "decision IN ('APPROVED', 'RETURNED')",
            name=op.f("ck_template_suggestion_reviews_decision_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_reviews_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id", "revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_review_revision",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_reviews_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_template_suggestion_reviews")
        ),
        sa.UniqueConstraint(
            "approved_template_id",
            name=op.f("uq_template_suggestion_reviews_approved_template_id"),
        ),
        sa.UniqueConstraint(
            "suggestion_id",
            "revision_id",
            "id",
            "decision",
            name="uq_suggestion_review_context",
        ),
    )
    with op.batch_alter_table(
        "template_suggestion_reviews", schema=None
    ) as batch_op:
        batch_op.create_index(
            "uq_suggestion_one_approval",
            ["suggestion_id"],
            unique=True,
            sqlite_where=sa.text("decision = 'APPROVED'"),
            postgresql_where=sa.text("decision = 'APPROVED'"),
        )

    op.create_table(
        "template_suggestion_transitions",
        sa.Column("suggestion_id", sa.Uuid(), nullable=False),
        sa.Column("revision_id", sa.Uuid(), nullable=False),
        sa.Column("from_status", sa.String(length=16), nullable=True),
        sa.Column("to_status", sa.String(length=16), nullable=False),
        sa.Column("review_id", sa.Uuid(), nullable=True),
        sa.Column("audit_log_id", sa.Uuid(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("updated_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "(from_status IS NULL AND to_status = 'PENDING') OR "
            "(from_status IS NOT NULL AND ((from_status = 'PENDING' "
            "AND to_status IN ('RETURNED', 'APPROVED', 'WITHDRAWN')) "
            "OR (from_status = 'RETURNED' AND to_status IN ('PENDING', "
            "'WITHDRAWN'))))",
            name=op.f("ck_template_suggestion_transitions_edge_valid"),
        ),
        sa.CheckConstraint(
            "(to_status IN ('RETURNED', 'APPROVED') AND review_id IS "
            "NOT NULL) OR (to_status IN ('PENDING', 'WITHDRAWN') AND "
            "review_id IS NULL)",
            name=op.f("ck_template_suggestion_transitions_review_required"),
        ),
        sa.ForeignKeyConstraint(
            ["audit_log_id"],
            ["audit_logs.id"],
            name=op.f(
                "fk_template_suggestion_transitions_audit_log_id_audit_logs"
            ),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_transitions_created_by_users"),
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id", "revision_id", "review_id", "to_status"],
            [
                "template_suggestion_reviews.suggestion_id",
                "template_suggestion_reviews.revision_id",
                "template_suggestion_reviews.id",
                "template_suggestion_reviews.decision",
            ],
            name="fk_suggestion_transition_review",
        ),
        sa.ForeignKeyConstraint(
            ["suggestion_id", "revision_id"],
            [
                "template_suggestion_revisions.suggestion_id",
                "template_suggestion_revisions.id",
            ],
            name="fk_suggestion_transition_revision",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"],
            ["users.id"],
            name=op.f("fk_template_suggestion_transitions_updated_by_users"),
        ),
        sa.PrimaryKeyConstraint(
            "id", name=op.f("pk_template_suggestion_transitions")
        ),
        sa.UniqueConstraint(
            "audit_log_id",
            name=op.f("uq_template_suggestion_transitions_audit_log_id"),
        ),
        sa.UniqueConstraint(
            "review_id",
            name=op.f("uq_template_suggestion_transitions_review_id"),
        ),
    )
    with op.batch_alter_table(
        "template_suggestion_transitions", schema=None
    ) as batch_op:
        batch_op.create_index(
            "ix_suggestion_transitions_history",
            ["suggestion_id", "created_at", "id"],
            unique=False,
        )
        batch_op.create_index(
            "uq_suggestion_first_submission",
            ["suggestion_id"],
            unique=True,
            sqlite_where=sa.text("from_status IS NULL"),
            postgresql_where=sa.text("from_status IS NULL"),
        )

    _install_protection()


def downgrade() -> None:
    """先移除保護與循環外鍵，再移除本次四張表。"""
    _remove_protection()
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(
            "fk_suggestion_current_revision",
            "template_suggestions",
            type_="foreignkey",
        )
        _drop_tables()
    else:
        # db-dependency: SQLite 無法單獨移除循環外鍵，且交易內切換
        # foreign_keys 無效；僅在 migration 回退期間關閉並確保恢復。
        with op.get_context().autocommit_block():
            op.execute("PRAGMA foreign_keys=OFF")
            try:
                _drop_tables()
            finally:
                op.execute("PRAGMA foreign_keys=ON")
            bind = op.get_bind()
            if bind.exec_driver_sql("PRAGMA foreign_keys").scalar() != 1:
                raise RuntimeError("SQLite foreign keys were not restored")
            if bind.exec_driver_sql("PRAGMA foreign_key_check").fetchall():
                raise RuntimeError("SQLite foreign key check failed")


def _drop_tables() -> None:
    for table in (
        "template_suggestion_transitions",
        "template_suggestion_reviews",
        "template_suggestion_revisions",
        "template_suggestions",
    ):
        op.drop_table(table)


_HISTORY = (
    "template_suggestion_revisions",
    "template_suggestion_reviews",
    "template_suggestion_transitions",
)
_IDENTITY = (
    "id",
    "proposer_id",
    "source_project_original_id",
    "source_item_original_id",
    "source_project_name",
    "source_item_title",
    "first_submitted_at",
    "created_at",
    "created_by",
)


def _install_protection() -> None:
    # TPL-R32：資料庫保護同時涵蓋 ORM、Core 與原生 SQL。
    # db-dependency: SQLite 僅有逐列 trigger；PostgreSQL 另擋 TRUNCATE。
    if op.get_bind().dialect.name == "sqlite":
        for table in _HISTORY:
            for action in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER {table}_{action.lower()}_immutable "
                    f"BEFORE {action} ON {table} BEGIN "
                    "SELECT RAISE(ABORT, 'suggestion history immutable'); END"
                )
        # SQLite 的 REPLACE 隱含刪除不一定觸發 DELETE trigger；
        # 先攔住所有可替換既有歷程的唯一鍵，不依賴 recursive_triggers。
        conflicts = {
            "template_suggestion_revisions": (
                "id = NEW.id OR (suggestion_id = NEW.suggestion_id "
                "AND revision_no = NEW.revision_no)"
            ),
            "template_suggestion_reviews": (
                "id = NEW.id OR approved_template_id = "
                "NEW.approved_template_id OR (suggestion_id = "
                "NEW.suggestion_id AND decision = 'APPROVED' "
                "AND NEW.decision = 'APPROVED')"
            ),
            "template_suggestion_transitions": (
                "id = NEW.id OR review_id = NEW.review_id "
                "OR audit_log_id = NEW.audit_log_id OR "
                "(suggestion_id = NEW.suggestion_id AND from_status IS NULL "
                "AND NEW.from_status IS NULL)"
            ),
            "template_suggestions": "id = NEW.id",
        }
        for table, predicate in conflicts.items():
            op.execute(
                f"CREATE TRIGGER {table}_replace_immutable "
                f"BEFORE INSERT ON {table} WHEN EXISTS "
                f"(SELECT 1 FROM {table} WHERE {predicate}) BEGIN "
                "SELECT RAISE(ABORT, 'suggestion history immutable'); END"
            )
        changed = " OR ".join(
            f"NEW.{column} IS NOT OLD.{column}" for column in _IDENTITY
        )
        op.execute(
            "CREATE TRIGGER suggestion_identity_immutable "
            "BEFORE UPDATE ON template_suggestions "
            f"WHEN {changed} BEGIN "
            "SELECT RAISE(ABORT, 'suggestion identity immutable'); END"
        )
    else:
        op.execute(
            "CREATE FUNCTION suggestion_history_immutable() "
            "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
            "RAISE EXCEPTION 'suggestion history immutable' "
            "USING ERRCODE = '23514'; END; $$"
        )
        for table in _HISTORY:
            op.execute(
                f"CREATE TRIGGER {table}_immutable "
                f"BEFORE UPDATE OR DELETE OR TRUNCATE ON {table} "
                "FOR EACH STATEMENT "
                "EXECUTE FUNCTION suggestion_history_immutable()"
            )
        changed = " OR ".join(
            f"NEW.{column} IS DISTINCT FROM OLD.{column}"
            for column in _IDENTITY
        )
        op.execute(
            "CREATE FUNCTION suggestion_identity_immutable() "
            "RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN "
            f"IF {changed} THEN "
            "RAISE EXCEPTION 'suggestion identity immutable' "
            "USING ERRCODE = '23514'; END IF; RETURN NEW; END; $$"
        )
        op.execute(
            "CREATE TRIGGER suggestion_identity_immutable "
            "BEFORE UPDATE ON template_suggestions FOR EACH ROW "
            "EXECUTE FUNCTION suggestion_identity_immutable()"
        )


def _remove_protection() -> None:
    if op.get_bind().dialect.name == "sqlite":
        for table in _HISTORY:
            for action in ("update", "delete"):
                op.execute(f"DROP TRIGGER {table}_{action}_immutable")
        for table in (*_HISTORY, "template_suggestions"):
            op.execute(f"DROP TRIGGER {table}_replace_immutable")
        op.execute("DROP TRIGGER suggestion_identity_immutable")
    else:
        for table in _HISTORY:
            op.execute(f"DROP TRIGGER {table}_immutable ON {table}")
        op.execute(
            "DROP TRIGGER suggestion_identity_immutable "
            "ON template_suggestions"
        )
        op.execute("DROP FUNCTION suggestion_history_immutable()")
        op.execute("DROP FUNCTION suggestion_identity_immutable()")
