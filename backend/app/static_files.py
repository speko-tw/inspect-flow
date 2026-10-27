"""DPL-R06／R09：單一 image 的靜態前端與執行期子路徑設定。"""

import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Match, Mount
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


def get_base_path() -> str:
    """限制注入內容為路徑片段，避免 HTML 注入與不一致的路由前綴。"""
    value = os.environ.get("INSPECTFLOW_BASE_PATH", "").rstrip("/")
    if value and not re.fullmatch(r"(?:/[A-Za-z0-9_-]+)+", value):
        raise ValueError("INSPECTFLOW_BASE_PATH must be /path or empty")
    return value


class FrontendMount(Mount):
    """DPL-R06：靜態掛載不得攔截 API 的 404／405 或寫入請求。"""

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        path = scope.get("path", "")
        if scope["type"] != "http" or (
            scope.get("method") not in {"GET", "HEAD"}
            or path == "/api"
            or path.startswith("/api/")
        ):
            return Match.NONE, {}
        return super().matches(scope)


class SPAStaticFiles(StaticFiles):
    """DPL-R09：僅改寫入口與 manifest，雜湊資源仍可長期快取。"""

    def __init__(self, directory: Path, base_path: str) -> None:
        super().__init__(directory=directory, html=True)
        self.base_path = base_path
        self.static_directory = directory

    async def get_response(self, path: str, scope: Scope) -> Response:
        """DPL-R06：只對無副檔名的前端路由提供 SPA fallback。"""
        # 編碼的分隔符經 ASGI 解碼後也必須拒絕，不能落入 SPA fallback。
        if ".." in path.split("/"):
            raise HTTPException(status_code=404)
        served_index = path in {"", ".", "index.html"}
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or Path(path).suffix:
                raise
            response = await super().get_response("index.html", scope)
            served_index = True

        if served_index:
            html = (self.static_directory / "index.html").read_text()
            if self.base_path:
                html = html.replace('src="/', f'src="{self.base_path}/')
                html = html.replace('href="/', f'href="{self.base_path}/')
            meta = (
                '<meta name="inspectflow-base-path" '
                f'content="{self.base_path}">'
            )
            html = html.replace("</head>", f"{meta}</head>")
            response = HTMLResponse(html)
        elif path == "manifest.webmanifest":
            manifest: dict[str, Any] = json.loads(
                (self.static_directory / path).read_text()
            )
            manifest["start_url"] = f"{self.base_path}/tasks/"
            manifest["scope"] = f"{self.base_path}/"
            for icon in manifest.get("icons", []):
                icon["src"] = self.base_path + icon["src"]
            response = JSONResponse(
                manifest, media_type="application/manifest+json"
            )

        if served_index or path in {"sw.js", "manifest.webmanifest"}:
            response.headers["Cache-Control"] = (
                "no-cache, no-store, must-revalidate"
            )
        elif path.startswith("assets/"):
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable"
            )
        if scope["method"] == "HEAD":
            response.body = b""
        return response


def mount_frontend(app: FastAPI) -> None:
    """DPL-R09：集中靜態掛載，入口只負責接線（RG-M07）。"""
    base_path = get_base_path()
    static_dir = Path(os.environ.get("INSPECTFLOW_STATIC_DIR", "/app/static"))
    if static_dir.is_dir():
        app.router.routes.append(
            FrontendMount(
                "/",
                app=SPAStaticFiles(static_dir, base_path),
                name="frontend",
            )
        )
