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
    """一個人擁有的一項模組範圍權限（DOM-R59）。

    ``source`` 記錄這筆權限怎麼來的（手動、自動蘊含、權限組合、回填
    migration），讓蘊含與回填產生的授權可追溯。Admin 的模組權限是
    隱含的，不寫資料列；帳號停用時資料列保留（DOM-R67）。
    """

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
    """一個人被委派管理的模組（DOM-R61）。

    被委派者只能授予與收回自己被委派模組內的模組權限；委派本身不附帶
    任何模組的編輯能力，指派與收回只有 Admin 能做。
    """

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
    """一鍵勾選多個模組權限的命名組合（DOM-R63）。

    名稱以小寫後唯一的函式索引保證不分大小寫唯一。組合與人員之間
    不記錄連結，因此修改或刪除組合不會追改已套用過的人。
    """

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
    """權限組合內的一個模組範圍權限代碼（DOM-R63）；同組合不得重複。"""

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
    """系統唯一的「建立者角色」設定，指向一個 ``Role``（DOM-R64）。

    ``role_id`` 以 ``RESTRICT`` 保護，目前的建立者角色不能刪除，須先
    改設另一個角色。``setting_key`` 的 CHECK 與唯一約束讓整張表最多
    只有一列。
    """

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
