"""ADM-R47、#414：帳號詳情的公司名稱不依賴列表或公司目錄。"""

import pytest

from app.main import create_app


@pytest.mark.parametrize(
    "path,method",
    [
        ("/api/v1/users/{user_id}", "get"),
        ("/api/v1/users/{user_id}", "patch"),
        ("/api/v1/users/{user_id}/company", "put"),
        ("/api/v1/users/{user_id}/admin", "put"),
        ("/api/v1/users/{user_id}/active", "put"),
    ],
)
def test_user_detail_contract_requires_nullable_company_name(path, method):
    """詳情必須明確回傳公司名稱或 null，避免前端以連結狀態代替名稱。"""
    schema = create_app().openapi()
    response = schema["paths"][path][method]["responses"]["200"]["content"][
        "application/json"
    ]["schema"]
    definition = schema["components"]["schemas"][
        response["$ref"].split("/")[-1]
    ]
    assert "company_name" in definition["required"]
    assert {
        part["type"]
        for part in definition["properties"]["company_name"]["anyOf"]
    } == {"string", "null"}
