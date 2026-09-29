"""Project business fields and length checks (DOM-R40 through DOM-R44)."""

from datetime import date

from sqlalchemy import Date
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin
from app.models._bounded_string import BoundedString, validate_nullable

_LIMITS = {
    "project_code": 32,
    "name": 128,
    "client_name": 128,
    "site_location": 256,
}


def _check_length(field: str, value: str) -> None:
    limit = _LIMITS[field]
    if len(value) > limit:
        raise ValueError(
            f"Project.{field} must be at most {limit} characters; "
            f"got {len(value)}"
        )


def _bounded(field: str) -> BoundedString:
    def check(value: str) -> None:
        _check_length(field, value)

    return BoundedString(_LIMITS[field], check)


class Project(AuditMixin, TimestampedBase):
    """A project identified internally by UUID; codes may repeat."""

    __tablename__ = "projects"

    project_code: Mapped[str] = mapped_column(
        _bounded("project_code"), nullable=False
    )
    name: Mapped[str] = mapped_column(_bounded("name"), nullable=False)
    client_name: Mapped[str] = mapped_column(
        _bounded("client_name"), nullable=False
    )
    site_location: Mapped[str] = mapped_column(
        _bounded("site_location"), nullable=False
    )
    planned_start_date: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )
    planned_completion_date: Mapped[date | None] = mapped_column(
        Date, nullable=True
    )

    @validates("project_code", "name", "client_name", "site_location")
    def _validate_required_string(
        self, key: str, value: str | None
    ) -> str | None:
        value = validate_nullable(self, key, value, f"Project.{key}")
        if value is not None:
            _check_length(key, value)
        return value
