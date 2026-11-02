"""Contract test for multipart uploads (API-AC06)."""

import base64

from fastapi import APIRouter, FastAPI, UploadFile
from fastapi.testclient import TestClient

from app.api.errors import ErrorCode, register_error_handlers


def test_upload_requires_multipart_instead_of_json_base64() -> None:
    router = APIRouter()

    @router.post("/api/v1/upload")
    async def upload(file: UploadFile) -> dict[str, str]:
        content = await file.read()
        return {"filename": file.filename or "", "content": content.decode()}

    app = FastAPI()
    register_error_handlers(app)
    app.include_router(router)
    client = TestClient(app)
    payload = b"same file contents"

    multipart_response = client.post(
        "/api/v1/upload",
        files={"file": ("sample.txt", payload, "text/plain")},
    )

    assert multipart_response.request.headers["content-type"].startswith(
        "multipart/form-data; boundary="
    )
    assert multipart_response.status_code == 200
    assert multipart_response.json() == {
        "filename": "sample.txt",
        "content": payload.decode(),
    }

    json_response = client.post(
        "/api/v1/upload",
        json={"file": base64.b64encode(payload).decode()},
    )

    assert json_response.request.headers["content-type"] == "application/json"
    assert 400 <= json_response.status_code < 500
    assert json_response.json() == {
        "error": {"code": ErrorCode.REQUEST_VALIDATION_FAILED.value}
    }


def test_field_evidence_endpoint_rejects_json_and_accepts_multipart(
    tmp_path, monkeypatch
) -> None:
    """API-AC06: exercise multipart against the real authorized route."""
    import hashlib
    import io
    from pathlib import Path
    from uuid import UUID, uuid4

    from alembic.config import Config
    from fastapi.testclient import TestClient
    from PIL import Image
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from alembic import command
    from app.db.engine import create_engine_from_settings, dispose_engine
    from app.db.settings import DATABASE_URL_ENV_VAR
    from app.main import create_app
    from app.models import TaskInspectionItem, TaskRequirementSnapshot
    from tests.api.test_inspection_planning_api import (
        _dispatched_field_task,
        _planning_world,
    )

    backend = Path(__file__).resolve().parents[2]
    monkeypatch.setenv(
        DATABASE_URL_ENV_VAR, f"sqlite:///{tmp_path / 'contract.db'}"
    )
    monkeypatch.setenv(
        "INSPECTFLOW_EVIDENCE_STORAGE_ROOT", str(tmp_path / "photos")
    )
    dispose_engine()
    command.upgrade(Config(str(backend / "alembic.ini")), "head")
    engine = create_engine_from_settings()

    def make_client():
        return TestClient(create_app(), base_url="https://testserver")

    try:
        with Session(engine) as session:
            world = _planning_world(session, make_client)
            _, task_id = _dispatched_field_task(
                world, "multipart route contract", world["field_user"].id
            )
            started = world["field"].post(
                f"/api/v1/inspection-tasks/{task_id}:start"
            )
            assert started.status_code == 200, started.text
            item = session.scalar(
                select(TaskInspectionItem).where(
                    TaskInspectionItem.task_id == UUID(task_id)
                )
            )
            assert item is not None
            snapshot = session.scalar(
                select(TaskRequirementSnapshot).where(
                    TaskRequirementSnapshot.task_inspection_item_id == item.id,
                    TaskRequirementSnapshot.is_current.is_(True),
                )
            )
            assert snapshot is not None
            from app.models import TaskSnapshotPoint

            point_id = session.scalar(
                select(TaskSnapshotPoint.source_point_id).where(
                    TaskSnapshotPoint.snapshot_id == snapshot.id
                )
            )
            assert point_id is not None
            image = Image.new("RGB", (1200, 800), (40, 90, 130))
            output = io.BytesIO()
            image.save(output, "JPEG", quality=90)
            content = output.getvalue()
            path = f"/api/v1/inspection-tasks/{task_id}/photos"
            json_response = world["field"].post(
                path,
                headers={"Idempotency-Key": str(uuid4())},
                json={"file": content.decode("latin-1")},
            )
            assert json_response.status_code == 422
            assert json_response.json() == {
                "error": {"code": "request.validation_failed"}
            }

            multipart_response = world["field"].post(
                path,
                headers={"Idempotency-Key": str(uuid4())},
                data={
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "item_id": str(item.id),
                    "is_overview": "false",
                    "point_ids": [str(point_id)],
                    "capture_source": "camera",
                },
                files={"file": ("field.jpg", content, "image/jpeg")},
            )
            assert multipart_response.status_code == 201, (
                multipart_response.text
            )
            assert set(multipart_response.json()["variants"]) == {
                "field",
                "office",
            }
    finally:
        engine.dispose()
        dispose_engine()
