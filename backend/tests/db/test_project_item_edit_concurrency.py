"""PostgreSQL concurrency coverage for concurrent project item edits."""

from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event, Lock

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, event, select
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
