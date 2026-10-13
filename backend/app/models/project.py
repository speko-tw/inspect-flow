"""專案的業務欄位與長度檢查（DOM-R40～R44、DOM-R76）。"""

from datetime import date

from sqlalchemy import Date
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.company_roles import (
    COMPANY_ROLE_MAX_LENGTH,
    DEFAULT_COMPANY_ROLE,
    is_company_role_registered,
)
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


def _check_company_role(value: str) -> None:
    # DOM-R76：登記表在 ORM model 寫入前檢查（比照 DOM-R35）。登記表在
    # 程式內而不是資料庫 enum，所以只能在這裡把關；這樣新增角色不必改
    # 資料表，而任何寫入路徑（API、服務、腳本）都繞不過去。
    if not is_company_role_registered(value):
        raise ValueError(
            f"Project.company_role {value!r} is not a registered "
            "company role (DOM-R76)"
        )


def _bounded(field: str) -> BoundedString:
    def check(value: str) -> None:
        _check_length(field, value)

    return BoundedString(_LIMITS[field], check)


class Project(AuditMixin, TimestampedBase):
    """專案：內部以 UUID 識別，專案代號允許重複。"""

    __tablename__ = "projects"
    # 不在 INSERT 後立刻用 RETURNING 取回 server_default 的值；理由是
    # 舊結構資料庫沒有 ``company_role`` 欄，見該欄位的註解。
    __mapper_args__ = {"eager_defaults": False}

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
    # DOM-R76：本公司在這個案子的角色，一個專案一個值。預設承攬施工方
    # 只放在資料庫端（server_default），不設 Python 預設：這樣省略角色
    # 的寫入不會把這一欄放進 INSERT，舊結構資料庫（尚未有此欄）上的歷史
    # migration 測試仍能用 ORM 寫入 Project。API 與前端一律明確送出
    # （ADM-R40），不依賴這個預設。
    company_role: Mapped[str] = mapped_column(
        BoundedString(COMPANY_ROLE_MAX_LENGTH, _check_company_role),
        nullable=False,
        server_default=DEFAULT_COMPANY_ROLE,
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

    @validates("company_role")
    def _validate_company_role(
        self, key: str, value: str | None
    ) -> str | None:
        value = validate_nullable(self, key, value, f"Project.{key}")
        if value is not None:
            _check_company_role(value)
        return value
