"""Service-layer Project operations (DOM-R14, DOM-R40-R44)."""

from datetime import date

import pytest

from app.services.projects import (
    InvalidProjectFieldError,
    ProjectUnchangedError,
    create_project,
    find_projects_by_code,
    update_project,
)


def test_create_and_update_project_fill_operator_and_optional_dates(
    session, operator
):
    project = create_project(
        session,
        project_code="DEMO",
        name="示範廠機電工程",
        client_name="示範業主",
        site_location="示範工地",
        planned_start_date=date(2026, 10, 1),
    )
    session.commit()

    assert project.created_by == operator.id
    assert project.updated_by == operator.id
    assert project.planned_start_date == date(2026, 10, 1)
    assert project.planned_completion_date is None

    update_project(
        session,
        project,
        name="更新後工程",
        planned_start_date=None,
        planned_completion_date=date(2027, 4, 1),
    )
    session.commit()

    assert project.name == "更新後工程"
    assert project.planned_start_date is None
    assert project.planned_completion_date == date(2027, 4, 1)
    assert project.updated_by == operator.id


def test_invalid_update_does_not_partially_change_project(session, operator):
    project = create_project(
        session,
        project_code="DEMO",
        name="原工程名稱",
        client_name="示範業主",
        site_location="示範工地",
    )
    session.flush()

    with pytest.raises(InvalidProjectFieldError):
        update_project(
            session,
            project,
            name="已經改變",
            site_location="x" * 257,
        )

    assert project.name == "原工程名稱"
    assert project.site_location == "示範工地"
    assert project.updated_by == operator.id


def test_empty_update_is_rejected(session, operator):
    project = create_project(
        session,
        project_code="DEMO",
        name="示範工程",
        client_name="示範業主",
        site_location="示範工地",
    )

    with pytest.raises(ProjectUnchangedError):
        update_project(session, project)


def test_duplicate_code_lookup_does_not_block_inserts(session, operator):
    projects = [
        create_project(
            session,
            project_code="DEMO",
            name="示範廠機電工程",
            client_name="示範業主",
            site_location="示範工地",
        )
        for _ in range(2)
    ]
    session.commit()

    matches = find_projects_by_code(session, "DEMO")
    assert {project.id for project in matches} == {
        project.id for project in projects
    }
    assert projects[0].id != projects[1].id
    assert list(find_projects_by_code(session, "MISSING")) == []
