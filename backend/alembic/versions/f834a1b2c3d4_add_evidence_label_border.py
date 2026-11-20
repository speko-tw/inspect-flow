"""FEV-R22：舊照片圖層補上預設開啟的外框設定。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f834a1b2c3d4"
down_revision: str | Sequence[str] | None = "f791a2b3c4d5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _layers(add: bool) -> None:
    table = sa.table(
        "evidence",
        sa.column("id", sa.Uuid()),
        sa.column("label_layer", sa.JSON()),
    )
    bind = op.get_bind()
    for identifier, saved in bind.execute(sa.select(table)).all():
        layer = dict(saved)
        if add:
            layer.setdefault("border", True)
        else:
            layer.pop("border", None)
        bind.execute(
            table.update()
            .where(table.c.id == identifier)
            .values(label_layer=layer)
        )


def upgrade() -> None:
    """只回填設定，不改寫已保存的 OFFICE 與不可變稽核事件。"""
    _layers(True)


def downgrade() -> None:
    """移除本次新增的圖層設定。"""
    _layers(False)
