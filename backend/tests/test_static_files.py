"""驗證前端路由 fallback 與 API 路徑隔離。"""

from fastapi.testclient import TestClient

from app.main import create_app


def test_spa_routes_and_pwa_cache_headers(tmp_path, monkeypatch) -> None:
    (tmp_path / "index.html").write_text("<main>InspectFlow</main>")
    (tmp_path / "sw.js").write_text("self.skipWaiting()")
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app-abc123.js").write_text("console.log('ok')")
    monkeypatch.setenv("INSPECTFLOW_STATIC_DIR", str(tmp_path))

    client = TestClient(create_app())
    home = client.get("/")
    deep_link = client.get("/projects/new")
    worker = client.get("/sw.js")
    asset = client.get("/assets/app-abc123.js")

    assert home.text == "<main>InspectFlow</main>"
    assert deep_link.text == home.text
    assert "no-store" in home.headers["cache-control"]
    assert "no-store" in worker.headers["cache-control"]
    assert "immutable" in asset.headers["cache-control"]
    assert client.get("/api/unknown").status_code == 404
    assert client.get("/missing.js").status_code == 404


def test_missing_service_worker_is_not_cacheable(
    monkeypatch, tmp_path
) -> None:
    (tmp_path / "index.html").write_text("<main>InspectFlow</main>")
    monkeypatch.setenv("INSPECTFLOW_STATIC_DIR", str(tmp_path))

    response = TestClient(create_app()).get("/sw.js")

    assert response.status_code == 404
    assert "no-store" in response.headers["cache-control"]
