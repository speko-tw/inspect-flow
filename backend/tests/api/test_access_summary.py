"""Issue #480: ``/auth/me`` and ``/auth/login`` carry an office/field
access summary so the frontend never guesses the landing page.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import (
    ProjectMember,
    ProjectMemberRole,
    SystemRoleCode,
    User,
    UserModuleDelegation,
    UserModulePermission,
)
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
            "project.read",
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
        permission_codes=["project.read", "inspection_task.read"],
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
    module_only = person("moduleonly")
    delegated = person("delegate")
    external = person("external")
    external.is_external_collaborator = True
    member_only = person("memberonly")
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
    add_project_member(
        db_session,
        project_id=project_a.id,
        user_id=member_only.id,
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
    db_session.add(
        UserModulePermission(
            user_id=module_only.id,
            permission_code="project.use",
            source="manual",
        )
    )
    db_session.add(
        UserModulePermission(
            user_id=module_only.id,
            permission_code="project.create",
            source="manual",
        )
    )
    db_session.add(
        UserModuleDelegation(user_id=delegated.id, module="template")
    )
    module_codes = {
        office.id: ("project.use", "inspection.use"),
        field.id: ("inspection.use",),
        both.id: ("project.use", "inspection.use"),
        split.id: ("project.use", "inspection.use"),
        reader.id: ("project.use", "inspection.use"),
        editor.id: ("inspection.use",),
    }
    for user_id, codes in module_codes.items():
        db_session.add_all(
            UserModulePermission(
                user_id=user_id,
                permission_code=code,
                source="manual",
            )
            for code in codes
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
        "module_only": client(module_only),
        "delegated": client(delegated),
        "external": client(external),
        "member_only": client(member_only),
        "member_only_user": member_only,
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


def test_me_reports_new_project_and_delegation_flags(world) -> None:
    admin = world["admin"].get(ME).json()
    assert admin["can_create_project"] is True
    assert admin["has_project_access"] is True
    assert admin["delegated_modules"] == ["inspection", "project", "template"]

    office = world["office"].get(ME).json()
    assert office["has_project_access"] is True
    assert office["can_create_project"] is False

    creator = world["module_only"].get(ME).json()
    assert creator["can_create_project"] is True
    assert creator["has_project_access"] is False

    delegated = world["delegated"].get(ME).json()
    assert delegated["delegated_modules"] == ["template"]
    assert delegated["has_template_access"] is False

    external = world["external"].get(ME).json()
    assert external["is_external_collaborator"] is True


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


def test_permission_views_agree_across_project_and_person_endpoints(world):
    project_id = world["project_a"].id
    cases = {
        "admin": (200, 200, 200, []),
        "office": (
            200,
            200,
            200,
            ["DEMO-480-A"],
        ),
        "nobody": (403, 403, 403, []),
        "module_only": (403, 403, 403, []),
    }
    for who, (
        project_status,
        workflow_status,
        members_status,
        my_projects,
    ) in cases.items():
        client = world[who]
        profile = client.get(ME)
        assert profile.status_code == 200
        module_permissions = set(profile.json()["module_permissions"])
        if who == "module_only":
            assert module_permissions == {"project.use", "project.create"}
        elif who == "admin":
            assert module_permissions
        elif who == "nobody":
            assert module_permissions == set()

        projects = client.get(ME_PROJECTS)
        assert projects.status_code == 200
        assert [row["project_code"] for row in projects.json()] == my_projects
        if who == "office":
            assert projects.json()[0]["has_office_access"] is True
        if who == "nobody":
            assert projects.json() == []

        project = client.get(f"/api/v1/projects/{project_id}")
        workflow = client.get(
            f"/api/v1/projects/{project_id}/workflow-summary"
        )
        members = client.get(f"/api/v1/projects/{project_id}/members")
        assert project.status_code == project_status, project.text
        assert workflow.status_code == workflow_status, workflow.text
        assert members.status_code == members_status, members.text
        if who == "office":
            assert set(workflow.json()["viewer_permission_codes"]) == {
                "project.read",
                "inspection_plan.read",
                "project_member.manage",
            }
        if who == "admin":
            assert workflow.json()["viewer_permission_codes"]


def test_project_read_requires_project_use_and_membership(world) -> None:
    user = world["member_only_user"]
    project = world["project_a"]
    role = create_role(
        world["db"], name="只讀專案", permission_codes=["project.read"]
    )
    member = world["db"].scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == project.id,
            ProjectMember.user_id == user.id,
        )
    )
    assert member is not None
    member.role_assignments.append(ProjectMemberRole(role_id=role.id))
    world["db"].commit()

    project_path = f"/api/v1/projects/{project.id}/workflow-summary"
    denied_without_module = world["member_only"].get(project_path)
    assert denied_without_module.status_code == 403

    world["db"].add(
        UserModulePermission(
            user_id=user.id,
            permission_code="project.use",
            source="manual",
        )
    )
    world["db"].commit()
    allowed_with_both_layers = world["member_only"].get(project_path)
    assert allowed_with_both_layers.status_code == 200

    nonmember_with_module = world["module_only"].get(project_path)
    assert nonmember_with_module.status_code == 403


def test_inspection_item_list_accepts_membership_without_role(world) -> None:
    project_id = world["project_a"].id
    member_only = world["member_only"]
    module_only = world["module_only"]

    item_list = member_only.get(
        f"/api/v1/projects/{project_id}/inspection-items"
    )
    assert item_list.status_code == 200, item_list.text
    assert item_list.json()["items"] == []

    for path in (
        f"/api/v1/projects/{project_id}",
        f"/api/v1/projects/{project_id}/workflow-summary",
        f"/api/v1/projects/{project_id}/members",
    ):
        response = member_only.get(path)
        assert response.status_code == 403, response.text

    nonmember_items = module_only.get(
        f"/api/v1/projects/{project_id}/inspection-items"
    )
    assert nonmember_items.status_code == 403, nonmember_items.text


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
