#!/usr/bin/env python3
"""範本建議（TPL-AC33～AC43）真後端 HTTP 整合驗收（#807）。

所有動作都走正式 API，不讀寫資料庫、不用 mock。腳本只對本機後端執行
（沿用 seed.py 的位址守門），在示範資料上另建一個獨立世界：新的人員、
專案、來源項目與目標系統，因此可在 SQLite 與 PostgreSQL 重複執行。

人員（虛構）：林小姐（提議人）、陳先生（另一位提議人）、吳經理與
王主任（審核者，只有 template.manage、不是來源專案成員）。

用法：
  suggestion_integration.py --base URL --seed-result FILE --out FILE
  suggestion_integration.py ... --world-only --tag ui --out world.json
"""

import argparse
import copy
import json
import sys
import threading
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from seed import (  # noqa: E402
    Api,
    build_template_points,
    change_first_password,
    get_role_id,
    require_loopback_base,
)

PASSWORD = "DemoSuggest2026"
REVIEW_REASON = "請補充梁柱接頭的間距與照片要求"
RESULTS: list[dict] = []


class Raw(Api):
    """與 seed.Api 共用登入 cookie，但保留非 2xx 的狀態碼與內容。"""

    def req(self, method: str, path: str, body: dict | None = None):
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
        try:
            payload = json.loads(raw) if raw else None
        except ValueError:
            payload = raw
        return response.status, payload


def session(base: str, username: str, password: str) -> Raw:
    """以帳號密碼登入並回傳保留狀態碼的工作階段。"""
    api = Raw(base)
    api.call("POST", "/auth/login", {"login": username, "password": password})
    return api


def code_of(response) -> str | None:
    """取回錯誤封包的 error.code；成功回應回 None。"""
    payload = response[1]
    if isinstance(payload, dict):
        return (payload.get("error") or {}).get("code")
    return None


def check(ac: str, label: str, condition: bool, detail: str = "") -> bool:
    """記錄一筆斷言；失敗不中斷，最後統一以非零退出碼回報。"""
    RESULTS.append(
        {"ac": ac, "check": label, "ok": bool(condition), "detail": detail}
    )
    print(f"{'PASS' if condition else 'FAIL'} {ac} {label} {detail}".strip())
    return bool(condition)


def expected(detail: dict) -> dict:
    """把最後讀到的版本與狀態當作 expected 欄位送回。"""
    return {
        "expected_revision_id": detail["current_revision_id"],
        "expected_status": detail["status"],
    }


def point_spec(title: str, photos: int = 1) -> dict:
    """示範來源項目用的單一項次，含數字標準與綁定欄位。"""
    return {
        "title": title,
        "instruction": f"{title}的做法與判定。",
        "photos": photos,
        "fields": [
            {
                "name": "實測值",
                "type": "number",
                "unit": "mm",
                "standard": {
                    "value": "10",
                    "condition": ">=",
                },
            },
            {"name": "備註", "type": "text"},
        ],
    }


def make_template(admin: Raw, system_id: str, sequence: int, title: str):
    """以正式範本 API 建立一筆多項次範本，供套用成來源項目。"""
    created = admin.call(
        "POST",
        "/templates",
        {
            "system_id": system_id,
            "sequence": sequence,
            "title": title,
            "instruction": f"{title}說明",
            "inspection_points": build_template_points(
                [point_spec(f"{title}項次一"), point_spec(f"{title}項次二", 2)]
            ),
        },
    )
    return created


def create_user(base, admin, company_id, key, name, tag, permissions):
    """建立虛構人員並換掉臨時密碼，回傳可直接登入的資訊。"""
    username = f"demo-{key}-{tag}"
    created = admin.call(
        "POST",
        "/users",
        {
            "username": username,
            "email": f"{username}@example.com",
            "name_zh": name,
            "company_id": company_id,
            "is_external_collaborator": False,
        },
    )
    change_first_password(
        base, username, created["temporary_password"], PASSWORD
    )
    for code in permissions:
        admin.call("PUT", f"/users/{created['id']}/module-permissions/{code}")
    return {
        "id": created["id"],
        "username": username,
        "password": PASSWORD,
        "name": name,
    }


def build_world(base: str, seed_result: dict, tag: str) -> dict:
    """在示範資料上另建獨立的人員、專案、來源項目與目標系統。"""
    admin = session(base, "admin", "DemoAdmin2026")
    company_id = seed_result["company_id"]
    roles = {
        "edit": get_role_id(admin, "專案工程師"),
        "field": get_role_id(admin, "現場工程師"),
        "reader": get_role_id(admin, "專案查閱人員"),
    }
    people = {
        "lin": ("林小姐", ["inspection.use"]),
        "chen": ("陳先生", ["inspection.use"]),
        "wu": ("吳經理", ["template.manage"]),
        "wang": ("王主任", ["template.manage"]),
        "noinsp": ("周助理", []),
    }
    users = {
        key: create_user(base, admin, company_id, key, name, tag, perms)
        for key, (name, perms) in people.items()
    }
    # 任務與外部協作者沿用示範資料帳號，不為本功能新增權限。
    for key, login, secret in (
        ("field", "demo-field-a", "DemoFieldA2026"),
        ("consultant", "demo-consultant", "DemoConsultant2026"),
        ("delegate", "demo-template-delegate", "DemoDelegate2026"),
        ("no_access", "demo-no-access", "DemoNoAccess2026"),
    ):
        users[key] = {
            "id": seed_result["users"][
                {
                    "field": "field_a",
                    "consultant": "consultant",
                    "delegate": "template_delegate",
                    "no_access": "no_access",
                }[key]
            ],
            "username": login,
            "password": secret,
            "name": key,
        }
    category = admin.call(
        "POST", "/template-categories", {"name": f"QA-{tag}-main 建議驗收分類"}
    )
    other_category = admin.call(
        "POST", "/template-categories", {"name": f"QA-{tag}-other 另一分類"}
    )
    systems = {}
    for key, owner, name in (
        ("A", category, "結構工程"),
        ("B", category, "防水工程"),
        ("other", other_category, "他類系統"),
        ("source", category, "來源素材"),
    ):
        systems[key] = admin.call(
            "POST",
            f"/template-categories/{owner['id']}/systems",
            # 名稱以 ASCII 開頭，純鍵盤走查才能用輸入字母選取下拉項目。
            {"name": f"QA-{tag}-{key} {name}"},
        )
    for number in range(1, 11):
        make_template(admin, systems["source"]["id"], number, f"素材{number}")
    seeded = next(
        item
        for item in admin.call("GET", "/template-categories?limit=100")[
            "items"
        ]
        if item["name"] == "建築工程"
    )
    drain = next(
        item
        for item in admin.call(
            "GET", f"/template-categories/{seeded['id']}/systems"
        )["items"]
        if item["name"] == "給排水"
    )
    project = admin.call(
        "POST",
        "/projects",
        {
            "project_code": f"SUG-{tag.upper()}",
            "name": f"範本建議驗收工程{tag}",
            "client_name": "示範公司",
            "site_location": "示範市驗收路一號",
        },
    )
    members = (
        ("lin", "edit"),
        ("chen", "edit"),
        ("noinsp", "edit"),
        ("field", "field"),
        ("consultant", "reader"),
    )
    for key, role in members:
        admin.call(
            "POST",
            f"/projects/{project['id']}/members",
            {"user_id": users[key]["id"], "role_ids": [roles[role]]},
        )
    for system_id in (drain["id"], systems["source"]["id"]):
        admin.call(
            "POST",
            f"/projects/{project['id']}/inspection-items:apply-template",
            {"system_id": system_id},
        )
    items = admin.call("GET", f"/projects/{project['id']}/inspection-items")[
        "items"
    ]
    return {
        "tag": tag,
        "users": users,
        "roles": roles,
        "project": project["id"],
        "project_name": project["name"],
        "systems": {key: value["id"] for key, value in systems.items()},
        "categories": {
            "main": category["id"],
            "other": other_category["id"],
        },
        "items": {item["title"]: item["id"] for item in items},
        "source_titles": [item["title"] for item in items],
    }


