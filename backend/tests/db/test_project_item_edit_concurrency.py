"""PostgreSQL concurrency coverage for concurrent project item edits."""

from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event, Lock
from time import monotonic
from uuid import UUID

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import (
    create_engine_from_settings,
    dispose_engine,
    get_engine,
)
from app.main import create_app
from app.models import (
    AuditLog,
    ProjectEvidenceRequirement,
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    ProjectInspectionPoint,
    TaskInspectionItem,
    TaskRequirementSnapshot,
    TemplateCategory,
    TemplateItem,
    TemplateSystem,
)
from tests.api.test_inspection_planning_api import _planning_world

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def test_project_item_patch_can_swap_point_sequences_on_postgresql(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL immediate unique constraints")

    world = _planning_world(db_session, make_client)
    item = world["item"]
    project = world["project"]
    admin = world["admin"]
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    initial = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "sequence": sequence,
                    "title": f"點位 {sequence}",
                    "instruction": "初始說明",
                    "text_standard": {"text": "初始標準"},
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                }
                for sequence in (1, 2)
            ]
        },
    )
    assert initial.status_code == 200, initial.text
    points = initial.json()["inspection_points"]

    swapped = admin.patch(
        item_url,
        json={
            "inspection_points": [
                {
                    "id": point["id"],
                    "sequence": 3 - point["sequence"],
                    "title": point["title"],
                    "instruction": point["instruction"],
                    "text_standard": point["text_standard"],
                    "numeric_standard": None,
                    "measurement_fields": [],
                    "evidence_requirements": [{"min_count": 1}],
                }
                for point in points
            ]
        },
    )
    assert swapped.status_code == 200, swapped.text
    assert {
        point["id"]: point["sequence"]
        for point in swapped.json()["inspection_points"]
    } == {point["id"]: 3 - point["sequence"] for point in points}
    stored_sequences = dict(
        db_session.execute(
            select(
                ProjectInspectionPoint.id, ProjectInspectionPoint.sequence
            ).where(
                ProjectInspectionPoint.project_inspection_item_id == item.id
            )
        ).all()
    )
    assert stored_sequences == {
        UUID(point["id"]): 3 - point["sequence"] for point in points
    }


@pytest.fixture(autouse=True)
def dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def engine(db_url: str) -> Generator[Engine, None, None]:
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    db_engine = create_engine_from_settings(db_url)
    try:
        yield db_engine
    finally:
        db_engine.dispose()
        dispose_engine()


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def make_client() -> Callable[[], TestClient]:
    def create_client() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return create_client


