#!/usr/bin/env python3
"""透過後端 API 建立隔離、可重建的示範資料。"""

import argparse
import json
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

DATA_FILE = Path(__file__).parents[1] / "data" / "seed.json"
COOKIE_NAME = "__Host-inspectflow_session"


class Api:
    """管理單一登入工作階段，資料操作都走正式 API。"""

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/") + "/api/v1"
        self.cookie: str | None = None

    def call(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        ok: tuple[int, ...] = (200, 201, 204),
    ) -> dict | None:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"},
        )
        if self.cookie:
            request.add_header("Cookie", self.cookie)
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        raw = response.read().decode()
        if response.status not in ok:
            raise RuntimeError(
                f"{method} {path} returned {response.status}: {raw}"
            )
        for header in response.headers.get_all("Set-Cookie") or []:
            if header.startswith(COOKIE_NAME + "="):
                self.cookie = header.split(";", 1)[0]
        return json.loads(raw) if raw else None


def login(base: str, username: str, password: str) -> Api:
    """以示範帳號登入後端並回傳已驗證的 API 工作階段。"""
    api = Api(base)
    api.call("POST", "/auth/login", {
        "login": username,
        "password": password,
    })
    return api


def change_first_password(
    base: str, username: str, temporary: str, password: str
) -> Api:
    """更換臨時密碼，避免首次登入畫面打斷示範。"""
    api = login(base, username, temporary)
    api.call("POST", "/auth/password", {
        "current_password": temporary,
        "new_password": password,
    })
    return login(base, username, password)


def build_template_points(spec: list[dict]) -> list[dict]:
    """將示範項目轉成範本 API 結構並連結量測欄位標準。"""
    points = []
    for sequence, point in enumerate(spec, start=1):
        fields = []
        numeric = None
        for field in point.get("fields", []):
            client_id = str(uuid.uuid4())
            bound = bool(field.get("standard"))
            fields.append({
                "client_id": client_id,
                "name": field["name"],
                "field_type": field["type"],
                "unit": None if bound else field.get("unit"),
            })
            if bound:
                numeric = dict(
                    field["standard"],
                    unit=field["unit"],
                    measurement_field_client_id=client_id,
                )
        text = None
        if point.get("text_standard"):
            text = {"text": point["text_standard"]}
        points.append({
            "sequence": sequence,
            "title": point["title"],
            "instruction": point["instruction"],
            "text_standard": text,
            "numeric_standard": numeric,
            "measurement_fields": fields,
            "evidence_requirements": [{"min_count": point["photos"]}],
        })
    return points


def get_role_id(api: Api, name: str) -> str:
    roles = api.call("GET", "/roles")
    for role in roles["items"]:
        if role["name"] == name:
            return role["id"]
    raise RuntimeError(f"預建角色不存在：{name}")


def create_accounts(
    base: str, admin: Api, company_id: str, data: dict
) -> tuple[dict, dict]:
    """建立虛構帳號並依兩層模型設定模組權限與委派。"""
    users = {}
    sessions = {}
    for account in data["accounts"]:
        created = admin.call("POST", "/users", {
            "username": account["username"],
            "email": account["email"],
            "name_zh": account["name"],
            "company_id": (
                None if account["external"] else company_id
            ),
            "is_external_collaborator": account["external"],
        })
        user_id = created["id"]
        users[account["key"]] = user_id
        change_first_password(
            base,
            account["username"],
            created["temporary_password"],
            account["password"],
        )
        for code in account["permissions"]:
            admin.call(
                "PUT",
                f"/users/{user_id}/module-permissions/{code}",
            )
        for module in account["delegated_modules"]:
            admin.call(
                "PUT",
                f"/users/{user_id}/module-delegations/{module}",
            )
        sessions[account["key"]] = login(
            base, account["username"], account["password"]
        )
    return users, sessions


def create_templates(admin: Api, templates: list[dict]) -> dict[str, str]:
    """建立範本庫資料，供各示範專案套用。"""
    category = admin.call("POST", "/template-categories", {
        "name": "建築工程",
    })
    system = admin.call(
        "POST",
        f"/template-categories/{category['id']}/systems",
        {"name": "給排水"},
    )
    template_ids = {}
    for sequence, template in enumerate(templates, start=1):
        created = admin.call("POST", "/templates", {
            "system_id": system["id"],
            "sequence": sequence,
            "title": template["title"],
            "instruction": template["instruction"],
            "inspection_points": build_template_points(
                template["points"]
            ),
        })
        template_ids[template["title"]] = created["id"]
    template_ids["system_id"] = system["id"]
    return template_ids


