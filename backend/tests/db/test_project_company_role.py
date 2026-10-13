"""DOM-AC73：``Project.company_role`` 欄位、登記表與 migration。

與其他資料庫測試共用 SQLite／PostgreSQL fixture，所以
``make check-postgres`` 也會在 PostgreSQL 上驗證這支 migration：
回填既有專案、不可空、登記表檢查都不能只在 SQLite 上成立。
"""

import ast
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest
from alembic.config import Config
from sqlalchemy import (
    Engine,
    MetaData,
    Table,
    Uuid,
    insert,
    inspect,
    select,
    update,
)
from sqlalchemy.exc import StatementError
from sqlalchemy.orm import Session

from alembic import command
from app import company_roles
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings
from app.models import Project
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_PARENT = "c13b5e7a9d20"
_MIGRATION = (
    _BACKEND_DIR / "alembic/versions/a7c3e9d15b42_add_project_company_role.py"
)


def _config() -> Config:
    return Config(str(_BACKEND_DIR / "alembic.ini"))


def _projects_table(engine: Engine) -> Table:
    table = Table("projects", MetaData(), autoload_with=engine)
    # SQLite 反射出來的 Uuid 欄位是 CHAR；改回宣告的型別，Core 才會
    # 在兩種資料庫上都用 UUID 物件綁定參數。
    for name in ("id", "created_by", "updated_by"):
        table.c[name].type = Uuid()
    return table


def _project_values(owner_id, code: str) -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "id": uuid7(),
        "project_code": code,
        "name": f"{code} 工程",
        "client_name": "示範業主",
        "site_location": "示範工地",
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


def _orm_project(owner_id, **extra) -> Project:
    return Project(
        project_code="DEMO",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
        created_by=owner_id,
        updated_by=owner_id,
        **extra,
    )


def test_column_is_not_null_and_registry_maps_roles_to_levels(session):
    columns = {
        column["name"]: column
        for column in inspect(session.get_bind()).get_columns("projects")
    }
    assert columns["company_role"]["nullable"] is False
    assert columns["company_role"]["type"].length == 32

    levels = {
        role.value: role.inspection_level
        for role in company_roles.list_company_roles()
    }
    assert levels == {
        "contractor": "self_inspection",
        "supervisor": "spot_check",
    }
    assert [role.label for role in company_roles.list_company_roles()] == [
        "承攬施工方",
        "監造方",
    ]


def test_omitted_role_defaults_and_supervisor_is_stored(session):
    owner = create_root_user_with_company(session, "R76A")
    default = _orm_project(owner.id)
    supervisor = _orm_project(owner.id, company_role="supervisor")
    session.add_all([default, supervisor])
    session.commit()

    session.expire_all()
    assert default.company_role == "contractor"
    assert supervisor.company_role == "supervisor"


@pytest.mark.parametrize("bad", [None, "unknown", "", "Contractor"])
def test_orm_rejects_unregistered_or_null_role(session, bad):
    owner = create_root_user_with_company(session, "R76B")
    with pytest.raises(ValueError):
        _orm_project(owner.id, company_role=bad)

    project = _orm_project(owner.id)
    session.add(project)
    session.commit()
    with pytest.raises(ValueError):
        project.company_role = bad
    session.refresh(project)
    assert project.company_role == "contractor"


def test_core_writes_with_unregistered_role_are_rejected(session):
    # 不經 ORM 屬性的寫入（Core insert／update）也要在綁定時被擋下
    # （DOM-R76，比照 DOM-R35）。
    owner = create_root_user_with_company(session, "R76C")
    table = cast(Table, Project.__table__)
    values = _project_values(owner.id, "CORE")

    with pytest.raises(StatementError):
        session.execute(insert(table).values(**values, company_role="bad"))
    session.rollback()

    owner = create_root_user_with_company(session, "R76D")
    project = _orm_project(owner.id)
    session.add(project)
    session.commit()
    with pytest.raises(StatementError):
        session.execute(
            update(table)
            .where(table.c.id == project.id)
            .values(company_role="bad")
        )
    session.rollback()
    session.refresh(project)
    assert project.company_role == "contractor"


def test_temporary_role_needs_no_table_change(session, extra_company_role):
    owner = create_root_user_with_company(session, "R76E")
    project = _orm_project(owner.id, company_role=extra_company_role)
    session.add(project)
    session.commit()

    session.expire_all()
    assert project.company_role == extra_company_role
    assert company_roles.company_role_inspection_level(extra_company_role) == (
        "spot_check"
    )


def test_migration_backfills_existing_projects_with_contractor(db_url):
    cfg = _config()
    command.upgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        assert "company_role" not in {
            column["name"]
            for column in inspect(engine).get_columns("projects")
        }
        with Session(engine) as session:
            owner = create_root_user_with_company(session, "R76F")
            table = _projects_table(engine)
            first = _project_values(owner.id, "OLD-1")
            second = _project_values(owner.id, "OLD-2")
            session.execute(insert(table), [first, second])
            session.commit()
    finally:
        engine.dispose()

    command.upgrade(cfg, "head")
    engine = create_engine_from_settings(db_url)
    try:
        columns = {
            column["name"]: column
            for column in inspect(engine).get_columns("projects")
        }
        assert columns["company_role"]["nullable"] is False
        table = _projects_table(engine)
        with Session(engine) as session:
            rows = session.execute(
                select(table.c.id, table.c.company_role).order_by(
                    table.c.project_code
                )
            ).all()
            assert [(row.id, row.company_role) for row in rows] == [
                (first["id"], "contractor"),
                (second["id"], "contractor"),
            ]
            # 資料庫端的預設值：略過欄位的寫入也是 contractor。
            third = _project_values(first["created_by"], "NEW-3")
            session.execute(insert(table).values(**third))
            session.commit()
            assert (
                session.scalar(
                    select(table.c.company_role).where(
                        table.c.id == third["id"]
                    )
                )
                == "contractor"
            )
    finally:
        engine.dispose()

    command.downgrade(cfg, _PARENT)
    engine = create_engine_from_settings(db_url)
    try:
        assert "company_role" not in {
            column["name"]
            for column in inspect(engine).get_columns("projects")
        }
        table = _projects_table(engine)
        with Session(engine) as session:
            assert len(session.execute(select(table.c.id)).all()) == 3
    finally:
        engine.dispose()


def test_migration_only_adds_a_column_and_imports_nothing_from_app():
    # DOM-R76：只新增欄位與更新資料、不重建資料表；回填寫字面值，不
    # import app 內的登記表或 model（登記表日後會變，migration 不能跟著變）。
    source = _MIGRATION.read_text(encoding="utf-8")
    assert "batch_alter_table" not in source
    assert "drop_table" not in source
    assert "create_table" not in source
    imported = {
        alias.name.split(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        (node.module or "").split(".")[0]
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ImportFrom)
    }
    assert "app" not in imported
    assert 'server_default="contractor"' in source
