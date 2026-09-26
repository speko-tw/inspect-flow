"""Contract tests for route prefixes and content-type handling
(API-AC01, API-AC04, API-AC05).
"""

from collections.abc import Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.api.errors import ErrorCode, register_error_handlers
from app.main import create_app


def _iter_business_routes(
    app: FastAPI,
) -> Iterator[tuple[APIRoute, str]]:
    """Yield every business ``APIRoute`` mounted on ``app`` together
    with its effective, fully-prefixed path.

    ``app.routes`` used to hold ``APIRoute`` objects directly, with
    ``include_router(..., prefix=...)`` rewriting each one's
    ``.path`` to already include the prefix. The installed FastAPI
    no longer flattens an included router this way: it groups the
    included router's routes behind an internal node on
    ``app.routes`` instead, and that node's own ``APIRoute``
    objects keep their *unprefixed* path. Each such node still
    exposes ``effective_candidates()`` -- the same lookup FastAPI
    itself uses to resolve a request -- which resolves the
    original ``APIRoute`` together with its effective, fully
    prefixed path; this is used via duck typing (``hasattr``)
    rather than importing any internal class, so it keeps working
    whether or not a given route happens to be flattened.
    """
    for route in app.routes:
        if isinstance(route, APIRoute):
            yield route, route.path
            continue
        effective_candidates = getattr(route, "effective_candidates", None)
        if not callable(effective_candidates):
            continue
        # No stable public type to annotate against here -- this
        # is a duck-typed lookup on an internal FastAPI grouping
        # node -- so each item is verified via ``isinstance``
        # below before being yielded.
        candidates: Any = effective_candidates()
        for context in candidates:
            original_route = getattr(context, "original_route", None)
            path = getattr(context, "path", None)
            if isinstance(original_route, APIRoute) and isinstance(path, str):
                yield original_route, path


def _media_type(content_type: str) -> str:
    """Return the media type portion of a ``Content-Type`` header,
    dropping any parameters (e.g. ``; charset=utf-8``) so the
    comparison does not depend on whether a charset is present.
    """
    return content_type.split(";", 1)[0].strip().lower()


class _Item(BaseModel):
    """A minimal JSON body used only to exercise content-type
    handling; it is not a domain model.
    """

    name: str


def _build_content_type_app() -> FastAPI:
    """A standalone app with its own JSON test endpoint (API-AC05).

    Registers the shared error handlers itself, exactly like
    ``create_app()`` does, so a request-body content-type mismatch
    is translated through the same envelope. The route is only
    mounted here, never on the real app.
    """
    app = FastAPI()
    register_error_handlers(app)

    @app.post("/echo")
    def echo(item: _Item) -> _Item:
        return item

    return app


def test_all_api_routes_are_prefixed_with_api_v1() -> None:
    """API-AC01: every business ``APIRoute`` on the real app starts
    with ``/api/v1/``; framework-generated documentation routes
    (``/openapi.json``, ``/docs``, ...) are not ``APIRoute``
    instances and are excluded.
    """
    app = create_app()

    business_routes = list(_iter_business_routes(app))

    # Guard against an empty set trivially satisfying the
    # assertion below (RG-S03).
    assert len(business_routes) > 0

    for _, path in business_routes:
        assert path.startswith("/api/v1/"), path

    # Cross-check against the public, documented OpenAPI schema
    # (whose "paths" are exactly the schema-included APIRoute
    # paths) so the assertion above does not rely solely on the
    # duck-typed traversal in ``_iter_business_routes``.
    schema_paths = list(app.openapi()["paths"])
    assert len(schema_paths) > 0
    for path in schema_paths:
        assert path.startswith("/api/v1/"), path


def test_documentation_routes_are_not_api_routes() -> None:
    """API-AC01: the framework's own documentation routes exist on
    the app but are not ``APIRoute`` instances, so the prefix check
    above never has to consider them.
    """
    app = create_app()

    doc_paths = {"/openapi.json", "/docs", "/docs/oauth2-redirect"}
    matching_routes = [
        route
        for route in app.routes
        if getattr(route, "path", None) in doc_paths
    ]

    assert len(matching_routes) >= len(doc_paths)
    for route in matching_routes:
        assert not isinstance(route, APIRoute), route.path


def test_health_response_content_type_is_json() -> None:
    """API-AC04: ``GET /api/v1/health`` responds with a JSON media
    type. Parsed as a media type (splitting off any ``charset``
    parameter) rather than compared as a literal string, so an
    added charset parameter would not break this assertion.
    """
    client = TestClient(create_app())

    response = client.get("/api/v1/health")

    assert response.status_code == 200
    assert _media_type(response.headers["content-type"]) == (
        "application/json"
    )


def test_non_json_content_type_is_rejected_with_shared_envelope() -> None:
    """API-AC05: sending a JSON body with a non-JSON
    ``Content-Type`` (``text/plain``) on a test-only JSON endpoint
    fails with 4xx and the shared error envelope, since the shared
    request-parsing layer only attempts JSON decoding when the
    ``Content-Type`` names a JSON media type; a ``text/plain``
    body is instead passed through as raw bytes and fails
    validation against the declared Pydantic model.
    """
    client = TestClient(_build_content_type_app())

    response = client.post(
        "/echo",
        content=b'{"name": "widget"}',
        headers={"content-type": "text/plain"},
    )

    assert 400 <= response.status_code < 500
    body = response.json()
    assert body["error"]["code"] == ErrorCode.REQUEST_VALIDATION_FAILED.value


def test_json_content_type_is_parsed_and_accepted() -> None:
    """API-AC05: the same request body, sent with
    ``Content-Type: application/json`` on the same test-only
    endpoint, is parsed correctly and handled successfully.
    """
    client = TestClient(_build_content_type_app())

    response = client.post(
        "/echo",
        content=b'{"name": "widget"}',
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 200
    assert response.json() == {"name": "widget"}
