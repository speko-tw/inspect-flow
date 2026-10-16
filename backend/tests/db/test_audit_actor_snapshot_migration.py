"""驗證 ALG-AC25 身分快照 migration 的回填與資料保留。"""

import importlib.util
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import (
    Engine,
    MetaData,
    Table,
    Uuid,
    insert,
    inspect,
    select,
    text,
)
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings
from app.models import Company
from app.models.audit_log import AuditLogImmutableError
from tests.db.conftest import create_root_user_with_company, make_system_admin

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PARENT = "8c624a9d70f1"
_REVISION = "9b7a6c2d1e45"
_MIGRATION_PATH = (
    _BACKEND_DIR
    / "alembic"
    / "versions"
    / "9b7a6c2d1e45_audit_actor_snapshot.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "audit_actor_snapshot_migration", _MIGRATION_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _config() -> Config:
    return Config(str(_BACKEND_DIR / "alembic.ini"))


def _audit_table(engine: Engine) -> Table:
    table = Table("audit_logs", MetaData(), autoload_with=engine)
    for name in ("id", "created_by", "project_id", "entity_id"):
        table.c[name].type = Uuid()
    return table


def test_snapshot_backfill_option_is_restored(db_url):
    """回填後同一連線不得保留 migration 專用選項。"""
    migration = _load_migration()
    engine = create_engine_from_settings(db_url)
    with engine.connect() as conn:
        migration._execute_snapshot_backfill(conn, text("SELECT 1"))
        assert (
            conn.get_execution_options().get(
                "audit_log_snapshot_backfill_allowed"
            )
            is None
        )
    engine.dispose()


def test_actor_snapshot_migration_backfills_and_round_trips(db_url):
    cfg = _config()
    command.upgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    actors = []
    fallback_usernames = []
    event_ids = [uuid7() for _ in range(6)]
    try:
        with Session(engine) as session:
            internal = create_root_user_with_company(session, "A580INT")
            internal.name_zh = "內部人員"
            internal_company = session.get(Company, internal.company_id)
            assert internal_company is not None
            internal_company.name = "內部單位"

            external = create_root_user_with_company(session, "A580EXT")
            external.name_zh = "外部人員"
            external.is_external_collaborator = True
            external_company = session.get(Company, external.company_id)
            assert external_company is not None
            external_company.name = "外部單位"

            no_unit = create_root_user_with_company(session, "A580NOU")
            no_unit.name_zh = "外部無單位"
            no_unit.is_external_collaborator = True
            no_unit.company_id = None
            no_unit.employee_no = None
            no_unit.department = None
            no_unit.location = None

            blank_name = create_root_user_with_company(session, "A580BLANK")
            blank_name.name_zh = ""
            blank_name.is_external_collaborator = True
            blank_name.company_id = None
            blank_name.employee_no = None
            blank_name.department = None
            blank_name.location = None

            whitespace_name = create_root_user_with_company(
                session, "A580SPACE"
            )
            whitespace_name.name_zh = "  \t\n"
            whitespace_name.is_external_collaborator = True
            whitespace_name.company_id = None
            whitespace_name.employee_no = None
            whitespace_name.department = None
            whitespace_name.location = None

            system = create_root_user_with_company(session, "A580SYS")
            make_system_admin(system)
            system.is_external_collaborator = True
            fallback_usernames = [
                blank_name.username,
                whitespace_name.username,
            ]
            session.commit()
            actors = [
                internal,
                external,
                no_unit,
                blank_name,
                whitespace_name,
                system,
            ]

            table = _audit_table(engine)
            session.execute(
                insert(table),
                [
                    {
                        "id": event_id,
                        "created_at": internal.created_at,
                        "created_by": actor.id,
                        "project_id": None,
                        "event_type": "role.created",
                        "entity_type": "role",
                        "entity_id": uuid4(),
                        "before": None,
                        "after": {"name": "歷史角色"},
                    }
                    for event_id, actor in zip(event_ids, actors, strict=True)
                ],
            )
            session.commit()
    finally:
        engine.dispose()

    command.upgrade(cfg, _REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("audit_logs")
        }
        assert columns["actor_snapshot"]["nullable"] is False
        assert inspect(engine).get_pk_constraint("audit_logs")["name"] == (
            "pk_audit_logs"
        )
        table = _audit_table(engine)
        with engine.connect() as connection:
            rows = connection.execute(
                select(table.c.id, table.c.actor_snapshot)
            ).all()
        assert dict(rows) == {
            event_ids[0]: "內部人員．內部單位",
            event_ids[1]: "外部人員．外部協作人員．外部單位",
            event_ids[2]: "外部協作人員（未填單位）",
            event_ids[3]: fallback_usernames[0],
            event_ids[4]: fallback_usernames[1],
            event_ids[5]: "admin",
        }
        indexes = {
            index["name"]: index["column_names"]
            for index in inspect(engine).get_indexes("audit_logs")
        }
        assert indexes["ix_audit_logs_created_by_created_at_id"] == [
            "created_by",
            "created_at",
            "id",
        ]
        assert indexes["ix_audit_logs_event_type_created_at_id"] == [
            "event_type",
            "created_at",
            "id",
        ]
    finally:
        engine.dispose()

    command.downgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        assert "actor_snapshot" not in {
            column["name"]
            for column in inspect(engine).get_columns("audit_logs")
        }
        table = _audit_table(engine)
        with engine.connect() as connection:
            assert connection.scalar(select(table.c.id).limit(1)) in event_ids
    finally:
        engine.dispose()

    command.upgrade(cfg, _REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            column["name"]
            for column in inspect(engine).get_columns("audit_logs")
        }
        assert "actor_snapshot" in columns
        table = _audit_table(engine)
        with engine.connect() as connection:
            rows = connection.execute(
                select(table.c.id, table.c.actor_snapshot)
            ).all()
        assert dict(rows) == {
            event_ids[0]: "內部人員．內部單位",
            event_ids[1]: "外部人員．外部協作人員．外部單位",
            event_ids[2]: "外部協作人員（未填單位）",
            event_ids[3]: fallback_usernames[0],
            event_ids[4]: fallback_usernames[1],
            event_ids[5]: "admin",
        }

        for statement in (
            "UPDATE audit_logs SET entity_type = 'changed'",
            "DELETE FROM audit_logs",
        ):
            with engine.connect() as connection:
                with pytest.raises(AuditLogImmutableError):
                    connection.execute(text(statement))
                connection.rollback()
    finally:
        engine.dispose()
