"""Per-account failed password checks and the resulting lockout."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase, UTCDateTime


class LoginFailure(TimestampedBase):
    """One failed check, retained within the current sliding window."""

    __tablename__ = "login_failures"
    __table_args__ = (
        Index("ix_login_failures_user_time", "user_id", "failed_at"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    failed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
