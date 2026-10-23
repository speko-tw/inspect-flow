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
    external_candidate = create_user(
        db_session,
        username="external-candidate",
        email="external-candidate@demo.example",
        name_zh="外部候選人",
        is_external_collaborator=True,
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
                "is_external_collaborator": False,
            },
            {
                "id": str(external_candidate.id),
                "username": "external-candidate",
                "name_zh": "外部候選人",
                "is_external_collaborator": True,
            },
        ],
        "next_cursor": None,
    }

    exact_account_match = client_for(delegate).get(
        "/api/v1/module-delegate/users?q=candidate"
    )
    assert exact_account_match.status_code == 200
    assert [
        item["username"] for item in exact_account_match.json()["items"]
    ] == ["candidate", "external-candidate"]
    assert [
        item["is_external_collaborator"]
        for item in exact_account_match.json()["items"]
    ] == [False, True]
    external_match = client_for(delegate).get(
        "/api/v1/module-delegate/users?q=external-candidate"
    )
    assert external_match.status_code == 200
    assert external_match.json()["items"] == [
        {
            "id": str(external_candidate.id),
            "username": "external-candidate",
            "name_zh": "外部候選人",
            "is_external_collaborator": True,
        }
    ]

    assert (
        client_for(candidate).get("/api/v1/module-delegate/users").status_code
        == 403
    )
    assert client_for(delegate).get("/api/v1/users").status_code == 403
    assert (
        client_for(admin).get("/api/v1/module-delegate/users").status_code
        == 200
    )


def test_module_delegate_can_read_target_heading_but_not_admin_identity(
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
    delegate = create_user(
        db_session,
        username="detail-delegate",
        email="detail-delegate@demo.example",
        name_zh="委派者",
        is_external_collaborator=False,
    )
    target = create_user(
        db_session,
        username="detail-target",
        email="detail-target@demo.example",
        name_zh="目標姓名",
        is_external_collaborator=False,
    )
    external_target = create_user(
        db_session,
        username="detail-external-target",
        email="detail-external-target@demo.example",
        name_zh="外部目標姓名",
        is_external_collaborator=True,
    )
    admin_target = create_user(
        db_session,
        username="detail-admin-target",
        email="detail-admin-target@demo.example",
        name_zh="管理者",
        is_external_collaborator=False,
    )
    admin_target.is_admin = True
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

    delegate_client = client_for(delegate)
    self_response = delegate_client.get(
        f"/api/v1/module-delegate/users/{delegate.id}"
    )
    assert self_response.status_code == 404
    response = delegate_client.get(
        f"/api/v1/module-delegate/users/{target.id}"
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": str(target.id),
        "username": target.username,
        "name_zh": target.name_zh,
        "is_external_collaborator": False,
    }
    external_response = delegate_client.get(
        f"/api/v1/module-delegate/users/{external_target.id}"
    )
    assert external_response.status_code == 200
    assert external_response.json() == {
        "id": str(external_target.id),
        "username": external_target.username,
        "name_zh": external_target.name_zh,
        "is_external_collaborator": True,
    }
    denied = delegate_client.get(
        f"/api/v1/module-delegate/users/{admin_target.id}"
    )
    assert denied.status_code == 403
    assert "is_admin" not in denied.text
    assert "email" not in denied.text
    assert (
        client_for(admin)
        .get(f"/api/v1/module-delegate/users/{admin_target.id}")
        .status_code
        == 200
    )
