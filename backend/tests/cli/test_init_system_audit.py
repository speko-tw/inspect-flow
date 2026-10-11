"""Initialization does not write audit records (ALG-AC08)."""

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.cli.init_system import run
from app.models import AuditLog, Role, SetupCode, User


def test_initialization_creates_system_data_without_audit_records(
    session_factory: sessionmaker[Session],
) -> None:
    output: list[str] = []
    assert run(session_factory, output=output.append) == 0
    assert len(output) == 1

    with session_factory() as session:
        assert len(session.scalars(select(User)).all()) == 1
        assert {role.name for role in session.scalars(select(Role)).all()} == {
            "專案工程師",
            "現場工程師",
            "專案查閱人員",
        }
        assert len(session.scalars(select(SetupCode)).all()) == 1
        assert session.scalars(select(AuditLog)).all() == []
