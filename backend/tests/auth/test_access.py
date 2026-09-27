"""Tests for AUT-R18~AUT-R23's access-level dependencies
(``app/auth/access.py``): AUT-AC17~AUT-AC21, AUT-AC43, AUT-AC44.

Every scenario below is built with plain demo values (``DEMO``-style
company/project codes, throwaway employee numbers) -- none of it
names a real organization.
"""

import uuid
from typing import NamedTuple

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.errors import ErrorCode
from app.auth.access import (
    require_admin,
    require_login_access,
    require_project_permission,
    require_self_or_admin,
)
from app.auth.passwords import hash_password
from app.auth.sessions import SESSION_COOKIE_NAME
from app.main import create_app
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserPassword,
)
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user
from tests.conftest import _TestPermissionCode
from tests.db.conftest import create_root_user_with_company

PASSWORD = DEFAULT_TEST_PASSWORD

# A syntactically valid UUID that never corresponds to a real row --
# only used by AUT-AC17's no-cookie scenarios, where the login check
# must reject before any path parameter is ever inspected.
_ANY_UUID = str(uuid.uuid4())


# -- Scenario builders (ORM, not the HTTP API) ----------------------


def _make_project(session: Session, creator: User, code: str) -> Project:
    project = Project(
        project_code=code, created_by=creator.id, updated_by=creator.id
    )
    session.add(project)
    session.flush()
    return project


def _make_role(
    session: Session, creator: User, name: str, codes: list[str]
) -> Role:
    role = Role(name=name, created_by=creator.id, updated_by=creator.id)
    session.add(role)
    session.flush()
    for code in codes:
        session.add(RolePermission(role_id=role.id, code=code))
    session.flush()
    return role


def _replace_role_codes(
    session: Session, role: Role, codes: list[str]
) -> None:
    """AUT-AC19: swap ``role``'s permission codes in place, so a
    later ``effective_permissions`` call (never cached) reflects the
    new content on the very next request.
    """
    for permission in list(role.permission_codes):
        session.delete(permission)
    session.flush()
    for code in codes:
        session.add(RolePermission(role_id=role.id, code=code))
    session.commit()


def _add_member(
    session: Session,
    creator: User,
    project: Project,
    user: User,
    roles: list[Role],
) -> ProjectMember:
    member = ProjectMember(
        project_id=project.id,
        user_id=user.id,
        created_by=creator.id,
        updated_by=creator.id,
    )
    session.add(member)
    session.flush()
    for role in roles:
        session.add(
            ProjectMemberRole(project_member_id=member.id, role_id=role.id)
        )
    session.flush()
    return member


def _make_admin_user(session: Session, employee_no: str) -> User:
    user = make_local_user(session, employee_no)
    user.is_admin = True
    session.commit()
    return user


def _login(client: TestClient, user: User) -> str:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": user.email, "password": PASSWORD},
    )
    assert response.status_code == 200
    return response.cookies[SESSION_COOKIE_NAME]


# -- The probe application (AUT-AC17, AUT-AC43, AUT-AC44's test
# routes, one per access level plus one per AUT-AC44 action) --------