def sessions_for(base: str, world: dict) -> dict:
    """為世界中的每個人登入一份獨立工作階段（可並行使用）。"""
    result = {
        key: session(base, user["username"], user["password"])
        for key, user in world["users"].items()
    }
    result["admin"] = session(base, "admin", "DemoAdmin2026")
    return result


def audit_events(admin: Raw, event_type: str | None = None) -> list[dict]:
    """逐頁讀完稽核事件（Admin 專用 API）。"""
    items: list[dict] = []
    cursor = None
    while True:
        query = "limit=100"
        if event_type:
            query += f"&event_type={event_type}"
        if cursor:
            query += f"&cursor={cursor}"
        page = admin.call("GET", f"/audit-logs?{query}")
        items += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return items


def events_of(admin: Raw, entity_id: str) -> list[dict]:
    """某一件建議自己的事件，由舊到新。"""
    rows = [
        row
        for row in audit_events(admin)
        if row["entity_id"] == entity_id
        and row["event_type"].startswith("template_suggestion.")
    ]
    return sorted(rows, key=lambda row: (row["created_at"], row["id"]))


def audit_total(admin: Raw) -> int:
    """目前稽核事件總數，用來斷言「失敗不留成功事件」。"""
    return len(audit_events(admin))


def pending_all(wu: Raw) -> list[dict]:
    """逐頁讀完全部待審件（limit=1，順便驗證游標）。"""
    rows, cursor = [], None
    while True:
        query = "status=PENDING&limit=1" + (
            f"&cursor={cursor}" if cursor else ""
        )
        page = wu.call("GET", f"/template-suggestions?{query}")
        rows += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return rows


def templates_in(admin: Raw, system_id: str) -> list[dict]:
    """某目標系統現有的範本摘要。"""
    return admin.call("GET", f"/templates?system_id={system_id}&limit=100")[
        "items"
    ]


class Flow:
    """各情境共用的小動作，維持斷言可讀。"""

    def __init__(self, world: dict, s: dict) -> None:
        self.w = world
        self.s = s
        self.project = world["project"]

    def item(self, title: str) -> str:
        return self.w["items"][title]

    def propose(self, who: str, title: str, project=None):
        return self.s[who].req(
            "POST",
            f"/projects/{project or self.project}/template-suggestions",
            {"project_inspection_item_id": self.item(title)},
        )

    def make(self, who: str, title: str) -> dict:
        status, data = self.propose(who, title)
        assert status == 201, (status, data)
        return data

    def get(self, who: str, sid: str) -> dict:
        status, data = self.s[who].req("GET", f"/template-suggestions/{sid}")
        assert status == 200, (status, data)
        return data

    def action(self, who: str, sid: str, verb: str, body: dict):
        return self.s[who].req(
            "POST", f"/template-suggestions/{sid}:{verb}", body
        )

    def revise(self, who: str, detail: dict, content: dict):
        return self.s[who].req(
            "POST",
            f"/template-suggestions/{detail['id']}/revisions",
            dict(expected(detail), content=content),
        )

    def return_it(self, sid: str, reason: str = REVIEW_REASON, who="wu"):
        detail = self.get(who, sid)
        status, data = self.action(
            who, sid, "return", dict(expected(detail), reason=reason)
        )
        assert status == 200, (status, data)
        return data

    def approve(self, sid: str, system: str = "A", who: str = "wu"):
        detail = self.get(who, sid)
        return self.action(
            who,
            sid,
            "approve",
            dict(
                expected(detail),
                category_id=self.w["categories"]["main"],
                system_id=self.w["systems"][system],
            ),
        )

    def revisions(self, who: str, sid: str) -> list[dict]:
        status, data = self.s[who].req(
            "GET", f"/template-suggestions/{sid}/revisions?limit=100"
        )
        assert status == 200, (status, data)
        return data["items"]


def race(first, second):
    """同時放行兩個動作，回傳兩者的結果（用來驗證競爭只有一方成功）。"""
    barrier = threading.Barrier(2)

    def run(action):
        barrier.wait()
        return action()

    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(run, first), pool.submit(run, second)]
        return futures[0].result(), futures[1].result()


def edited(content: dict, title: str | None = None, note: str | None = None):
    """複製內容並改名稱／第一個項次說明，用來產生新修訂。"""
    result = copy.deepcopy(content)
    if title is not None:
        result["title"] = title
    if note is not None:
        result["inspection_points"][0]["instruction"] = note
    return result


def source_item(admin: Raw, project: str, item_id: str) -> dict:
    """讀回來源專案項目，用於比對「提議不改來源」。"""
    items = admin.call("GET", f"/projects/{project}/inspection-items")
    return next(i for i in items["items"] if i["id"] == item_id)


