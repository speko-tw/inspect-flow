"""Issue #480: ``/auth/me`` and ``/auth/login`` carry an office/field
access summary so the frontend never guesses the landing page.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import SystemRoleCode, User
from app.permission_codes import PermissionCode, permission_code_scope
from app.services.access_summary import (
    FIELD_PERMISSION_CODES,
    OFFICE_PERMISSION_CODES,
    READ_ONLY_PERMISSION_CODES,
)
from app.services.project_members import add_project_member
from app.services.projects import create_project
from app.services.roles import create_role
from app.services.system_roles import assign_system_role
from app.services.users import create_user
from tests.api.query_count import select_count
from tests.db.conftest import create_root_user_with_company

ME = "/api/v1/auth/me"
ME_PROJECTS = "/api/v1/me/projects"


def _client_for(db_session: Session, make_client, user: User) -> TestClient:
    _session, token = create_session(db_session, user)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


def _access(body: dict) -> tuple[bool, bool, bool]:
    return (
        body["has_office_access"],
        body["has_field_access"],
        body["has_template_access"],
    )


@pytest.fixture
def world(db_session: Session, make_client):
    root = create_root_user_with_company(db_session, "ROOT480")
    root.username = "admin"
    root.is_system = True
    root.is_admin = True
    root.company_id = None
    root.employee_no = None
    root.department = None
    root.location = None
    root.name_en = None
    root.name_zh = None
    root.email = None
    db_session.flush()

    def person(name: str) -> User:
        return create_user(
            db_session,
            username=name,
            email=f"{name}@demo.example",
            name_zh=name,
            is_external_collaborator=False,
        )

    project_a = create_project(
        db_session,
        project_code="DEMO-480-A",
        name="示範工程甲",
        client_name="示範業主",
        site_location="示範工地甲",
    )
    project_b = create_project(
        db_session,
        project_code="DEMO-480-B",
        name="示範工程乙",
        client_name="示範業主",
        site_location="示範工地乙",
    )
    office_role = create_role(
        db_session,
        name="內業",
        permission_codes=[
            "project_member.manage",
            "inspection_plan.read",
        ],
    )
    field_role = create_role(
        db_session,
        name="查核員",
        permission_codes=["inspection_task.inspect"],
    )
    read_only_role = create_role(
        db_session,
        name="只讀任務",
        permission_codes=["inspection_task.read"],
    )
    empty_role = create_role(db_session, name="空角色", permission_codes=[])
    template_role = create_role(
        db_session,
        name="項目編輯",
        permission_codes=["project_inspection_item.edit"],
    )

    office = person("office")
    field = person("field")
    both = person("both")
    nobody = person("nobody")
    split = person("split")
    reader = person("reader")
    template_admin = person("tpladmin")
    editor = person("editor")
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=office.id,
        role_ids=[office_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_b.id,
        user_id=office.id,
        role_ids=[empty_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=field.id,
        role_ids=[field_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=both.id,
        role_ids=[office_role.id, field_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=nobody.id,
        role_ids=[empty_role.id],
    )
    # Different projects: office in A, field in B.
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=split.id,
        role_ids=[office_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_b.id,
        user_id=split.id,
        role_ids=[field_role.id, read_only_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=reader.id,
        role_ids=[read_only_role.id],
    )
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=editor.id,
        role_ids=[template_role.id],
    )
    assign_system_role(
        db_session, template_admin.id, SystemRoleCode.TEMPLATE_ADMIN
    )
    db_session.commit()

    def client(user: User) -> TestClient:
        return _client_for(db_session, make_client, user)

    return {
        "admin": client(root),
        "office": client(office),
        "field": client(field),
        "both": client(both),
        "nobody": client(nobody),
        "split": client(split),
        "reader": client(reader),
        "tpladmin": client(template_admin),
        "editor": client(editor),
        "project_a": project_a,
        "project_b": project_b,
        "make_client": make_client,
        "db": db_session,
    }


def test_permission_classification_covers_every_registered_code() -> None:
    registered = {
        code.value
        for code in PermissionCode
        if permission_code_scope(code.value) == "project"
    }

    groups = (
        OFFICE_PERMISSION_CODES,
        FIELD_PERMISSION_CODES,
        READ_ONLY_PERMISSION_CODES,
    )
    assert set().union(*groups) == registered
    assert sum(len(group) for group in groups) == len(registered)
    assert FIELD_PERMISSION_CODES == {"inspection_task.inspect"}


@pytest.mark.parametrize(
    ("who", "expected"),
    [
        ("admin", (True, True, True)),
        ("office", (True, False, False)),
        ("field", (False, True, False)),
        ("both", (True, True, False)),
        ("nobody", (False, False, False)),
        ("split", (True, True, False)),
        # task read alone is neither office nor field (ADM-R18).
        ("reader", (False, False, False)),
        # system template admin without any project membership.
        ("tpladmin", (False, False, True)),
        # project_inspection_item.edit alone does not manage the library.
        ("editor", (True, False, False)),
    ],
)
def test_me_reports_access_summary(world, who, expected) -> None:
    resp = world[who].get(ME)

    assert resp.status_code == 200
    assert _access(resp.json()) == expected


def test_access_summary_select_count_is_constant(world) -> None:
    few, _ = select_count(world["office"], ME)
    # ``split`` is a member of two projects with several role codes;
    # a per-project loop would issue more statements than ``office``.
    many, _ = select_count(world["split"], ME)

    assert many == few


def test_my_projects_flags_office_access_per_project(world) -> None:
    body = world["split"].get(ME_PROJECTS).json()

    assert {
        item["project_code"]: item["has_office_access"] for item in body
    } == {
        "DEMO-480-A": True,
        "DEMO-480-B": False,
    }


def test_responses_match_frontend_contract_fixture(world) -> None:
    """RG-M22: the shapes the frontend tests mock are the real ones."""
    contract = json.loads(
        (
            Path(__file__).parents[3]
            / "frontend/src/auth/fixtures"
            / "current-user-contract.json"
        ).read_text(encoding="utf-8")
    )

    for who in ("admin", "office", "field", "nobody"):
        assert sorted(world[who].get(ME).json()) == sorted(
            contract["current_user_keys"]
        )
    projects = world["split"].get(ME_PROJECTS).json()
    assert projects
    for item in projects:
        assert sorted(item) == contract["my_project_keys"]
