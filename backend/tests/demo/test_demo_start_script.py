"""示範啟動腳本的首次登入碼 shell 傳參回歸測試。"""

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parents[3]
START_SCRIPT = REPO / "demo" / "scripts" / "start.sh"
SEED_SCRIPT = REPO / "demo" / "scripts" / "seed.py"


def _write_executable(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents)
    path.chmod(0o755)


def test_start_script_passes_leading_dash_setup_code_to_seed_cli(tmp_path):
    """啟動腳本必須將減號開頭設定碼當作 --code 的值傳入。"""
    fake_repo = tmp_path / "repo"
    work_dir = tmp_path / "demo-work"
    python = fake_repo / "backend" / ".venv" / "bin" / "python"
    node = fake_repo / "frontend" / "node_modules" / ".bin" / "vite"
    bin_dir = tmp_path / "bin"
    python.parent.mkdir(parents=True)
    node.parent.mkdir(parents=True)

    _write_executable(
        python,
        f"#!{sys.executable}\n"
        "import importlib.util, sys\n"
        "if sys.argv[1:3] == ['-m', 'uvicorn']:\n"
        "    sys.exit(0)\n"
        "spec = importlib.util.spec_from_file_location(\n"
        f"    'demo_seed', {str(SEED_SCRIPT)!r})\n"
        "module = importlib.util.module_from_spec(spec)\n"
        "spec.loader.exec_module(module)\n"
        "module.seed = lambda base, code: {'code': code}\n"
        "sys.argv = sys.argv[1:]\n"
        "module.main()\n",
    )
    _write_executable(node, "#!/bin/sh\nexit 0\n")
    _write_executable(
        bin_dir / "make",
        "#!/bin/sh\n"
        'if [ "$3" = init ]; then\n'
        "  echo 'First-login code: -demo-once'\n"
        "fi\n",
    )
    _write_executable(bin_dir / "lsof", "#!/bin/sh\nexit 1\n")
    _write_executable(bin_dir / "curl", "#!/bin/sh\nexit 0\n")

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}:{env['PATH']}",
            "REPO": str(fake_repo),
            "DEMO_WORK_DIR": str(work_dir),
            "BACKEND_PORT": "18300",
            "FRONTEND_PORT": "15300",
        }
    )
    result = subprocess.run(
        ["bash", str(START_SCRIPT)],
        env=env,
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert '"code": "-demo-once"' in result.stdout
