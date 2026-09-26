"""Contract tests for API entity identifiers (API-AC08, API-R06)."""

from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.schemas import EntityIdResponse


def test_entity_id_is_a_uuid_string_not_an_incrementing_integer() -> None:
    """API-AC08: an entity id serialized through the response model
    is a UUID string, not a decimal integer.
    """
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
    """API-AC08: the ``id`` field on the response model is
    required, not optional.
    """
    with pytest.raises(ValidationError):
        # Omit id on purpose to check that the field is required.
        EntityIdResponse()  # pyright: ignore[reportCallIssue]
