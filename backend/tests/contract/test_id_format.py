"""Contract tests for API entity identifiers."""

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.schemas import EntityIdResponse


def test_entity_id_is_a_uuid_string_not_an_incrementing_integer() -> None:
    app = FastAPI()
    entity_id = uuid4()

    @app.get("/entity", response_model=EntityIdResponse)
    def get_entity() -> EntityIdResponse:
        return EntityIdResponse(id=entity_id)

    response = TestClient(app).get("/entity")

    assert response.status_code == 200
    value = response.json()["id"]
    assert isinstance(value, str)
    assert str(UUID(value)) == value
    assert not value.isdecimal()
    assert value == str(entity_id)


def test_entity_id_response_requires_id() -> None:
    with pytest.raises(ValidationError):
        EntityIdResponse()  # pyright: ignore[reportCallIssue]
