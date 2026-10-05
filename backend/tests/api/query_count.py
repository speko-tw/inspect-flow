"""Count SELECT statements issued while one HTTP request runs (F14)."""

from sqlalchemy import event

from app.db.engine import get_engine


def select_count(client, url: str, **params) -> tuple[int, int]:
    """Return ``(SELECT statements, items in the page)`` for a GET."""
    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        response = client.get(url, params=params)
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert response.status_code == 200, response.text
    body = response.json()
    rows = body.get("items", body.get("tasks"))
    return len(statements), 1 if rows is None else len(rows)