def test_concurrent_project_item_patches_preserve_revision_history(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row-level SELECT FOR UPDATE")

    world = _planning_world(db_session, make_client)
    item = world["item"]
    project = world["project"]
    admin = world["admin"]
    plan_response = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "並行修改測試"},
    )
    assert plan_response.status_code == 201, plan_response.text
    task_response = admin.post(
        f"/api/v1/inspection-plans/{plan_response.json()['id']}/tasks",
        json={"name": "並行修改任務", "item_ids": [str(item.id)]},
    )
    assert task_response.status_code == 201, task_response.text

    _, first_token = create_session(db_session, world["admin_user"])
    _, second_token = create_session(db_session, world["admin_user"])
    db_session.commit()
    clients = [make_client(), make_client()]
    for client, token in zip(
        clients, (first_token, second_token), strict=True
    ):
        client.cookies.set(SESSION_COOKIE_NAME, token)

    barrier = Barrier(2)
    app_engine = get_engine()
    second_lock_attempted = Event()
    event_lock = Lock()
    lock_events: list[str] = []
    item_lock_connection_ids: set[int] = set()
    first_connection_id: int | None = None
    second_connection_id: int | None = None
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"

    def is_item_lock(statement: str) -> bool:
        # #435 名稱檢查鎖先於來源項目鎖，仍驗證後到交易等待先到者提交。
        return "pg_advisory_xact_lock" in statement.lower()

    def before_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ) -> None:
        nonlocal first_connection_id, second_connection_id
        if not is_item_lock(statement):
            return
        connection_id = id(connection)
        with event_lock:
            item_lock_connection_ids.add(connection_id)
            if first_connection_id is None:
                first_connection_id = connection_id
            elif second_connection_id is None:
                second_connection_id = connection_id
                assert second_connection_id != first_connection_id
                lock_events.append("second_lock_attempted")
                second_lock_attempted.set()
            else:
                assert connection_id == second_connection_id

    def after_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ) -> None:
        if not is_item_lock(statement):
            return
        connection_id = id(connection)
        if connection_id == first_connection_id:
            with event_lock:
                lock_events.append("first_lock_acquired")
            assert second_lock_attempted.wait(timeout=10)
            return
        assert connection_id == second_connection_id
        with event_lock:
            lock_events.append("second_lock_acquired")

    def on_commit(connection) -> None:
        connection_id = id(connection)
        if connection_id == first_connection_id:
            with event_lock:
                lock_events.append("first_transaction_commit")

    def patch(client: TestClient, title: str):
        barrier.wait(timeout=10)
        return client.patch(
            item_url,
            json={"title": title, "reinspect": False},
        )

    event.listen(app_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(app_engine, "after_cursor_execute", after_cursor_execute)
    event.listen(app_engine, "commit", on_commit)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(
                executor.map(
                    lambda args: patch(*args),
                    zip(clients, ("並行修改甲", "並行修改乙"), strict=True),
                )
            )
    finally:
        event.remove(
            app_engine, "before_cursor_execute", before_cursor_execute
        )
        event.remove(app_engine, "after_cursor_execute", after_cursor_execute)
        event.remove(app_engine, "commit", on_commit)

    assert [response.status_code for response in responses] == [200, 200], [
        response.text for response in responses
    ]
    assert len(item_lock_connection_ids) == 2
    assert first_connection_id != second_connection_id
    second_attempt = lock_events.index("second_lock_attempted")
    first_commit = lock_events.index("first_transaction_commit")
    second_acquire = lock_events.index("second_lock_acquired")
    assert second_attempt < first_commit < second_acquire

    db_session.expire_all()
    stored_item = db_session.get(ProjectInspectionItem, item.id)
    assert stored_item is not None
    assert stored_item.standard_revision == 3
    assert stored_item.title in {"並行修改甲", "並行修改乙"}

    changes = db_session.scalars(
        select(ProjectInspectionItemChange)
        .where(
            ProjectInspectionItemChange.project_inspection_item_id == item.id
        )
        .order_by(ProjectInspectionItemChange.after_revision)
    ).all()
    assert [
        (change.before_revision, change.after_revision) for change in changes
    ] == [(1, 2), (2, 3)]

    task_item = db_session.scalar(
        select(TaskInspectionItem).where(
            TaskInspectionItem.project_inspection_item_id == item.id
        )
    )
    assert task_item is not None
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    assert snapshot.title == stored_item.title
    assert snapshot.source_standard_revision == 3

    events = db_session.scalars(
        select(AuditLog).where(
            AuditLog.event_type == "project_inspection_item.updated",
            AuditLog.entity_id == item.id,
        )
    ).all()
    assert len(events) == 2
    event_titles = set()
    for audit_event in events:
        assert isinstance(audit_event.after, dict)
        event_titles.add(audit_event.after["title"])
    assert event_titles == {"並行修改甲", "並行修改乙"}


@pytest.mark.parametrize("first_writer", ["task_create", "item_patch"])
def test_task_creation_and_item_patch_serialize_snapshot_sources(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
    first_writer: str,
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row-level locks")

    world = _planning_world(db_session, make_client)
    item = world["item"]
    project = world["project"]
    admin = world["admin"]
    plan_response = admin.post(
        f"/api/v1/projects/{project.id}/inspection-plans",
        json={"name": "建立與修改並行"},
    )
    assert plan_response.status_code == 201, plan_response.text
    plan_id = plan_response.json()["id"]

    _, patch_token = create_session(db_session, world["admin_user"])
    _, create_token = create_session(db_session, world["admin_user"])
    db_session.commit()
    patch_client, create_client = make_client(), make_client()
    patch_client.cookies.set(SESSION_COOKIE_NAME, patch_token)
    create_client.cookies.set(SESSION_COOKIE_NAME, create_token)
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"
    task_url = f"/api/v1/inspection-plans/{plan_id}/tasks"

    create_lock_acquired = Event()
    create_lock_attempted = Event()
    patch_lock_attempted = Event()
    patch_lock_acquired = Event()
    lock_wait_confirmed = Event()
    release_first_writer = Event()
    events_lock = Lock()
    observed: list[str] = []
    request_connection_ids: dict[int, str] = {}
    request_backend_pids: dict[str, int] = {}
    app_engine = get_engine()

    def is_create_source_lock(statement: str) -> bool:
        normalized = statement.lower()
        return (
            "project_inspection_items" in normalized
            and " for share" in normalized
        )

    def is_patch_item_lock(statement: str) -> bool:
        normalized = statement.lower()
        return (
            "project_inspection_items" in normalized
            and "for no key update" in normalized
        )

    def wait_for_lock_wait(backend_pid: int, blocker_pid: int) -> None:
        deadline = monotonic() + 10
        with app_engine.connect() as probe_connection:
            while monotonic() < deadline:
                probe_connection.execute(
                    text("SELECT pg_stat_clear_snapshot()")
                )
                activity = probe_connection.execute(
                    text(
                        "SELECT wait_event_type, pg_blocking_pids(pid) "
                        "FROM pg_stat_activity "
                        "WHERE pid = :backend_pid"
                    ),
                    {"backend_pid": backend_pid},
                ).one_or_none()
                if (
                    activity is not None
                    and activity.wait_event_type == "Lock"
                    and blocker_pid in activity.pg_blocking_pids
                ):
                    lock_wait_confirmed.set()
                    with events_lock:
                        observed.append("lock_wait_confirmed")
                    return
        raise AssertionError(
            f"PostgreSQL backend {backend_pid} did not wait on a lock"
        )

    def wait_for_blocked_request(request_name: str, blocker_name: str) -> None:
        attempted = (
            patch_lock_attempted
            if request_name == "item_patch"
            else create_lock_attempted
        )
        assert attempted.wait(timeout=10)
        with events_lock:
            backend_pid = request_backend_pids.get(request_name)
            blocker_pid = request_backend_pids.get(blocker_name)
        assert backend_pid is not None
        assert blocker_pid is not None
        wait_for_lock_wait(backend_pid, blocker_pid)

    def before_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ) -> None:
        if is_create_source_lock(statement):
            backend_pid = (
                connection.connection.driver_connection.info.backend_pid
            )
            with events_lock:
                observed.append("create_lock_attempted")
                request_backend_pids["task_create"] = backend_pid
            create_lock_attempted.set()
        if is_patch_item_lock(statement):
            backend_pid = (
                connection.connection.driver_connection.info.backend_pid
            )
            with events_lock:
                observed.append("patch_lock_attempted")
                request_backend_pids["item_patch"] = backend_pid
            patch_lock_attempted.set()

    def after_cursor_execute(
        connection, cursor, statement, parameters, context, executemany
    ) -> None:
        if is_create_source_lock(statement):
            with events_lock:
                observed.append("create_lock_acquired")
                request_connection_ids[id(connection)] = "task_create"
            create_lock_acquired.set()
            if first_writer == "task_create":
                assert release_first_writer.wait(timeout=30)
        if is_patch_item_lock(statement):
            with events_lock:
                observed.append("patch_lock_acquired")
                request_connection_ids[id(connection)] = "item_patch"
            patch_lock_acquired.set()
            if first_writer == "item_patch":
                assert release_first_writer.wait(timeout=30)

    def on_commit(connection) -> None:
        with events_lock:
            request = request_connection_ids.get(id(connection))
            if request is not None:
                observed.append(f"{request}_commit")

    def create_task():
        return create_client.post(
            task_url,
            json={
                "name": "並行建立任務",
                "item_ids": [str(item.id)],
            },
        )

    def patch_item():
        return patch_client.patch(
            item_url,
            json={"title": "並行後標準", "reinspect": False},
        )

    event.listen(app_engine, "before_cursor_execute", before_cursor_execute)
    event.listen(app_engine, "after_cursor_execute", after_cursor_execute)
    event.listen(app_engine, "commit", on_commit)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                if first_writer == "task_create":
                    create_future = executor.submit(create_task)
                    assert create_lock_acquired.wait(timeout=10)
                    patch_future = executor.submit(patch_item)
                    wait_for_blocked_request("item_patch", "task_create")
                    release_first_writer.set()
                else:
                    patch_future = executor.submit(patch_item)
                    assert patch_lock_acquired.wait(timeout=10)
                    create_future = executor.submit(create_task)
                    wait_for_blocked_request("task_create", "item_patch")
                    release_first_writer.set()

                create_response = create_future.result(timeout=20)
                patch_response = patch_future.result(timeout=20)
            finally:
                release_first_writer.set()
    finally:
        event.remove(
            app_engine, "before_cursor_execute", before_cursor_execute
        )
        event.remove(app_engine, "after_cursor_execute", after_cursor_execute)
        event.remove(app_engine, "commit", on_commit)

    assert create_response.status_code == 201, create_response.text
    assert patch_response.status_code == 200, patch_response.text
    assert create_lock_acquired.is_set()
    assert patch_lock_acquired.is_set()
    assert lock_wait_confirmed.is_set()
    if first_writer == "task_create":
        assert observed.index("create_lock_acquired") < observed.index(
            "patch_lock_attempted"
        )
    else:
        assert observed.index("patch_lock_acquired") < observed.index(
            "create_lock_attempted"
        )
    expected_commits = (
        ["task_create_commit", "item_patch_commit"]
        if first_writer == "task_create"
        else ["item_patch_commit", "task_create_commit"]
    )
    commits = [event for event in observed if event.endswith("_commit")]
    assert commits == expected_commits

    task_id = create_response.json()["id"]
    task_item = db_session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task_id)
    )
    assert task_item is not None
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    db_session.expire_all()
    stored_item = db_session.get(ProjectInspectionItem, item.id)
    assert snapshot is not None
    assert stored_item is not None
    assert stored_item.standard_revision == 2
    assert stored_item.title == "並行後標準"
    assert snapshot.source_standard_revision == stored_item.standard_revision
    assert snapshot.title == stored_item.title


