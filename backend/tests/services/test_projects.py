"""DOM-AC30: duplicate-code lookup returns all matching projects."""

from app.models import Project
from app.services.projects import find_projects_by_code


def test_duplicate_code_lookup_does_not_block_inserts(session, operator):
    projects = [
        Project(
            project_code="DEMO",
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
            created_by=operator.id,
            updated_by=operator.id,
        )
        for _ in range(2)
    ]
    session.add_all(projects)
    session.commit()

    matches = find_projects_by_code(session, "DEMO")
    assert {project.id for project in matches} == {
        project.id for project in projects
    }
    assert projects[0].id != projects[1].id
    assert list(find_projects_by_code(session, "MISSING")) == []
