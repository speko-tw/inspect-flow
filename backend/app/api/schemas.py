"""Shared API schema types."""

from uuid import UUID

from pydantic import BaseModel


class EntityIdResponse(BaseModel):
    """Minimal response model for an entity UUID identifier."""

    id: UUID