def test_concurrent_project_item_patches_serialize_on_sqlite_session_touch(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
) -> None:
    if engine.dialect.name != "sqlite":
        pytest.skip("covers SQLite request serialization")

    world = _planning_world(db_session, make_client)
    item = world["item"]
    project = world["project"]
    token = world["admin"].cookies.get(SESSION_COOKIE_NAME)
    assert token
    clients = [make_client(), make_client()]
    for client in clients:
        client.cookies.set(SESSION_COOKIE_NAME, token)

    barrier = Barrier(2)
    item_url = f"/api/v1/projects/{project.id}/inspection-items/{item.id}"

    def patch(client: TestClient, title: str):
        barrier.wait(timeout=10)
        return client.patch(
            item_url,
            json={"title": title, "reinspect": False},
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(
                lambda args: patch(*args),
                zip(clients, ("SQLite 並行甲", "SQLite 並行乙"), strict=True),
            )
        )

    assert [response.status_code for response in responses] == [200, 200], [
        response.text for response in responses
    ]
    db_session.expire_all()
    stored_item = db_session.get(ProjectInspectionItem, item.id)
    assert stored_item is not None
    assert stored_item.standard_revision == 3


class _LockGate:
    """讓先取得指定鎖的請求暫停持鎖，確認後到者真的在等鎖才放行。

    比照 #555 的作法，用 SQLAlchemy 事件與 pg_stat_activity 固定
    交錯順序，而不是靠 sleep 賭時序：先完成鎖定語句的連線是持鎖者，
    另一條連線只要也送出鎖定語句就會被 PostgreSQL 擋住。
    """

    def __init__(self, engine: Engine, matches: Callable[[str], bool]):
        self._engine = engine
        self._matches = matches
        self._mutex = Lock()
        self._backend_pids: dict[int, int] = {}
        self._holder: int | None = None
        self.acquired = Event()
        self.waiter_attempted = Event()
        self.release = Event()
        self.commits: list[str] = []

    def _before(
        self, connection, cursor, statement, parameters, context, executemany
    ) -> None:
        if not self._matches(statement.lower()):
            return
        pid = connection.connection.driver_connection.info.backend_pid
        with self._mutex:
            self._backend_pids[id(connection)] = pid
            others = [c for c in self._backend_pids if c != self._holder]
            if self._holder is not None and others:
                self.waiter_attempted.set()

    def _after(
        self, connection, cursor, statement, parameters, context, executemany
    ) -> None:
        if not self._matches(statement.lower()):
            return
        with self._mutex:
            if self._holder is None:
                self._holder = id(connection)
            is_holder = self._holder == id(connection)
        if is_holder:
            self.acquired.set()
            assert self.release.wait(timeout=30)

    def _commit(self, connection) -> None:
        with self._mutex:
            if id(connection) in self._backend_pids:
                role = "holder" if id(connection) == self._holder else "waiter"
                self.commits.append(role)

    def __enter__(self) -> "_LockGate":
        event.listen(self._engine, "before_cursor_execute", self._before)
        event.listen(self._engine, "after_cursor_execute", self._after)
        event.listen(self._engine, "commit", self._commit)
        return self

    def __exit__(self, *exc_info) -> None:
        self.release.set()
        event.remove(self._engine, "before_cursor_execute", self._before)
        event.remove(self._engine, "after_cursor_execute", self._after)
        event.remove(self._engine, "commit", self._commit)

    def wait_until_waiter_blocked(self) -> None:
        """等到另一條連線確實被持鎖者擋在 PostgreSQL 的鎖等待上。"""
        assert self.acquired.is_set()
        deadline = monotonic() + 10
        while monotonic() < deadline:
            with self._mutex:
                holder = self._holder
                holder_pid = self._backend_pids.get(holder or 0)
                waiter_pids = [
                    pid
                    for conn, pid in self._backend_pids.items()
                    if conn != holder
                ]
            if holder_pid is not None and waiter_pids:
                with self._engine.connect() as probe:
                    probe.execute(text("SELECT pg_stat_clear_snapshot()"))
                    blocked = probe.execute(
                        text(
                            "SELECT 1 FROM pg_stat_activity "
                            "WHERE pid = :waiter "
                            "AND wait_event_type = 'Lock' "
                            "AND :holder = ANY(pg_blocking_pids(pid))"
                        ),
                        {"waiter": waiter_pids[0], "holder": holder_pid},
                    ).first()
                if blocked is not None:
                    return
        raise AssertionError("second request never waited on the held lock")


