"""Static scans over ``backend/app`` and ``backend/alembic``
enforcing DBF-AC01 (no direct database driver imports) and DBF-AC03
(no ``create_all`` shortcut).

Both rules are checked with ``ast`` over every ``*.py`` file under
either directory (never by string-matching Python source, which
would also flag mentions inside docstrings/comments -- see
``app/db/engine.py``'s own module docstring, which names
``sqlite3`` in prose). The Alembic scaffold's non-Python files
(``alembic.ini``, ``script.py.mako``) are covered separately with a
plain text search, since ``create_all`` there would not be Python
source ``ast`` can parse.
"""

import ast
from pathlib import Path

# backend/tests/db/test_db_access_rules.py -> backend/
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_APP_DIR = _BACKEND_DIR / "app"
_ALEMBIC_DIR = _BACKEND_DIR / "alembic"

# DBF-R01: SQLAlchemy is the only allowed database access path.
# These are the modules a direct import of a database driver would
# name, whichever DB-API package supplies them.
_FORBIDDEN_DB_MODULES = frozenset(
    {
        "sqlite3",
        "pysqlite2",
        "psycopg",
        "psycopg2",
        "psycopg2cffi",
        "asyncpg",
        "pg8000",
        "aiosqlite",
    }
)


def _iter_python_files() -> list[Path]:
    files = sorted(_APP_DIR.rglob("*.py")) + sorted(_ALEMBIC_DIR.rglob("*.py"))
    return files


def _top_level_module(dotted_name: str) -> str:
    return dotted_name.split(".", 1)[0]


def find_forbidden_db_imports(
    source: str, forbidden: frozenset[str] = _FORBIDDEN_DB_MODULES
) -> list[tuple[int, str]]:
    """Return ``(line_number, module_name)`` for every import of a
    forbidden database driver module in ``source``.

    Covers ``import x`` / ``import x.y``, ``from x import y``, and
    the dynamic-import forms ``importlib.import_module("x")`` and
    ``__import__("x")`` when the module name is a string literal
    (a non-literal argument cannot be checked statically and is not
    flagged).
    """
    tree = ast.parse(source)
    hits: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                top = _top_level_module(alias.name)
                if top in forbidden:
                    hits.append((node.lineno, top))
        elif isinstance(node, ast.ImportFrom):
            if node.module is not None:
                top = _top_level_module(node.module)
                if top in forbidden:
                    hits.append((node.lineno, top))
        elif isinstance(node, ast.Call):
            hits.extend(_forbidden_dynamic_import(node, forbidden))
    return hits


def _forbidden_dynamic_import(
    node: ast.Call, forbidden: frozenset[str]
) -> list[tuple[int, str]]:
    func = node.func
    is_import_module = (
        isinstance(func, ast.Attribute)
        and func.attr == "import_module"
        and isinstance(func.value, ast.Name)
        and func.value.id == "importlib"
    )
    is_dunder_import = isinstance(func, ast.Name) and func.id == "__import__"
    if not (is_import_module or is_dunder_import):
        return []
    if not node.args:
        return []
    first_arg = node.args[0]
    if not (
        isinstance(first_arg, ast.Constant)
        and isinstance(first_arg.value, str)
    ):
        return []
    top = _top_level_module(first_arg.value)
    if top in forbidden:
        return [(node.lineno, top)]
    return []


def find_create_all_calls(source: str) -> list[int]:
    """Return the line numbers of every ``create_all`` attribute
    access or call in ``source`` (DBF-R03).

    Flags the attribute access itself (``x.create_all``), not only
    a completed call, so ``method = obj.create_all`` followed by a
    later ``method()`` is still caught.
    """
    tree = ast.parse(source)
    return sorted(
        {
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute) and node.attr == "create_all"
        }
    )


def _scan_python_files() -> tuple[
    list[tuple[Path, int, str]], list[tuple[Path, int]]
]:
    forbidden_imports: list[tuple[Path, int, str]] = []
    create_all_calls: list[tuple[Path, int]] = []
    for path in _iter_python_files():
        source = path.read_text(encoding="utf-8")
        for lineno, module in find_forbidden_db_imports(source):
            forbidden_imports.append((path, lineno, module))
        for lineno in find_create_all_calls(source):
            create_all_calls.append((path, lineno))
    return forbidden_imports, create_all_calls


