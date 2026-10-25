"""IP-AC23～26：在 SQLite／PostgreSQL 重用停用的真 API 驗收。"""

from tests.api.test_project_item_activation import (
    test_activation_audit_noop_and_atomic_rollback,
    test_activation_permissions_module_boundary_and_scope,
    test_activation_preserves_existing_tasks_and_snapshots,
    test_list_filter_inactive_patch_and_name_conflicts,
    test_new_selection_rejected_but_retained_inactive_draft_can_dispatch,
    world,
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
    "world",
    "test_activation_audit_noop_and_atomic_rollback",
    "test_activation_permissions_module_boundary_and_scope",
    "test_activation_preserves_existing_tasks_and_snapshots",
    "test_list_filter_inactive_patch_and_name_conflicts",
    "test_new_selection_rejected_but_retained_inactive_draft_can_dispatch",
]
