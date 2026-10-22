"""#435：在 PostgreSQL 重用刪除及改名的真 API 驗收。"""

from tests.api.test_project_item_removal import (
    test_delete_item_audit_failure_rolls_back_all_changes,
    test_delete_item_requires_edit_permission_and_project_boundary,
    test_delete_unused_item_clears_changes_and_records_audit,
    test_delete_used_item_rejects_every_task_status,
    test_rename_item_rejects_normalized_duplicate_without_mutation,
)
from tests.db.test_planning_api_postgresql import (
    _dispose_shared_engine,
    db_session,
    engine,
    make_client,
    migrated_url,
)

__all__ = [
    "_dispose_shared_engine",
    "db_session",
    "engine",
    "make_client",
    "migrated_url",
    "test_delete_item_audit_failure_rolls_back_all_changes",
    "test_delete_item_requires_edit_permission_and_project_boundary",
    "test_delete_unused_item_clears_changes_and_records_audit",
    "test_delete_used_item_rejects_every_task_status",
    "test_rename_item_rejects_normalized_duplicate_without_mutation",
]