def _two_admin_clients(
    db_session: Session,
    world,
    make_client: Callable[[], TestClient],
) -> list[TestClient]:
    tokens = [
        create_session(db_session, world["admin_user"])[1] for _ in range(2)
    ]
    db_session.commit()
    clients = [make_client(), make_client()]
    for client, token in zip(clients, tokens, strict=True):
        client.cookies.set(SESSION_COOKIE_NAME, token)
    return clients


def _world_with_draft_task(db_session, make_client, name):
    world = _planning_world(db_session, make_client)
    plan_response = world["admin"].post(
        f"/api/v1/projects/{world['project'].id}/inspection-plans",
        json={"name": name},
    )
    assert plan_response.status_code == 201, plan_response.text
    task_response = world["admin"].post(
        f"/api/v1/inspection-plans/{plan_response.json()['id']}/tasks",
        json={"name": "示範任務", "item_ids": [str(world["item"].id)]},
    )
    assert task_response.status_code == 201, task_response.text
    return world, task_response.json()["id"]


def test_concurrent_task_item_replacements_reread_old_items_after_lock(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row-level locks")

    world, task_id = _world_with_draft_task(
        db_session, make_client, "草稿項目並行取代"
    )
    first, second = _two_admin_clients(db_session, world, make_client)
    url = f"/api/v1/inspection-tasks/{task_id}/items"
    item_id, item_two_id = world["item"].id, world["item_two"].id

    def lock_statement(statement: str) -> bool:
        return "inspection_plans" in statement and "for update" in statement

    with _LockGate(get_engine(), lock_statement) as gate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first_future = executor.submit(
                    first.put, url, json={"item_ids": [str(item_two_id)]}
                )
                assert gate.acquired.wait(timeout=10)
                second_future = executor.submit(
                    second.put,
                    url,
                    json={"item_ids": [str(item_id), str(item_two_id)]},
                )
                gate.wait_until_waiter_blocked()
            finally:
                gate.release.set()
            first_response = first_future.result(timeout=20)
            second_response = second_future.result(timeout=20)

    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == 200, second_response.text
    assert gate.commits == ["holder", "waiter"]
    assert {item["id"] for item in second_response.json()["items"]} == {
        str(item_id),
        str(item_two_id),
    }

    db_session.expire_all()
    task_items = db_session.scalars(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task_id)
    ).all()
    assert {row.project_inspection_item_id for row in task_items} == {
        item_id,
        item_two_id,
    }
    audits = db_session.scalars(
        select(AuditLog)
        .where(
            AuditLog.event_type == "inspection_task.items_updated",
            AuditLog.entity_id == UUID(task_id),
        )
        .order_by(AuditLog.created_at, AuditLog.id)
    ).all()
    # 後到者必須以持鎖後重讀的項目集合為 before；若沿用鎖前舊值，
    # 第二筆稽核的 before 會誤記成最初的項目。
    recorded = []
    for audit in audits:
        assert isinstance(audit.before, dict)
        assert isinstance(audit.after, dict)
        recorded.append(
            (set(audit.before["items"]), set(audit.after["items"]))
        )
    assert recorded == [
        ({str(item_id)}, {str(item_two_id)}),
        ({str(item_two_id)}, {str(item_id), str(item_two_id)}),
    ]


