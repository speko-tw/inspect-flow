"""Contract tests for the shared error envelope (API-AC02, API-AC03,
API-AC07, API-AC09, API-AC10).
"""

import logging
import re
import subprocess
from collections.abc import Iterable, Mapping
from pathlib import Path

import pytest
from fastapi import APIRouter, FastAPI
from fastapi.testclient import TestClient
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.errors import (
    ERROR_CODE_DESCRIPTIONS,
    APIError,
    DescribedStrEnum,
    ErrorCode,
    build_error_code_descriptions,
    register_error_handlers,
)
from app.main import create_app

DOT_NAMESPACE_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")

# Files that legitimately mention every error code because they
# *define* or *verify* the dot-namespace convention itself -- they
# are not a separate hand-maintained lookup table competing with
# ``build_error_code_descriptions`` (API-AC10c).
ALLOWED_CODE_MENTIONS: frozenset[str] = frozenset(
    {
        "backend/app/api/errors.py",
        "backend/tests/contract/test_error_envelope.py",
        "docs/specs/api-conventions/spec.md",
        "docs/specs/api-conventions/plan.md",
        "docs/intents/03-decisions-and-stack.md",
    }
)


def _find_hand_written_tables(
    files: Mapping[str, str], codes: Iterable[str]
) -> list[str]:
    """Return the paths (sorted) that look like a hand-written
    error-code table: not on the exemption list, and whose content
    mentions every one of ``codes``.
    """
    code_list = list(codes)
    offending = [
        path
        for path, text in files.items()
        if path not in ALLOWED_CODE_MENTIONS
        and all(code in text for code in code_list)
    ]
    return sorted(offending)


class SupersetCode(DescribedStrEnum):
    """A test-only enum with an extra member (API-AC10b)."""

    REQUEST_VALIDATION_FAILED = (
        "request.validation_failed",
        "test",
    )
    RESOURCE_NOT_FOUND = ("resource.not_found", "test")
    SERVER_INTERNAL_ERROR = ("server.internal_error", "test")
    RESOURCE_CONFLICT = ("resource.conflict", "test extra member")


class SwappedCode(DescribedStrEnum):
    """A test-only enum missing one member and adding another
    (API-AC10b).
    """

    REQUEST_VALIDATION_FAILED = (
        "request.validation_failed",
        "test",
    )
    RESOURCE_NOT_FOUND = ("resource.not_found", "test")
    SERVER_CONFIG_ERROR = ("server.config_error", "swapped-in member")


def _build_test_router() -> APIRouter:
    router = APIRouter()

    @router.get("/validate/{item_id}")
    def validate(item_id: int) -> dict[str, int]:
        return {"item_id": item_id}

    @router.get("/missing")
    def missing() -> None:
        raise APIError(
            ErrorCode.RESOURCE_NOT_FOUND,
            404,
            "the requested item does not exist",
        )

    @router.get("/boom")
    def boom() -> None:
        raise RuntimeError("boom")

    @router.get("/get-only")
    def get_only() -> dict[str, str]:
        return {"status": "ok"}

    return router


@pytest.fixture
def error_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(_build_test_router())
    return app


@pytest.fixture
def error_client(error_app: FastAPI) -> TestClient:
    return TestClient(error_app, raise_server_exceptions=False)


def test_unmounted_path_returns_404_with_resource_not_found_code() -> None:
    """API-AC02: an unmounted path on the real app returns 404 with
    the shared ``resource.not_found`` code.
    """
    client = TestClient(create_app())

    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND


