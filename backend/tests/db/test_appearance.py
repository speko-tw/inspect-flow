"""AUT-AC80～82、DOM-AC77：相同案例實跑 SQLite 與 PostgreSQL。"""

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import MetaData, Table, func, inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.auth.passwords import hash_password
from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.db.engine import create_engine_from_settings
from app.main import create_app
from app.models import AuditLog, User, UserModulePermission, UserPassword
from tests.db.conftest import create_root_user_with_company

_CFG = str(Path(__file__).resolve().parents[2] / "alembic.ini")


@pytest.fixture
def engine(db_url):
    """每個 API 案例使用正式 migration，不以 create_all 代替。"""
    command.upgrade(Config(_CFG), "head")
    eng = create_engine_from_settings(db_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def account_kind():
    """一般回歸預設使用沒有功能權限的本人，不隱含 Admin 放行。"""
    return "no-access"


@pytest.fixture
def account(engine, account_kind):
    """預備本人與另一帳號，避免 API 讀寫期間留著 fixture 寫鎖。"""
    with Session(engine) as db:
        user = create_root_user_with_company(db, "APPEAR515")
        other = create_root_user_with_company(db, "OTHER515")
        if account_kind == "admin":
            user.is_admin = True
        elif account_kind == "general":
            db.add(
                UserModulePermission(
                    user_id=user.id,
                    permission_code="template.use",
                    source="manual",
                )
            )
        # AUT-AC82：初始修改者與時間刻意不同，漏寫任一欄位都必須使斷言失敗。
        user.updated_by = other.id
        user.updated_at = datetime(2020, 1, 1, tzinfo=UTC)
        db.add(
            UserPassword(
                user_id=user.id,
                password_hash=hash_password("appearance-password"),
                created_by=user.id,
                updated_by=user.id,
            )
        )
        _, token = create_session(db, user)
        ids = (user.id, other.id, token, user.username)
        db.commit()
        return ids


def _client(token):
    client = TestClient(create_app(), base_url="https://testserver")
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


@pytest.mark.parametrize("account_kind", ["general", "admin", "no-access"])
@pytest.mark.parametrize("appearance", ["system", "light", "dark"])
def test_self_appearance_persists_across_devices_without_audit(
    engine, account, appearance, account_kind
):
    """無模組權限也能改本人，另一裝置與重新登入均取帳號值。"""
    user_id, other_id, token, username = account
    client = _client(token)
    profile = client.get("/api/v1/auth/me").json()
    assert profile["is_admin"] == (account_kind == "admin")
    if account_kind == "general":
        assert "template.use" in profile["module_permissions"]
        assert profile["can_browse_templates"] is True
    elif account_kind == "no-access":
        assert profile["module_permissions"] == []
        assert profile["has_project_access"] is False
        assert profile["can_browse_templates"] is False
    with Session(engine) as db:
        original = db.get(User, user_id)
        assert original is not None
        previous_time = original.updated_at
        assert original.updated_by == other_id
        before = db.scalar(select(func.count()).select_from(AuditLog))
    response = client.patch("/api/v1/auth/me", json={"appearance": appearance})
    assert response.status_code == 200
    assert response.json() == {"appearance": appearance}
    second = _client(token)
    assert second.get("/api/v1/auth/me").json()["appearance"] == appearance
    logged_in = TestClient(create_app(), base_url="https://testserver")
    response = logged_in.post(
        "/api/v1/auth/login",
        json={
            "login": username,
            "password": "appearance-password",
        },
    )
    assert response.status_code == 200
    assert response.json()["appearance"] == appearance
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None
        assert user.appearance == appearance
        assert user.updated_by == user_id
        assert user.updated_at > previous_time
        other = db.get(User, other_id)
        assert other is not None and other.appearance == "system"
        assert db.scalar(select(func.count()).select_from(AuditLog)) == before


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"appearance": None},
        {"appearance": "sepia"},
        {"appearance": "dark", "user_id": "another-user"},
    ],
)
def test_appearance_rejects_invalid_or_foreign_fields(engine, account, body):
    """嚴格本體不容許指定他人，拒絕時不能留下部分更新。"""
    user_id, _, token, _ = account
    assert (
        _client(token).patch("/api/v1/auth/me", json=body).status_code == 422
    )
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None and user.appearance == "system"


