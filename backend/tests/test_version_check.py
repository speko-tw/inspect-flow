"""Tests for the repository version consistency gate."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / "scripts/check-version.py"


def write_fixture(root: Path, backend: str, frontend: str) -> None:
    (root / "backend").mkdir()
    (root / "frontend").mkdir()
    (root / "VERSION").write_text("0.3.0\n", encoding="utf-8")
    (root / "backend/pyproject.toml").write_text(
        f'[project]\nversion = "{backend}"\n', encoding="utf-8"
    )
    (root / "frontend/package.json").write_text(
        json.dumps({"version": frontend}), encoding="utf-8"
    )


def run_check(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECKER), "--root", str(root)],
        capture_output=True,
        check=False,
        text=True,
    )


def test_version_check_accepts_matching_sources(tmp_path: Path) -> None:
    write_fixture(tmp_path, "0.3.0", "0.3.0")

    result = run_check(tmp_path)

    assert result.returncode == 0
    assert "version check passed: 0.3.0" in result.stdout


def test_version_check_fails_when_a_manifest_is_changed(
    tmp_path: Path,
) -> None:
    write_fixture(tmp_path, "0.3.1", "0.3.0")

    result = run_check(tmp_path)

    assert result.returncode != 0
    assert "version mismatch" in result.stderr
