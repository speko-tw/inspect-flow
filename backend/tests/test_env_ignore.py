"""Env files holding secrets stay out of git; the template does not (#293)."""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _is_ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "--quiet", path],
        cwd=REPO_ROOT,
        check=False,
    )
    return result.returncode == 0


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.local",
        ".env.production",
        "backend/.env",
        "backend/.env.local",
        "frontend/.env",
        "frontend/.env.local",
        "frontend/.env.production",
    ],
)
def test_env_files_are_ignored(path):
    assert _is_ignored(path)


def test_env_example_is_not_ignored():
    assert not _is_ignored(".env.example")
