"""加入操作者快照並回填既有稽核紀錄（ALG-R29）。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "9b7a6c2d1e45"
down_revision: str | Sequence[str] | None = "8c624a9d70f1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TEMP_TABLE = "_audit_logs_actor_snapshot_new"


def _create_table(name: str, *, with_snapshot: bool) -> None:
    """建立替換表，保留既有欄位與限制。"""
    bind = op.get_bind()
    primary_key_name = "pk_audit_logs"
    if bind.dialect.name == "postgresql" and name == _TEMP_TABLE:
        primary_key_name = "pk_audit_logs_actor_snapshot_new"
    columns = [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("entity_type", sa.String(), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("after", sa.JSON(), nullable=True),
    ]
    if with_snapshot:
        columns.append(sa.Column("actor_snapshot", sa.Text(), nullable=False))
    op.create_table(
        name,
        *columns,
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_audit_logs_created_by_users"),
        ),
        sa.PrimaryKeyConstraint("id", name=primary_key_name),
    )


def _copy_indexes() -> None:
    """重建換表時隨舊資料表一併移除的查詢索引。"""
    op.create_index("ix_audit_logs_project_id", "audit_logs", ["project_id"])
    op.create_index(
        "ix_audit_logs_created_at_id",
        "audit_logs",
        ["created_at", "id"],
    )
    op.create_index(
        "ix_audit_logs_created_by_created_at_id",
        "audit_logs",
        ["created_by", "created_at", "id"],
    )
    op.create_index(
        "ix_audit_logs_event_type_created_at_id",
        "audit_logs",
        ["event_type", "created_at", "id"],
    )


def _rename_primary_key() -> None:
    """換表後恢復 PostgreSQL 的慣用主鍵名稱。"""
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            sa.text(
                "ALTER TABLE audit_logs RENAME CONSTRAINT "
                "pk_audit_logs_actor_snapshot_new TO pk_audit_logs"
            )
        )


def _snapshot_expression(
    users: sa.Table, companies: sa.Table
) -> sa.ColumnElement[str]:
    """以 SQL 產生跨 SQLite 與 PostgreSQL 一致的既有快照。"""
    name = sa.func.coalesce(users.c.name_zh, users.c.username)
    unit = companies.c.name
    external = sa.case(
        (
            sa.and_(unit.is_(None), users.c.name_zh.is_not(None)),
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
    """回填身分後以不可空值欄位取代既有稽核表。"""
    bind = op.get_bind()
    metadata = sa.MetaData()
    old = sa.Table("audit_logs", metadata, autoload_with=bind)
    users = sa.Table("users", metadata, autoload_with=bind)
    companies = sa.Table("companies", metadata, autoload_with=bind)

    _create_table(_TEMP_TABLE, with_snapshot=True)
    replacement = sa.Table(_TEMP_TABLE, metadata, autoload_with=bind)
    source = sa.select(
        old.c.id,
        old.c.created_at,
        old.c.created_by,
        old.c.project_id,
        old.c.event_type,
        old.c.entity_type,
        old.c.entity_id,
        old.c.before,
        old.c.after,
        _snapshot_expression(users, companies).label("actor_snapshot"),
    ).select_from(
        old.join(users, old.c.created_by == users.c.id).outerjoin(
            companies, users.c.company_id == companies.c.id
        )
    )
    bind.execute(
        sa.insert(replacement).from_select(
            [column.name for column in replacement.columns], source
        )
    )

    op.drop_table("audit_logs")
    op.rename_table(_TEMP_TABLE, "audit_logs")
    _rename_primary_key()
    _copy_indexes()


def downgrade() -> None:
    """移除快照欄位並保留其餘稽核資料。"""
    bind = op.get_bind()
    metadata = sa.MetaData()
    old = sa.Table("audit_logs", metadata, autoload_with=bind)

    _create_table(_TEMP_TABLE, with_snapshot=False)
    replacement = sa.Table(_TEMP_TABLE, metadata, autoload_with=bind)
    source = sa.select(
        old.c.id,
        old.c.created_at,
        old.c.created_by,
        old.c.project_id,
        old.c.event_type,
        old.c.entity_type,
        old.c.entity_id,
        old.c.before,
        old.c.after,
    )
    bind.execute(
        sa.insert(replacement).from_select(
            [column.name for column in replacement.columns], source
        )
    )

    op.drop_table("audit_logs")
    op.rename_table(_TEMP_TABLE, "audit_logs")
    _rename_primary_key()
    _copy_indexes()
