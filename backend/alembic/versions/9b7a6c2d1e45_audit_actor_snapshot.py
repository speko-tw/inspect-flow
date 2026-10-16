"""加入操作者快照並回填既有稽核紀錄（ALG-R29）。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9b7a6c2d1e45"
down_revision: str | Sequence[str] | None = "8c624a9d70f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SNAPSHOT_BACKFILL_OPTION = "audit_log_snapshot_backfill_allowed"
_WHITESPACE = " \t\n\r\f\v"


def _execute_snapshot_backfill(
    bind: sa.Connection, statement: sa.Update
) -> None:
    """只在單次回填語句期間啟用 append-only guard 例外。"""
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
    """依操作者現值產生快照，空白姓名沿用 username。"""
    name_zh = users.c.name_zh
    if dialect_name == "postgresql":
        trimmed_name = sa.func.btrim(name_zh, _WHITESPACE)
    else:
        trimmed_name = sa.func.trim(name_zh, _WHITESPACE)
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
    """在原表加入快照欄位並於同一 migration 交易回填。"""
    bind = op.get_bind()
    dialect_name = bind.dialect.name
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
