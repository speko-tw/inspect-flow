"""Contracts for optional field-level validation errors (API-R10–R18)."""

import logging
import re

import pytest
from fastapi import APIRouter, FastAPI, Header, Query
from fastapi import Path as ApiPath
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict, Field

from app.api.errors import (
    FIELD_ERROR_CODE_DESCRIPTIONS,
    APIError,
    DescribedStrEnum,
    ErrorCode,
    FieldErrorCode,
    build_error_code_descriptions,
    register_error_handlers,
)


class NestedBody(BaseModel):
    name: str = Field(min_length=2, max_length=4)
    amount: int = Field(gt=0)


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[NestedBody]
    labels: dict[str, int]
    choice: int | str


class EscapedBody(BaseModel):
    slash: int = Field(alias="a/b")
    tilde: int = Field(alias="~c")


def _client() -> TestClient:
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.post("/body")
    def body(payload: Body) -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    return TestClient(app, raise_server_exceptions=False)


def test_json_body_errors_have_safe_repeatable_pointers_and_codes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """API-R10/R13：重複 union 分支錯誤只保留一個安全路徑。"""
    client = _client()
    payload = {
        "items": [
            {"amount": 0},
            {"name": "sentinel-long-name", "amount": -1},
        ],
        "labels": {"sentinel-dynamic-key": "sentinel-value"},
        "choice": [],
        "sentinel-extra-key": "sentinel-extra-value",
    }

    with caplog.at_level(logging.ERROR):
        first = client.post("/body", json=payload)
        second = client.post("/body", json=payload)

    assert first.status_code == 422
    assert first.json() == second.json()
    error = first.json()["error"]
    assert error["code"] == "request.validation_failed"
    fields = error["fields"]
    assert all(set(field) == {"path", "code"} for field in fields)
    assert [field["path"] for field in fields] == [
        "/items/0/name",
        "/items/0/amount",
        "/items/1/name",
        "/items/1/amount",
        "/labels",
        "/choice",
        "",
    ]
    by_path = {field["path"]: field["code"] for field in fields}
    assert by_path["/items/0/name"] == "field.required"
    assert by_path["/items/0/amount"] == "field.out_of_range"
    assert by_path["/items/1/name"] == "field.too_long"
    assert by_path["/items/1/amount"] == "field.out_of_range"
    assert by_path["/labels"] == "field.invalid"
    assert by_path["/choice"] == "field.invalid"
    assert by_path[""] == "field.invalid"
    for sentinel in (
        "sentinel-long-name",
        "sentinel-dynamic-key",
        "sentinel-value",
        "sentinel-extra-key",
        "sentinel-extra-value",
    ):
        assert sentinel not in first.text
        assert sentinel not in caplog.text


def test_field_errors_are_limited_to_100_and_exclude_non_json_errors() -> None:
    """API-R10：先移除重複路徑，再套用不同錯誤的數量上限。"""
    client = _client()
    response = client.post(
        "/body",
        json={
            "items": [{} for _ in range(60)],
            "labels": {},
            "choice": 1,
        },
    )
    assert response.status_code == 422
    assert len(response.json()["error"]["fields"]) == 100

    deduplicated = client.post(
        "/body",
        json={
            "items": [{} for _ in range(49)],
            "labels": {},
            "choice": [],
            "sentinel-extra-key": "ignored",
        },
    )
    fields = deduplicated.json()["error"]["fields"]
    assert len(fields) == 100
    assert [field["path"] for field in fields].count("/choice") == 1
    assert fields[-1] == {"path": "", "code": "field.invalid"}

    malformed = client.post(
        "/body",
        content="{",
        headers={"content-type": "application/json"},
    )
    assert malformed.status_code == 422
    assert "fields" not in malformed.json()["error"]

    wrong_type = client.post(
        "/body",
        content='{"items": []}',
        headers={"content-type": "text/plain"},
    )
    assert wrong_type.status_code == 422
    assert "fields" not in wrong_type.json()["error"]


def test_field_error_description_map_is_generated_from_its_enum() -> None:
    assert FIELD_ERROR_CODE_DESCRIPTIONS == build_error_code_descriptions(
        FieldErrorCode
    )
    assert set(FIELD_ERROR_CODE_DESCRIPTIONS) == {
        member.value for member in FieldErrorCode
    }


