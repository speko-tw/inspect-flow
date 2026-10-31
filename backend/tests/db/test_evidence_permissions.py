"""FEV-R12：預建角色初始內容與既有角色保留。"""

from pathlib import Path

from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings
from app.models import Role
from app.services.default_permissions import ensure_default_permissions
from tests.db.conftest import create_root_user_with_company


def test_evidence_presets_and_repeat_preserves_admin_choices(db_url):
    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(cfg, "head")
    engine = create_engine_from_settings(db_url)
    with Session(engine) as session:
        actor = create_root_user_with_company(session, "FEVROLE")
        ensure_default_permissions(session, actor_id=actor.id)
        session.commit()
        roles = {r.name: r for r in session.scalars(select(Role))}
        codes = {
            name: {p.code for p in r.permission_codes}
            for name, r in roles.items()
        }
        assert {"evidence.read", "evidence.manage"} <= codes["專案工程師"]
        assert "evidence.read" not in codes["現場工程師"]
        assert "evidence.manage" not in codes["現場工程師"]
        assert "evidence.read" in codes["專案查閱人員"]
        assert "evidence.manage" not in codes["專案查閱人員"]
        role = roles["專案工程師"]
        role.permission_codes = [
            p for p in role.permission_codes if p.code == "project.read"
        ]
        session.commit()
        ensure_default_permissions(session, actor_id=actor.id)
        session.commit()
        assert {p.code for p in role.permission_codes} == {"project.read"}
    engine.dispose()