def scenario_ac33(f: Flow, base: str) -> None:
    """TPL-AC33：資格矩陣、停用來源須先恢復、不要求 template.use。"""
    admin = f.s["admin"]
    title = "素材1"
    before = (audit_total(admin), len(pending_all(f.s["wu"])))
    expected_status = {
        "lin": 201,
        "chen": 201,
        "admin": 201,
        "noinsp": 403,
        "field": 403,
        "consultant": 403,
        "wu": 403,
        "wang": 403,
        "delegate": 403,
        "no_access": 403,
    }
    for who, want in expected_status.items():
        got = f.propose(who, title)
        check(
            "TPL-AC33",
            f"{who} 提議回 {want}",
            got[0] == want,
            f"實際 {got[0]}",
        )
    successes = sum(1 for v in expected_status.values() if v == 201)
    after = (audit_total(admin), len(pending_all(f.s["wu"])))
    check(
        "TPL-AC33",
        "被拒絕者沒有新件、沒有稽核事件",
        after == (before[0] + successes, before[1] + successes),
        f"前 {before} 後 {after}",
    )
    codes = admin.call(
        "GET", f"/users/{f.w['users']['lin']['id']}/module-permissions"
    )["permission_codes"]
    check(
        "TPL-AC33",
        "林小姐只有 inspection.use、沒有 template.use 仍可提議",
        codes == ["inspection.use"],
        f"模組權限 {codes}",
    )
    # 停用來源：先恢復才可初次提出。
    inactive = "素材2"
    item_id = f.item(inactive)
    project = f.project
    admin.call(
        "POST",
        f"/projects/{project}/inspection-items/{item_id}:deactivate",
    )
    before_inactive = len(pending_all(f.s["wu"]))
    got = f.propose("lin", inactive)
    check(
        "TPL-AC33",
        "停用來源初次提出被拒、無新件",
        got[0] in (409, 422)
        and len(pending_all(f.s["wu"])) == before_inactive,
        f"狀態 {got[0]} {code_of(got)}",
    )
    admin.call(
        "POST",
        f"/projects/{project}/inspection-items/{item_id}:activate",
    )
    got = f.propose("lin", inactive)
    check("TPL-AC33", "恢復來源後可提出", got[0] == 201, f"狀態 {got[0]}")


def scenario_ac34_ac43(f: Flow) -> None:
    """TPL-AC34／AC43：來源改刪不影響待審件與已核准件。"""
    admin = f.s["admin"]
    project = f.project
    slope = "排水管坡度檢查"
    # 來源項目掛一筆現場任務，證明任務引用不被複製或改動。
    plan = admin.call(
        "POST", f"/projects/{project}/inspection-plans", {"name": "驗收計畫"}
    )
    zone = admin.call("POST", f"/projects/{project}/zones", {"name": "驗收區"})
    task = admin.call(
        "POST",
        f"/inspection-plans/{plan['id']}/tasks",
        {
            "name": "驗收任務",
            "item_ids": [f.item(slope)],
            "zone_id": zone["id"],
            "location_text": "A 棟",
            "suggested_assignee_id": f.w["users"]["field"]["id"],
        },
    )
    admin.call("POST", f"/inspection-tasks/{task['id']}:dispatch")
    f.s["field"].call("POST", f"/inspection-tasks/{task['id']}:start")
    original = source_item(admin, project, f.item(slope))
    task_before = admin.call("GET", f"/inspection-tasks/{task['id']}")
    detail = f.make("lin", slope)
    blob = json.dumps(detail["content"], ensure_ascii=False)
    source_ids = [original["id"]] + [
        p["id"] for p in original["inspection_points"]
    ]
    check(
        "TPL-AC34",
        "內容含完整項次、不含來源資料庫主鍵與任務引用",
        len(detail["content"]["inspection_points"])
        == len(original["inspection_points"])
        and all(i not in blob for i in source_ids)
        and "task_count" not in blob,
    )
    check(
        "TPL-AC34",
        "提議不改來源項目與任務",
        source_item(admin, project, f.item(slope)) == original
        and admin.call("GET", f"/inspection-tasks/{task['id']}")
        == task_before,
    )
    status, _ = admin.req(
        "PATCH",
        f"/projects/{project}/inspection-items/{f.item(slope)}",
        {
            "title": "來源被改名",
            "instruction": "來源被改說明",
            "reinspect": False,
        },
    )
    again = f.get("lin", detail["id"])
    check(
        "TPL-AC34",
        "來源修改後待審內容與雜湊不變",
        status == 200
        and again["content"] == detail["content"]
        and again["content_sha256"] == detail["content_sha256"]
        and again["status"] == "PENDING",
        f"來源 PATCH 狀態 {status}",
    )
    # 刪除：另一筆沒有任務引用的來源。
    doomed = "素材3"
    sug = f.make("lin", doomed)
    status, _ = admin.req(
        "DELETE", f"/projects/{project}/inspection-items/{f.item(doomed)}"
    )
    after = f.get("lin", sug["id"])
    revs = f.revisions("lin", sug["id"])
    check(
        "TPL-AC34",
        "來源刪除後待審件、各版與名稱快照仍在",
        status == 204
        and after["content"] == sug["content"]
        and after["status"] == "PENDING"
        and after["source_item_title"] == sug["source_item_title"]
        and len(revs) == 1,
        f"刪除狀態 {status}",
    )
    # 複製與刪除競爭：完整快照或 404，絕不留下空件。
    outcomes = {"copied": 0, "missing": 0}
    ok = True
    for number in range(4, 10):
        title = f"素材{number}"
        total = len(
            f.s["lin"].call("GET", "/me/template-suggestions?limit=100")[
                "items"
            ]
        )
        proposed, deleted = race(
            partial(f.propose, "lin", title),
            partial(
                admin.req,
                "DELETE",
                f"/projects/{project}/inspection-items/{f.item(title)}",
            ),
        )
        listed = f.s["lin"].call("GET", "/me/template-suggestions?limit=100")
        if proposed[0] == 201:
            outcomes["copied"] += 1
            ok &= (
                deleted[0] == 204
                and len(proposed[1]["content"]["inspection_points"]) == 2
            )
            ok &= len(listed["items"]) == total + 1
        else:
            outcomes["missing"] += 1
            ok &= proposed[0] == 404 and deleted[0] == 204
            ok &= len(listed["items"]) == total
    check(
        "TPL-AC34",
        "複製／刪除競爭 6 輪皆為完整快照或 404、無空件",
        ok,
        json.dumps(outcomes),
    )
    # AC43：核准後改刪來源，入庫範本與已核准件不變。
    title = "素材10"
    sug = f.make("lin", title)
    status = f.approve(sug["id"], "A")[0]
    approved = f.get("wu", sug["id"])
    template_id = approved["approved_template_id"]
    snap = {
        "template": admin.call("GET", f"/templates/{template_id}"),
        "detail": approved,
        "revisions": f.revisions("wu", sug["id"]),
    }
    admin.call(
        "PATCH",
        f"/projects/{project}/inspection-items/{f.item(title)}",
        {"title": "核准後被改名", "reinspect": False},
    )
    mid = admin.call("GET", f"/templates/{template_id}")
    gone, _ = admin.req(
        "DELETE", f"/projects/{project}/inspection-items/{f.item(title)}"
    )
    final = {
        "template": admin.call("GET", f"/templates/{template_id}"),
        "detail": f.get("wu", sug["id"]),
        "revisions": f.revisions("wu", sug["id"]),
    }
    check(
        "TPL-AC43",
        "核准後先改再刪來源，範本結構與核准件全部不變",
        status == 200
        and gone == 204
        and mid == snap["template"]
        and final == snap,
        f"核准 {status} 刪除 {gone}",
    )
    check(
        "TPL-AC43",
        "範本與核准件仍存在、歷程可讀",
        final["detail"]["status"] == "APPROVED"
        and final["template"]["title"] == snap["detail"]["title"]
        and len(final["revisions"]) == 1,
    )


