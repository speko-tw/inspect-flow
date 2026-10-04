"""Tests for the release version interfaces."""

import logging
import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.version import get_commit

BACKEND = Path(__file__).resolve().parents[1]


def test_version_api_is_public_and_returns_only_version_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INSPECTFLOW_VERSION", "9.8.7")
    monkeypatch.setenv("INSPECTFLOW_COMMIT", "abc1234")

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/version")

    assert response.status_code == 200
    assert response.json() == {"version": "9.8.7", "commit": "abc1234"}


def test_startup_logs_release_identity(
    caplog: pytest.LogCaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INSPECTFLOW_VERSION", "9.8.7")
    monkeypatch.setenv("INSPECTFLOW_COMMIT", "abc1234")
    caplog.set_level(logging.INFO)

    with TestClient(create_app()):
        pass

    assert "InspectFlow v9.8.7 (abc1234)" in caplog.text


def test_backend_cli_prints_release_identity() -> None:
    env = {
        **os.environ,
        "INSPECTFLOW_VERSION": "9.8.7",
        "INSPECTFLOW_COMMIT": "abc1234",
    }
    result = subprocess.run(
        [sys.executable, "-m", "app", "version"],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        check=True,
        text=True,
    )

    assert result.stdout.strip() == "InspectFlow v9.8.7 (abc1234)"


def test_commit_is_omitted_when_git_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail(
        *_args: object, **_kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        raise FileNotFoundError("git unavailable")

    monkeypatch.delenv("INSPECTFLOW_COMMIT", raising=False)
    monkeypatch.setattr("app.version.subprocess.run", fail)

    assert get_commit() is None