def test_unhandled_exception_returns_json_envelope(
    error_client: TestClient,
) -> None:
    """API-AC03: a route that raises an uncaught exception returns
    500 with a JSON envelope, not a plain-text response.
    """
    response = error_client.get("/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert body["error"]["code"] == ErrorCode.SERVER_INTERNAL_ERROR


def test_unhandled_exception_does_not_log_secret_message(
    error_app: FastAPI,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Regression: an unhandled exception's message may embed
    sensitive request data (e.g. an authorization token); the
    handler must not log that message or a traceback, only the
    exception type and the request line (RG-M17).
    """
    secret = "synthetic-secret-token"

    router = APIRouter()

    @router.get("/leaky")
    def leaky() -> None:
        raise RuntimeError(f"Bearer {secret}")

    error_app.include_router(router)
    client = TestClient(error_app, raise_server_exceptions=False)

    with caplog.at_level(logging.ERROR, logger="app.api.errors"):
        response = client.get("/leaky")

    assert response.status_code == 500
    assert secret not in response.text

    app_records = [
        record for record in caplog.records if record.name == "app.api.errors"
    ]
    assert len(app_records) >= 1
    for record in app_records:
        assert secret not in record.getMessage()
        assert record.exc_info is None
        assert not record.exc_text

    assert "RuntimeError" in caplog.text


def test_three_error_codes_are_distinct_non_empty_strings(
    error_client: TestClient,
) -> None:
    """API-AC07: validation (422), not-found (404) and unhandled
    (500) errors each carry a distinct, non-empty ``error.code``.
    """
    validation_response = error_client.get("/validate/not-an-int")
    missing_response = error_client.get("/missing")
    boom_response = error_client.get("/boom")

    assert validation_response.status_code == 422
    assert missing_response.status_code == 404
    assert boom_response.status_code == 500

    validation_code = validation_response.json()["error"]["code"]
    missing_code = missing_response.json()["error"]["code"]
    boom_code = boom_response.json()["error"]["code"]

    for code in (validation_code, missing_code, boom_code):
        assert isinstance(code, str)
        assert code != ""

    assert len({validation_code, missing_code, boom_code}) == 3
    assert validation_code == ErrorCode.REQUEST_VALIDATION_FAILED
    assert missing_code == ErrorCode.RESOURCE_NOT_FOUND
    assert boom_code == ErrorCode.SERVER_INTERNAL_ERROR


def test_error_codes_follow_dot_namespace_pattern(
    error_client: TestClient,
) -> None:
    """API-AC09: the three codes triggered above, and every
    ``ErrorCode`` member, match the dot-namespace regex.
    """
    validation_code = error_client.get("/validate/not-an-int").json()["error"][
        "code"
    ]
    missing_code = error_client.get("/missing").json()["error"]["code"]
    boom_code = error_client.get("/boom").json()["error"]["code"]

    for code in (validation_code, missing_code, boom_code):
        assert DOT_NAMESPACE_RE.match(code)

    for member in ErrorCode:
        assert DOT_NAMESPACE_RE.match(member.value)


def test_http_exception_preserves_status_and_headers(
    error_client: TestClient,
) -> None:
    """The StarletteHTTPException handler keeps the framework's
    status code and headers (e.g. 405 Allow) while still emitting
    the shared envelope with a ``request.*`` code, since 405 is
    not one of the three formal codes.
    """
    response = error_client.post("/get-only")

    assert response.status_code == 405
    assert "allow" in {k.lower() for k in response.headers}
    assert (
        response.json()["error"]["code"] == ErrorCode.REQUEST_VALIDATION_FAILED
    )


def test_explicit_http_exception_404_maps_to_resource_not_found() -> None:
    """A directly raised StarletteHTTPException(404) also maps to
    ``resource.not_found``, matching the framework-raised case.
    """
    router = APIRouter()

    @router.get("/explicit-404")
    def explicit_404() -> None:
        raise StarletteHTTPException(status_code=404)

    app = FastAPI()
    register_error_handlers(app)
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/explicit-404")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND


def test_description_mapping_matches_error_code_members() -> None:
    """API-AC10a: ``build_error_code_descriptions`` is the single
    source of truth for ``ERROR_CODE_DESCRIPTIONS``; its keys match
    ``ErrorCode`` exactly.
    """
    produced = build_error_code_descriptions(ErrorCode)

    assert set(produced) == {member.value for member in ErrorCode}
    assert produced == ERROR_CODE_DESCRIPTIONS


def test_description_mapping_tracks_test_only_enum_changes() -> None:
    """API-AC10b: adding or removing a member from a test-only
    enum changes the generation function's output accordingly,
    proving the mapping is not a separately hand-maintained table.
    """
    superset = build_error_code_descriptions(SupersetCode)
    swapped = build_error_code_descriptions(SwappedCode)

    assert set(superset) == {member.value for member in SupersetCode}
    assert "resource.conflict" in superset
    assert "resource.conflict" not in ERROR_CODE_DESCRIPTIONS

    assert set(swapped) == {member.value for member in SwappedCode}
    assert "server.config_error" in swapped
    assert "server.internal_error" not in swapped


def test_no_hand_written_error_code_table_exists() -> None:
    """API-AC10c: no file in the repository looks like a
    hand-maintained error-code table kept separate from the
    generation function. Judged by content (does the file mention
    every code?), not by filename, so a table such as
    ``docs/api-error-reference.md`` cannot slip past a filename-only
    check.
    """
    repo_root = Path(__file__).resolve().parents[3]

    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"git ls-files failed: {result.stderr}"

    tracked_paths = [p for p in result.stdout.splitlines() if p]

    files: dict[str, str] = {}
    for rel_path in tracked_paths:
        abs_path = repo_root / rel_path
        try:
            files[rel_path] = abs_path.read_text(errors="ignore")
        except (OSError, UnicodeDecodeError):
            # Unreadable or binary files cannot contain a
            # hand-written error-code table; skip them.
            continue

    # RG-S03: prove the scan actually looked at files, so a scan
    # that silently finds nothing cannot masquerade as a pass.
    assert len(files) > 0

    codes = {member.value for member in ErrorCode}
    offending = _find_hand_written_tables(files, codes)

    assert offending == []


def test_find_hand_written_tables_flags_content_based_table() -> None:
    """A file outside the exemption list is flagged when its
    content mentions every error code, regardless of its filename.
    """
    codes = {member.value for member in ErrorCode}
    files = {
        "docs/api-error-reference.md": (
            "| code | meaning |\n"
            "| request.validation_failed | invalid request |\n"
            "| resource.not_found | missing resource |\n"
            "| server.internal_error | server failure |\n"
        )
    }

    assert _find_hand_written_tables(files, codes) == [
        "docs/api-error-reference.md"
    ]


def test_find_hand_written_tables_ignores_partial_mentions() -> None:
    """A file mentioning only one of the three codes in passing is
    not a table and must not be flagged.
    """
    codes = {member.value for member in ErrorCode}
    files = {"docs/other.md": "See resource.not_found for details."}

    assert _find_hand_written_tables(files, codes) == []


def test_find_hand_written_tables_exempts_allowed_files() -> None:
    """Every exempted path is skipped even when its content
    mentions all three codes, since these files define or verify
    the convention rather than duplicate it.
    """
    codes = {member.value for member in ErrorCode}
    files = {
        path: (
            "request.validation_failed resource.not_found "
            "server.internal_error"
        )
        for path in ALLOWED_CODE_MENTIONS
    }

    assert _find_hand_written_tables(files, codes) == []
