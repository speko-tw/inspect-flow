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
    assert client.get("/..%2fsecret").status_code == 404
    assert client.post("/api/unknown").status_code == 404
    assert client.post("/api/v1/health").status_code == 405
    assert client.post("/projects/new").status_code == 404
    assert client.head("/projects/new").content == b""


def test_missing_service_worker_is_not_cacheable(
    monkeypatch, tmp_path
) -> None:
    (tmp_path / "index.html").write_text("<main>InspectFlow</main>")
    monkeypatch.setenv("INSPECTFLOW_STATIC_DIR", str(tmp_path))

    response = TestClient(create_app()).get("/sw.js")

    assert response.status_code == 404
    assert "no-store" in response.headers["cache-control"]


def test_runtime_base_path_rewrites_entry_and_manifest(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text(
        '<head><script src="./assets/app.js"></script></head>'
        '<link href="/manifest.webmanifest">'
    )
    (tmp_path / "manifest.webmanifest").write_text(
        '{"icons": [{"src": "/icons/icon.png"}]}'
    )
    monkeypatch.setenv("INSPECTFLOW_STATIC_DIR", str(tmp_path))
    monkeypatch.setenv("INSPECTFLOW_BASE_PATH", "/inspectflow")
    client = TestClient(create_app())
    entry = client.get("/projects/new")
    assert 'src="/inspectflow/assets/app.js"' in entry.text
    assert 'href="/inspectflow/manifest.webmanifest"' in entry.text
    assert 'content="/inspectflow"' in entry.text
    manifest = client.get("/manifest.webmanifest").json()
    assert manifest["start_url"] == "/inspectflow/tasks/"
    assert manifest["scope"] == "/inspectflow/"
    assert manifest["icons"][0]["src"] == "/inspectflow/icons/icon.png"


def test_reject_invalid_base_path(monkeypatch):
    import pytest

    monkeypatch.setenv("INSPECTFLOW_BASE_PATH", '/bad"><script>')
    with pytest.raises(ValueError, match="INSPECTFLOW_BASE_PATH"):
        create_app()


def test_root_deep_link_resolves_relative_build_assets(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text(
        '<head><script src="./assets/app.js"></script></head>'
    )
    monkeypatch.setenv("INSPECTFLOW_STATIC_DIR", str(tmp_path))
    monkeypatch.delenv("INSPECTFLOW_BASE_PATH", raising=False)
    response = TestClient(create_app()).get("/projects/new")
    assert 'src="/assets/app.js"' in response.text
