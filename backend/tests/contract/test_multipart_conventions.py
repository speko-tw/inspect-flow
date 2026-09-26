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
