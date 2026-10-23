"""整合專案項目來源快照與任務人員索引的 migration 分支。"""

from collections.abc import Sequence

revision: str = "d7e2f6a1b904"
down_revision: str | Sequence[str] | None = (
    "c489a760d1e3",
    "c5f1a2e7b903",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """保留兩邊已發布的 revision，讓任一分支可升級至單一 head。"""


def downgrade() -> None:
    """只拆開分支標記，資料變更由各父 revision 自行還原。"""