def scenario_ac35_ac36(f: Flow) -> str:
    """TPL-AC35／AC36：退回兩次重送、管理者改版核准、比較與不可覆寫。"""
    title = "給水管試壓檢查"
    sug = f.make("lin", title)
    sid = sug["id"]
    got = f.revise("lin", sug, edited(sug["content"], title="本人待審改"))
    check(
        "TPL-AC35",
        "待審件本人不能修改",
        got[0] in (403, 409),
        f"狀態 {got[0]}",
    )
    f.return_it(sid, "第一次退回原因")
    detail = f.get("lin", sid)
    got = f.action("lin", sid, "submit", expected(detail))
    check(
        "TPL-AC35",
        "退回後未改內容不能重送",
        got[0] == 409 and code_of(got) == "template_suggestion.invalid_state",
        f"狀態 {got[0]} {code_of(got)}",
    )
    got = f.revise("lin", detail, edited(detail["content"], title="第二版"))
    detail2 = got[1]
    check("TPL-AC35", "退回後保存第 2 版", got[0] == 201, f"狀態 {got[0]}")
    got = f.action("lin", sid, "submit", expected(detail2))
    check(
        "TPL-AC35",
        "第 2 版同一件重送回待審",
        got[0] == 200
        and got[1]["status"] == "PENDING"
        and got[1]["id"] == sid,
    )
    f.return_it(sid, "第二次退回原因")
    detail = f.get("lin", sid)
    got = f.revise("lin", detail, edited(detail["content"], note="第三版說明"))
    got = f.action("lin", sid, "submit", expected(got[1]))
    check(
        "TPL-AC35",
        "退回兩次後第三版仍可重送（不限次數）",
        got[0] == 200 and got[1]["revision_no"] == 3,
        f"版本 {got[1]['revision_no'] if got[0] == 200 else got}",
    )
    got = f.s["wu"].req(
        "PATCH", f"/template-suggestions/{sid}", {"status": "APPROVED"}
    )
    check(
        "TPL-AC35",
        "直接 PATCH status 被拒（無此端點）",
        got[0] in (404, 405),
        f"狀態 {got[0]}",
    )
    # AC36：同件第 1 版退回、本人第 2 版重送、管理者第 3 版後核准。
    sug = f.make("lin", "素材1")
    sid = sug["id"]
    v1 = sug
    f.return_it(sid, "請補充依據")
    detail = f.get("lin", sid)
    v2d = f.revise("lin", detail, edited(detail["content"], title="第二版名"))
    f.action("lin", sid, "submit", expected(v2d[1]))
    detail = f.get("wu", sid)
    v3d = f.revise(
        "wu",
        detail,
        edited(detail["content"], title="管理者第三版", note="管理者改"),
    )
    check(
        "TPL-AC36",
        "管理者修改待審件新增第 3 版且仍待審",
        v3d[0] == 201
        and v3d[1]["status"] == "PENDING"
        and v3d[1]["revision_no"] == 3,
    )
    got = f.approve(sid, "A")
    final = f.get("wu", sid)
    revs = f.revisions("lin", sid)
    check(
        "TPL-AC36",
        "核准指向第 3 版並保存審核紀錄",
        got[0] == 200
        and final["status"] == "APPROVED"
        and got[1]["reviewed_revision_id"] == revs[2]["id"],
    )
    check(
        "TPL-AC36",
        "三版內容、編輯者、退回原因各自保留",
        [r["revision_no"] for r in revs] == [1, 2, 3]
        and revs[0]["content"] == v1["content"]
        and revs[0]["editor_name"] == "林小姐"
        and revs[2]["editor_name"] == "吳經理"
        and any(
            x["reason"] == "請補充依據" and x["reviewer_name"] == "吳經理"
            for x in revs[0]["reviews"]
        ),
    )
    wu_revs = f.revisions("wu", sid)
    check("TPL-AC36", "管理者讀到同一份完整歷程", wu_revs == revs)
    cmp12 = f.s["wu"].req(
        "GET",
        f"/template-suggestions/{sid}/revisions:compare"
        f"?from_revision_id={revs[0]['id']}&to_revision_id={revs[1]['id']}",
    )
    cmp23 = f.s["wu"].req(
        "GET",
        f"/template-suggestions/{sid}/revisions:compare"
        f"?from_revision_id={revs[1]['id']}&to_revision_id={revs[2]['id']}",
    )
    cmp13 = f.s["wu"].req(
        "GET",
        f"/template-suggestions/{sid}/revisions:compare"
        f"?from_revision_id={revs[0]['id']}&to_revision_id={revs[2]['id']}",
    )
    check(
        "TPL-AC36",
        "相鄰 1／2、2／3 可比較，非相鄰 1／3 回 422",
        cmp12[0] == 200 and cmp23[0] == 200 and cmp13[0] == 422,
        f"{cmp12[0]}/{cmp23[0]}/{cmp13[0]}",
    )
    check(
        "TPL-AC36",
        "本人不可比較（僅管理者）",
        f.s["lin"].req(
            "GET",
            f"/template-suggestions/{sid}/revisions:compare"
            f"?from_revision_id={revs[0]['id']}"
            f"&to_revision_id={revs[1]['id']}",
        )[0]
        == 403,
    )
    for verb, path in (
        ("PUT", f"/template-suggestions/{sid}/revisions/{revs[0]['id']}"),
        ("PATCH", f"/template-suggestions/{sid}/revisions/{revs[0]['id']}"),
        ("DELETE", f"/template-suggestions/{sid}/revisions/{revs[0]['id']}"),
    ):
        got = f.s["wu"].req(verb, path, {"content": {}})
        check(
            "TPL-AC36",
            f"{verb} 覆寫舊版被拒（無此端點）",
            got[0] in (404, 405),
            f"狀態 {got[0]}",
        )
    # 終止件與非法轉換。
    for who, verb, body in (
        ("lin", "withdraw", expected(final)),
        ("lin", "submit", expected(final)),
        (
            "wu",
            "return",
            dict(expected(final), reason="終止後退回"),
        ),
    ):
        got = f.action(who, sid, verb, body)
        check(
            "TPL-AC35",
            f"已核准件不能 {verb}",
            got[0] == 409
            and code_of(got) == "template_suggestion.invalid_state",
            f"狀態 {got[0]} {code_of(got)}",
        )
    got = f.approve(sid, "A")
    check("TPL-AC35", "已核准件不能再核准", got[0] == 409)
    got = f.revise("wu", final, edited(final["content"], title="終止後改"))
    check("TPL-AC35", "已核准件不能再修改", got[0] == 409, f"{got[0]}")
    # 撤回：保留歷程，終止。
    sug = f.make("lin", "素材1")
    got = f.action("lin", sug["id"], "withdraw", expected(sug))
    done = f.get("lin", sug["id"])
    again = f.action("lin", sug["id"], "withdraw", expected(done))
    check(
        "TPL-AC35",
        "撤回保留各版與歷程且不能再撤回",
        got[0] == 200
        and done["status"] == "WITHDRAWN"
        and len(f.revisions("lin", sug["id"])) == 1
        and again[0] == 409,
    )
    got = f.action("lin", sug["id"], "submit", expected(done))
    check("TPL-AC35", "已撤回件不能重送", got[0] == 409)
    # 無變更保存回 200，不增版。
    sug = f.make("lin", "素材1")
    f.return_it(sug["id"])
    detail = f.get("lin", sug["id"])
    got = f.revise("lin", detail, copy.deepcopy(detail["content"]))
    check(
        "TPL-AC36",
        "無變更保存回 200 且不增版",
        got[0] == 200
        and got[1]["revision_no"] == 1
        and len(f.revisions("lin", sug["id"])) == 1,
    )
    return sid


