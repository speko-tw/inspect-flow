"""DPL-R03：重啟不得替換有效設定碼或已設定的管理員密碼。"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.auth.password_service import set_password
from app.cli import ensure_initial_setup
from app.cli.init_system import run
from app.db import clock
from app.models import SetupCode, User


@pytest.mark.parametrize("state", ["empty", "password", "valid", "expired"])
def test_initialize_only_when_needed(session_factory, monkeypatch, state):
    monkeypatch.setattr(
        ensure_initial_setup, "get_session_factory", lambda: session_factory
    )
    old_id = None
    if state != "empty":
        assert run(session_factory, output=lambda _: None) == 0
        with session_factory() as db:
            admin = db.scalars(select(User)).one()
            code = db.scalars(select(SetupCode)).one()
            old_id = code.id
            if state == "password":
                set_password(
                    db, admin, "StrongPassword2026!", is_temporary=False
                )
            elif state == "expired":
                code.expires_at = clock.utc_now() - timedelta(seconds=1)
            db.commit()
    calls = []
    original = ensure_initial_setup.initialize

    def initialize(factory):
        calls.append(True)
        return original(factory, output=lambda _: None)

    monkeypatch.setattr(ensure_initial_setup, "initialize", initialize)
    assert ensure_initial_setup.main() == 0
    assert bool(calls) == (state in {"empty", "expired"})
    with session_factory() as db:
        active = db.scalars(
            select(SetupCode).where(SetupCode.voided_at.is_(None))
        ).all()
        if state == "valid":
            assert len(active) == 1
            assert active[0].id == old_id
        elif state in {"empty", "expired"}:
            assert len(active) == 1
            assert active[0].id != old_id
            assert active[0].expires_at > clock.utc_now()