def create_task(
    api: Api,
    plan_id: str,
    item_id: str,
    zone_id: str,
    task: dict,
    users: dict,
    sessions: dict,
) -> str:
    """依示範狀態建立 Task，保留可實際操作的草稿。"""
    created = api.call(
        "POST",
        f"/inspection-plans/{plan_id}/tasks",
        {
            "name": task["name"],
            "item_ids": [item_id],
            "zone_id": zone_id,
            "location_text": task["location"],
            "suggested_assignee_id": users.get(task["assignee"]),
        },
    )
    task_id = created["id"]
    desired = task["status"]
    if desired != "DRAFT":
        api.call("POST", f"/inspection-tasks/{task_id}:dispatch")
    if desired in {"IN_PROGRESS", "COMPLETED"}:
        field = sessions[task["assignee"]]
        field.call("POST", f"/inspection-tasks/{task_id}:start")
        if desired == "COMPLETED":
            field.call("POST", f"/inspection-tasks/{task_id}:complete")
    elif desired == "CANCELLED":
        api.call(
            "POST",
            f"/inspection-tasks/{task_id}:cancel",
            {"reason": "示範資料中的取消狀態"},
        )
    return task_id


def seed(base: str, code: str) -> dict:
    """建立公司、人員、專案、範本及各狀態示範任務。"""
    data = json.loads(DATA_FILE.read_text())
    admin = Api(base)
    admin.call("POST", "/setup/admin-password", {
        "code": code,
        "password": data["admin"]["password"],
    })
    company = admin.call("POST", "/companies", {
        "name": data["company"],
    })
    users, sessions = create_accounts(
        base, admin, company["id"], data
    )
    role_ids = {
        key: get_role_id(admin, name)
        for key, name in data["roles"].items()
    }
    template_ids = create_templates(admin, data["templates"])
    projects = {}
    tasks = {}
    for project in data["projects"]:
        office = sessions["office"]
        created = office.call("POST", "/projects", {
            "project_code": project["code"],
            "name": project["name"],
            "client_name": project["client"],
            "site_location": project["location"],
        })
        project_id = created["id"]
        projects[project["key"]] = project_id
        # DOM-R65 讓建立者在同一交易自動取得預建角色。
        for user_key, role_key in project["members"]:
            office.call("POST", f"/projects/{project_id}/members", {
                "user_id": users[user_key],
                "role_ids": [role_ids[role_key]],
            })
        office.call(
            "POST",
            f"/projects/{project_id}/inspection-items:apply-template",
            {"system_id": template_ids["system_id"]},
        )
        items = office.call(
            "GET", f"/projects/{project_id}/inspection-items"
        )["items"]
        item_ids = {item["title"]: item["id"] for item in items}
        zones = {}
        for task in project["tasks"]:
            name = task["zone"]
            if name not in zones:
                zone = office.call(
                    "POST", f"/projects/{project_id}/zones", {"name": name}
                )
                zones[name] = zone["id"]
        plan = office.call(
            "POST",
            f"/projects/{project_id}/inspection-plans",
            {"name": f"{project['name']}查核計畫"},
        )
        for task in project["tasks"]:
            task_id = create_task(
                office,
                plan["id"],
                item_ids[task["item"]],
                zones[task["zone"]],
                task,
                users,
                sessions,
            )
            tasks[f"{project['key']}_{task['key']}"] = task_id
    admin_config = data["admin"]
    admin_view = login(
        base, admin_config["username"], admin_config["password"]
    )
    project_id = projects["B"]
    summary = admin_view.call(
        "GET", f"/admin/dashboard/summary?project_id={project_id}"
    )
    engineers = admin_view.call(
        "GET", f"/admin/dashboard/engineers?project_id={project_id}"
    )
    if not summary["pending_count"] or not summary["in_progress_count"]:
        raise RuntimeError(
            "示範 Dashboard 必須有待開始與進行中任務"
        )
    if not summary["completed_count"]:
        raise RuntimeError("示範 Dashboard 必須有已完成任務")
    if not any(item["name_zh"] == "吳怡君" for item in engineers["items"]):
        raise RuntimeError("示範 Dashboard 必須列出現場工作量")
    return {
        "company_id": company["id"],
        "users": users,
        "projects": projects,
        "tasks": tasks,
        "dashboard": summary,
    }


def main() -> None:
    """執行一次性資料初始化並可選擇輸出 UUID 對照表。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8300")
    parser.add_argument("--code", required=True)
    parser.add_argument("--out")
    args = parser.parse_args()
    try:
        result = seed(args.base, args.code)
    except (OSError, RuntimeError, urllib.error.URLError) as error:
        sys.exit(f"demo seed failed: {error}")
    if args.out:
        Path(args.out).write_text(
            json.dumps(result, ensure_ascii=False, indent=2)
        )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    print("demo seed: done")


if __name__ == "__main__":
    main()