def scenario_ac37(f: Flow) -> None:
    """TPL-AC37：審核權限、原因必填與失敗不留紀錄。"""
    admin = f.s["admin"]
    sug = f.make("lin", "素材1")
    sid = sug["id"]
    for who in ("field", "consultant", "delegate", "noinsp", "lin"):
        list_status = f.s[who].req("GET", "/template-suggestions")[0]
        ret = f.action(
            who,
            sid,
            "return",
            dict(expected(sug), reason="不該成功"),
        )[0]
        app = f.action(
            who,
            sid,
            "approve",
            dict(
                expected(sug),
                category_id=f.w["categories"]["main"],
                system_id=f.w["systems"]["A"],
            ),
        )[0]
        check(
            "TPL-AC37",
            f"{who} 不能列管理清單、退回或核准",
            (list_status, ret, app) == (403, 403, 403),
            f"{list_status}/{ret}/{app}",
        )
    check(
        "TPL-AC37",
        "吳經理（非來源成員）可讀管理清單",
        f.s["wu"].req("GET", "/template-suggestions?status=ALL")[0] == 200,
    )
    got = f.s["wu"].req(
        "PATCH",
        f"/projects/{f.project}/inspection-items/{f.item('素材1')}",
        {"title": "審核者不得改來源"},
    )
    check(
        "TPL-AC37",
        "審核者不因審核取得來源專案寫入權",
        got[0] == 403,
        f"狀態 {got[0]}",
    )
    before = audit_total(admin)
    for reason in ("   ", "", "字" * 1001):
        got = f.action("wu", sid, "return", dict(expected(sug), reason=reason))
        check(
            "TPL-AC37",
            f"退回原因（長度 {len(reason.strip())}）回 422",
            got[0] == 422,
            f"狀態 {got[0]}",
        )
    revs = f.revisions("wu", sid)
    check(
        "TPL-AC37",
        "422 後仍待審、無審核紀錄、無新增事件",
        f.get("wu", sid)["status"] == "PENDING"
        and revs[0]["reviews"] == []
        and audit_total(admin) == before,
    )
    got = f.action(
        "wu", sid, "return", dict(expected(sug), reason="字" * 1000)
    )
    check(
        "TPL-AC37",
        "合法的 1000 字原因可退回並保存",
        got[0] == 200 and got[1]["return_reason"] == "字" * 1000,
    )


