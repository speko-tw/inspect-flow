"""僅在系統仍需初始設定時建立首次登入碼。"""

from sqlalchemy import select

from app.cli.init_system import run as initialize
from app.db import clock
from app.db.engine import get_session_factory
from app.models import SetupCode, User, UserPassword


def main() -> int:
    """DPL-R03：避免每次重啟廢止有效碼，已完成設定時不再簽發。"""
    factory = get_session_factory()
    with factory() as session:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one_or_none()
        if admin is not None:
            password = session.scalar(
                select(UserPassword.user_id).where(
                    UserPassword.user_id == admin.id
                )
            )
            if password is not None:
                return 0
            pending = session.scalar(
                select(SetupCode.id)
                .where(
                    SetupCode.voided_at.is_(None),
                    SetupCode.expires_at > clock.utc_now(),
                )
                .limit(1)
            )
            if pending is not None:
                return 0
    return initialize(factory)


if __name__ == "__main__":
    raise SystemExit(main())
