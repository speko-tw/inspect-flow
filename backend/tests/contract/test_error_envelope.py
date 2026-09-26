"""Contract tests for the shared error envelope (API-AC02, API-AC03,
API-AC07, API-AC09, API-AC10).
"""

import re
import subprocess
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
HAND_WRITTEN_TABLE_RE = re.compile(
    r"(?i)error[_-]?codes?\.(md|json|ya?ml|csv|txt)$"
)


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
def test_app() -> FastAPI:
    app = FastAPI()
    register_error_handlers(app)
    app.include_router(_build_test_router())
    return app


@pytest.fixture
def test_client(test_app: FastAPI) -> TestClient:
    return TestClient(test_app, raise_server_exceptions=False)


def test_unmounted_path_returns_404_with_resource_not_found_code() -> None:
    """API-AC02: an unmounted path on the real app returns 404 with
    the shared ``resource.not_found`` code.
    """
    client = TestClient(create_app())

    response = client.get("/api/v1/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND


def test_unhandled_exception_returns_json_envelope(
    test_client: TestClient,
) -> None:
    """API-AC03: a route that raises an uncaught exception returns
    500 with a JSON envelope, not a plain-text response.
    """
    response = test_client.get("/boom")

    assert response.status_code == 500
    assert response.headers["content-type"] == "application/json"
    body = response.json()
    assert body["error"]["code"] == ErrorCode.SERVER_INTERNAL_ERROR


def test_three_error_codes_are_distinct_non_empty_strings(
    test_client: TestClient,
) -> None:
    """API-AC07: validation (422), not-found (404) and unhandled
    (500) errors each carry a distinct, non-empty ``error.code``.
    """
    validation_response = test_client.get("/validate/not-an-int")
    missing_response = test_client.get("/missing")
    boom_response = test_client.get("/boom")

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
    test_client: TestClient,
) -> None:
    """API-AC09: the three codes triggered above, and every
    ``ErrorCode`` member, match the dot-namespace regex.
    """
    validation_code = test_client.get("/validate/not-an-int").json()["error"][
        "code"
    ]
    missing_code = test_client.get("/missing").json()["error"]["code"]
    boom_code = test_client.get("/boom").json()["error"]["code"]

    for code in (validation_code, missing_code, boom_code):
        assert DOT_NAMESPACE_RE.match(code)

    for member in ErrorCode:
        assert DOT_NAMESPACE_RE.match(member.value)


def test_http_exception_preserves_status_and_headers(
    test_client: TestClient,
) -> None:
    """The StarletteHTTPException handler keeps the framework's
    status code and headers (e.g. 405 Allow) while still emitting
    the shared envelope with a ``request.*`` code, since 405 is
    not one of the three formal codes.
    """
    response = test_client.post("/get-only")

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
    generation function.
    """
    repo_root = Path(__file__).resolve().parents[3]

    result = subprocess.run(
        ["git", "ls-files"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, f"git ls-files failed: {result.stderr}"

    offending = [
        path
        for path in result.stdout.splitlines()
        if HAND_WRITTEN_TABLE_RE.search(path)
    ]
    assert offending == []
