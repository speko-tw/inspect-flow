"""IP-AC17: backfill task names and verify SQLite/PostgreSQL downgrade."""

import importlib.util
from pathlib import Path

from alembic.config import Config
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    ProjectZone,
    TaskInspectionItem,
)
from tests.db.conftest import create_root_user_with_company

_BACKEND = Path(__file__).resolve().parents[2]
_PARENT_REVISION = "b4e8a2c71f93"
_REVISION = "a497f3d2b601"


def _config() -> Config:
    return Config(str(_BACKEND / "alembic.ini"))


def test_bounded_name_always_satisfies_name_check() -> None:
    """截斷後只剩空白也要退回預設名稱，否則 CHECK 會擋下升級。"""
    path = (
        _BACKEND
        / "alembic"
        / "versions"
        / "a497f3d2b601_add_inspection_task_name.py"
    )
    spec = importlib.util.spec_from_file_location("task_name_rev", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    assert module._bounded_name("門檢查") == "門檢查"
    assert module._bounded_name("   ") == "查核任務"
    assert module._bounded_name(" " * 130 + "X") == "查核任務"
    assert module._bounded_name("長" * 200) == "長" * 128
    assert module._bounded_name("\x00X") == "X"
    assert module._bounded_name("\x00") == "查核任務"


def test_task_name_migration_backfills_and_downgrades(db_url: str) -> None:
    config = _config()
    command.upgrade(config, "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            actor = create_root_user_with_company(session, "TASKNAME")
            project = Project(
                project_code="TASK-NAME",
                name="任務名稱測試",
                client_name="業主",
                site_location="工地",
                created_by=actor.id,
                updated_by=actor.id,
            )
            session.add(project)
            session.flush()
            zone = ProjectZone(
                project_id=project.id,
                name="B1 停車場",
                name_key="b1 停車場",
                created_by=actor.id,
                updated_by=actor.id,
            )
            plan = InspectionPlan(
                project_id=project.id,
                name="測試計畫",
                created_by=actor.id,
                updated_by=actor.id,
            )
            session.add_all([zone, plan])
            session.flush()
            items = [
                ProjectInspectionItem(
                    project_id=project.id,
                    sequence=index,
                    title=title,
                    instruction="檢查",
                    source_template_name="範本",
                    applied_at=project.created_at,
                    created_by=actor.id,
                    updated_by=actor.id,
                )
                for index, title in enumerate(("消防撒水頭", "管線支架"), 1)
            ]
            session.add_all(items)
            session.flush()
            tasks = [
                InspectionTask(
                    plan_id=plan.id,
                    project_id=project.id,
                    name="舊名稱一",
                    zone_id=zone.id,
                    # 分區與補充地點並存時，回填以分區名稱優先。
                    location_text="應被忽略的補充地點",
                    created_by=actor.id,
                    updated_by=actor.id,
                ),
                InspectionTask(
                    plan_id=plan.id,
                    project_id=project.id,
                    name="舊名稱二",
                    location_text="東側",
                    created_by=actor.id,
                    updated_by=actor.id,
                ),
                InspectionTask(
                    plan_id=plan.id,
                    project_id=project.id,
                    name="舊名稱三",
                    location_text="屋頂",
                    created_by=actor.id,
                    updated_by=actor.id,
                ),
                InspectionTask(
                    plan_id=plan.id,
                    project_id=project.id,
                    name="舊空白名稱",
                    created_by=actor.id,
                    updated_by=actor.id,
                ),
            ]
            blank_item = ProjectInspectionItem(
                project_id=project.id,
                sequence=4,
                title="   ",
                instruction="檢查",
                source_template_name="範本",
                applied_at=project.created_at,
                created_by=actor.id,
                updated_by=actor.id,
            )
            long_item = ProjectInspectionItem(
                project_id=project.id,
                sequence=3,
                title="長" * 160,
                instruction="檢查",
                source_template_name="範本",
                applied_at=project.created_at,
                created_by=actor.id,
                updated_by=actor.id,
            )
            session.add_all([*tasks, blank_item, long_item])
            session.flush()
            long_task = InspectionTask(
                plan_id=plan.id,
                project_id=project.id,
                name="舊長名稱",
                created_by=actor.id,
                updated_by=actor.id,
            )
            session.add(long_task)
            # SQLite 的 length() 遇到 NUL 即停止，舊標題含 NUL 也要能升級；
            # PostgreSQL 的 text 不能存 NUL，不會有這類舊資料，故不植入。
            nul_titles = (
                ((5, "\x00X"), (6, "\x00"))
                if engine.dialect.name == "sqlite"
                else ()
            )
            nul_items = [
                ProjectInspectionItem(
                    project_id=project.id,
                    sequence=sequence,
                    title=title,
                    instruction="檢查",
                    source_template_name="範本",
                    applied_at=project.created_at,
                    created_by=actor.id,
                    updated_by=actor.id,
                )
                for sequence, title in nul_titles
            ]
            nul_tasks = [
                InspectionTask(
                    plan_id=plan.id,
                    project_id=project.id,
                    name=f"舊 NUL 名稱{index}",
                    created_by=actor.id,
                    updated_by=actor.id,
                )
                for index in range(len(nul_titles))
            ]
            session.add_all([*nul_items, *nul_tasks])
            session.flush()
            session.add_all(
                TaskInspectionItem(
                    task_id=nul_task.id,
                    project_id=project.id,
                    project_inspection_item_id=nul_item.id,
                    created_by=actor.id,
                    updated_by=actor.id,
                )
                for nul_task, nul_item in zip(
                    nul_tasks, nul_items, strict=True
                )
            )
            session.flush()
            session.add_all(
                [
                    TaskInspectionItem(
                        task_id=long_task.id,
                        project_id=project.id,
                        project_inspection_item_id=long_item.id,
                        created_by=actor.id,
                        updated_by=actor.id,
                    ),
                    TaskInspectionItem(
                        task_id=tasks[0].id,
                        project_id=project.id,
                        project_inspection_item_id=items[0].id,
                        created_by=actor.id,
                        updated_by=actor.id,
                    ),
                    TaskInspectionItem(
                        task_id=tasks[3].id,
                        project_id=project.id,
                        project_inspection_item_id=blank_item.id,
                        created_by=actor.id,
                        updated_by=actor.id,
                    ),
                    *[
                        TaskInspectionItem(
                            task_id=tasks[1].id,
                            project_id=project.id,
                            project_inspection_item_id=item.id,
                            created_by=actor.id,
                            updated_by=actor.id,
                        )
                        for item in items
                    ],
                ]
            )
            session.commit()
            task_ids = (
                [task.id for task in tasks]
                + [long_task.id]
                + [task.id for task in nul_tasks]
            )
            task_item_id = session.scalar(
                select(TaskInspectionItem.id).where(
                    TaskInspectionItem.task_id == long_task.id
                )
            )
    finally:
        engine.dispose()

    command.downgrade(config, _PARENT_REVISION)
    command.upgrade(config, _REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            backfilled = [
                session.get(InspectionTask, task_id) for task_id in task_ids
            ]
            assert backfilled[0] is not None
            assert backfilled[1] is not None
            assert backfilled[2] is not None
            assert backfilled[3] is not None
            assert backfilled[4] is not None
            assert backfilled[0].name == "消防撒水頭－B1 停車場"
            # 全空白標題的舊資料退回預設名稱，不得讓升級失敗。
            assert backfilled[3].name == "查核任務"
            assert len(backfilled[4].name) == 128
            assert backfilled[4].name == "長" * 128
            if nul_titles:
                assert backfilled[5] is not None
                assert backfilled[6] is not None
                assert backfilled[5].name == "X"
                assert backfilled[6].name == "查核任務"
            assert task_item_id is not None
            assert session.get(TaskInspectionItem, task_item_id) is not None
            assert backfilled[1].name == "消防撒水頭等 2 項－東側"
            assert backfilled[2].name == "查核任務－屋頂"
        columns = {
            row["name"]: row
            for row in inspect(engine).get_columns("inspection_tasks")
        }
        assert columns["name"]["nullable"] is False
    finally:
        engine.dispose()

    command.downgrade(config, _PARENT_REVISION)
    engine = create_engine_from_settings(db_url)
    try:
        assert "name" not in {
            row["name"]
            for row in inspect(engine).get_columns("inspection_tasks")
        }
        assert inspect(engine).has_table("task_inspection_items")
    finally:
        engine.dispose()
