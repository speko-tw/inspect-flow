"""One serialized login failure counter per account (AUT-R28)."""

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase, UTCDateTime


class LoginCounter(TimestampedBase):
    """Current window count and lock deadline for one user."""

    __tablename__ = "login_counters"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failure_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        UTCDateTime, nullable=True
    )
