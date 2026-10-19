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

    assert data["company"] == "示範公司"
    assert set(accounts) == {
        "office",
        "manager",
        "field_a",
        "field_b",
        "consultant",
        "template_delegate",
        "template_manager",
        "no_access",
    }
    assert len(accounts) + 1 == 9
    assert data["admin"] == {
        "username": "admin",
        "password": "DemoAdmin2026",
    }

    expected = {
        "office": (
            "demo-office",
            {"project.create", "inspection.use", "template.use"},
            [],
            False,
        ),
        "manager": (
            "demo-manager",
            {"all_project_progress.read"},
            [],
            False,
        ),
        "field_a": (
            "demo-field-a",
            {"project.use", "inspection.use"},
            [],
            False,
        ),
        "field_b": (
            "demo-field-b",
            {"project.use", "inspection.use"},
            [],
            False,
        ),
        "consultant": (
            "demo-consultant",
            {"project.use", "inspection.use", "template.use"},
            [],
            True,
        ),
        "template_delegate": (
            "demo-template-delegate",
            set(),
            ["template"],
            False,
        ),
        "template_manager": (
            "demo-template-manager",
            {"template.manage"},
            [],
            False,
        ),
        "no_access": (
            "demo-no-access",
            set(),
            [],
            False,
        ),
    }
    for key, (username, permissions, delegated, external) in expected.items():
        account = accounts[key]
        assert account["username"] == username
        assert set(account["permissions"]) == permissions
        assert account["delegated_modules"] == delegated
        assert account["external"] is external

    assert (
        "template.manage" not in accounts["template_delegate"]["permissions"]
    )
    assert accounts["no_access"]["permissions"] == []
    assert accounts["no_access"]["delegated_modules"] == []

    projects = data["projects"]
    assert {project["client"] for project in projects} == {
        "示範公司",
        "示範廠機電工程",
    }
    role_names = data["roles"]
    project_roles = {key: [] for key in accounts}
    project_roles["admin"] = []
    for project in projects:
        # 專案建立 API 會自動給建立者內業角色，因此要補入角色預期。
        project_roles["office"].append(role_names["office"])
        for member, role in project["members"]:
            project_roles[member].append(role_names[role])

    assert project_roles == {
        "admin": [],
        "office": ["專案工程師", "專案工程師"],
        "manager": [],
        "field_a": ["現場工程師", "現場工程師"],
        "field_b": ["現場工程師", "現場工程師"],
        "consultant": ["專案查閱人員"],
        "template_delegate": [],
        "template_manager": [],
        "no_access": [],
    }


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
