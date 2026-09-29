"""Isolated migrated database and HTTP client for management API tests."""

from collections.abc import Callable, Generator
from pathlib import Path

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from app.main import create_app

_BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _dispose_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv(DATABASE_URL_ENV_VAR, url)
    command.upgrade(Config(str(_BACKEND_DIR / "alembic.ini")), "head")
    return url


@pytest.fixture
def engine(migrated_url: str) -> Generator[Engine, None, None]:
    db_engine = create_engine_from_settings(migrated_url)
    try:
        yield db_engine
    finally:
        db_engine.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@pytest.fixture
def make_client(engine: Engine) -> Callable[[], TestClient]:
    def create_client() -> TestClient:
        return TestClient(create_app(), base_url="https://testserver")

    return create_client
