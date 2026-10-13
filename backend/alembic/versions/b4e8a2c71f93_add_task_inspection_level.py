"""依 IP-R16 新增 InspectionTask.inspection_level，回填既有任務。

只新增欄位與更新資料、不重建資料表（IP-R16）：欄位以不可空值加上
``server_default``，新增的當下資料庫就把既有任務補成
``self_inspection``，SQLite 與 PostgreSQL 的 ``ADD COLUMN`` 都支援這個
寫法，不必先加可空欄位再改回不可空（SQLite 改不可空需要重建資料表）。

升級當下既有專案都是承攬施工方（``contractor``），預設值已是正確結果；
但本支 migration 仍依所屬專案的 ``company_role`` 把監造方（``supervisor``）
專案的任務更正為 ``spot_check``，這樣即使某個資料庫先升級過
``company_role`` 並已把專案改成監造方，回填也不會錯。

兩個層級值與角色對應都寫字面值，不 import app 內的角色登記表或
model：登記表日後會增減角色，而這支 migration 描述的是當時的資料形狀，
不能隨登記表改變結果。

Revision ID: b4e8a2c71f93
Revises: a7c3e9d15b42
Create Date: 2026-10-13
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b4e8a2c71f93"
down_revision: str | Sequence[str] | None = "a7c3e9d15b42"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """新增 inspection_level；依專案角色回填，預設為 self_inspection。"""
    op.add_column(
        "inspection_tasks",
        sa.Column(
            "inspection_level",
            sa.String(32),
            nullable=False,
            server_default="self_inspection",
        ),
    )
    op.execute(
        sa.text(
            "UPDATE inspection_tasks SET inspection_level = 'spot_check' "
            "WHERE project_id IN "
            "(SELECT id FROM projects WHERE company_role = 'supervisor')"
        )
    )


def downgrade() -> None:
    """移除 inspection_level，還原舊版 Task 結構。"""
    op.drop_column("inspection_tasks", "inspection_level")
