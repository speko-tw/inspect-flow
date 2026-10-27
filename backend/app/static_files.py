"""簡易試用單一 image 的前端靜態檔處理。"""

from pathlib import Path

from starlette.exceptions import HTTPException
from starlette.responses import Response
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


class SPAStaticFiles(StaticFiles):
    """提供前端建置檔，並將用戶端路由導回 ``index.html``。"""

    async def get_response(self, path: str, scope: Scope) -> Response:
        served_index = path in {"", ".", "index.html"}
        try:
            response = await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
            if path == "api" or path.startswith("api/"):
                raise
            if Path(path).suffix:
                raise
            response = await super().get_response("index.html", scope)
            served_index = True

        if served_index or path == "sw.js":
            response.headers["Cache-Control"] = (
                "no-cache, no-store, must-revalidate"
            )
        elif path.startswith("assets/"):
            response.headers["Cache-Control"] = (
                "public, max-age=31536000, immutable"
            )
        return response
