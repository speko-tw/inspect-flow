"""Helpers for observing database commits and ASGI response timing."""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi.testclient import TestClient
from sqlalchemy import event
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.db.engine import get_engine


@contextmanager
def observed_client(app: ASGIApp) -> Iterator[tuple[TestClient, list[str]]]:
    """Capture commit and response-start ordering for one real request."""
    events: list[str] = []
    engine = get_engine()

    def record_commit(_connection: object) -> None:
        events.append("commit")

    async def observe_send(scope: Scope, receive: Receive, send: Send) -> None:
        async def record_response(message: Message) -> None:
            if message["type"] == "http.response.start":
                events.append("response_started")
            await send(message)

        await app(scope, receive, record_response)

    event.listen(engine, "commit", record_commit)
    try:
        with TestClient(observe_send, base_url="https://testserver") as client:
            yield client, events
    finally:
        event.remove(engine, "commit", record_commit)
