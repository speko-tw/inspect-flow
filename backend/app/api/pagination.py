"""提供清單端點共用的篩選與 cursor 分頁工具。"""

import base64
import binascii
import json
import re
import uuid
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import String, and_, bindparam, or_, select
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode

_CURSOR_ALPHABET = re.compile(r"[A-Za-z0-9_-]+")


def ilike_contains(column: Any, value: str) -> Any:
    """Build a literal, case-insensitive substring condition."""
    escaped = (
        value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    )
    pattern = bindparam("list_search_query", f"%{escaped}%", type_=String())
    return column.ilike(pattern, escape="\\")


def page_cursor_key(cursor: str | None) -> tuple[datetime, uuid.UUID] | None:
    """解析清單游標中的建立時間與 UUID。

    API-R08 依時間與 UUID 排序；保留微秒才能準確續接同秒資料。
    """
    if cursor is None:
        return None
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict) or set(payload) != {"t", "id"}:
            raise ValueError("invalid cursor")
        timestamp = datetime.fromisoformat(payload["t"])
        identifier = uuid.UUID(payload["id"])
        if timestamp.tzinfo is None:
            raise ValueError("cursor has no timezone")
        key = (timestamp.astimezone(UTC), identifier)
        if encode_page_cursor(*key) != cursor:
            raise ValueError("noncanonical cursor")
        return key
    except (
        ValueError,
        TypeError,
        AttributeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


def encode_page_cursor(created_at: datetime, identifier: uuid.UUID) -> str:
    """編碼分頁游標並保留建立時間精度。

    API-R08 以建立時間與 UUID 排序，游標必須保留相同的排序鍵。
    """
    payload = {
        "t": created_at.astimezone(UTC).isoformat(timespec="microseconds"),
        "id": str(identifier),
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def page(
    db: Session,
    model: type[Any],
    *,
    cursor: str | None,
    limit: int,
    serialize: Callable[[Any], Any] | None = None,
    serialize_batch: Callable[[Sequence[Any]], list[Any]] | None = None,
    filters: Sequence[Any] = (),
) -> dict[str, Any]:
    """Page rows ordered by ``(created_at, id)``.

    Pass ``serialize`` to render one row at a time, or ``serialize_batch``
    to render the whole page at once (one batched load per child table
    instead of per-row queries).
    """
    if (serialize is None) == (serialize_batch is None):
        raise ValueError("pass exactly one of serialize, serialize_batch")
    statement = select(model).where(*filters)
    key = page_cursor_key(cursor)
    if key is not None:
        statement = statement.where(
            or_(
                model.created_at > key[0],
                and_(model.created_at == key[0], model.id > key[1]),
            )
        )
    rows = db.scalars(
        statement.order_by(model.created_at, model.id).limit(limit + 1)
    ).all()
    items = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = encode_page_cursor(last.created_at, last.id)
    if serialize_batch is not None:
        rendered = serialize_batch(items)
    else:
        assert serialize is not None
        rendered = [serialize(item) for item in items]
    return {"items": rendered, "next_cursor": next_cursor}


def page_by_text_key(
    db: Session,
    model: type[Any],
    *,
    sort_key: Any,
    key_name: str,
    cursor: str | None,
    limit: int,
    serialize: Callable[[Any], Any],
    filters: Sequence[Any] = (),
) -> dict[str, Any]:
    """Page rows ordered by a required text field and UUID (API-R08)."""
    cursor_key = _text_page_cursor_key(cursor, key_name)
    statement = select(model).where(*filters)
    if cursor_key is not None:
        value, identifier = cursor_key
        statement = statement.where(
            or_(
                sort_key > value,
                and_(sort_key == value, model.id > identifier),
            )
        )
    rows = db.scalars(
        statement.order_by(sort_key, model.id).limit(limit + 1)
    ).all()
    items = rows[:limit]
    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = _encode_text_page_cursor(
            getattr(last, key_name), last.id, key_name
        )
    return {
        "items": [serialize(item) for item in items],
        "next_cursor": next_cursor,
    }


def _encode_text_page_cursor(
    value: str, identifier: uuid.UUID, key_name: str
) -> str:
    payload = {"field": key_name, "value": value, "id": str(identifier)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _text_page_cursor_key(
    cursor: str | None, key_name: str
) -> tuple[str, uuid.UUID] | None:
    if cursor is None:
        return None
    try:
        if not _CURSOR_ALPHABET.fullmatch(cursor):
            raise ValueError("invalid cursor alphabet")
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        payload = json.loads(raw.decode("utf-8"))
        if (
            not isinstance(payload, dict)
            or set(payload) != {"field", "value", "id"}
            or payload["field"] != key_name
            or not isinstance(payload["value"], str)
        ):
            raise ValueError("invalid cursor payload")
        identifier = uuid.UUID(payload["id"])
        value = payload["value"]
        if _encode_text_page_cursor(value, identifier, key_name) != cursor:
            raise ValueError("noncanonical cursor")
        return value, identifier
    except (
        ValueError,
        TypeError,
        AttributeError,
        UnicodeDecodeError,
        binascii.Error,
        json.JSONDecodeError,
    ) as exc:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422) from exc


def write_call(
    call: Callable[..., Any],
    *args: Any,
    error_mapper: Callable[[Exception], APIError | None],
) -> Any:
    try:
        return call(*args)
    except Exception as exc:
        mapped = error_mapper(exc)
        if mapped is None:
            raise
        raise mapped from exc
