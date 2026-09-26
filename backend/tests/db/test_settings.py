"""Tests for the database connection settings (DBF-AC04)."""

from pathlib import Path

from sqlalchemy import text

from app.db import settings
from app.db.engine import create_engine_from_settings

_REPO_ROOT = Path(__file__).resolve().parents[3]


def test_env_var_is_documented_in_env_example():
    content = (_REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    assert settings.DATABASE_URL_ENV_VAR in content


def test_default_url_used_when_env_var_is_unset(monkeypatch):
    monkeypatch.delenv(settings.DATABASE_URL_ENV_VAR, raising=False)

    resolved = settings.get_database_url()

    assert resolved == settings.default_database_url()
    assert resolved == f"sqlite:///{settings.default_sqlite_path()}"
    assert settings.default_sqlite_path().is_absolute()


def test_default_url_used_when_env_var_is_empty(monkeypatch):
    monkeypatch.setenv(settings.DATABASE_URL_ENV_VAR, "")

    assert settings.get_database_url() == settings.default_database_url()


def test_env_var_overrides_default(monkeypatch, tmp_path):
    db_path = tmp_path / "custom.db"
    monkeypatch.setenv(settings.DATABASE_URL_ENV_VAR, f"sqlite:///{db_path}")

    assert settings.get_database_url() == f"sqlite:///{db_path}"


def test_engine_creates_file_at_configured_path(monkeypatch, tmp_path):
    db_path = tmp_path / "nested" / "configured.db"
    monkeypatch.setenv(settings.DATABASE_URL_ENV_VAR, f"sqlite:///{db_path}")

    engine = create_engine_from_settings(settings.get_database_url())
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()

    assert db_path.exists()


def test_engine_creates_file_at_replaced_default_path(monkeypatch, tmp_path):
    """DBF-AC04's default-path case, with a real connection.

    Replaces the module's default SQLite path constant with one
    under ``tmp_path`` (rather than connecting to the real default
    ``backend/data/inspectflow.db``, which this test must never
    touch), unsets the env var so ``get_database_url()`` falls
    back to that replaced default, and drives a real connection
    through it -- checking both that the file is created and that
    its parent directory is created automatically.
    """
    replaced_default = tmp_path / "nested" / "inspectflow.db"
    monkeypatch.setattr(settings, "_DEFAULT_SQLITE_PATH", replaced_default)
    monkeypatch.delenv(settings.DATABASE_URL_ENV_VAR, raising=False)

    assert settings.get_database_url() == f"sqlite:///{replaced_default}"

    engine = create_engine_from_settings()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    finally:
        engine.dispose()

    assert replaced_default.exists()
