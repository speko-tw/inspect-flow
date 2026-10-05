"""Batched ``IN`` loading helpers that replace per-row lookups (#462)."""

from collections import defaultdict
from collections.abc import Iterable
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

# Keeps every statement far below the bind-parameter limit of SQLite and
# PostgreSQL while still using one query per 500 distinct ids.
_CHUNK_SIZE = 500


def _unique(keys: Iterable[UUID]) -> list[UUID]:
    return list(dict.fromkeys(keys))


def load_grouped(
    db: Session,
    column: Any,
    keys: Iterable[UUID],
    *order_by: Any,
) -> dict[UUID, list[Any]]:
    """Load rows whose ``column`` is in ``keys``, grouped by that column.

    Rows inside each group keep the order given by ``order_by``.
    """
    model = column.class_
    grouped: dict[UUID, list[Any]] = defaultdict(list)
    ids = _unique(keys)
    for start in range(0, len(ids), _CHUNK_SIZE):
        statement = select(model).where(
            column.in_(ids[start : start + _CHUNK_SIZE])
        )
        if order_by:
            statement = statement.order_by(*order_by)
        for row in db.scalars(statement):
            grouped[getattr(row, column.key)].append(row)
    return grouped


def load_by_id(db: Session, model: Any, ids: Iterable[UUID]) -> dict:
    """Load ``model`` rows by primary key in one query per chunk."""
    rows = load_grouped(db, model.id, ids)
    return {key: values[0] for key, values in rows.items()}
