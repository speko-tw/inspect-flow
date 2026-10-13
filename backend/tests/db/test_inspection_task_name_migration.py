"""IP-AC17: backfill task names and verify SQLite/PostgreSQL downgrade."""

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
_PARENT_REVISION = "c13b5e7a9d20"
_REVISION = "a497f3d2b601"


def _config() -> Config:
    return Config(str(_BACKEND / "alembic.ini"))


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
            ]
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
            session.add_all([*tasks, long_item])
            session.flush()
            long_task = InspectionTask(
                plan_id=plan.id,
                project_id=project.id,
                name="舊長名稱",
                created_by=actor.id,
                updated_by=actor.id,
            )
            session.add(long_task)
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
            task_ids = [task.id for task in tasks] + [long_task.id]
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
            assert backfilled[0].name == "消防撒水頭－B1 停車場"
            assert len(backfilled[3].name) == 128
            assert backfilled[3].name == "長" * 128
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
