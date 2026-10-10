"""PostgreSQL concurrency coverage for concurrent project item edits."""

from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event, Lock
from time import monotonic

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
    ProjectInspectionItem,
    ProjectInspectionItemChange,
    TaskInspectionItem,
    TaskRequirementSnapshot,
)
from tests.api.test_inspection_planning_api import _planning_world

_BACKEND_DIR = Path(__file__).resolve().parents[2]


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
        json={"item_ids": [str(item.id)]},
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
        normalized = statement.lower()
        return (
            "project_inspection_items" in normalized
            and "for no key update" in normalized
        )

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
        return create_client.post(task_url, json={"item_ids": [str(item.id)]})

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
