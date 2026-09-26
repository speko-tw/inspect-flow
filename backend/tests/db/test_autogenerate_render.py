"""Tests for ``alembic/env.py``'s ``render_item`` (issue #199).

Drives a real ``alembic revision --autogenerate`` against an empty
database through Alembic's public Python API
(``alembic.config.Config`` / ``alembic.command``), using a copy of
the project's own ``env.py`` and ``script.py.mako`` under a
temporary script location -- so this exercises the same code path a
developer running ``alembic revision --autogenerate`` locally does,
not a hand-rolled call to ``render_item`` in isolation. Without
``render_item``, autogenerate renders ``UTCDateTime``/
``BoundedString`` (``app.db.base``, ``app.models._bounded_string``)
as themselves and adds an ``import app...`` line for them, which
issue #139's rule (``test_no_app_imports_in_migrations`` below)
forbids in a real migration under ``alembic/versions``.
"""

import shutil
from pathlib import Path

from alembic.config import Config

from alembic import command
from tests.db.test_db_access_rules import find_forbidden_db_imports

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_DIR = _BACKEND_DIR / "alembic"


def _new_script_location(tmp_path: Path) -> Path:
    """Copy this project's ``env.py``/``script.py.mako`` into a
    fresh, empty script directory under ``tmp_path`` (its own
    ``versions/`` starts empty, unlike ``backend/alembic/versions``)
    so ``command.revision`` runs against the real environment
    module without touching the repository's own migration chain.
    """
    script_dir = tmp_path / "alembic_autogen"
    (script_dir / "versions").mkdir(parents=True)
    shutil.copy(_ALEMBIC_DIR / "env.py", script_dir / "env.py")
    shutil.copy(_ALEMBIC_DIR / "script.py.mako", script_dir / "script.py.mako")
    return script_dir


def _autogenerate_against_empty_db(tmp_path: Path) -> str:
    script_dir = _new_script_location(tmp_path)
    cfg = Config()
    cfg.set_main_option("script_location", str(script_dir))

    command.revision(cfg, message="render_item_test", autogenerate=True)

    generated = list((script_dir / "versions").glob("*.py"))
    assert len(generated) == 1, generated
    return generated[0].read_text(encoding="utf-8")


def test_autogenerate_renders_builtin_types_for_app_defined_columns(
    db_url, tmp_path
):
    """``db_url`` points ``INSPECTFLOW_DATABASE_URL`` at a fresh,
    empty database (SQLite by default; see ``conftest.py``), so the
    generated migration is a full "create everything" diff covering
    every model -- including ``UTCDateTime`` (e.g.
    ``User.created_at``) and ``BoundedString`` (e.g. ``User.email``)
    columns.
    """
    content = _autogenerate_against_empty_db(tmp_path)

    assert "sa.DateTime(timezone=True)" in content
    assert "sa.String(length=" in content
    assert "UTCDateTime" not in content
    assert "BoundedString" not in content


def test_autogenerate_output_has_no_app_import(db_url, tmp_path):
    """Reuses ``test_db_access_rules.py``'s own AST-based scanner
    (issue #139) to prove the generated file passes the same check
    that would reject it if it were committed under
    ``alembic/versions``.
    """
    content = _autogenerate_against_empty_db(tmp_path)

    hits = find_forbidden_db_imports(content, forbidden=frozenset({"app"}))

    assert hits == [], hits
