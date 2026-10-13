"""IP-AC16：``InspectionTask.inspection_level`` 欄位與 migration。

與其他資料庫測試共用 SQLite／PostgreSQL fixture，所以
``make check-postgres`` 也會在 PostgreSQL 上驗證這支 migration：
依專案角色回填、不可空、降級都不能只在 SQLite 上成立。
"""

import ast
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import Engine, MetaData, Table, Uuid, insert, inspect, select
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings
from app.models import InspectionPlan, InspectionTask, Project
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PARENT = "a7c3e9d15b42"
_MIGRATION = (
    _BACKEND_DIR / "alembic/versions/b4e8a2c71f93_add_task_inspection_level.py"
)


def _config() -> Config:
    return Config(str(_BACKEND_DIR / "alembic.ini"))


def _table(engine: Engine, name: str) -> Table:
    table = Table(name, MetaData(), autoload_with=engine)
    # SQLite 反射出來的 Uuid 欄位是 CHAR；改回宣告的型別，Core 才會
    # 在兩種資料庫上都用 UUID 物件綁定參數。
    for column in table.c:
        if column.name in {
            "id",
            "project_id",
            "plan_id",
            "created_by",
            "updated_by",
        }:
            column.type = Uuid()
    return table


def _audit(owner_id) -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "created_at": now,
        "updated_at": now,
        "created_by": owner_id,
        "updated_by": owner_id,
    }


@pytest.fixture
def session(db_url):
    command.upgrade(_config(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as sess:
            yield sess
    finally:
        engine.dispose()


def test_migration_chain_has_one_head_after_the_company_role_migration():
    script = ScriptDirectory.from_config(_config())
    revision = script.get_revision("b4e8a2c71f93")
    assert revision is not None
    assert revision.down_revision == _PARENT
    assert len(script.get_heads()) == 1


def test_column_is_not_null_and_defaults_to_self_inspection(session):
    columns = {
        column["name"]: column
        for column in inspect(session.get_bind()).get_columns(
            "inspection_tasks"
        )
    }
    assert columns["inspection_level"]["nullable"] is False
    assert columns["inspection_level"]["type"].length == 32

    owner = create_root_user_with_company(session, "T10A")
    project = Project(
        project_code="T10A",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
        created_by=owner.id,
        updated_by=owner.id,
    )
    session.add(project)
    session.flush()
    plan = InspectionPlan(
        project_id=project.id,
        name="計畫",
        created_by=owner.id,
        updated_by=owner.id,
    )
    session.add(plan)
    session.flush()
    task = InspectionTask(
        plan_id=plan.id,
        project_id=project.id,
        created_by=owner.id,
        updated_by=owner.id,
    )
    session.add(task)
    session.commit()
    session.expire_all()
    assert task.inspection_level == "self_inspection"


@pytest.mark.parametrize("bad", [None, "unknown", "", "SPOT_CHECK"])
def test_orm_rejects_unregistered_or_null_level(session, bad):
    owner = create_root_user_with_company(session, "T10B")
    with pytest.raises(ValueError):
        InspectionTask(
            plan_id=uuid7(),
            project_id=uuid7(),
            inspection_level=bad,
            created_by=owner.id,
            updated_by=owner.id,
        )


def _seed_old_schema(engine: Engine) -> dict[str, object]:
    """在 migration 之前的結構寫入兩個專案各一筆任務。"""
    with Session(engine) as session:
        owner = create_root_user_with_company(session, "T10C")
        projects = _table(engine, "projects")
        plans = _table(engine, "inspection_plans")
        tasks = _table(engine, "inspection_tasks")
        ids: dict[str, object] = {}
        for role in ("contractor", "supervisor"):
            project_id, plan_id, task_id = uuid7(), uuid7(), uuid7()
            session.execute(
                insert(projects).values(
                    id=project_id,
                    project_code=f"OLD-{role}",
                    name=f"{role} 工程",
                    client_name="示範業主",
                    site_location="示範工地",
                    company_role=role,
                    **_audit(owner.id),
                )
            )
            session.execute(
                insert(plans).values(
                    id=plan_id,
                    project_id=project_id,
                    name="舊計畫",
                    **_audit(owner.id),
                )
            )
            session.execute(
                insert(tasks).values(
                    id=task_id,
                    plan_id=plan_id,
                    project_id=project_id,
                    **_audit(owner.id),
                )
            )
            ids[role] = task_id
        session.commit()
        return ids


def test_migration_backfills_by_project_role_and_downgrades(db_url):
    cfg = _config()
    command.upgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        assert "inspection_level" not in {
            column["name"]
            for column in inspect(engine).get_columns("inspection_tasks")
        }
        ids = _seed_old_schema(engine)
    finally:
        engine.dispose()

    command.upgrade(cfg, "head")
    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("inspection_tasks")
        }
        assert columns["inspection_level"]["nullable"] is False
        tasks = _table(engine, "inspection_tasks")
        with Session(engine) as session:
            rows = dict(
                session.execute(
                    select(tasks.c.id, tasks.c.inspection_level)
                ).all()
            )
            # 承攬施工方專案的任務為一級自主檢查、監造方專案為二級抽查。
            assert rows == {
                ids["contractor"]: "self_inspection",
                ids["supervisor"]: "spot_check",
            }
    finally:
        engine.dispose()

    command.downgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        assert "inspection_level" not in {
            column["name"]
            for column in inspect(engine).get_columns("inspection_tasks")
        }
        tasks = _table(engine, "inspection_tasks")
        with Session(engine) as session:
            assert len(session.execute(select(tasks.c.id)).all()) == 2
    finally:
        engine.dispose()


def test_migration_only_adds_a_column_and_imports_nothing_from_app():
    # IP-R16：只新增欄位與更新資料、不重建資料表；層級值與角色對應寫
    # 字面值，不 import app 內的登記表或 model。
    source = _MIGRATION.read_text(encoding="utf-8")
    assert "batch_alter_table" not in source
    assert "drop_table" not in source
    assert "create_table" not in source
    tree = ast.parse(source)
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        (node.module or "").split(".")[0]
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom)
    }
    assert "app" not in imported
    assert 'server_default="self_inspection"' in source