def test_field_error_deduplication_keeps_distinct_codes_for_same_path() -> (
    None
):
    """去重只移除 API-R10 中 path 與 code 都相同的錯誤。"""
    from app.api.errors import _deduplicate_field_errors

    assert _deduplicate_field_errors(
        [
            {"path": "/value", "code": "field.invalid"},
            {"path": "/value", "code": "field.invalid"},
            {"path": "/value", "code": "field.required"},
        ]
    ) == [
        {"path": "/value", "code": "field.invalid"},
        {"path": "/value", "code": "field.required"},
    ]


def test_all_field_error_codes_follow_the_dot_namespace() -> None:
    pattern = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")
    assert all(pattern.fullmatch(member.value) for member in FieldErrorCode)


def test_template_codes_and_temporary_enum_are_generated_and_too_short_maps():
    class TemporaryFieldErrorCode(DescribedStrEnum):
        TEMPORARY = ("temporary.example", "A temporary test code.")

    generated = build_error_code_descriptions(TemporaryFieldErrorCode)
    assert generated == {"temporary.example": "A temporary test code."}
    assert "template.sequence_duplicate" in FIELD_ERROR_CODE_DESCRIPTIONS

    client = _client()
    response = client.post(
        "/body",
        json={
            "items": [{"name": "x", "amount": 1}],
            "labels": {},
            "choice": 1,
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["fields"] == [
        {"path": "/items/0/name", "code": "field.too_short"}
    ]


def test_mixed_body_and_query_errors_only_include_body_fields() -> None:
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.post("/mixed")
    def mixed(payload: Body, search: str = Query(min_length=2)) -> dict:
        return {"ok": True}

    app.include_router(router)
    response = TestClient(app).post(
        "/mixed?search=x",
        json={
            "items": [{"name": "x", "amount": 1}],
            "labels": {},
            "choice": 1,
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["fields"] == [
        {"path": "/items/0/name", "code": "field.too_short"}
    ]


def test_query_path_and_header_errors_do_not_produce_fields() -> None:
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.post("/body/{item_id}")
    def body_sources(
        payload: Body,
        item_id: int = ApiPath(gt=0),
        search: str = Query(min_length=2),
        x_token: str = Header(min_length=2),
    ) -> dict:
        return {"ok": True}

    app.include_router(router)
    response = TestClient(app).post(
        "/body/0?search=x",
        headers={"x-token": "x"},
        json={"items": [], "labels": {}, "choice": 1},
    )

    assert response.status_code == 422
    assert "fields" not in response.json()["error"]


def test_json_pointer_escapes_declared_aliases_and_body_root() -> None:
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.post("/escaped")
    def escaped(payload: EscapedBody) -> dict[str, bool]:
        return {"ok": True}

    app.include_router(router)
    response = TestClient(app).post("/escaped", json={"a/b": "x", "~c": "y"})

    assert response.status_code == 422
    assert response.json()["error"]["fields"] == [
        {"path": "/a~1b", "code": "field.invalid"},
        {"path": "/~0c", "code": "field.invalid"},
    ]


def test_api_error_fields_are_422_only_and_preserve_details() -> None:
    app = FastAPI()
    register_error_handlers(app)
    router = APIRouter()

    @router.post("/invalid")
    def invalid_endpoint() -> None:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=["legacy detail"],
            fields=[
                {
                    "path": "/title",
                    "code": "field.invalid",
                    "unexpected": "must not be serialized",
                }
            ],
        )

    @router.post("/conflict")
    def conflict_endpoint() -> None:
        raise APIError(
            ErrorCode.TEMPLATE_NAME_CONFLICT,
            409,
            fields=[{"path": "/title", "code": "field.invalid"}],
        )

    app.include_router(router)
    client = TestClient(app)

    invalid = client.post("/invalid")
    assert invalid.status_code == 422
    assert invalid.json() == {
        "error": {
            "code": ErrorCode.REQUEST_VALIDATION_FAILED.value,
            "details": ["legacy detail"],
            "fields": [{"path": "/title", "code": "field.invalid"}],
        }
    }
    conflict = client.post("/conflict")
    assert conflict.status_code == 409
    assert conflict.json() == {"error": {"code": "template.name_conflict"}}
