"""AUT-R49：委派者選人查詢只回傳最小欄位。"""

from app.auth.sessions import SESSION_COOKIE_NAME, create_session
from app.models import UserModuleDelegation
from app.services.users import create_user
from tests.db.conftest import create_root_user_with_company


def test_module_delegate_user_picker_is_scoped_and_minimal(
    db_session, make_client
):
    admin = create_root_user_with_company(db_session, "DELEGATE-ADMIN")
    admin.username = "admin"
    admin.company_id = None
    admin.employee_no = None
    admin.department = None
    admin.location = None
    admin.name_en = None
    admin.name_zh = None
    admin.email = None
    admin.is_admin = True
    admin.is_system = True
    db_session.flush()
    delegate = create_user(
        db_session,
        username="delegate",
        email="delegate@demo.example",
        name_zh="委派者",
        is_external_collaborator=False,
    )
    candidate = create_user(
        db_session,
        username="candidate",
        email="candidate@demo.example",
        name_zh="候選人",
        is_external_collaborator=False,
    )
    inactive = create_user(
        db_session,
        username="inactive",
        email="inactive@demo.example",
        name_zh="停用人員",
        is_external_collaborator=False,
    )
    inactive.is_active = False
    non_system_admin = create_user(
        db_session,
        username="admin-target",
        email="admin-target@demo.example",
        name_zh="管理員",
        is_external_collaborator=False,
    )
    non_system_admin.is_admin = True
    db_session.add(
        UserModuleDelegation(user_id=delegate.id, module="template")
    )
    db_session.commit()

    def client_for(user):
        _, token = create_session(db_session, user)
        db_session.commit()
        client = make_client()
        client.cookies.set(SESSION_COOKIE_NAME, token)
        return client

    delegated_response = client_for(delegate).get(
        "/api/v1/module-delegate/users"
    )
    assert delegated_response.status_code == 200
    assert all(
        item["username"] != non_system_admin.username
        for item in delegated_response.json()["items"]
    )
    assert delegated_response.json() == {
        "items": [
            {
                "id": str(candidate.id),
                "username": "candidate",
                "name_zh": "候選人",
            },
            {
                "id": str(delegate.id),
                "username": "delegate",
                "name_zh": "委派者",
            },
        ],
        "next_cursor": None,
    }

    assert (
        client_for(candidate).get("/api/v1/module-delegate/users").status_code
        == 403
    )
    assert client_for(delegate).get("/api/v1/users").status_code == 403
    assert (
        client_for(admin).get("/api/v1/module-delegate/users").status_code
        == 200
    )