@pytest.mark.parametrize("first_writer", ["task_items", "item_patch"])
def test_task_item_replacement_and_item_patch_serialize_snapshot_sources(
    engine: Engine,
    db_session: Session,
    make_client: Callable[[], TestClient],
    first_writer: str,
) -> None:
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row-level locks")

    world, task_id = _world_with_draft_task(
        db_session, make_client, "草稿項目與來源並行"
    )
    items_client, patch_client = _two_admin_clients(
        db_session, world, make_client
    )
    items_url = f"/api/v1/inspection-tasks/{task_id}/items"
    item_url = (
        f"/api/v1/projects/{world['project'].id}"
        f"/inspection-items/{world['item_two'].id}"
    )

    def source_lock(statement: str) -> bool:
        return "project_inspection_items" in statement and (
            " for share" in statement or "for no key update" in statement
        )

    def replace_items():
        return items_client.put(
            items_url, json={"item_ids": [str(world["item_two"].id)]}
        )

    def patch_item():
        return patch_client.patch(
            item_url, json={"title": "並行後標準", "reinspect": False}
        )

    first_call, second_call = (
        (replace_items, patch_item)
        if first_writer == "task_items"
        else (patch_item, replace_items)
    )
    with _LockGate(get_engine(), source_lock) as gate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            try:
                first_future = executor.submit(first_call)
                assert gate.acquired.wait(timeout=10)
                second_future = executor.submit(second_call)
                gate.wait_until_waiter_blocked()
            finally:
                gate.release.set()
            first_response = first_future.result(timeout=20)
            second_response = second_future.result(timeout=20)

    assert first_response.status_code == 200, first_response.text
    assert second_response.status_code == 200, second_response.text
    assert gate.commits == ["holder", "waiter"]

    db_session.expire_all()
    stored_item = db_session.get(ProjectInspectionItem, world["item_two"].id)
    assert stored_item is not None
    assert stored_item.standard_revision == 2
    task_item = db_session.scalar(
        select(TaskInspectionItem).where(TaskInspectionItem.task_id == task_id)
    )
    assert task_item is not None
    assert task_item.project_inspection_item_id == stored_item.id
    snapshot = db_session.scalar(
        select(TaskRequirementSnapshot).where(
            TaskRequirementSnapshot.task_inspection_item_id == task_item.id,
            TaskRequirementSnapshot.is_current.is_(True),
        )
    )
    assert snapshot is not None
    # 不論誰先取得來源鎖，新快照都不得停在舊標準。
    assert snapshot.source_standard_revision == stored_item.standard_revision
    assert snapshot.title == stored_item.title == "並行後標準"


