"""檢查 FastAPI yield 依賴的 HTTP 回應與 commit 生命週期。"""

from collections.abc import Generator
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi import APIRouter, Depends
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session

from alembic import command
from app.auth.dependencies import get_db
from app.db.engine import dispose_engine, get_engine
from app.main import create_app
from app.models import User
from tests.db.conftest import build_root_user, create_root_user_with_company
from tests.response_order import observed_client

_BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture
def migrated_engine(db_url: str) -> Generator[Engine, None, None]:
    """依設定使用 SQLite 或受 gate 控制的 PostgreSQL 測試資料庫。"""
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    engine = get_engine()
    try:
        yield engine
    finally:
        dispose_engine()


def _app_with_routes(invalid_user: User | None = None):
    app = create_app()
    router = APIRouter()

    @router.post("/test/commit-before-response")
    def update_user(
        db: Session = Depends(get_db, scope="function"),  # noqa
    ):
        user = db.scalar(select(User).limit(1))
        assert user is not None
        user.name_zh = "已提交"
        return {"updated": True}

    @router.post("/test/commit-failure", status_code=201)
    def add_invalid_user(
        db: Session = Depends(get_db, scope="function"),  # noqa
    ):
        assert invalid_user is not None
        db.add(invalid_user)
        return {"created": True}

    app.include_router(router, prefix="/api/v1")
    return app


def test_commit_finishes_before_http_response_starts(migrated_engine):
    with Session(migrated_engine) as session:
        create_root_user_with_company(session, "C620ORDER")
        session.commit()

    with observed_client(_app_with_routes()) as (client, events):
        response = client.post("/api/v1/test/commit-before-response")

    assert response.status_code == 200
    assert events.index("commit") < events.index("response_started")
    with Session(migrated_engine) as session:
        user = session.scalar(select(User).limit(1))
        assert user is not None
        assert user.name_zh == "已提交"


def test_commit_failure_returns_error_before_success_status(migrated_engine):
    invalid_user = build_root_user("C620FAIL", company_id=uuid4())
    app = _app_with_routes(invalid_user)

    from fastapi.testclient import TestClient

    with TestClient(
        app,
        base_url="https://testserver",
        raise_server_exceptions=False,
    ) as client:
        response = client.post("/api/v1/test/commit-failure")

    assert response.status_code == 500
    with Session(migrated_engine) as session:
        stored = session.get(User, invalid_user.id)
        assert stored is None
