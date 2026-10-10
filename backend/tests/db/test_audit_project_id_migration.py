"""ALG-AC01/ALG-AC18: preserve historical audit rows across #412.

The test uses the real Alembic chain and the same SQLite/PostgreSQL
fixture as the other database tests.
"""

from datetime import UTC, datetime
from pathlib import Path

from alembic.config import Config
from sqlalchemy import Engine, MetaData, Table, Uuid, insert, inspect, select
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PARENT = "d5a2c8e7b194"
_PROJECT_REVISION = "f6c142a90b7d"


def _config() -> Config:
    return Config(str(_BACKEND_DIR / "alembic.ini"))


def _audit_table(engine: Engine) -> Table:
    table = Table("audit_logs", MetaData(), autoload_with=engine)
    # SQLite reflection reports the migration's Uuid columns as CHAR.
    # Restore the declared types so Core binds UUID objects on both DBs.
    for name in ("id", "created_by", "entity_id"):
        table.c[name].type = Uuid()
    return table


def test_project_column_round_trip_preserves_historical_row(db_url):
    cfg = _config()
    command.upgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    event_id = uuid7()
    try:
        old_table = _audit_table(engine)
        assert "project_id" not in old_table.c
        with Session(engine) as session:
            user = create_root_user_with_company(session, "AUD412M")
            session.execute(
                insert(old_table).values(
                    id=event_id,
                    created_at=datetime.now(UTC),
                    created_by=user.id,
                    event_type="role.created",
                    entity_type="role",
                    entity_id=uuid7(),
                    before=None,
                    after={"name": "歷史角色"},
                )
            )
            session.commit()
    finally:
        engine.dispose()

    command.upgrade(cfg, _PROJECT_REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        inspector = inspect(engine)
        columns = {
            column["name"]: column
            for column in inspector.get_columns("audit_logs")
        }
        assert columns["project_id"]["nullable"] is True
        indexes = {
            index["name"]: index["column_names"]
            for index in inspector.get_indexes("audit_logs")
        }
        assert indexes["ix_audit_logs_project_id"] == ["project_id"]
        assert indexes["ix_audit_logs_created_at_id"] == [
            "created_at",
            "id",
        ]
        table = _audit_table(engine)
        with engine.connect() as connection:
            row = connection.execute(
                select(table).where(table.c.id == event_id)
            ).one()
        assert row._mapping["id"] == event_id
        assert row._mapping["after"] == {"name": "歷史角色"}
        assert row._mapping["project_id"] is None
    finally:
        engine.dispose()

    command.downgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        inspector = inspect(engine)
        assert "project_id" not in {
            column["name"] for column in inspector.get_columns("audit_logs")
        }
        names = {
            index["name"] for index in inspector.get_indexes("audit_logs")
        }
        assert "ix_audit_logs_project_id" not in names
        assert "ix_audit_logs_created_at_id" not in names
        table = _audit_table(engine)
        with engine.connect() as connection:
            assert (
                connection.scalar(
                    select(table.c.id).where(table.c.id == event_id)
                )
                == event_id
            )
    finally:
        engine.dispose()
