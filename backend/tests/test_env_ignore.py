"""Env files holding secrets stay out of git; the template does not (#293)."""

import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]


def _is_ignored(path: str) -> bool:
    """Ask git whether ``path`` matches an ignore rule.

    ``--no-index`` makes git check the rules even for files that are
    already tracked (``.env.example`` is), which it skips by default.
    Exit code 0 means ignored, 1 means not ignored; anything else
    (for example 128) is a git error and must fail the test.
    """
    result = subprocess.run(
        ["git", "check-ignore", "--quiet", "--no-index", path],
        cwd=REPO_ROOT,
        check=False,
    )
    assert result.returncode in (0, 1), (
        f"git check-ignore failed with exit code {result.returncode}"
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
