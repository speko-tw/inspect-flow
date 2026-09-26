"""``AuthSession`` model: one row per active login (AUT-R11~
AUT-R17).

Only the data this spec defines lives here (authentication's "資料"
section); issuing a session, checking it on every request, and
deleting it on logout/expiry/deactivation are `authentication` plan
task T3, not this one.
"""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import clock
from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin


class AuthSession(AuditMixin, TimestampedBase):
    """One login's server-side state: which `User`, the hash of the
    token the client's cookie carries, and the two expiry checks
    T3's per-request check enforces.

    `user_id` is not unique -- the same `User` may hold several rows
    at once (one per client/device it is logged in on, AUT-R11,
    AUT-R17); `token_hash` is unique so a colliding token can never
    be issued to resolve to more than one row. `expires_at` is the
    absolute deadline set when the row is created; `last_seen_at` is
    the sliding idle deadline's reference point. Both are UTC and
    required: a freshly created row is itself "seen" at the moment
    it is issued (the login request is this session's first
    request), so `last_seen_at` starts equal to `created_at` rather
    than being left null until some later request updates it; T3's
    per-request check then advances it on every subsequent request
    that passes.

    `created_by`/`updated_by` (from `AuditMixin`) are the logged-in
    `User` themself, per the spec's "資料" section.
    """

    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(
        String, nullable=False, unique=True
    )
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=clock.utc_now
    )