def test_appearance_requires_login_and_keeps_temporary_password_gate(
    engine, account
):
    """外觀不能繞過首次改密碼，未登入也不能更新偏好。"""
    user_id, _, token, _ = account
    client = TestClient(create_app(), base_url="https://testserver")
    body = {"appearance": "dark"}
    assert client.patch("/api/v1/auth/me", json=body).status_code == 401
    with Session(engine) as db:
        password = db.scalar(
            select(UserPassword).where(
                UserPassword.user_id == user_id,
            )
        )
        assert password is not None
        password.must_change_password = True
        db.commit()
        user = db.get(User, user_id)
        assert user is not None
        before = (user.appearance, user.updated_by, user.updated_at)
    client = _client(token)
    assert client.get("/api/v1/auth/me").status_code == 200
    response = client.patch("/api/v1/auth/me", json=body)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth.password_change_required"
    with Session(engine) as db:
        user = db.get(User, user_id)
        assert user is not None
        assert (user.appearance, user.updated_by, user.updated_at) == before


@pytest.mark.parametrize("account_kind", ["admin"])
def test_admin_account_patch_ignores_another_users_appearance(
    engine, account, account_kind
):
    """AUT-R55：管理他人的入口不能繞過本人偏好端點。"""
    _, other_id, token, _ = account
    with Session(engine) as db:
        other = db.get(User, other_id)
        assert other is not None
        other.appearance = "light"
        db.commit()
    response = _client(token).patch(
        f"/api/v1/users/{other_id}",
        json={"appearance": "dark"},
    )
    assert response.status_code == 200
    assert "appearance" not in response.json()
    with Session(engine) as db:
        other = db.get(User, other_id)
        assert other is not None and other.appearance == "light"


@pytest.mark.parametrize("value", [None, "sepia", "Dark", ""])
def test_appearance_database_constraint_rejects_raw_updates(
    engine, account, value
):
    """Core 寫入繞過 ORM validator 時，仍由資料庫保護三態。"""
    user_id, _, _, _ = account
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            update(User)
            .where(User.id == user_id)
            .values(
                appearance=value,
            )
        )


def test_appearance_migration_backfill_and_roundtrip(db_url):
    """附加欄位後舊帳號預設 system，降升版不破壞原外鍵或帳號。"""
    cfg = Config(_CFG)
    command.upgrade(cfg, "c489a760d1e3")
    eng = create_engine_from_settings(db_url)
    try:
        users = Table("users", MetaData(), autoload_with=eng)
        user_id = uuid4()
        stored_id = (
            user_id if eng.dialect.name == "postgresql" else user_id.hex
        )
        now = datetime.now(UTC)
        with eng.begin() as conn:
            conn.execute(
                users.insert().values(
                    id=stored_id,
                    username="admin",
                    is_admin=True,
                    is_system=True,
                    is_external_collaborator=False,
                    created_by=stored_id,
                    updated_by=stored_id,
                    created_at=now,
                    updated_at=now,
                )
            )
        foreign_keys = inspect(eng).get_foreign_keys("users")
        command.upgrade(cfg, "head")
        with Session(eng) as db:
            user = db.get(User, user_id)
            assert user is not None and user.appearance == "system"
            user.appearance = "dark"
            db.commit()
        assert inspect(eng).get_foreign_keys("users") == foreign_keys
        new_users = Table("users", MetaData(), autoload_with=eng)
        fresh_id = uuid4()
        stored_fresh = (
            fresh_id if eng.dialect.name == "postgresql" else fresh_id.hex
        )
        with eng.begin() as conn:
            conn.execute(
                new_users.insert().values(
                    id=stored_fresh,
                    username="fresh.appearance",
                    email="fresh@example.test",
                    name_zh="新帳號",
                    is_system=False,
                    is_admin=False,
                    is_external_collaborator=False,
                    created_by=stored_fresh,
                    updated_by=stored_fresh,
                    created_at=now,
                    updated_at=now,
                )
            )
        with Session(eng) as db:
            fresh = db.get(User, fresh_id)
            assert fresh is not None and fresh.appearance == "system"
        command.downgrade(cfg, "c489a760d1e3")
        assert "appearance" not in {
            c["name"] for c in inspect(eng).get_columns("users")
        }
        command.upgrade(cfg, "head")
        with Session(eng) as db:
            user = db.get(User, user_id)
            assert user is not None and user.username == "admin"
            assert user.appearance == "system"
    finally:
        eng.dispose()
