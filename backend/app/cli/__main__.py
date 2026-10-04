"""Backend command line interface."""

from __future__ import annotations

import sys

from app.version import release_identity


def main(arguments: list[str] | None = None) -> int:
    """Run a backend CLI subcommand."""
    args = sys.argv[1:] if arguments is None else arguments
    if args == ["version"]:
        print(release_identity())
        return 0
    print("Usage: python -m app version", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
