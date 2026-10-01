"""PostgreSQL integration coverage for management conflict mapping."""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.api.errors import ErrorCode
from app.api.v1._management_errors import (
    integrity_error_code,
    management_error_status,
)
from app.api.v1.projects import _member_conflict
from app.db.engine import create_engine_from_settings
from app.models import Company, Project, ProjectMember, User
from tests.db.conftest import build_root_user, create_root_user_with_company


@pytest.fixture
def migrated_engine(db_url) -> Generator[Engine, None, None]:
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    command.upgrade(config, "head")
    engine = create_engine_from_settings(db_url)
    try:
        yield engine
    finally:
        engine.dispose()


def test_postgresql_management_constraints_map_to_conflicts(migrated_engine):
    if migrated_engine.dialect.name != "postgresql":
        pytest.skip(
            "requires the PostgreSQL constraints used by check-postgres"
        )

    with Session(migrated_engine) as session:
        existing = create_root_user_with_company(session, "M001")
        company = session.get(Company, existing.company_id)
        assert company is not None
        company.name = "Company Conflict"
        session.commit()

        duplicate_username = build_root_user("M002", existing.company_id)
        duplicate_username.username = existing.username
        duplicate_email = build_root_user("M003", existing.company_id)
        duplicate_email.email = existing.email
        cases: tuple[tuple[User | Company, ErrorCode], ...] = (
            (duplicate_username, ErrorCode.USER_USERNAME_CONFLICT),
            (duplicate_email, ErrorCode.USER_EMAIL_CONFLICT),
            (
                build_root_user("M001", existing.company_id),
                ErrorCode.USER_EMPLOYEE_NO_CONFLICT,
            ),
            (
                Company(
                    name="company conflict",
                    created_by=existing.id,
                    updated_by=existing.id,
                ),
                ErrorCode.COMPANY_NAME_CONFLICT,
            ),
        )

        for candidate, expected in cases:
            with pytest.raises(IntegrityError) as raised:
                session.add(candidate)
                session.flush()
            code = integrity_error_code(raised.value)
            assert code is not None
            assert code == expected
            assert management_error_status(code) == 409
            session.rollback()


def test_postgresql_project_member_constraint_is_recognized(migrated_engine):
    if migrated_engine.dialect.name != "postgresql":
        pytest.skip(
            "requires the PostgreSQL ProjectMember constraint used by "
            "check-postgres"
        )

    with Session(migrated_engine) as session:
        operator = create_root_user_with_company(session, "PM001")
        project = Project(
            project_code="PM001",
            name="Project Member Constraint",
            client_name="Example Client",
            site_location="Example Site",
            created_by=operator.id,
            updated_by=operator.id,
        )
        session.add(project)
        session.flush()

        member = ProjectMember(
            project_id=project.id,
            user_id=operator.id,
            created_by=operator.id,
            updated_by=operator.id,
        )
        session.add(member)
        session.flush()

        duplicate = ProjectMember(
            project_id=project.id,
            user_id=operator.id,
            created_by=operator.id,
            updated_by=operator.id,
        )
        with pytest.raises(IntegrityError) as raised:
            session.add(duplicate)
            session.flush()

        diagnostic = getattr(raised.value.orig, "diag", None)
        assert getattr(diagnostic, "constraint_name", None) == (
            "uq_project_members_project_id"
        )
        assert _member_conflict(raised.value)
