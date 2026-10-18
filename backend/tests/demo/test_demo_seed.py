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
    assert "template.use" in accounts["consultant"]["permissions"]
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

    assert len(numeric_points) == 4
    for point in numeric_points:
        standard = point["numeric_standard"]
        field_ids = {
            field["client_id"] for field in point["measurement_fields"]
        }
        assert standard["measurement_field_client_id"] in field_ids
        assert point["evidence_requirements"]


def test_templates_include_a_separate_system_for_apply_walkthrough():
    templates = load_seed_data()["templates"]
    by_system = {}
    for template in templates:
        system = template.get("system", "給排水")
        by_system.setdefault(system, []).append(template["title"])

    assert by_system["給排水"] == [
        "排水管坡度檢查",
        "給水管試壓檢查",
        "止水閥標示檢查",
    ]
    assert by_system["電氣設備"] == [
        "配電盤外觀檢查",
        "接地電阻量測",
    ]


def test_seed_creates_systems_and_resets_sequences_per_system():
    seed = load_seed_module()

    class RecordingApi:
        def __init__(self):
            self.calls = []

        def call(self, method, path, body):
            self.calls.append((method, path, body))
            if path == "/template-categories":
                return {"id": "category"}
            if path.endswith("/systems"):
                return {"id": body["name"]}
            return {"id": body["title"]}

    api = RecordingApi()
    ids = seed.create_templates(api, load_seed_data()["templates"])
    created = [
        body for method, path, body in api.calls if path == "/templates"
    ]

    assert ids["system_id"] == "給排水"
    assert [item["sequence"] for item in created] == [1, 2, 3, 1, 2]
    assert [item["system_id"] for item in created] == [
        "給排水",
        "給排水",
        "給排水",
        "電氣設備",
        "電氣設備",
    ]


def test_seed_retains_default_system_id_for_project_task_templates():
    seed = load_seed_module()

    class RecordingApi:
        def call(self, method, path, body):
            if path == "/template-categories":
                return {"id": "category"}
            if path.endswith("/systems"):
                return {"id": body["name"]}
            return {"id": body["title"]}

    result = seed.create_templates(
        RecordingApi(), load_seed_data()["templates"]
    )

    assert result["排水管坡度檢查"] == "排水管坡度檢查"
    assert result["接地電阻量測"] == "接地電阻量測"
    assert result["system_id"] == "給排水"
