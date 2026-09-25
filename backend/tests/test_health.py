"""Tests for the health check endpoint (SKL-AC01)."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

FAKE_SECRET_KEY = "fake-secret-do-not-use-in-response"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SECRET_KEY", FAKE_SECRET_KEY)
    app = create_app()
    return TestClient(app)


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert FAKE_SECRET_KEY not in response.text