# Non-Python, plain-text files under the Alembic scaffold that are
# meaningful to scan for a literal "create_all" (unlike __pycache__
# byte-compiled files, which are neither Python source nor text).
_ALEMBIC_TEXT_FILE_NAMES = frozenset({"README", "script.py.mako"})


def _scan_non_python_alembic_files_for_create_all() -> list[Path]:
    hits: list[Path] = []
    for path in sorted(_ALEMBIC_DIR.rglob("*")):
        if not path.is_file() or path.name not in _ALEMBIC_TEXT_FILE_NAMES:
            continue
        if "create_all" in path.read_text(encoding="utf-8"):
            hits.append(path)
    ini_path = _BACKEND_DIR / "alembic.ini"
    if "create_all" in ini_path.read_text(encoding="utf-8"):
        hits.append(ini_path)
    return hits


def test_scanned_python_files_are_non_empty_and_cover_env_py():
    """Guards the scan itself: an empty file list would make every
    assertion below vacuously pass.
    """
    # Each root is checked on its own (DBF-AC01, DBF-AC03 name both),
    # so losing one of them cannot hide behind the other's files.
    for root in (_APP_DIR, _ALEMBIC_DIR):
        assert root.is_dir(), f"scan root missing: {root}"
        assert any(root.rglob("*.py")), f"no Python files in {root}"

    files = _iter_python_files()
    relative = {path.relative_to(_BACKEND_DIR) for path in files}
    assert Path("alembic/env.py") in relative


def test_no_forbidden_database_driver_imports():
    forbidden_imports, _ = _scan_python_files()

    assert not forbidden_imports, "\n".join(
        f"{path}:{lineno}: forbidden import of {module!r}"
        for path, lineno, module in forbidden_imports
    )


def test_no_create_all_calls_in_app_or_alembic_python_source():
    _, create_all_calls = _scan_python_files()

    assert not create_all_calls, "\n".join(
        f"{path}:{lineno}: found create_all"
        for path, lineno in create_all_calls
    )


def test_no_create_all_in_non_python_alembic_scaffold_files():
    hits = _scan_non_python_alembic_files_for_create_all()

    assert not hits, [str(path) for path in hits]


# -- Self-tests for the scanner functions themselves --------------
#
# These feed synthetic source strings straight to
# find_forbidden_db_imports/find_create_all_calls (bypassing the
# filesystem walk) to prove the scanner catches real violations and
# does not false-positive on prose that merely mentions a forbidden
# module name.


def test_scanner_detects_plain_import_of_forbidden_module():
    hits = find_forbidden_db_imports("import sqlite3\n")

    assert hits == [(1, "sqlite3")]


def test_scanner_detects_from_import_of_forbidden_module():
    source = "from psycopg import connect\n"

    hits = find_forbidden_db_imports(source)

    assert hits == [(1, "psycopg")]


def test_scanner_detects_dynamic_import_forms():
    source = (
        "import importlib\n"
        'importlib.import_module("psycopg2")\n'
        '__import__("aiosqlite")\n'
    )

    hits = find_forbidden_db_imports(source)

    assert hits == [(2, "psycopg2"), (3, "aiosqlite")]


def test_scanner_ignores_forbidden_module_name_in_docstring():
    source = (
        '"""This module never imports sqlite3 directly; it always\n'
        "goes through SQLAlchemy.\n"
        '"""\n'
        "\n"
        "import sqlalchemy\n"
    )

    hits = find_forbidden_db_imports(source)

    assert hits == []


def test_scanner_ignores_forbidden_module_name_in_comment():
    source = "# do not import psycopg2 here\nimport sqlalchemy\n"

    hits = find_forbidden_db_imports(source)

    assert hits == []


def test_scanner_detects_create_all_call():
    source = "Base.metadata.create_all(engine)\n"

    hits = find_create_all_calls(source)

    assert hits == [1]


def test_scanner_detects_create_all_attribute_access_without_call():
    source = "method = Base.metadata.create_all\n"

    hits = find_create_all_calls(source)

    assert hits == [1]


def test_scanner_ignores_create_all_mentioned_in_a_comment():
    source = "# tests may call Base.metadata.create_all() directly\nx = 1\n"

    hits = find_create_all_calls(source)

    assert hits == []
