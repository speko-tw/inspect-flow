"""Tests for the release version interfaces."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.version import get_commit, get_version

BACKEND = Path(__file__).resolve().parents[1]


def test_version_api_is_public_and_returns_only_version_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_version.cache_clear()
    get_commit.cache_clear()
    monkeypatch.setenv("INSPECTFLOW_VERSION", "9.8.7")
    monkeypatch.setenv("INSPECTFLOW_COMMIT", "abc1234")

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/version")

    assert response.status_code == 200
    assert response.json() == {"version": "9.8.7", "commit": "abc1234"}


def test_uvicorn_startup_logs_release_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("INSPECTFLOW_VERSION", "9.8.7")
    monkeypatch.setenv("INSPECTFLOW_COMMIT", "abc1234")
    get_version.cache_clear()
    get_commit.cache_clear()
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "0",
        ],
        cwd=BACKEND,
        env=os.environ.copy(),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        output, _ = process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        process.terminate()
        output, _ = process.communicate(timeout=5)
    assert "InspectFlow v9.8.7 (abc1234)" in output


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
    get_commit.cache_clear()
    monkeypatch.setattr("app.version.subprocess.run", fail)

    assert get_commit() is None


def test_commit_is_cached_between_api_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_commit.cache_clear()
    monkeypatch.delenv("INSPECTFLOW_COMMIT", raising=False)
    calls = 0

    def fake_run(
        *_args: object, **_kwargs: object
    ) -> subprocess.CompletedProcess[str]:
        nonlocal calls
        calls += 1
        return subprocess.CompletedProcess([], 0, "abc1234\n", "")

    monkeypatch.setattr("app.version.subprocess.run", fake_run)
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/version").json()["commit"] == "abc1234"
        assert client.get("/api/v1/version").json()["commit"] == "abc1234"
    assert calls == 1
