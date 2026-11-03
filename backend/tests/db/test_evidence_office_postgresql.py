"""FEV-AC02／12／13／31～37：以同一組真 API 案例驗證 PostgreSQL。"""

import os
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import make_url

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from tests.api.test_evidence_office import (
    test_access_two_layers_and_manage_without_read_does_not_leak_office,
    test_capture_flag_boundary_and_layer_disabled_exact_field_bytes,
    test_edit_repeat_reset_preserves_field_baseline_and_only_two_files,
    test_failed_replacement_restores_original_rows_keys_and_bytes,
    test_full_layer_overrides_validation_auto_fit_and_reset,
    test_maintenance_preserves_inputs_skips_locks_and_is_repeatable,
    test_parallel_office_edits_leave_exactly_the_two_committed_files,
    test_saved_small_baseline_legacy_inference_and_source_never_refreshes,
    test_straighten_fills_working_frame_without_black_corners,
    test_task_plan_and_photo_lock_precedence,
    test_transform_brightness_endpoints_rounding_and_clockwise_order,
)
from tests.db.test_evidence_upload_postgresql import (
    _dispose_shared_engine,
    db_session,
    engine,
    make_client,
)

_BACKEND = Path(__file__).resolve().parents[2]

__all__ = [
    "test_edit_repeat_reset_preserves_field_baseline_and_only_two_files",
    "test_full_layer_overrides_validation_auto_fit_and_reset",
    "test_parallel_office_edits_leave_exactly_the_two_committed_files",
    "test_failed_replacement_restores_original_rows_keys_and_bytes",
    "test_task_plan_and_photo_lock_precedence",
    "test_access_two_layers_and_manage_without_read_does_not_leak_office",
    "test_capture_flag_boundary_and_layer_disabled_exact_field_bytes",
    "test_maintenance_preserves_inputs_skips_locks_and_is_repeatable",
    "test_transform_brightness_endpoints_rounding_and_clockwise_order",
    "test_straighten_fills_working_frame_without_black_corners",
    "test_saved_small_baseline_legacy_inference_and_source_never_refreshes",
    "_dispose_shared_engine",
    "db_session",
    "engine",
    "make_client",
    "migrated_url",
]


@pytest.fixture
def migrated_url(request, tmp_path, monkeypatch):
    """並行工作共用測試庫時，T4 只清理自己的 schema，不重設 public。"""
    backend = request.config.getoption("--db-backend", default="sqlite")
    if backend == "sqlite":
        url = f"sqlite:///{tmp_path / 'office.db'}"
        monkeypatch.setenv("INSPECTFLOW_DATABASE_URL", url)
        command.upgrade(Config(str(_BACKEND / "alembic.ini")), "head")
        yield url
        return
    original = os.environ["INSPECTFLOW_TEST_POSTGRES_URL"]
    maintenance = create_engine_from_settings(original)
    schema = "w793_" + uuid4().hex
    with maintenance.begin() as connection:
        name = connection.scalar(text("select current_database()"))
        assert name == make_url(original).database
        assert name and name.endswith("_test"), "requires a test database"
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    url = (
        make_url(original)
        .update_query_dict(
            {
                "options": f"-csearch_path={schema}",
            }
        )
        .render_as_string(hide_password=False)
    )
    monkeypatch.setenv("INSPECTFLOW_DATABASE_URL", url)
    try:
        command.upgrade(Config(str(_BACKEND / "alembic.ini")), "head")
        yield url
    finally:
        dispose_engine()
        with maintenance.begin() as connection:
            connection.execution_options(audit_log_ddl_allowed=True)
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        maintenance.dispose()
