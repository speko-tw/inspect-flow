"""DOM-R78：為既有與新帳號預設跟隨裝置外觀。"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a515c0f9e2d1"
down_revision: str | None = "c489a760d1e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """以附加欄位保留 users 的循環外鍵，避免 SQLite 重建資料表。"""
    op.add_column(
        "users",
        sa.Column(
            "appearance",
            sa.String(6),
            sa.CheckConstraint(
                "appearance IN ('system', 'light', 'dark')",
                name=op.f("ck_users_appearance_values"),
            ),
            nullable=False,
            server_default="system",
        ),
    )


def downgrade() -> None:
    """移除偏好欄位，保留帳號與原有外鍵資料。"""
    op.drop_column("users", "appearance")
