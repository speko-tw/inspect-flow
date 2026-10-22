"""共用帳號有效啟用條件（DOM-R75、#286）。"""

from datetime import date

from sqlalchemy import and_, or_
from sqlalchemy.sql.elements import ColumnElement

from app.db import clock
from app.models import User


def effectively_active_user_clause(
    *, today: date | None = None
) -> ColumnElement[bool]:
    """以唯讀 SQL 條件排除停用與到期帳號（DOM-R75、#286）。

    到期帳號可能尚未經登入流程寫回停用狀態，因此清單與彙總
    必須直接比對到期日；共用條件避免不同畫面的人數口徑分歧。
    到期日當天仍啟用，沿用生命週期服務的 UTC 日期邊界。
    """
    current_date = today if today is not None else clock.utc_now().date()
    return and_(
        User.is_active.is_(True),
        or_(
            User.is_external_collaborator.is_(False),
            User.account_expires_on.is_(None),
            User.account_expires_on >= current_date,
        ),
    )