def scenario_ac38_ac39(f: Flow) -> None:
    """TPL-AC38：同名、目標錯誤與配號；AC39：競爭與回滾。"""
    admin = f.s["admin"]
    sug = f.make("lin", "素材1")
    sid = sug["id"]
    title = sug["title"]
    make_template(admin, f.w["systems"]["A"], 1, title)
    make_template(admin, f.w["systems"]["B"], 1, "CASEFOLD驗收")
    count_a = len(templates_in(admin, f.w["systems"]["A"]))
    before = audit_total(admin)
    got = f.approve(sid, "A")
    check(
        "TPL-AC38",
        "同名核准回 409 template.name_conflict",
        got[0] == 409 and code_of(got) == "template.name_conflict",
        f"狀態 {got[0]} {code_of(got)}",
    )
    detail = f.get("wu", sid)
    check(
        "TPL-AC38",
        "同名後仍待審、範本數與稽核不變",
        detail["status"] == "PENDING"
        and len(templates_in(admin, f.w["systems"]["A"])) == count_a
        and audit_total(admin) == before,
    )
    mismatch = f.action(
        "wu",
        sid,
        "approve",
        dict(
            expected(detail),
            category_id=f.w["categories"]["main"],
            system_id=f.w["systems"]["other"],
        ),
    )
    missing = f.action(
        "wu",
        sid,
        "approve",
        dict(
            expected(detail),
            category_id=f.w["categories"]["main"],
            system_id=str(uuid.uuid4()),
        ),
    )
    check(
        "TPL-AC38",
        "系統不屬所選類別 422、不存在的目標 404",
        mismatch[0] == 422 and missing[0] == 404,
        f"{mismatch[0]}/{missing[0]}",
    )
    revised = f.revise(
        "wu", detail, edited(detail["content"], title=" casefold驗收 ")
    )
    got = f.approve(sid, "B")
    check(
        "TPL-AC38",
        "trim／casefold 比對同名仍回 409",
        revised[0] == 201 and got[0] == 409,
        f"{revised[0]}/{got[0]}",
    )
    detail = f.get("wu", sid)
    f.revise("wu", detail, edited(detail["content"], title=f"{title}通用版"))
    max_before = max(
        t["sequence"] for t in templates_in(admin, f.w["systems"]["A"])
    )
    got = f.approve(sid, "A")
    templates = templates_in(admin, f.w["systems"]["A"])
    new = [t for t in templates if t["title"] == f"{title}通用版"]
    check(
        "TPL-AC38",
        "改名後核准成功，只新增一筆且序號接最大值",
        got[0] == 200
        and len(templates) == count_a + 1
        and len(new) == 1
        and new[0]["sequence"] == max_before + 1,
        f"核准 {got[0]} {code_of(got)}；序號 "
        f"{new[0]['sequence'] if new else None}；原有 {count_a}",
    )
    approved = f.get("wu", sid)
    snap = approved["approval"]
    admin.call(
        "PATCH",
        f"/template-categories/{f.w['categories']['main']}",
        {"name": f"QA-{f.w['tag']}-main 主分類改名"},
    )
    admin.req("DELETE", f"/templates/{approved['approved_template_id']}")
    after = f.get("wu", sid)
    check(
        "TPL-AC38",
        "範本日後被刪／分類改名，核准快照與歷程不變",
        after["approval"] == snap
        and after["status"] == "APPROVED"
        and len(f.revisions("wu", sid)) == 3,
        "變動欄位 "
        + ",".join(k for k in snap if snap[k] != after["approval"].get(k)),
    )
    # AC39：兩位審核者並行核准同一件。
    wins = {"approve": 0, "conflict": 0}
    ok = True
    for _ in range(5):
        sug = f.make("lin", "素材1")
        sug_title = f"並行核准{uuid.uuid4().hex[:6]}"
        detail = f.get("wu", sug["id"])
        f.revise("wu", detail, edited(detail["content"], title=sug_title))
        detail = f.get("wu", sug["id"])
        body = dict(
            expected(detail),
            category_id=f.w["categories"]["main"],
            system_id=f.w["systems"]["B"],
        )
        results = race(
            partial(f.action, "wu", sug["id"], "approve", body),
            partial(f.action, "wang", sug["id"], "approve", body),
        )
        statuses = sorted(r[0] for r in results)
        made = [
            t
            for t in templates_in(admin, f.w["systems"]["B"])
            if t["title"] == sug_title
        ]
        ok &= statuses == [200, 409] and len(made) == 1
        ok &= f.get("wu", sug["id"])["status"] == "APPROVED"
        wins["approve"] += statuses.count(200)
        wins["conflict"] += statuses.count(409)
    check(
        "TPL-AC39",
        "兩位審核者並行核准 5 輪：恰一個 200、一筆範本",
        ok,
        json.dumps(wins),
    )
    # 核准對撤回。
    ok, outcome = True, {"approved": 0, "withdrawn": 0}
    for _ in range(5):
        sug = f.make("lin", "素材1")
        sug_title = f"核准撤回{uuid.uuid4().hex[:6]}"
        detail = f.get("wu", sug["id"])
        f.revise("wu", detail, edited(detail["content"], title=sug_title))
        detail = f.get("wu", sug["id"])
        approve_body = dict(
            expected(detail),
            category_id=f.w["categories"]["main"],
            system_id=f.w["systems"]["B"],
        )
        approved_r, withdrawn_r = race(
            partial(f.action, "wu", sug["id"], "approve", approve_body),
            partial(f.action, "lin", sug["id"], "withdraw", expected(detail)),
        )
        made = [
            t
            for t in templates_in(admin, f.w["systems"]["B"])
            if t["title"] == sug_title
        ]
        final = f.get("wu", sug["id"])["status"]
        if approved_r[0] == 200:
            outcome["approved"] += 1
            ok &= withdrawn_r[0] == 409 and final == "APPROVED"
            ok &= len(made) == 1
        else:
            outcome["withdrawn"] += 1
            ok &= approved_r[0] == 409 and withdrawn_r[0] == 200
            ok &= final == "WITHDRAWN" and len(made) == 0
    check(
        "TPL-AC39",
        "核准對撤回 5 輪：只一方成功，範本數與狀態一致",
        ok,
        json.dumps(outcome),
    )
    # 核准對管理者修訂：核准的範本必須等於受審版本。
    ok, outcome = True, {"approved_first": 0, "revised_first": 0}
    for _ in range(5):
        sug = f.make("lin", "素材1")
        sug_title = f"核准修訂{uuid.uuid4().hex[:6]}"
        detail = f.get("wu", sug["id"])
        f.revise("wu", detail, edited(detail["content"], title=sug_title))
        detail = f.get("wu", sug["id"])
        approve_body = dict(
            expected(detail),
            category_id=f.w["categories"]["main"],
            system_id=f.w["systems"]["B"],
        )
        new_content = edited(detail["content"], title=sug_title + "改")
        approved_r, revised_r = race(
            partial(f.action, "wu", sug["id"], "approve", approve_body),
            partial(f.revise, "wang", detail, new_content),
        )
        titles = [t["title"] for t in templates_in(admin, f.w["systems"]["B"])]
        if approved_r[0] == 200:
            outcome["approved_first"] += 1
            ok &= revised_r[0] == 409 and sug_title in titles
            ok &= sug_title + "改" not in titles
        else:
            outcome["revised_first"] += 1
            ok &= approved_r[0] == 409 and revised_r[0] == 201
            ok &= sug_title not in titles and sug_title + "改" not in titles
            ok &= f.get("wu", sug["id"])["status"] == "PENDING"
    check(
        "TPL-AC39",
        "核准對修訂 5 輪：只一方成功，核准的是受審版本",
        ok,
        json.dumps(outcome),
    )
    # 過期 expected 欄位。
    sug = f.make("lin", "素材1")
    f.return_it(sug["id"])
    detail = f.get("lin", sug["id"])
    first = f.revise("lin", detail, edited(detail["content"], title="版二"))
    stale = f.revise("lin", detail, edited(detail["content"], title="版三"))
    check(
        "TPL-AC39",
        "過期 expected 欄位回 409 template_suggestion.changed",
        first[0] == 201
        and stale[0] == 409
        and code_of(stale) == "template_suggestion.changed",
        f"{first[0]}/{stale[0]} {code_of(stale)}",
    )


