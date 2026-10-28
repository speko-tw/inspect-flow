"""檢查簡易部署的 Compose 設定，不連線 Docker daemon。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
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


def check_image_tags() -> None:
    """直接執行 workflow 的驗證片段，避免測試與發布規則分歧。"""
    workflow = (ROOT / ".github/workflows/publish-image.yml").read_text(
        encoding="utf-8"
    )
    step = workflow.split("      - name: Validate image tag\n", 1)[1]
    step = step.split("      - uses:", 1)[0]
    require(
        "          REF: ${{ github.ref }}\n" in step,
        "手動發布必須以 github.ref 檢查來源分支。",
    )
    snippet = textwrap.dedent(
        step.split("          python - <<'PY'\n", 1)[1].split(
            "          PY\n", 1
        )[0]
    )
    cases = (
        ("push", "v0.5.2", "0.5.2", "refs/tags/v0.5.2", None),
        ("push", "v0.5.2", "0.5.1", "refs/tags/v0.5.2", "version PR"),
        ("push", "vlatest", "0.5.2", "refs/tags/vlatest", "release tags"),
        ("push", "v1.2.3-rc", "0.5.2", "refs/tags/v1.2.3-rc", "release tags"),
        (
            "workflow_dispatch",
            "pilot-test",
            "0.5.2",
            "refs/heads/topic",
            "from main",
        ),
        ("workflow_dispatch", "pilot-test", "0.5.2", "refs/heads/main", None),
        (
            "workflow_dispatch",
            "latest",
            "0.5.2",
            "refs/heads/main",
            "release tags",
        ),
        (
            "workflow_dispatch",
            "1.2.3-rc",
            "0.5.2",
            "refs/heads/main",
            "release tags",
        ),
        (
            "workflow_dispatch",
            "pilot-test",
            "0.5.2",
            "refs/tags/main",
            "from main",
        ),
        ("push", "vpilot-test", "0.5.2", "refs/tags/vpilot-test", None),
        ("push", "vbad/tag", "0.5.2", "refs/tags/vbad/tag", "invalid Docker"),
        ("push", "0.5.2", "0.5.2", "refs/tags/0.5.2", "start with v"),
    )
    with tempfile.TemporaryDirectory(prefix="image-tag-check-") as tmp:
        directory = Path(tmp)
        for event, tag, version, ref, error in cases:
            # VERSION 的空白也須與正式執行時採相同處理。
            (directory / "VERSION").write_text(
                f"  {version} \n", encoding="utf-8"
            )
            output = directory / "output"
            output.write_text("", encoding="utf-8")
            env = os.environ.copy()
            env.update(
                EVENT_NAME=event,
                REF_NAME=tag,
                REF=ref,
                INPUT_TAG=tag,
                GITHUB_OUTPUT=str(output),
                GITHUB_SHA="1234567890abcdef",
            )
            result = subprocess.run(
                [sys.executable, "-c", snippet],
                cwd=directory,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            if error is None:
                value = tag[1:] if event == "push" else tag
                stable = str(event == "push" and tag == "v0.5.2").lower()
                expected = f"commit=1234567\nvalue={value}\nstable={stable}\n"
                require(
                    result.returncode == 0
                    and output.read_text(encoding="utf-8") == expected,
                    f"{event} {tag} 應成功且輸出正確：{result.stderr}",
                )
            else:
                require(
                    result.returncode != 0
                    and error in result.stderr
                    and not output.read_text(encoding="utf-8"),
                    f"{event} {tag} 應拒絕並說明原因：{result.stderr}",
                )
            print(
                f"Image tag: {event} {tag} VERSION={version} {ref}: "
                f"exit={result.returncode} PASS"
            )
    print("Image tag checks passed (no image published).")


def main() -> int:
    """檢查預設具名 volume 與選用的主機資料夾 設定。"""
    check_image_tags()
    env = os.environ.copy()
    env.update(
        {
            "INSPECTFLOW_IMAGE_TAG": "compose-config-check",
            "INSPECTFLOW_HOST_PORT": "8080",
            "INSPECTFLOW_BIND_ADDRESS": "127.0.0.1",
            "INSPECTFLOW_DATA_DIR": "",
            "INSPECTFLOW_UPLOADS_DIR": "",
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
        port["published"] == "8080"
        and port["target"] == 8000
        and port["host_ip"] == "127.0.0.1",
        "預設 port/address 必須是 127.0.0.1:8080->8000。",
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
    bind = render_config(("compose.yaml",), bind_env)
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
        "bind 設定 必須保留可設定的 host address 與 port。",
    )
    require(default["name"] == "inspectflow", "專案名稱必須固定。")
    for name in ("inspectflow-data", "inspectflow-uploads"):
        require(
            default["volumes"][name]["name"] == name, "volume 名稱須固定。"
        )
    require(
        "INSPECTFLOW_COOKIE_SECURE" not in services["app"]["environment"],
        "不得提供關閉 Secure cookie 的設定。",
    )
    require(
        all(
            s["logging"]["options"]["max-size"] == "10m"
            for s in services.values()
        ),
        "全部服務必須限制 log 大小。",
    )
    require(
        "env_file" not in services["app"],
        "不得把整份 .env 轉送容器。",
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
