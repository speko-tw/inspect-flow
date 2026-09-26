"""``UserPassword`` model: a `User`'s local login password (AUT-R01,
AUT-R03, AUT-R04, AUT-R24).

Only the data this spec defines lives here (authentication's
"資料" section); the hashing algorithm, its parameters, and the
length rule enforced when a password is set are `authentication`
plan.md tasks T1/T6, not this one.
"""

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin


class UserPassword(AuditMixin, TimestampedBase):
    """A `User`'s password hash, kept off `User` itself.

    At most one row per `User` (`user_id` unique): its absence means
    the account has not set a password and cannot log in with one
    (external accounts never get a row here). `password_hash` is a
    PHC string produced by the password hashing scheme T1
    implements; no length is specified since a PHC string's length
    is determined by that scheme, not by this table.

    Kept in its own table rather than as a column on `User` so that
    `User`'s own queries and edit paths never risk pulling back a
    hash that should never appear in a response (see the spec's
    "資料" section for the full rationale).
    """

    __tablename__ = "user_passwords"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True
    )
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