def scenario_ac40(f: Flow) -> None:
    """TPL-AC40：待審數量、本人隔離、入口條件與無通知。"""
    admin = f.s["admin"]
    wu = f.s["wu"]
    mine = f.make("chen", "素材1")
    listed = pending_all(wu)
    count = wu.call("GET", "/template-suggestions:pending-count")
    check(
        "TPL-AC40",
        "待審數等於逐頁讀完（limit=1）的全部待審件",
        count["pending_count"] == len(listed) and len(listed) >= 1,
        f"{count['pending_count']} / {len(listed)}",
    )
    page = wu.call("GET", "/template-suggestions?status=PENDING&limit=1")
    searched = wu.call(
        "GET",
        "/template-suggestions?status=PENDING&q="
        + urllib.request.quote(mine["title"][:2]),
    )
    miss = wu.call(
        "GET",
        "/template-suggestions?status=PENDING&q="
        + urllib.request.quote("zzz不存在zzz"),
    )
    check(
        "TPL-AC40",
        "分頁與搜尋不改全體待審數",
        len(page["items"]) == 1
        and miss["items"] == []
        and wu.call("GET", "/template-suggestions:pending-count") == count
        and len(searched["items"]) >= 1,
    )
    steps = {}
    base_count = count["pending_count"]
    sug = f.make("lin", "素材1")
    steps["提出"] = wu.call("GET", "/template-suggestions:pending-count")
    f.return_it(sug["id"])
    steps["退回"] = wu.call("GET", "/template-suggestions:pending-count")
    detail = f.get("lin", sug["id"])
    revised = f.revise("lin", detail, edited(detail["content"], title="重送"))
    f.action("lin", sug["id"], "submit", expected(revised[1]))
    steps["重送"] = wu.call("GET", "/template-suggestions:pending-count")
    detail = f.get("lin", sug["id"])
    f.action("lin", sug["id"], "withdraw", expected(detail))
    steps["撤回"] = wu.call("GET", "/template-suggestions:pending-count")
    got = [steps[k]["pending_count"] - base_count for k in steps]
    check(
        "TPL-AC40",
        "提出、退回、重送、撤回後數量依序 +1、0、+1、0",
        got == [1, 0, 1, 0],
        str(got),
    )
    lin_list = f.s["lin"].call("GET", "/me/template-suggestions?limit=100")
    check(
        "TPL-AC40",
        "林小姐只看到自己的建議；陳先生的詳情 404",
        all(
            i["proposer_id"] == f.w["users"]["lin"]["id"]
            for i in lin_list["items"]
        )
        and f.s["lin"].req("GET", f"/template-suggestions/{mine['id']}")[0]
        == 404
        and f.s["lin"].req(
            "GET", f"/template-suggestions/{mine['id']}/revisions"
        )[0]
        == 404,
    )
    all_rows = wu.call("GET", "/template-suggestions?status=ALL&limit=100")
    ids = {row["id"] for row in all_rows["items"]}
    check(
        "TPL-AC40",
        "管理者讀得到所有已提出件（含林小姐與陳先生）",
        mine["id"] in ids and sug["id"] in ids,
    )
    project_filter = f.s["lin"].call(
        "GET",
        f"/me/template-suggestions?source_project_id={f.project}&limit=1",
    )
    other_filter = f.s["lin"].call(
        "GET",
        f"/me/template-suggestions?source_project_id={uuid.uuid4()}",
    )
    never = f.s["field"].call("GET", "/me/template-suggestions")
    check(
        "TPL-AC40",
        "本案件數含所有狀態；從未提議者為 0；缺 template.use 仍可讀",
        project_filter["total_count"] == lin_list["total_count"]
        and other_filter["total_count"] == 0
        and never["total_count"] == 0
        and never["items"] == [],
        f"{project_filter['total_count']}/{never['total_count']}",
    )
    probes = [
        f.s["admin"].req("GET", path)[0]
        for path in (
            "/notifications",
            "/me/notifications",
        )
    ]
    check(
        "TPL-AC40",
        "沒有通知端點（皆 404）",
        probes == [404, 404],
        str(probes),
    )
    _ = admin


def scenario_ac41(f: Flow) -> None:
    """TPL-AC41：失權後仍可讀與撤回，修改重送被拒，跨件隔離。"""
    admin = f.s["admin"]
    user_id = f.w["users"]["lin"]["id"]
    pending = f.make("lin", "素材1")
    returned = f.make("lin", "素材1")
    f.return_it(returned["id"])
    returned = f.get("lin", returned["id"])
    admin.call("DELETE", f"/projects/{f.project}/members/{user_id}")
    try:
        check(
            "TPL-AC41",
            "失去來源專案權限後仍可讀清單、詳情與各版",
            f.s["lin"].req("GET", "/me/template-suggestions")[0] == 200
            and f.s["lin"].req(
                "GET", f"/template-suggestions/{returned['id']}"
            )[0]
            == 200
            and f.s["lin"].req(
                "GET", f"/template-suggestions/{returned['id']}/revisions"
            )[0]
            == 200,
        )
        rev = f.revise(
            "lin", returned, edited(returned["content"], title="失權後改")
        )
        sub = f.action("lin", returned["id"], "submit", expected(returned))
        prop = f.propose("lin", "素材1")
        check(
            "TPL-AC41",
            "失權後修改、重送與新提議皆 403",
            (rev[0], sub[0], prop[0]) == (403, 403, 403),
            f"{rev[0]}/{sub[0]}/{prop[0]}",
        )
        wd = f.action("lin", pending["id"], "withdraw", expected(pending))
        check(
            "TPL-AC41",
            "失權後仍可撤回待審件",
            wd[0] == 200 and wd[1]["status"] == "WITHDRAWN",
        )
    finally:
        admin.call(
            "POST",
            f"/projects/{f.project}/members",
            {"user_id": user_id, "role_ids": [f.w["roles"]["edit"]]},
        )
    foreign = f.make("chen", "素材1")
    foreign_revs = f.revisions("chen", foreign["id"])
    mine = f.make("lin", "素材1")
    mine_revs = f.revisions("lin", mine["id"])
    got = f.s["wu"].req(
        "GET",
        f"/template-suggestions/{mine['id']}/revisions:compare"
        f"?from_revision_id={mine_revs[0]['id']}"
        f"&to_revision_id={foreign_revs[0]['id']}",
    )
    check(
        "TPL-AC41",
        "跨件修訂比較被拒且不洩漏內容",
        got[0] in (404, 422) and "inspection_points" not in json.dumps(got[1]),
        f"狀態 {got[0]}",
    )
    forged = []
    forged.append(
        f.s["lin"].req(
            "POST",
            f"/projects/{f.project}/template-suggestions",
            {
                "project_inspection_item_id": f.item("素材1"),
                "proposer_id": f.w["users"]["chen"]["id"],
            },
        )[0]
    )
    forged.append(
        f.s["lin"].req(
            "POST",
            f"/template-suggestions/{mine['id']}/revisions",
            dict(
                expected(mine),
                content=mine["content"],
                status="APPROVED",
            ),
        )[0]
    )
    forged.append(
        f.action(
            "wu",
            mine["id"],
            "return",
            dict(expected(mine), reason="x", reviewer_id=user_id),
        )[0]
    )
    check(
        "TPL-AC41",
        "請求夾帶身分或狀態欄位皆 422",
        forged == [422, 422, 422],
        str(forged),
    )


