"""``SetupCode`` model: the one-time first-login code that lets the
person installing InspectFlow set the built-in ``admin``'s password
(AUT-R42, AUT-R43, AUT-R44, AUT-R45).

Only the data this spec defines lives here (authentication's "資料"
section); generating and hashing the code, the 24-hour expiry rule,
the lockout thresholds and the set-password flow are later
``authentication`` tasks.
"""

from datetime import datetime

from sqlalchemy import Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase, UTCDateTime
from app.models._audit import AuditMixin


class SetupCode(AuditMixin, TimestampedBase):
    """A first-login code, stored as a hash only (never in clear).

    Several rows may exist over time: re-running initialization
    voids the old row (``voided_at``) and adds a new one (AUT-R43),
    so "at most one valid (neither voided nor expired) row at a
    time" changes with time and is enforced by the service that
    writes these rows, not by a database constraint.

    The failed-attempt counter and lockout state (AUT-R45) live on
    the row itself, so a freshly added row starts unlocked with a
    zero count and no separate counter table is needed. They are
    system-wide, not per account, because the code belongs to no
    account.
    """

    __tablename__ = "setup_codes"

    # Hash of the code (same hashing function as passwords,
    # AUT-R01); no length is specified since it is a PHC string
    # whose length the hashing scheme determines.
    code_hash: Mapped[str] = mapped_column(String, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    voided_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    failure_window_started_at: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
