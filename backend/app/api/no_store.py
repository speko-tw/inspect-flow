"""為所有 `/api/` 回應加上 `Cache-Control: no-store`（#711）。

為什麼：`/auth/me`、有效權限與任務資料都依登入者而異，共用電腦或
中間 proxy 若快取，下一位使用者可能看到上一位的內容。逐路由設定
容易漏，所以在 app 層統一補上；路由已明確設定 `Cache-Control` 時
（例如帶 max-age 的靜態型回應）尊重該設定，不覆蓋。
採純 ASGI 而非 `BaseHTTPMiddleware`，避免影響串流回應（照片下載）。
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_API_PREFIX = "/api/"


class NoStoreMiddleware:
    """對 `/api/` 路徑補上 `Cache-Control: no-store`，不覆蓋既有值。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self, scope: Scope, receive: Receive, send: Send
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_api = scope["path"].startswith(_API_PREFIX)
        is_pwa_worker = scope["path"] == "/sw.js"
        if not is_api and not is_pwa_worker:
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                if is_pwa_worker:
                    headers["Cache-Control"] = (
                        "no-cache, no-store, must-revalidate"
                    )
                elif "cache-control" not in headers:
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_header)