@pytest.mark.parametrize("first_action", ["delete", "create"])
def test_delete_and_task_creation_serialize_item_reference(
    engine, db_session, make_client, first_action
):
    """#435：固定交錯，確認引用檢查與 Task 快照互斥。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks")
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    item_id = world["item"].id
    plan = world["admin"].post(
        f"/api/v1/projects/{project_id}/inspection-plans",
        json={"name": "刪除並行"},
    )
    assert plan.status_code == 201, plan.text
    clients = _two_admin_clients(db_session, world, make_client)

    def call(action, client):
        if action == "delete":
            return client.delete(
                f"/api/v1/projects/{project_id}/inspection-items/{item_id}"
            )
        return client.post(
            f"/api/v1/inspection-plans/{plan.json()['id']}/tasks",
            json={"name": "並行任務", "item_ids": [str(item_id)]},
        )

    def matches(statement):
        return "project_inspection_items" in statement and (
            "for update" in statement or "for share" in statement
        )

    other = "create" if first_action == "delete" else "delete"
    with _LockGate(get_engine(), matches) as gate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(call, first_action, clients[0])
            try:
                assert gate.acquired.wait(timeout=10)
                second = executor.submit(call, other, clients[1])
                gate.wait_until_waiter_blocked()
            finally:
                gate.release.set()
            responses = [first.result(timeout=15), second.result(timeout=15)]
    expected = [204, 422] if first_action == "delete" else [201, 409]
    assert [r.status_code for r in responses] == expected, [
        r.text for r in responses
    ]
    db_session.expire_all()
    if first_action == "delete":
        assert db_session.get(ProjectInspectionItem, item_id) is None
        assert db_session.scalar(select(TaskInspectionItem)) is None
    else:
        assert db_session.get(ProjectInspectionItem, item_id) is not None
        assert db_session.scalar(select(TaskInspectionItem)) is not None


@pytest.mark.parametrize("other_action", ["rename", "apply"])
@pytest.mark.parametrize("first_action", ["rename", "other"])
def test_concurrent_item_name_writes_reject_duplicate(
    engine, db_session, make_client, other_action, first_action
):
    """#435：改名與套用共用名稱鎖，名稱檢查不能同時通過。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL advisory locks")
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    operator_id = world["admin_user"].id
    category = TemplateCategory(
        name="並行分類", created_by=operator_id, updated_by=operator_id
    )
    db_session.add(category)
    db_session.flush()
    system = TemplateSystem(
        category_id=category.id,
        name="並行系統",
        created_by=operator_id,
        updated_by=operator_id,
    )
    db_session.add(system)
    db_session.flush()
    template = TemplateItem(
        system_id=system.id,
        sequence=1,
        title=" Target Name ",
        instruction="並行名稱",
        created_by=operator_id,
        updated_by=operator_id,
    )
    db_session.add(template)
    db_session.commit()
    template_id = template.id
    item_id = world["item"].id
    other_id = world["item_two"].id
    clients = _two_admin_clients(db_session, world, make_client)

    def call(action, client):
        if action == "other" and other_action == "apply":
            return client.post(
                f"/api/v1/projects/{project_id}/inspection-items:"
                "apply-template",
                json={"template_id": str(template_id)},
            )
        target_id = item_id if action == "rename" else other_id
        return client.patch(
            f"/api/v1/projects/{project_id}/inspection-items/{target_id}",
            json={"title": "target NAME"},
        )

    other = "other" if first_action == "rename" else "rename"
    with _LockGate(
        get_engine(), lambda stmt: "pg_advisory_xact_lock" in stmt
    ) as gate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(call, first_action, clients[0])
            try:
                assert gate.acquired.wait(timeout=10)
                second = executor.submit(call, other, clients[1])
                gate.wait_until_waiter_blocked()
            finally:
                gate.release.set()
            responses = [first.result(timeout=15), second.result(timeout=15)]
    assert responses[0].status_code in (200, 201), responses[0].text
    assert responses[1].status_code == 409, responses[1].text
    assert responses[1].json()["error"]["code"] == (
        "project_inspection_item.duplicate_name"
    )
    titles = db_session.scalars(
        select(ProjectInspectionItem.title).where(
            ProjectInspectionItem.project_id == project_id
        )
    ).all()
    assert (
        sum(title.strip().casefold() == "target name" for title in titles) == 1
    )


