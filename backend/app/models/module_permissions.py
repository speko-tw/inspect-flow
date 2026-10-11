"""Module permissions and configuration models (DOM-R59, R61, R63, R64)."""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import (
    Mapped,
    mapped_column,
    relationship,
    validates,
)
from sqlalchemy.types import Uuid

from app.db.base import TimestampedBase
from app.models._audit import AuditMixin
from app.permission_codes import (
    MODULES,
    is_permission_code_registered,
    permission_code_scope,
)


class UserModulePermission(TimestampedBase):
    __tablename__ = "user_module_permissions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    permission_code: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "permission_code"),
        CheckConstraint(
            "source IN ('manual', 'implied', 'bundle', 'backfill')",
            name="source",
        ),
    )

    @validates("permission_code")
    def _validate_permission_code(self, key: str, value: str) -> str:
        if (
            not is_permission_code_registered(value)
            or permission_code_scope(value) != "module"
        ):
            raise ValueError("User module permission code is not registered")
        return value

    @validates("source")
    def _validate_source(self, key: str, value: str) -> str:
        if value not in {"manual", "implied", "bundle", "backfill"}:
            raise ValueError("Invalid user module permission source")
        return value


class UserModuleDelegation(TimestampedBase):
    __tablename__ = "user_module_delegations"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    module: Mapped[str] = mapped_column(String(32), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "module"),
        CheckConstraint(
            "module IN ('project', 'inspection', 'template')", name="module"
        ),
    )

    @validates("module")
    def _validate_module(self, key: str, value: str) -> str:
        if value not in MODULES:
            raise ValueError("Unregistered module delegation")
        return value


class PermissionBundle(AuditMixin, TimestampedBase):
    __tablename__ = "permission_bundles"

    name: Mapped[str] = mapped_column(String(64), nullable=False)
    permission_codes: Mapped[list["PermissionBundlePermission"]] = (
        relationship(
            back_populates="bundle",
            cascade="all, delete-orphan",
            passive_deletes=True,
        )
    )

    __table_args__ = (
        Index(
            "ix_permission_bundles_name_lower",
            func.lower(name),
            unique=True,
        ),
    )

    @validates("name")
    def _validate_name(self, key: str, value: str) -> str:
        if not value or len(value) > 64:
            raise ValueError(
                "Permission bundle name must contain 1-64 characters"
            )
        return value


class PermissionBundlePermission(TimestampedBase):
    __tablename__ = "permission_bundle_permissions"

    bundle_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("permission_bundles.id", ondelete="CASCADE"),
        nullable=False,
    )
    permission_code: Mapped[str] = mapped_column(String(64), nullable=False)
    bundle: Mapped[PermissionBundle] = relationship(
        back_populates="permission_codes"
    )

    __table_args__ = (UniqueConstraint("bundle_id", "permission_code"),)

    @validates("permission_code")
    def _validate_permission_code(self, key: str, value: str) -> str:
        if (
            not is_permission_code_registered(value)
            or permission_code_scope(value) != "module"
        ):
            raise ValueError("Bundle permission code is not registered")
        return value


class CreatorRoleSetting(TimestampedBase):
    __tablename__ = "creator_role_settings"

    setting_key: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        unique=True,
        default="creator_role",
        server_default="creator_role",
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("roles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint("setting_key = 'creator_role'", name="setting_key"),
    )


__all__ = [
    "CreatorRoleSetting",
    "PermissionBundle",
    "PermissionBundlePermission",
    "UserModuleDelegation",
    "UserModulePermission",
]
