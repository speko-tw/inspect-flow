"""Admin-only, read-only audit log query (ALG-R22–ALG-R24)."""

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.pagination import encode_page_cursor, page_cursor_key
from app.api.time_format import format_utc
from app.auth.access import require_admin
from app.auth.dependencies import get_db
from app.services.audit import query_audit_events

router = APIRouter(
    prefix="/audit-logs",
    tags=["audit-logs"],
    dependencies=[Depends(require_admin)],
)

_EVENT_TYPE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")


def _utc_time(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() != timedelta(0):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    return value.astimezone(UTC)


@router.get("")
def list_audit_logs(
    project_id: UUID | None = None,
    actor_id: UUID | None = None,
    from_time: Annotated[datetime | None, Query(alias="from")] = None,
    to_time: Annotated[datetime | None, Query(alias="to")] = None,
    event_type: str | None = None,
    cursor: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),  # noqa: B008
) -> dict[str, object]:
    start = _utc_time(from_time)
    end = _utc_time(to_time)
    if start is not None and end is not None and start > end:
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if event_type is not None and not _EVENT_TYPE.fullmatch(event_type):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)

    rows, has_more = query_audit_events(
        db,
        project_id=project_id,
        actor_id=actor_id,
        from_time=start,
        to_time=end,
        event_type=event_type,
        cursor_key=page_cursor_key(cursor),
        limit=limit,
    )
    return {
        "items": [
            {
                "id": row.id,
                "created_at": format_utc(row.created_at),
                "created_by": row.created_by,
                "project_id": row.project_id,
                "event_type": row.event_type,
                "entity_type": row.entity_type,
                "entity_id": row.entity_id,
                "before": row.before,
                "after": row.after,
            }
            for row in rows
        ],
        "next_cursor": (
            encode_page_cursor(rows[-1].created_at, rows[-1].id)
            if has_more
            else None
        ),
    }