@pytest.fixture
def probe(
    registered_permission_codes: type[_TestPermissionCode],
) -> tuple[FastAPI, dict[str, int]]:
    """A copy of the real application plus nine test-only routes,
    each counting how many times its handler actually ran -- so a
    rejected request (401/403) can be proven to never reach it.

    Built inside this fixture (after ``registered_permission_codes``
    has already swapped in the test registry) because
    ``require_project_permission`` checks its code against DOM-R35's
    active registry at declaration time, fail-fast.
    """
    calls = {
        "login": 0,
        "admin": 0,
        "self_or_admin": 0,
        "report_read": 0,
        "evidence_read": 0,
        "evidence_create": 0,
        "evidence_update": 0,
        "evidence_delete": 0,
        "report_approve": 0,
    }
    app = create_app()
    router = APIRouter()

    # Built once here (not inline in each ``Depends(...)`` default
    # below, which ruff's B008 rightly flags as a function call in a
    # default argument): each is itself a dependency *callable*,
    # exactly the object ``Depends()`` expects.
    self_or_admin_dep = require_self_or_admin()
    report_read_dep = require_project_permission(
        registered_permission_codes.REPORT_READ.value
    )
    evidence_read_dep = require_project_permission(
        registered_permission_codes.EVIDENCE_READ.value
    )
    evidence_create_dep = require_project_permission(
        registered_permission_codes.EVIDENCE_CREATE.value
    )
    evidence_update_dep = require_project_permission(
        registered_permission_codes.EVIDENCE_UPDATE.value
    )
    evidence_delete_dep = require_project_permission(
        registered_permission_codes.EVIDENCE_DELETE.value
    )
    report_approve_dep = require_project_permission(
        registered_permission_codes.REPORT_APPROVE.value
    )

    @router.get("/api/v1/test/needs-login")
    def needs_login(
        user: User = Depends(require_login_access),  # noqa: B008
    ) -> dict[str, str]:
        calls["login"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-admin")
    def needs_admin(
        user: User = Depends(require_admin),  # noqa: B008
    ) -> dict[str, str]:
        calls["admin"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/self-or-admin/{user_id}")
    def self_or_admin(
        user: User = Depends(self_or_admin_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["self_or_admin"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/report-read/{project_id}")
    def needs_report_read(
        user: User = Depends(report_read_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["report_read"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/evidence-read/{project_id}")
    def needs_evidence_read(
        user: User = Depends(evidence_read_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["evidence_read"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/evidence-create/{project_id}")
    def needs_evidence_create(
        user: User = Depends(evidence_create_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["evidence_create"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/evidence-update/{project_id}")
    def needs_evidence_update(
        user: User = Depends(evidence_update_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["evidence_update"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/evidence-delete/{project_id}")
    def needs_evidence_delete(
        user: User = Depends(evidence_delete_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["evidence_delete"] += 1
        return {"user_id": str(user.id)}

    @router.get("/api/v1/test/needs-permission/report-approve/{project_id}")
    def needs_report_approve(
        user: User = Depends(report_approve_dep),  # noqa: B008
    ) -> dict[str, str]:
        calls["report_approve"] += 1
        return {"user_id": str(user.id)}

    app.include_router(router)
    return app, calls


@pytest.fixture
def probe_client(
    probe: tuple[FastAPI, dict[str, int]],
) -> tuple[TestClient, dict[str, int]]:
    app, calls = probe
    return TestClient(app, base_url="https://testserver"), calls


# -- AUT-AC17 --------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/test/needs-login",
        "/api/v1/test/needs-admin",
        f"/api/v1/test/needs-permission/report-read/{_ANY_UUID}",
        f"/api/v1/test/self-or-admin/{_ANY_UUID}",
    ],
)
def test_aut_ac17_no_cookie_is_rejected_before_the_handler_runs(
    probe_client: tuple[TestClient, dict[str, int]], path: str
) -> None:
    """AUT-AC17: without a Cookie, every one of the four access
    levels rejects with 401 ``auth.not_authenticated``, and no
    handler ever runs.
    """
    client, calls = probe_client

    response = client.get(path)

    assert response.status_code == 401
    assert (
        response.json()["error"]["code"]
        == ErrorCode.AUTH_NOT_AUTHENTICATED.value
    )
    assert sum(calls.values()) == 0


# -- AUT-AC18 / AUT-AC19 ----------------------------------------------


class _ProjectPermissionScenario(NamedTuple):
    project_p: Project
    project_q: Project
    role_r1: Role
    user_u: User
    admin_a: User


def _build_project_permission_scenario(
    db_session: Session,
    registered_permission_codes: type[_TestPermissionCode],
    suffix: str,
) -> _ProjectPermissionScenario:
    creator = create_root_user_with_company(db_session, f"E9{suffix}0")
    db_session.commit()

    project_p = _make_project(db_session, creator, f"PRJ-P-{suffix}")
    project_q = _make_project(db_session, creator, f"PRJ-Q-{suffix}")

    role_r1 = _make_role(
        db_session,
        creator,
        f"R1-{suffix}",
        [registered_permission_codes.REPORT_READ.value],
    )
    role_r2 = _make_role(
        db_session,
        creator,
        f"R2-{suffix}",
        [registered_permission_codes.REPORT_APPROVE.value],
    )

    user_u = make_local_user(db_session, f"E9{suffix}1")
    _add_member(db_session, creator, project_p, user_u, [role_r1, role_r2])
    db_session.commit()

    admin_a = _make_admin_user(db_session, f"E9{suffix}2")

    return _ProjectPermissionScenario(
        project_p=project_p,
        project_q=project_q,
        role_r1=role_r1,
        user_u=user_u,
        admin_a=admin_a,
    )


def test_aut_ac18_project_permission_by_role_and_membership(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
    registered_permission_codes: type[_TestPermissionCode],
) -> None:
    """AUT-AC18: a project member is let through for the permission
    code their roles' union grants, rejected for one they do not
    hold, and rejected outright for a project they are not a member
    of; an Admin passes every combination regardless of membership.
    """
    client, calls = probe_client
    scenario = _build_project_permission_scenario(
        db_session, registered_permission_codes, "18"
    )

    token_u = _login(client, scenario.user_u)
    cookies_u = {SESSION_COOKIE_NAME: token_u}

    response = client.get(
        f"/api/v1/test/needs-permission/report-read/{scenario.project_p.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 200

    response = client.get(
        f"/api/v1/test/needs-permission/evidence-read/{scenario.project_p.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )

    response = client.get(
        f"/api/v1/test/needs-permission/report-read/{scenario.project_q.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )

    token_a = _login(client, scenario.admin_a)
    cookies_a = {SESSION_COOKIE_NAME: token_a}
    for project in (scenario.project_p, scenario.project_q):
        for action in ("report-read", "evidence-read"):
            response = client.get(
                f"/api/v1/test/needs-permission/{action}/{project.id}",
                cookies=cookies_a,
            )
            assert response.status_code == 200

    assert calls["report_read"] > 0
    assert calls["evidence_read"] > 0


def test_aut_ac19_effective_permission_change_is_immediate(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
    registered_permission_codes: type[_TestPermissionCode],
) -> None:
    """AUT-AC19: continuing AUT-AC18's setup with the same login
    Cookie (no re-login) -- changing R1's permission content, and
    later ``is_admin``, both take effect on the very next request,
    proving the permission check is never cached across requests.
    """
    client, calls = probe_client
    scenario = _build_project_permission_scenario(
        db_session, registered_permission_codes, "19"
    )
    token_u = _login(client, scenario.user_u)
    cookies_u = {SESSION_COOKIE_NAME: token_u}

    _replace_role_codes(
        db_session,
        scenario.role_r1,
        [registered_permission_codes.EVIDENCE_READ.value],
    )

    response = client.get(
        f"/api/v1/test/needs-permission/evidence-read/{scenario.project_p.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 200

    response = client.get(
        f"/api/v1/test/needs-permission/report-read/{scenario.project_p.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )

    db_session.expire_all()
    stored_u = db_session.get(User, scenario.user_u.id)
    assert stored_u is not None
    stored_u.is_admin = True
    db_session.commit()

    response = client.get(
        f"/api/v1/test/needs-permission/report-read/{scenario.project_q.id}",
        cookies=cookies_u,
    )
    assert response.status_code == 200
    assert calls["evidence_read"] > 0
    assert calls["report_read"] > 0


def test_aut_r19_admin_still_fails_closed_on_invalid_project_id(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
) -> None:
    """AUT-R19 (reviewer regression): an Admin hitting 需專案權限
    with a path parameter that is not a valid UUID is rejected with
    403 ``permission.denied`` -- the UUID is parsed *before* the
    Admin bypass, so Admin can never ride a malformed request through
    to the handler.
    """
    client, calls = probe_client
    admin_a = _make_admin_user(db_session, "E9R191")

    token_a = _login(client, admin_a)
    response = client.get(
        "/api/v1/test/needs-permission/report-read/not-a-uuid",
        cookies={SESSION_COOKIE_NAME: token_a},
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )
    assert calls["report_read"] == 0


# -- AUT-AC20 ----------------------------------------------------------


def test_aut_ac20_admin_required(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
) -> None:
    """AUT-AC20: an Admin passes the 需 Admin check; a non-Admin is
    rejected with 403 ``permission.denied``.
    """
    client, calls = probe_client
    admin_a = _make_admin_user(db_session, "E9200")
    user_u = make_local_user(db_session, "E9201")

    token_a = _login(client, admin_a)
    response = client.get(
        "/api/v1/test/needs-admin", cookies={SESSION_COOKIE_NAME: token_a}
    )
    assert response.status_code == 200

    token_u = _login(client, user_u)
    response = client.get(
        "/api/v1/test/needs-admin", cookies={SESSION_COOKIE_NAME: token_u}
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )
    assert calls["admin"] == 1


# -- AUT-AC21 ----------------------------------------------------------


def test_aut_ac21_self_or_admin(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
) -> None:
    """AUT-AC21: a user targeting themselves passes; a user
    targeting someone else is rejected; an Admin targeting someone
    else still passes.
    """
    client, calls = probe_client
    user_u = make_local_user(db_session, "E9210")
    user_v = make_local_user(db_session, "E9211")
    admin_a = _make_admin_user(db_session, "E9212")

    token_u = _login(client, user_u)
    cookies_u = {SESSION_COOKIE_NAME: token_u}

    response = client.get(
        f"/api/v1/test/self-or-admin/{user_u.id}", cookies=cookies_u
    )
    assert response.status_code == 200

    response = client.get(
        f"/api/v1/test/self-or-admin/{user_v.id}", cookies=cookies_u
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )

    token_a = _login(client, admin_a)
    response = client.get(
        f"/api/v1/test/self-or-admin/{user_v.id}",
        cookies={SESSION_COOKIE_NAME: token_a},
    )
    assert response.status_code == 200
    assert calls["self_or_admin"] == 2


def test_aut_r21_admin_still_fails_closed_on_invalid_user_id(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
) -> None:
    """AUT-R21 (reviewer regression): an Admin hitting 本人或 Admin
    with a path parameter that is not a valid UUID is rejected with
    403 ``permission.denied`` -- the UUID is parsed *before* the
    Admin bypass, so Admin can never ride a malformed request through
    to the handler.
    """
    client, calls = probe_client
    admin_a = _make_admin_user(db_session, "E9R211")

    token_a = _login(client, admin_a)
    response = client.get(
        "/api/v1/test/self-or-admin/not-a-uuid",
        cookies={SESSION_COOKIE_NAME: token_a},
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )
    assert calls["self_or_admin"] == 0


# -- AUT-AC43 ------------------------------------------------------


def test_aut_ac43_temporary_password_blocks_every_access_level(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
    registered_permission_codes: type[_TestPermissionCode],
) -> None:
    """AUT-AC43: an Admin whose password is still marked temporary
    is rejected on all four access levels (login, Admin, project
    permission, self-or-admin) with 403
    ``auth.password_change_required`` and no handler ever runs;
    clearing the flag then lets every one of them through.
    """
    client, calls = probe_client

    account_t = create_root_user_with_company(db_session, "E9430")
    account_t.is_admin = True
    db_session.add(
        UserPassword(
            user_id=account_t.id,
            password_hash=hash_password(PASSWORD),
            must_change_password=True,
            created_by=account_t.id,
            updated_by=account_t.id,
        )
    )
    db_session.commit()

    project_p = _make_project(db_session, account_t, "PRJ-AC43")
    role = _make_role(
        db_session,
        account_t,
        "R-AC43",
        [registered_permission_codes.REPORT_READ.value],
    )
    _add_member(db_session, account_t, project_p, account_t, [role])
    db_session.commit()

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email": account_t.email, "password": PASSWORD},
    )
    assert login_response.status_code == 200
    assert login_response.json()["must_change_password"] is True
    token = login_response.cookies[SESSION_COOKIE_NAME]
    cookies = {SESSION_COOKIE_NAME: token}

    paths = [
        "/api/v1/test/needs-login",
        "/api/v1/test/needs-admin",
        f"/api/v1/test/needs-permission/report-read/{project_p.id}",
        f"/api/v1/test/self-or-admin/{account_t.id}",
    ]
    for path in paths:
        response = client.get(path, cookies=cookies)
        assert response.status_code == 403, path
        assert (
            response.json()["error"]["code"]
            == ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED.value
        ), path
    assert sum(calls.values()) == 0

    db_session.expire_all()
    stored_password = (
        db_session.query(UserPassword).filter_by(user_id=account_t.id).one()
    )
    stored_password.must_change_password = False
    db_session.commit()

    for path in paths:
        response = client.get(path, cookies=cookies)
        assert response.status_code == 200, path


# -- AUT-AC44 --------------------------------------------------------


@pytest.mark.parametrize(
    "action",
    [
        "evidence-create",
        "evidence-update",
        "evidence-delete",
        "report-approve",
    ],
)
def test_aut_ac44_admin_bypasses_non_read_permission_checks(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
    registered_permission_codes: type[_TestPermissionCode],
    action: str,
) -> None:
    """AUT-AC44: an Admin who is not a project member still passes
    every non-read permission code (create/update/delete/approve),
    per AUT-Q2's ruling that Admin is not limited to read/modify.
    """
    client, calls = probe_client
    creator = create_root_user_with_company(db_session, "E944C")
    db_session.commit()
    project_p = _make_project(db_session, creator, f"PRJ-{action[:4]}44")
    admin_a = _make_admin_user(db_session, f"E9{action[:3]}441")
    db_session.commit()

    token_a = _login(client, admin_a)
    response = client.get(
        f"/api/v1/test/needs-permission/{action}/{project_p.id}",
        cookies={SESSION_COOKIE_NAME: token_a},
    )
    assert response.status_code == 200
    assert sum(calls.values()) == 1


@pytest.mark.parametrize(
    "action",
    [
        "evidence-create",
        "evidence-update",
        "evidence-delete",
        "report-approve",
    ],
)
def test_aut_ac44_read_only_member_is_denied_non_read_actions(
    db_session: Session,
    probe_client: tuple[TestClient, dict[str, int]],
    registered_permission_codes: type[_TestPermissionCode],
    action: str,
) -> None:
    """AUT-AC44: a non-Admin project member who only holds
    ``report.read`` is rejected for every non-read action, with
    ``error.code == "permission.denied"``.
    """
    client, calls = probe_client
    creator = create_root_user_with_company(db_session, "E944R")
    db_session.commit()
    project_p = _make_project(db_session, creator, f"PRJ-{action[:4]}44R")
    role = _make_role(
        db_session,
        creator,
        f"R-{action}-44",
        [registered_permission_codes.REPORT_READ.value],
    )
    user_u = make_local_user(db_session, f"E9{action[:3]}442")
    _add_member(db_session, creator, project_p, user_u, [role])
    db_session.commit()

    token_u = _login(client, user_u)
    response = client.get(
        f"/api/v1/test/needs-permission/{action}/{project_p.id}",
        cookies={SESSION_COOKIE_NAME: token_u},
    )
    assert response.status_code == 403
    assert (
        response.json()["error"]["code"] == ErrorCode.PERMISSION_DENIED.value
    )
    assert sum(calls.values()) == 0