@pytest.mark.parametrize("first_action", ["save", "delete"])
def test_save_template_and_item_deletion_serialize_source(
    engine, db_session, make_client, first_action
):
    """#435：完整複製先於刪除；刪除先到則存為範本回 404。"""
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL source row locks")
    world = _planning_world(db_session, make_client)
    project_id = world["project"].id
    item_id = world["item"].id
    operator_id = world["admin_user"].id
    point = db_session.scalar(
        select(ProjectInspectionPoint).where(
            ProjectInspectionPoint.project_inspection_item_id == item_id
        )
    )
    assert point is not None
    source_point_title = point.title
    db_session.add(
        ProjectEvidenceRequirement(
            project_inspection_item_id=item_id,
            inspection_point_id=point.id,
            min_count=1,
            created_by=operator_id,
            updated_by=operator_id,
        )
    )
    category = TemplateCategory(
        name="來源讀取鎖",
        created_by=operator_id,
        updated_by=operator_id,
    )
    db_session.add(category)
    db_session.flush()
    system = TemplateSystem(
        category_id=category.id,
        name="存為範本與刪除",
        created_by=operator_id,
        updated_by=operator_id,
    )
    db_session.add(system)
    db_session.commit()
    system_id = system.id
    clients = _two_admin_clients(db_session, world, make_client)

    def call(action, client):
        if action == "delete":
            return client.delete(
                f"/api/v1/projects/{project_id}/inspection-items/{item_id}"
            )
        return client.post(
            f"/api/v1/projects/{project_id}/templates",
            json={
                "project_inspection_item_id": str(item_id),
                "system_id": str(system_id),
                "name": "競態存成範本",
            },
        )

    def matches(statement):
        return "from project_inspection_items" in statement and (
            "for update" in statement or "for share" in statement
        )

    other = "delete" if first_action == "save" else "save"
    with _LockGate(get_engine(), matches) as gate:
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(call, first_action, clients[0])
            try:
                assert gate.acquired.wait(timeout=10)
                second = executor.submit(call, other, clients[1])
                gate.wait_until_waiter_blocked()
            finally:
                gate.release.set()
            responses = [first.result(timeout=15), second.result(timeout=15)]
    expected = [201, 204] if first_action == "save" else [204, 404]
    assert [r.status_code for r in responses] == expected, [
        r.text for r in responses
    ]
    db_session.expire_all()
    assert db_session.get(ProjectInspectionItem, item_id) is None
    templates = db_session.scalars(
        select(TemplateItem).where(TemplateItem.system_id == system_id)
    ).all()
    if first_action == "save":
        assert len(templates) == 1
        saved = responses[0].json()
        assert saved["instruction"] == "確認表面狀況"
        assert len(saved["inspection_points"]) == 1
        assert saved["inspection_points"][0]["title"] == source_point_title
        assert (
            saved["inspection_points"][0]["evidence_requirements"][0][
                "min_count"
            ]
            == 1
        )
    else:
        assert templates == []
        assert responses[1].json()["error"]["code"] == "resource.not_found"
