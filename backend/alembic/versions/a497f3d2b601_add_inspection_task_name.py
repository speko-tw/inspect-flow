"""為查核任務新增獨立名稱，並依現有項目與地點回填。

Revision ID: a497f3d2b601
Revises: 6eaaafbe0ef2
Create Date: 2026-10-12
"""

from collections import defaultdict
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a497f3d2b601"
down_revision: str | Sequence[str] | None = "c13b5e7a9d20"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _bounded_name(value: str) -> str:
    """回填時保留 Python 字元計數語意及 128 字元資料限制。"""
    return "".join(list(value)[:128])


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
        location = row.zone_name or row.location_text
        if not task_titles:
            item_part = "查核任務"
        elif len(task_titles) == 1:
            item_part = task_titles[0]
        else:
            item_part = f"{task_titles[0]}等 {len(task_titles)} 項"
        value = f"{item_part}－{location}" if location else item_part
        connection.execute(
            update,
            {"name": _bounded_name(value), "task_id": task_id},
        )


def downgrade() -> None:
    """移除任務名稱及其欄位約束。"""
    op.drop_column("inspection_tasks", "name")
