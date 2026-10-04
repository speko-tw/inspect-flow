"""Check that the repository's release version is synchronized."""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path


def read_versions(root: Path) -> dict[str, str]:
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    backend = tomllib.loads(
        (root / "backend/pyproject.toml").read_text(encoding="utf-8")
    )["project"]["version"]
    frontend = json.loads(
        (root / "frontend/package.json").read_text(encoding="utf-8")
    )["version"]
    return {"VERSION": version, "backend": backend, "frontend": frontend}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--root", type=Path, default=Path(__file__).resolve().parent.parent
    )
    args = parser.parse_args()
    try:
        versions = read_versions(args.root)
    except (
        OSError,
        KeyError,
        json.JSONDecodeError,
        tomllib.TOMLDecodeError,
    ) as exc:
        print(f"version check failed: {exc}", file=sys.stderr)
        return 1
    if len(set(versions.values())) != 1:
        values = ", ".join(
            f"{name}={value}" for name, value in versions.items()
        )
        print(f"version mismatch: {values}", file=sys.stderr)
        return 1
    print(f"version check passed: {versions['VERSION']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
