"""Personal workspace API checks for issue #290: ``GET /auth/me``
profile fields and ``GET /me/projects`` (permission and data scope).
"""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import User
from app.services.companies import create_company
from app.services.project_members import add_project_member
from app.services.projects import create_project
from app.services.roles import create_role
from app.services.users import create_user
from tests.db.conftest import create_root_user_with_company

ME_PROJECTS = "/api/v1/me/projects"


def _client_for(db_session: Session, make_client, user: User) -> TestClient:
    _session, token = create_session(db_session, user)
    db_session.commit()
    client = make_client()
    client.cookies.set(SESSION_COOKIE_NAME, token)
    return client


@pytest.fixture
def seed(db_session: Session, make_client):
    root = create_root_user_with_company(db_session, "ROOT290")
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

    company = create_company(db_session, name="示範公司")
    alice = create_user(
        db_session,
        username="alice",
        email="alice@demo.example",
        name_zh="愛麗絲",
        name_en="Alice",
        is_external_collaborator=False,
        company_id=company.id,
        department="機電部",
        location="台北",
        employee_no="E290",
    )
    bob = create_user(
        db_session,
        username="bob",
        email="bob@demo.example",
        name_zh="鮑伯",
        is_external_collaborator=False,
    )
    mine = create_project(
        db_session,
        project_code="DEMO-290-A",
        name="示範工程甲",
        client_name="示範業主",
        site_location="示範工地甲",
        planned_start_date=date(2026, 10, 1),
        planned_completion_date=date(2027, 4, 1),
    )
    also_mine = create_project(
        db_session,
        project_code="DEMO-290-B",
        name="示範工程乙",
        client_name="示範業主",
        site_location="示範工地乙",
    )
    others = create_project(
        db_session,
        project_code="DEMO-290-C",
        name="別人的工程",
        client_name="示範業主",
        site_location="示範工地丙",
    )
    inspector = create_role(
        db_session,
        name="查核員",
        permission_codes=["project_member.manage"],
    )
    reviewer = create_role(db_session, name="審核員", permission_codes=[])
    other_role = create_role(
        db_session,
        name="別人的角色",
        permission_codes=[],
    )
    add_project_member(
        db_session,
        project_id=mine.id,
        user_id=alice.id,
        role_ids=[inspector.id, reviewer.id],
    )
    add_project_member(
        db_session, project_id=also_mine.id, user_id=alice.id, role_ids=[]
    )
    add_project_member(
        db_session,
        project_id=others.id,
        user_id=bob.id,
        role_ids=[other_role.id],
    )
    db_session.commit()
    return {
        "company": company,
        "alice": alice,
        "bob": bob,
        "mine": mine,
        "also_mine": also_mine,
        "others": others,
        "alice_client": _client_for(db_session, make_client, alice),
        "bob_client": _client_for(db_session, make_client, bob),
        "admin_client": _client_for(db_session, make_client, root),
        "anonymous_client": make_client(),
    }


def test_me_includes_company_department_location_and_employee_no(seed):
    body = seed["alice_client"].get("/api/v1/auth/me").json()

    assert body["company"] == {
        "id": str(seed["company"].id),
        "name": "示範公司",
    }
    assert body["department"] == "機電部"
    assert body["location"] == "台北"
    assert body["employee_no"] == "E290"
    assert body["username"] == "alice"


def test_me_company_fields_are_null_without_a_company(seed):
    for client in (seed["bob_client"], seed["admin_client"]):
        body = client.get("/api/v1/auth/me").json()

        assert body["company"] is None
        assert body["department"] is None
        assert body["location"] is None
        assert body["employee_no"] is None


def test_my_projects_requires_login(seed):
    resp = seed["anonymous_client"].get(ME_PROJECTS)

    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "auth.not_authenticated"


def test_my_projects_lists_only_own_projects_with_own_roles(seed):
    resp = seed["alice_client"].get(ME_PROJECTS)

    assert resp.status_code == 200
    assert resp.json() == [
        {
            "id": str(seed["mine"].id),
            "project_code": "DEMO-290-A",
            "name": "示範工程甲",
            "client_name": "示範業主",
            "site_location": "示範工地甲",
            "planned_start_date": "2026-10-01",
            "planned_completion_date": "2027-04-01",
            "role_names": ["審核員", "查核員"],
            "has_office_access": True,
        },
        {
            "id": str(seed["also_mine"].id),
            "project_code": "DEMO-290-B",
            "name": "示範工程乙",
            "client_name": "示範業主",
            "site_location": "示範工地乙",
            "planned_start_date": None,
            "planned_completion_date": None,
            "role_names": [],
            "has_office_access": False,
        },
    ]


def test_my_projects_never_shows_other_users_projects_or_roles(seed):
    resp = seed["bob_client"].get(ME_PROJECTS)

    assert resp.status_code == 200
    body = resp.json()
    assert [item["id"] for item in body] == [str(seed["others"].id)]
    assert body[0]["role_names"] == ["別人的角色"]


def test_my_projects_is_empty_for_admin_without_membership(seed):
    # Admin sees every project through the admin pages, but this
    # endpoint only lists projects the user is a member of.
    resp = seed["admin_client"].get(ME_PROJECTS)

    assert resp.status_code == 200
    assert resp.json() == []
