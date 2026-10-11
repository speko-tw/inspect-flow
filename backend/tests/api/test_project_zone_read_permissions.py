"""Who may read a project's zones (#451, ADM-R17 section navigation)."""

import pytest

from app.auth.sessions import create_session
from app.models import (
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
)
from tests.api.test_inspection_planning_api import _client
from tests.db.conftest import create_root_user_with_company


def _member_with(db_session, make_client, permission_code):
    """Return a client for a project member holding one permission only."""
    admin = create_root_user_with_company(db_session, "ZONE-READ-ADMIN")
    admin.is_admin = True
    user = create_root_user_with_company(db_session, "ZONE-READ-USER")
    project = Project(
        project_code="ZONE-READ-1",
        name="示範專案",
        client_name="示範業主",
        site_location="示範工地",
        created_by=admin.id,
        updated_by=admin.id,
    )
    role = Role(
        name=f"zone read {permission_code}",
        created_by=admin.id,
        updated_by=admin.id,
        permission_codes=[RolePermission(code=permission_code)],
    )
    db_session.add_all([project, role])
    db_session.flush()
    db_session.add(
        ProjectMember(
            project_id=project.id,
            user_id=user.id,
            created_by=admin.id,
            updated_by=admin.id,
            role_assignments=[ProjectMemberRole(role_id=role.id)],
        )
    )
    db_session.commit()
    token = create_session(db_session, user)[1]
    db_session.commit()
    return _client(make_client, token), project


@pytest.mark.parametrize(
    ("permission_code", "expected"),
    [
        # The zones section lists what manage acts on, so manage alone
        # must be able to read; the others already could.
        ("project_zone.manage", 200),
        ("project_zone.read", 200),
        ("inspection_plan.read", 200),
        # Unrelated permission: still denied, the guard did not widen.
        ("inspection_task.inspect", 403),
    ],
)
def test_zone_list_read_follows_section_navigation_permissions(
    db_session, make_client, permission_code, expected
):
    client, project = _member_with(db_session, make_client, permission_code)

    response = client.get(f"/api/v1/projects/{project.id}/zones")

    assert response.status_code == expected, response.text
