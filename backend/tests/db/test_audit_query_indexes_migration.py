"""依 ALG-AC29 驗證新增查詢索引不會變更 audit rows。"""

from pathlib import Path

from alembic.config import Config
from sqlalchemy import inspect

from alembic import command
from app.db.engine import create_engine_from_settings

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PREVIOUS = "a497f3d2b601"
_REVISION = "8c624a9d70f1"


def test_audit_query_indexes_round_trip(db_url):
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    command.upgrade(cfg, _PREVIOUS)
    engine = create_engine_from_settings(db_url)
    try:
        command.upgrade(cfg, _REVISION)
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
        command.downgrade(cfg, _PREVIOUS)
        indexes = {
            index["name"]
            for index in inspect(engine).get_indexes("audit_logs")
        }
        assert "ix_audit_logs_created_by_created_at_id" not in indexes
        assert "ix_audit_logs_event_type_created_at_id" not in indexes
    finally:
        engine.dispose()
