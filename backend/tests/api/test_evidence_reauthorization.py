"""FEV-R12：串流及影像名額等待後，以最新權限決定是否寫入。"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from uuid import uuid4

import pytest
from anyio import CapacityLimiter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModulePermission,
)
from tests.api.test_evidence_mutations import _state
from tests.api.test_evidence_read import _add_photo, _paths
from tests.api.test_evidence_read import read_world as read_world
from tests.api.test_evidence_upload import _jpeg, _upload


def _revoke(w, user_id, scope):
    with Session(w["engine"]) as other:
        if scope == "inactive":
            user = other.get(User, user_id)
            assert user is not None and user.is_active
            user.is_active = False
        elif scope != "none":
            if scope == "module":
                query = select(UserModulePermission).where(
                    UserModulePermission.user_id == user_id,
                    UserModulePermission.permission_code == "inspection.use",
                )
            else:
                member = other.scalar(
                    select(ProjectMember.id).where(
                        ProjectMember.user_id == user_id,
                        ProjectMember.project_id == w["project"].id,
                    )
                )
                assert member is not None
                query = select(ProjectMemberRole).where(
                    ProjectMemberRole.project_member_id == member
                )
            rows = list(other.scalars(query))
            assert rows, "撤權探針必須移除實際存在的授權"
            for row in rows:
                other.delete(row)
        other.commit()


def _queue_gate(monkeypatch, api, ready, release):
    def limiter(_limit):
        gate = CapacityLimiter(1)
        gate.acquire_on_behalf_of_nowait("blocker")

        async def unblock():
            ready.set()
            try:
                assert await asyncio.to_thread(release.wait, 15)
            finally:
                gate.release_on_behalf_of("blocker")

        asyncio.create_task(unblock())
        return gate

    monkeypatch.setattr(api, "_upload_limiter", limiter)


@pytest.mark.parametrize("operation", ["upload", "office"])
@pytest.mark.parametrize("wait_at", ["body", "limiter"])
@pytest.mark.parametrize("scope", ["module", "project", "inactive", "none"])
def test_write_rechecks_access_after_wait(
    read_world, monkeypatch, operation, wait_at, scope
):
    """撤模組、撤角色、停用都拒絕；同一等待路徑保留成功對照。"""
    from app.api.v1 import evidence as upload_api
    from app.api.v1 import evidence_office as office_api

    w = read_world
    photo = _add_photo(w)
    _, _, url = _paths(w, photo)
    if operation == "office":
        role = w["db"].scalar(
            select(Role).where(Role.name == "API field planning reader")
        )
        assert role is not None
        role.permission_codes.append(RolePermission(code="evidence.manage"))
        w["db"].commit()
        client = w["field_reader"]
        user_id = w["field_reader_user"].id
        url += "/office-version"
        assert client.put(url, json={}).status_code == 200
        api = office_api
    else:
        client = w["field"]
        user_id = w["field_user"].id
        api = upload_api
    before = _state(w)
    w["db"].commit()
    ready, release = Event(), Event()
    if wait_at == "limiter":
        _queue_gate(monkeypatch, api, ready, release)
    elif operation == "upload":
        original = upload_api._parse_evidence_form

        async def parse(*args):
            ready.set()
            assert await asyncio.to_thread(release.wait, 15)
            return await original(*args)

        monkeypatch.setattr(upload_api, "_parse_evidence_form", parse)

    def body():
        yield b'{"brightness":'
        ready.set()
        assert release.wait(15)
        yield b"25}"

    def request():
        if operation == "upload":
            return _upload(
                w, w["task"], w["item_id"], w["point_id"], _jpeg(), uuid4()
            )
        if wait_at == "body":
            return client.put(
                url,
                content=body(),
                headers={"Content-Type": "application/json"},
            )
        return client.put(url, json={"brightness": 25})

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(request)
            try:
                if not ready.wait(10):
                    if pending.done():
                        result = pending.result()
                        pytest.fail(
                            f"未進入等待點：{result.status_code} {result.text}"
                        )
                    pytest.fail("請求必須進入指定等待點")
                # 另一連線須能提交，證明等候時沒有持有 DB 寫鎖。
                _revoke(w, user_id, scope)
            finally:
                release.set()
            response = pending.result(20)
    finally:
        release.set()
    if scope == "none":
        assert response.status_code == (201 if operation == "upload" else 200)
        assert _state(w) != before
    else:
        assert response.status_code == 403, response.text
        assert response.json()["error"]["code"] == "permission.denied"
        assert _state(w) == before


@pytest.mark.parametrize("scope", ["module", "project", "inactive", "none"])
def test_replay_rechecks_access_after_body_wait(
    read_world, monkeypatch, scope
):
    """FEV-R07／R12：同鍵重放在等待本文後也須重驗，不得洩漏照片。"""
    from app.api.v1 import evidence as api

    w = read_world
    image, key = _jpeg(), uuid4()

    def upload():
        return _upload(w, w["task"], w["item_id"], w["point_id"], image, key)

    first = upload()
    assert first.status_code == 201, first.text
    photo = first.json()
    user_id = w["field_user"].id
    before = _state(w)
    w["db"].commit()
    ready, release = Event(), Event()
    original = api._parse_evidence_form

    async def parse(*args):
        ready.set()
        assert await asyncio.to_thread(release.wait, 15)
        return await original(*args)

    monkeypatch.setattr(api, "_parse_evidence_form", parse)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(upload)
            try:
                if not ready.wait(10):
                    if pending.done():
                        result = pending.result()
                        pytest.fail(
                            f"未進入等待點：{result.status_code} {result.text}"
                        )
                    pytest.fail("重放請求必須進入本文等待點")
                # 撤權交易可提交，亦確認重放等本文時沒有持有寫鎖。
                _revoke(w, user_id, scope)
            finally:
                release.set()
            response = pending.result(20)
    finally:
        release.set()
    if scope == "none":
        assert response.status_code == 200, response.text
        assert response.json() == photo
    else:
        assert response.status_code == 403, response.text
        assert set(response.json()) == {"error"}
        assert response.json()["error"]["code"] == "permission.denied"
    assert _state(w) == before
