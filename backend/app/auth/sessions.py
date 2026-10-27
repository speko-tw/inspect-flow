"""登入狀態的簽發、驗證與計數（AUT-R09、R11～R17、R25、R27）。

與密碼驗證分離，未來外部身分來源也能沿用相同登入狀態機制。"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.auth.settings import get_session_timeouts
from app.db import clock
from app.models import AuthSession, User

# AUT-R12: ``__Host-`` prefix, no ``Domain``, ``Path=/`` -- enforced
# by browsers only when the cookie also carries ``Secure``, which
# ``app.api.v1.auth`` sets alongside this name.
SESSION_COOKIE_NAME = "__Host-inspectflow_session"


def get_session_cookie_name() -> str:
    """依 AUT-R12 固定使用瀏覽器強制驗證的安全前綴。"""
    return SESSION_COOKIE_NAME


def set_session_cookie(response: Response, token: str) -> None:
    """依 AUT-R12 統一簽發安全登入 Cookie，避免各入口屬性不一致。"""
    response.set_cookie(
        key=get_session_cookie_name(),
        value=token,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )


# AUT-R11: at least 256 bits of randomness. ``secrets.token_urlsafe``
# base64url-encodes ``_TOKEN_BYTES`` random bytes and strips padding,
# giving a 43-character string for 32 bytes (AUT-AC10).
_TOKEN_BYTES = 32


def generate_token() -> str:
    """依 AUT-R11、AUT-R13 產生至少 256 bits 的隨機登入代碼。"""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def hash_token(token: str) -> str:
    """依 AUT-R11 只保存 SHA-256 摘要，避免資料庫洩漏明文代碼。"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User) -> tuple[AuthSession, str]:
    """建立登入狀態並回傳明文代碼；不驗證密碼（AUT-R27）。

    僅 flush，由請求交易提交；操作者記為登入者本人。"""
    token = generate_token()
    now = clock.utc_now()
    timeouts = get_session_timeouts()
    session_row = AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=now + timeouts.absolute_timeout,
        last_seen_at=now,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(session_row)
    db.flush()
    return session_row, token


def _is_expired(
    row: AuthSession, now: datetime, idle_timeout: timedelta
) -> bool:
    """依 AUT-R15 判斷絕對期限及閒置期限。"""
    if now >= row.expires_at:
        return True
    return (now - row.last_seen_at) > idle_timeout


def validate_and_touch_session(db: Session, token: str) -> User | None:
    """驗證登入狀態並更新最後使用時間（AUT-R14、AUT-R15）。

    拒絕時立即提交刪除，避免上層拋出未登入錯誤後交易回滾而復原。"""
    token_hash = hash_token(token)
    row = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_hash)
    )
    if row is None:
        return None

    now = clock.utc_now()
    timeouts = get_session_timeouts()
    user = db.get(User, row.user_id)

    if user is not None and user.is_active:
        from app.services.user_lifecycle import (
            expire_external_account_if_due,
        )

        if expire_external_account_if_due(db, user.id, today=now.date()):
            db.commit()
            return None

    if (
        user is None
        or not user.is_active
        or _is_expired(row, now, timeouts.idle_timeout)
    ):
        db.delete(row)
        db.commit()
        return None

    row.last_seen_at = now
    row.updated_by = row.user_id
    db.flush()
    return user


def delete_session_by_token(db: Session, token: str) -> None:
    """依 AUT-R07 刪除對應登入狀態；未知代碼不產生副作用。"""
    token_hash = hash_token(token)
    row = db.scalar(
        select(AuthSession).where(AuthSession.token_hash == token_hash)
    )
    if row is not None:
        db.delete(row)
        db.flush()


def delete_all_sessions_for_user(db: Session, user_id: uuid.UUID) -> None:
    """依 AUT-R25、AUT-R35 撤銷使用者全部登入狀態。"""
    db.query(AuthSession).filter(AuthSession.user_id == user_id).delete(
        synchronize_session=False
    )


def count_valid_sessions(db: Session, user_id: uuid.UUID) -> int:
    """依 AUT-R16 唯讀計算有效登入數，不清除過期資料。"""
    now = clock.utc_now()
    timeouts = get_session_timeouts()
    rows = db.scalars(
        select(AuthSession).where(AuthSession.user_id == user_id)
    ).all()
    return sum(
        1 for row in rows if not _is_expired(row, now, timeouts.idle_timeout)
    )
