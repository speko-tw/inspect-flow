"""Fixtures for command tests that need a real migrated database."""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR

BACKEND_DIR = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def dispose_shared_engine():
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv(DATABASE_URL_ENV_VAR, url)
    command.upgrade(Config(str(BACKEND_DIR / "alembic.ini")), "head")
    return url


@pytest.fixture
def engine(migrated_url: str) -> Generator[Engine, None, None]:
    engine = create_engine_from_settings(migrated_url)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine)
