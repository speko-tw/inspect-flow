"""FEV-AC13：T4 新路由有唯一登入宣告，專案兩層權限另由真 API 驗證。"""

from app.auth.access import AccessLevel, iter_route_access
from app.main import create_app


def test_office_version_route_requires_login_and_is_not_public():
    path = (
        "/api/v1/inspection-tasks/{task_id}/photos/{photo_id}/office-version"
    )
    routes = [
        info
        for info in iter_route_access(create_app())
        if info.path == path and info.method == "PUT"
    ]
    assert len(routes) == 1
    assert routes[0].declaration is not None
    assert routes[0].declaration.level is AccessLevel.LOGIN_REQUIRED
