"""加入操作者快照並回填既有稽核紀錄（ALG-R29）。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9b7a6c2d1e45"
down_revision: str | Sequence[str] | None = "8c624a9d70f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 與 models/audit_log.py 的 append-only 攔截器共用的 execution option
# 名稱（ALG-R04）；改名時兩邊要一起改。
_SNAPSHOT_BACKFILL_OPTION = "audit_log_snapshot_backfill_allowed"
# 與 Python ``str.strip()`` 會去除的空白字元相同，讓資料庫端判斷
# 「姓名是否為空白」的結果與應用程式寫入快照時一致。
_WHITESPACE = (
    "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
    "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
)


def _execute_snapshot_backfill(
    bind: sa.Connection, statement: sa.Update
) -> None:
    """只在單次回填語句期間啟用 append-only guard 例外。

    audit_logs 只能新增（ALG-R04），攔截器會拒絕所有修改。只有帶這
    個 option、且語句是 migration 編譯的 actor_snapshot 單欄位
    UPDATE 時才放行；用完立即還原，不讓例外延伸到後續語句。
    """
    previous_option = bind.get_execution_options().get(
        _SNAPSHOT_BACKFILL_OPTION
    )
    bind.execution_options(**{_SNAPSHOT_BACKFILL_OPTION: True})
    try:
        bind.execute(statement)
    finally:
        bind.execution_options(**{_SNAPSHOT_BACKFILL_OPTION: previous_option})


def _snapshot_expression(
    users: sa.Table, companies: sa.Table, dialect_name: str
) -> sa.ColumnElement[str]:
    """依操作者現值產生快照，空白姓名沿用 username。

    組成方式依 ALG-R29：內部人員「姓名．單位」，外部協作人員
    「姓名．外部協作人員．單位」，缺項時省略；沒有單位的外部協作
    人員有姓名時為「外部協作人員（未填單位）」。
    """
    name_zh = users.c.name_zh
    # 兩種資料庫的函式名不同：PostgreSQL 用 btrim(字串, 字元集)，
    # SQLite 用 trim(字串, 字元集)。
    if dialect_name == "postgresql":
        trimmed_name = sa.func.btrim(name_zh, _WHITESPACE)
    else:
        trimmed_name = sa.func.trim(name_zh, _WHITESPACE)
    # 姓名只有空白也視為沒有姓名，改以 username 當快照姓名（#580）。
    has_name = sa.and_(name_zh.is_not(None), trimmed_name != "")
    name = sa.case((has_name, name_zh), else_=users.c.username)
    unit = companies.c.name
    external = sa.case(
        (
            sa.and_(unit.is_(None), has_name),
            sa.literal("外部協作人員（未填單位）"),
        ),
        (unit.is_(None), name),
        else_=name + "．外部協作人員．" + unit,
    )
    internal = sa.case(
        (unit.is_(None), name),
        else_=name + "．" + unit,
    )
    return sa.case(
        (users.c.is_external_collaborator.is_(True), external),
        else_=internal,
    )


def upgrade() -> None:
    """在原表加入快照欄位並於同一 migration 交易回填。

    既有紀錄沒有「寫入當時」的資料可用，ALG-R29 規定以 created_by
    目前的人員資料回填一次；之後新寫入的紀錄由寫入入口保存當下身分。
    """
    bind = op.get_bind()
    dialect_name = bind.dialect.name
    # 先加可空欄位、回填完成後才改 NOT NULL，既有資料列才不會違反
    # 約束（ALG-R29 要求欄位不可空）。
    op.add_column(
        "audit_logs", sa.Column("actor_snapshot", sa.Text(), nullable=True)
    )

    metadata = sa.MetaData()
    users = sa.Table("users", metadata, autoload_with=bind)
    companies = sa.Table("companies", metadata, autoload_with=bind)
    audit_logs = sa.table(
        "audit_logs",
        sa.column("created_by", sa.Uuid()),
        sa.column("actor_snapshot", sa.Text()),
    )
    actor_snapshot = (
        sa.select(_snapshot_expression(users, companies, dialect_name))
        .select_from(
            users.outerjoin(companies, users.c.company_id == companies.c.id)
        )
        .where(users.c.id == audit_logs.c.created_by)
        .scalar_subquery()
    )

    _execute_snapshot_backfill(
        bind,
        sa.update(audit_logs).values(actor_snapshot=actor_snapshot),
    )

    # SQLite 不能就地改欄位可否為空，需走 batch 重建；PostgreSQL 直接
    # ALTER。
    if dialect_name == "sqlite":
        with op.batch_alter_table("audit_logs") as batch:
            batch.alter_column(
                "actor_snapshot",
                existing_type=sa.Text(),
                nullable=False,
            )
    else:
        op.alter_column(
            "audit_logs",
            "actor_snapshot",
            existing_type=sa.Text(),
            nullable=False,
        )


def downgrade() -> None:
    """移除快照欄位，不變更或重寫既有稽核紀錄。"""
    if op.get_bind().dialect.name == "sqlite":
        with op.batch_alter_table("audit_logs") as batch:
            batch.drop_column("actor_snapshot")
    else:
        op.drop_column("audit_logs", "actor_snapshot")
