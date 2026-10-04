"""Release version and source commit information."""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)
VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"


def get_version() -> str:
    """Return the configured release version."""
    override = os.getenv("INSPECTFLOW_VERSION")
    if override:
        return override
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        logger.warning("VERSION file is unavailable")
        return "unknown"


def get_commit() -> str | None:
    """Return an injected commit or the current short Git SHA."""
    override = os.getenv("INSPECTFLOW_COMMIT")
    if override:
        return override
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            check=True,
            capture_output=True,
            cwd=VERSION_FILE.parent,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    commit = result.stdout.strip()
    return commit or None


def release_identity() -> str:
    """Format the release version and optional commit for display."""
    version = get_version()
    commit = get_commit()
    return (
        f"InspectFlow v{version} ({commit})"
        if commit
        else f"InspectFlow v{version}"
    )
