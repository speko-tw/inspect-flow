"""檢查簡易部署的 Compose 設定，不連線 Docker daemon。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def render_config(
    files: tuple[str, ...], env: dict[str, str]
) -> dict[str, Any]:
    """呼叫 Compose CLI 輸出 JSON 設定，不會啟動 Docker。"""
    command = ["docker", "compose"]
    for compose_file in files:
        command.extend(("-f", compose_file))
    command.extend(("config", "--format", "json"))
    result = subprocess.run(
        command,
        check=True,
        capture_output=True,
        cwd=ROOT,
        env=env,
        text=True,
    )
    return json.loads(result.stdout)


def require(condition: bool, message: str) -> None:
    """缺少部署契約時回報可辨識的錯誤。"""
    if not condition:
        raise ValueError(message)


def volume_targets(service: dict[str, Any]) -> set[tuple[str, str, str]]:
    """整理服務掛載的型別、來源與容器路徑。"""
    return {
        (mount["type"], mount.get("source", ""), mount["target"])
        for mount in service.get("volumes", [])
    }


def main() -> int:
    """檢查預設具名 volume 與選用的主機資料夾 overlay。"""
    env = os.environ.copy()
    env.update(
        {
            "INSPECTFLOW_VERSION": "compose-config-check",
            "INSPECTFLOW_HOST_PORT": "18700",
            "INSPECTFLOW_BIND_ADDRESS": "0.0.0.0",
            "INSPECTFLOW_COOKIE_SECURE": "true",
        }
    )
    default = render_config(("compose.yaml",), env)
    services = default["services"]
    require(
        {"migrate", "initialize", "app"} <= set(services),
        "Compose 必須包含 migrate、initialize、app services。",
    )
    require(
        services["migrate"]["command"] == ["alembic", "upgrade", "head"],
        "migrate service 必須套用 Alembic head。",
    )
    require(
        services["initialize"]["depends_on"]["migrate"]["condition"]
        == "service_completed_successfully",
        "initialize 必須等待 migration 成功。",
    )
    require(
        services["app"]["depends_on"]["initialize"]["condition"]
        == "service_completed_successfully",
        "app 必須等待初始化成功。",
    )
    require(
        services["app"].get("healthcheck", {}).get("test"),
        "app 必須定義 healthcheck。",
    )
    require(
        services["app"].get("restart") == "unless-stopped",
        "app restart policy 必須是 unless-stopped。",
    )
    require(
        default.get("volumes", {}).keys()
        >= {"inspectflow-data", "inspectflow-uploads"},
        "預設必須宣告資料庫與上傳具名 volumes。",
    )
    require(
        ("volume", "inspectflow-data", "/data")
        in volume_targets(services["migrate"])
        and ("volume", "inspectflow-data", "/data")
        in volume_targets(services["initialize"])
        and ("volume", "inspectflow-data", "/data")
        in volume_targets(services["app"])
        and ("volume", "inspectflow-uploads", "/uploads")
        in volume_targets(services["app"]),
        "預設 named volumes 必須掛載到 migration、初始化及 app 服務。",
    )
    port = services["app"]["ports"][0]
    require(
        port["published"] == "18700"
        and port["target"] == 8000
        and port["host_ip"] == "0.0.0.0",
        "預設 port/address 必須是 0.0.0.0:18700->8000。",
    )

    bind_env = env.copy()
    bind_env.update(
        {
            "INSPECTFLOW_DATA_DIR": "/tmp/inspectflow-compose-check/data",
            "INSPECTFLOW_UPLOADS_DIR": (
                "/tmp/inspectflow-compose-check/uploads"
            ),
            "INSPECTFLOW_HOST_PORT": "18707",
            "INSPECTFLOW_BIND_ADDRESS": "127.0.0.1",
        }
    )
    bind = render_config(("compose.yaml", "compose.bind.yaml"), bind_env)
    bind_services = bind["services"]
    for service_name in ("migrate", "initialize", "app"):
        require(
            ("bind", bind_env["INSPECTFLOW_DATA_DIR"], "/data")
            in volume_targets(bind_services[service_name]),
            f"{service_name} 必須使用設定的資料 bind mount。",
        )
    require(
        (
            "bind",
            bind_env["INSPECTFLOW_UPLOADS_DIR"],
            "/uploads",
        )
        in volume_targets(bind_services["app"]),
        "app 必須使用設定的 uploads bind mount。",
    )
    bind_port = bind_services["app"]["ports"][0]
    require(
        bind_port["published"] == "18707"
        and bind_port["target"] == 8000
        and bind_port["host_ip"] == "127.0.0.1",
        "bind overlay 必須保留可設定的 host address 與 port。",
    )
    print("Compose config checks passed (no Docker daemon contacted).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        KeyError,
        OSError,
        subprocess.CalledProcessError,
        ValueError,
    ) as exc:
        print(f"Compose config check failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
