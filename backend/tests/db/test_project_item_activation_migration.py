"""DOM-AC78：停用旗標的非空、預設值與保留關聯的升降版。"""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import inspect, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings
from app.models import (
    InspectionPlan,
    InspectionTask,
    Project,
    ProjectInspectionItem,
    TaskInspectionItem,
    TaskRequirementSnapshot,
)
from tests.db.conftest import create_root_user_with_company

_CFG = str(Path(__file__).resolve().parents[2] / "alembic.ini")


def test_item_activation_migration_backfills_and_preserves_snapshots(db_url):
    """由父版升級時全部啟用，來源與 Task／Snapshot 的識別完全保留。"""
    cfg = Config(_CFG)
    command.upgrade(cfg, "head")
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as db:
            actor = create_root_user_with_company(db, "ACTIVATE717")
            project = Project(
                project_code="ACT717",
                name="旗標測試",
                client_name="業主",
                site_location="工地",
                created_by=actor.id,
                updated_by=actor.id,
            )
            db.add(project)
            db.flush()
            item = ProjectInspectionItem(
                project_id=project.id,
                sequence=1,
                title="保留來源",
                instruction="原說明",
                source_template_name="範本",
                applied_at=project.created_at,
                is_active=False,
                created_by=actor.id,
                updated_by=actor.id,
            )
            plan = InspectionPlan(
                project_id=project.id,
                name="保留計畫",
                created_by=actor.id,
                updated_by=actor.id,
            )
            db.add_all([item, plan])
            db.flush()
            task = InspectionTask(
                plan_id=plan.id,
                project_id=project.id,
                name="保留任務",
                created_by=actor.id,
                updated_by=actor.id,
            )
            db.add(task)
            db.flush()
            association = TaskInspectionItem(
                task_id=task.id,
                project_id=project.id,
                project_inspection_item_id=item.id,
                created_by=actor.id,
                updated_by=actor.id,
            )
            db.add(association)
            db.flush()
            snapshot = TaskRequirementSnapshot(
                task_inspection_item_id=association.id,
                revision=1,
                source_standard_revision=1,
                title="原快照",
                instruction="保留原文",
                source_template_name="範本",
                is_current=True,
                created_by=actor.id,
                updated_by=actor.id,
            )
            db.add(snapshot)
            db.commit()
            ids = item.id, task.id, association.id, snapshot.id
    finally:
        engine.dispose()
    command.downgrade(cfg, "a515c0f9e2d1")
    engine = create_engine_from_settings(db_url)
    try:
        assert "is_active" not in {
            row["name"]
            for row in inspect(engine).get_columns("project_inspection_items")
        }
    finally:
        engine.dispose()
    command.upgrade(cfg, "head")
    engine = create_engine_from_settings(db_url)
    try:
        cols = {
            row["name"]: row
            for row in inspect(engine).get_columns("project_inspection_items")
        }
        assert cols["is_active"]["nullable"] is False
        assert cols["is_active"]["default"] is not None
        with Session(engine) as db:
            item = db.get(ProjectInspectionItem, ids[0])
            task = db.get(InspectionTask, ids[1])
            association = db.get(TaskInspectionItem, ids[2])
            snapshot = db.get(TaskRequirementSnapshot, ids[3])
            assert item is not None
            assert task is not None
            assert association is not None
            assert snapshot is not None
            assert item.is_active is True
            assert item.title == "保留來源"
            assert task.name == "保留任務"
            assert association.project_inspection_item_id == ids[0]
            assert snapshot.instruction == "保留原文"
            item.is_active = False
            db.commit()
            db.expire_all()
            assert db.scalar(select(ProjectInspectionItem.is_active)) is False
            with pytest.raises(IntegrityError):
                db.execute(
                    update(ProjectInspectionItem).values(is_active=None)
                )
                db.commit()
            db.rollback()
    finally:
        engine.dispose()