def scenario_ac42_trace(f: Flow) -> None:
    """TPL-AC42／稽核追溯：五種事件形狀、無變更與失敗不留事件。"""
    admin = f.s["admin"]
    project = f.project
    sug = f.make("lin", "素材1")
    sid = sug["id"]
    f.return_it(sid, "稽核用退回")
    detail = f.get("lin", sid)
    revised = f.revise(
        "lin", detail, edited(detail["content"], title="稽核版")
    )
    f.action("lin", sid, "submit", expected(revised[1]))
    before = audit_total(admin)
    f.revise("wu", f.get("wu", sid), edited(f.get("wu", sid)["content"]))
    noop = f.revise("wu", f.get("wu", sid), f.get("wu", sid)["content"])
    bad = f.action(
        "wu", sid, "return", dict(expected(f.get("wu", sid)), reason=" ")
    )
    check(
        "TPL-AC42",
        "無變更保存（200）與被拒絕的退回（422）沒有成功事件",
        noop[0] == 200 and bad[0] == 422 and audit_total(admin) == before,
    )
    detail = f.get("wu", sid)
    revised = f.revise("wu", detail, edited(detail["content"], note="管理者"))
    approved = f.approve(sid, "A")
    sug2 = f.make("lin", "素材1")
    f.action("lin", sug2["id"], "withdraw", expected(sug2))
    events = events_of(admin, sid)
    kinds = [e["event_type"] for e in events]
    check(
        "TPL-AC42",
        "事件依序：submitted、returned、revised、submitted、revised、approved",
        kinds
        == [
            "template_suggestion.submitted",
            "template_suggestion.returned",
            "template_suggestion.revised",
            "template_suggestion.submitted",
            "template_suggestion.revised",
            "template_suggestion.approved",
        ]
        and revised[0] == 201
        and approved[0] == 200,
        ",".join(k.split(".")[1] for k in kinds),
    )
    by_kind = {}
    for event in events:
        by_kind.setdefault(event["event_type"], []).append(event)
    first = by_kind["template_suggestion.submitted"][0]["after"]
    resub = by_kind["template_suggestion.submitted"][1]
    returned = by_kind["template_suggestion.returned"][0]["after"]
    ap = by_kind["template_suggestion.approved"][0]
    check(
        "TPL-AC42",
        "首次 submitted 記提議人、來源與雜湊；重送只記狀態",
        {
            "proposer_id",
            "source_project_id",
            "source_item_id",
            "revision_id",
            "content_sha256",
            "status",
        }
        <= set(first)
        and first["status"] == "PENDING"
        and resub["before"] == {"status": "RETURNED"}
        and resub["after"] == {"status": "PENDING"},
    )
    check(
        "TPL-AC42",
        "returned／approved 欄位符合目錄",
        {
            "status",
            "review_id",
            "reviewed_revision_id",
            "reviewer_id",
            "reason",
        }
        <= set(returned)
        and {
            "status",
            "review_id",
            "reviewed_revision_id",
            "reviewer_id",
            "template_id",
            "category_id",
            "system_id",
        }
        <= set(ap["after"])
        and ap["before"] == {"status": "PENDING"},
    )
    withdrawn = events_of(admin, sug2["id"])[-1]
    check(
        "TPL-AC42",
        "withdrawn 記前後狀態",
        withdrawn["event_type"] == "template_suggestion.withdrawn"
        and withdrawn["before"] == {"status": "PENDING"}
        and withdrawn["after"] == {"status": "WITHDRAWN"},
    )
    check(
        "TPL-AC42",
        "五種建議事件都帶來源 project_id，且不含完整內容",
        all(e["project_id"] == project for e in events + [withdrawn])
        and all(
            "inspection_points" not in json.dumps(e["after"] or {})
            for e in events
        ),
    )
    created = [
        e
        for e in audit_events(admin, "template_item.created")
        if e["entity_id"] == approved[1]["template_id"]
    ]
    check(
        "TPL-AC42",
        "核准另有 template_item.created：project_id 空值、無建議關聯欄位",
        len(created) == 1
        and created[0]["project_id"] is None
        and not {"project_id", "suggestion_id", "revision_id"}
        & set(created[0]["after"] or {}),
    )
    # 稽核追溯：範本 → 核准事件 → 建議 → 受審版本。
    template_id = approved[1]["template_id"]
    link = [
        e
        for e in audit_events(admin, "template_suggestion.approved")
        if e["after"].get("template_id") == template_id
    ]
    trace = f.get("wu", link[0]["entity_id"]) if link else {}
    revs = f.revisions("wu", sid)
    template = admin.call("GET", f"/templates/{template_id}")
    check(
        "TPL-AC42",
        "由範本可經核准事件追到建議、審核人與受審版本",
        len(link) == 1
        and trace.get("id") == sid
        and link[0]["after"]["reviewed_revision_id"] == revs[-1]["id"]
        and link[0]["after"]["reviewer_id"] == f.w["users"]["wu"]["id"]
        and template["title"] == revs[-1]["content"]["title"]
        and len(template["inspection_points"])
        == len(revs[-1]["content"]["inspection_points"]),
    )


def run_all(base: str, seed_result: dict, out: Path, tag: str) -> int:
    """建立世界並依序執行全部情境；有任何失敗即回非零。"""
    world = build_world(base, seed_result, tag)
    s = sessions_for(base, world)
    flow = Flow(world, s)
    for step in (
        lambda: scenario_ac33(flow, base),
        lambda: scenario_ac34_ac43(flow),
        lambda: scenario_ac35_ac36(flow),
        lambda: scenario_ac37(flow),
        lambda: scenario_ac38_ac39(flow),
        lambda: scenario_ac40(flow),
        lambda: scenario_ac41(flow),
        lambda: scenario_ac42_trace(flow),
    ):
        step()
    failed = [r for r in RESULTS if not r["ok"]]
    by_ac: dict[str, dict] = {}
    for row in RESULTS:
        slot = by_ac.setdefault(row["ac"], {"pass": 0, "fail": 0})
        slot["pass" if row["ok"] else "fail"] += 1
    out.write_text(
        json.dumps(
            {
                "total": len(RESULTS),
                "failed": len(failed),
                "by_ac": by_ac,
                "results": RESULTS,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(json.dumps(by_ac, ensure_ascii=False))
    print(f"checks: {len(RESULTS)} total, {len(failed)} failed")
    return 1 if failed else 0


def main() -> None:
    """入口：整合驗收，或只建立世界並輸出 JSON 給瀏覽器腳本。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="http://127.0.0.1:8300")
    parser.add_argument("--seed-result", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--world-only", action="store_true")
    parser.add_argument("--tag", default="api")
    args = parser.parse_args()
    require_loopback_base(args.base)
    seed_result = json.loads(Path(args.seed_result).read_text())
    out = Path(args.out)
    if args.world_only:
        world = build_world(args.base, seed_result, args.tag)
        out.write_text(json.dumps(world, ensure_ascii=False, indent=2))
        print(f"world written: {out}")
        return
    sys.exit(run_all(args.base, seed_result, out, args.tag))


if __name__ == "__main__":
    main()
