"""Shared API schema types."""

from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class EntityIdResponse(BaseModel):
    """Minimal response model for an entity UUID identifier."""

    id: UUID = Field(default_factory=uuid4)
