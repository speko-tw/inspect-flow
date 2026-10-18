"""#381 示範資料契約與範本 payload 回歸測試。"""

import importlib.util
import json
from pathlib import Path

REPO = Path(__file__).parents[3]
DATA_PATH = REPO / "demo" / "data" / "seed.json"
SCRIPT_PATH = REPO / "demo" / "scripts" / "seed.py"


def load_seed_data() -> dict:
    """讀取 demo/ 中供啟動腳本與教學共同使用的資料。"""
    return json.loads(DATA_PATH.read_text())


def load_seed_module():
    """載入獨立 CLI，驗證真正送往 API 的 payload builder。"""
    spec = importlib.util.spec_from_file_location("demo_seed", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_demo_accounts_cover_two_layer_access_identities():
    data = load_seed_data()
    accounts = {account["key"]: account for account in data["accounts"]}

    assert data["company"] == "示範廠機電工程"
    assert set(accounts) == {
        "office",
        "field_a",
        "field_b",
        "consultant",
        "template_delegate",
    }
    assert "project.create" in accounts["office"]["permissions"]
    assert "inspection_task.inspect" not in (accounts["office"]["permissions"])
    assert accounts["consultant"]["external"] is True
    assert accounts["template_delegate"]["delegated_modules"] == ["template"]
    assert accounts["template_delegate"]["permissions"] == []


def test_demo_projects_cover_statuses_and_real_dispatch_walkthrough():
    data = load_seed_data()
    projects = {project["key"]: project for project in data["projects"]}
    tasks = [
        task for project in projects.values() for task in project["tasks"]
    ]

    assert set(projects) == {"A", "B"}
    assert {task["status"] for task in tasks} == {
        "DRAFT",
        "PENDING",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
    }
    walkthrough = next(
        task for task in projects["B"]["tasks"] if task["key"] == "walkthrough"
    )
    assert walkthrough["status"] == "DRAFT"
    assert walkthrough["assignee"] == "field_a"
    assert any(
        member == ["consultant", "reader"]
        for member in projects["B"]["members"]
    )


def test_template_payload_links_numeric_standard_to_its_field():
    data = load_seed_data()
    seed = load_seed_module()
    payloads = [
        seed.build_template_points(template["points"])
        for template in data["templates"]
    ]
    points = [point for template in payloads for point in template]
    numeric_points = [point for point in points if point["numeric_standard"]]

    assert len(numeric_points) == 3
    for point in numeric_points:
        standard = point["numeric_standard"]
        field_ids = {
            field["client_id"] for field in point["measurement_fields"]
        }
        assert standard["measurement_field_client_id"] in field_ids
        assert point["evidence_requirements"]
