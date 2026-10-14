"""為查核任務新增獨立名稱，並依現有項目與地點回填。

Revision ID: a497f3d2b601
Revises: b4e8a2c71f93
Create Date: 2026-10-12
"""

from collections import defaultdict
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a497f3d2b601"
down_revision: str | Sequence[str] | None = "b4e8a2c71f93"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DEFAULT_NAME = "查核任務"


def _clean(value: str) -> str:
    """移除 NUL 字元。

    SQLite 的 length() 遇到 NUL 就停止計數，只有 NUL 加內容的舊標題
    （如 "\x00X"）會被 length(trim(name)) 算成 0，讓 CHECK 失敗；
    PostgreSQL 本來就不能存 NUL，移除不影響其行為。
    """
    return value.replace("\x00", "")


def _bounded_name(value: str) -> str:
    """回填名稱必須通過非空白且 128 字元以內的 CHECK。

    以 Python 字元數截斷，與 ORM 的長度語意一致；截斷後或來源本身
    若只剩空白，CHECK 會讓整個升級失敗，所以退回預設名稱，
    確保既有資料一定能升級。
    """
    bounded = "".join(list(_clean(value))[:128])
    return bounded if bounded.strip() else _DEFAULT_NAME


def _title_or_default(title: str) -> str:
    """舊資料的項目標題可能只有空白，沒有可讀內容時用預設名稱。"""
    cleaned = _clean(title)
    return cleaned if cleaned.strip() else _DEFAULT_NAME


def upgrade() -> None:
    """依任務當下項目和地點回填名稱，再設為必填。"""
    op.add_column(
        "inspection_tasks",
        sa.Column(
            "name",
            sa.String(length=128),
            sa.CheckConstraint(
                "length(trim(name)) BETWEEN 1 AND 128",
                name="inspection_task_name_valid",
            ),
            nullable=False,
            # 暫存預設值避免 SQLite 重建表觸發 cascade；
            # 應用層一律明確帶入名稱。
            server_default="查核任務",
        ),
    )

    connection = op.get_bind()
    task_rows = list(
        connection.execute(
            sa.text(
                "SELECT task.id AS task_id, zone.name AS zone_name, "
                "task.location_text AS location_text "
                "FROM inspection_tasks AS task "
                "LEFT JOIN project_zones AS zone "
                "ON zone.id = task.zone_id "
                "ORDER BY task.id"
            )
        )
    )
    item_rows = connection.execute(
        sa.text(
            "SELECT task_id, item.title AS item_title "
            "FROM task_inspection_items AS task_item "
            "JOIN project_inspection_items AS item "
            "ON item.id = task_item.project_inspection_item_id "
            "ORDER BY task_id, task_item.created_at, task_item.id"
        )
    )
    titles: dict[object, list[str]] = defaultdict(list)
    for row in item_rows:
        titles[row.task_id].append(row.item_title)

    update = sa.text(
        "UPDATE inspection_tasks SET name = :name WHERE id = :task_id"
    )
    for row in task_rows:
        task_id = row.task_id
        task_titles = titles[task_id]
        location = _clean(row.zone_name or row.location_text or "")
        if not task_titles:
            item_part = _DEFAULT_NAME
        elif len(task_titles) == 1:
            item_part = _title_or_default(task_titles[0])
        else:
            first_title = _title_or_default(task_titles[0])
            item_part = f"{first_title}等 {len(task_titles)} 項"
        # 只有空白的地點視為沒有地點，避免名稱尾端出現空白片段。
        value = f"{item_part}－{location}" if location.strip() else item_part
        connection.execute(
            update,
            {"name": _bounded_name(value), "task_id": task_id},
        )


def downgrade() -> None:
    """移除任務名稱及其欄位約束。"""
    op.drop_column("inspection_tasks", "name")
