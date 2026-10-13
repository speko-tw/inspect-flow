"""依 DOM-R76 新增 Project.company_role，既有專案回填承攬施工方。

只新增欄位、不重建資料表（DOM-R76）：欄位以不可空值加上
``server_default``，新增的當下資料庫就把既有專案補成 ``contractor``，
SQLite 與 PostgreSQL 的 ``ADD COLUMN`` 都支援這個寫法，不必先加可空
欄位再改回不可空（SQLite 改不可空需要重建資料表）。

回填值與預設值都寫字面值 ``contractor``，不 import app 內的角色登記表
或 model：登記表日後會增減角色，而這支 migration 描述的是當時的資料
形狀，不能隨登記表改變結果。

Revision ID: a7c3e9d15b42
Revises: c13b5e7a9d20
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a7c3e9d15b42"
down_revision: str | Sequence[str] | None = "c13b5e7a9d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增 company_role；既有專案由預設值一律補為 contractor。"""
    op.add_column(
        "projects",
        sa.Column(
            "company_role",
            sa.String(32),
            nullable=False,
            server_default="contractor",
        ),
    )


def downgrade() -> None:
    """移除 company_role，還原舊版 Project 結構。"""
    op.drop_column("projects", "company_role")
