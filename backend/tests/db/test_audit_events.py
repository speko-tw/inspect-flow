"""Tests for the first-batch event catalog and its round trip through
a real database (``docs/specs/audit-log/spec.md``'s "第一批事件"
table, ALG-AC07, issue #216).

Same fixture pattern as ``test_audit_log.py``: migrates the database
behind ``conftest.py``'s ``db_url`` fixture with the real Alembic
migration chain, then reads and writes it exclusively through
SQLAlchemy. Runs against SQLite by default and against PostgreSQL
under ``--db-backend=postgresql`` (plan.md requires ALG-AC07 to run
on both).
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import AuditLog, User
from app.services.audit import record_audit_event
from tests.db.conftest import create_root_user_with_company, make_system_admin

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def _alembic_config() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def migrated_url(db_url) -> str:
    command.upgrade(_alembic_config(), "head")
    return db_url


@pytest.fixture
def engine(migrated_url) -> Generator[Engine, None, None]:
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session(engine) -> Generator[Session, None, None]:
    with Session(engine) as sess:
        yield sess


@pytest.fixture
def operator(session) -> User:
    """A ``User`` with ``is_system = True`` so
    :func:`app.services.operator.get_current_operator` resolves to it
    outside of any HTTP request -- these tests call
    :func:`record_audit_event` directly, not through a route.
    """
    user = create_root_user_with_company(session, "E930")
    make_system_admin(user)
    session.commit()
    return user


class TestAlgAc07FirstBatchEventsRoundTrip:
    """ALG-AC07: each of the six first-batch events writes
    successfully; the collection fields (``permission_codes``,
    ``role_ids``, ``project_member_ids``) are passed in deliberately
    unsorted order and as ``uuid.UUID`` objects, then read back as
    sorted arrays of strings (ALG-R10).
    """

    def test_all_six_events_round_trip(self, session, operator):
        role_id = uuid7()
        project_id = uuid7()
        user_id = uuid7()
        member_a, member_b, member_c = uuid7(), uuid7(), uuid7()
        # Deliberately unsorted order (ALG-AC07's "故意以未排序的順序").
        unsorted_member_ids = [member_c, member_a, member_b]
        expected_member_ids = sorted(str(m) for m in unsorted_member_ids)

        created = record_audit_event(
            session,
            "role.created",
            entity_id=role_id,
            before=None,
            after={
                # Unsorted order.
                "permission_codes": ["report.approve", "project.view"],
                "name": "Inspector",
            },
        )
        updated = record_audit_event(
            session,
            "role.updated",
            entity_id=role_id,
            before={"name": "Inspector"},
            after={"name": "Senior Inspector"},
        )
        deleted = record_audit_event(
            session,
            "role.deleted",
            entity_id=role_id,
            before={
                "name": "Senior Inspector",
                "permission_codes": ["report.approve", "project.view"],
                "project_member_ids": unsorted_member_ids,
            },
            after=None,
        )
        roles_changed = record_audit_event(
            session,
            "project_member.roles_changed",
            entity_id=uuid7(),
            project_id=project_id,
            before={
                "role_ids": [],
                "project_id": project_id,
                "user_id": user_id,
            },
            after={
                "role_ids": [role_id],
                "project_id": project_id,
                "user_id": user_id,
            },
        )
        removed = record_audit_event(
            session,
            "project_member.removed",
            entity_id=uuid7(),
            project_id=project_id,
            before={
                "project_id": project_id,
                "user_id": user_id,
                "role_ids": [],
            },
            after=None,
        )
        admin_changed = record_audit_event(
            session,
            "user.admin_changed",
            entity_id=user_id,
            before={"is_admin": False},
            after={"is_admin": True},
        )
        session.commit()

        session.expire_all()
        by_id = {
            log.id: log
            for log in (
                created,
                updated,
                deleted,
                roles_changed,
                removed,
                admin_changed,
            )
        }
        fetched = {log_id: session.get(AuditLog, log_id) for log_id in by_id}
        assert all(row is not None for row in fetched.values())

        role_created = fetched[created.id]
        assert role_created.event_type == "role.created"
        assert role_created.project_id is None
        assert role_created.entity_type == "role"
        assert role_created.entity_id == role_id
        assert role_created.before is None
        assert role_created.after == {
            "name": "Inspector",
            "permission_codes": ["project.view", "report.approve"],
        }

        role_updated = fetched[updated.id]
        assert role_updated.event_type == "role.updated"
        assert role_updated.project_id is None
        assert role_updated.before == {"name": "Inspector"}
        assert role_updated.after == {"name": "Senior Inspector"}

        role_deleted = fetched[deleted.id]
        assert role_deleted.event_type == "role.deleted"
        assert role_deleted.project_id is None
        assert role_deleted.after is None
        assert role_deleted.before == {
            "name": "Senior Inspector",
            "permission_codes": ["project.view", "report.approve"],
            "project_member_ids": expected_member_ids,
        }

        member_roles_changed = fetched[roles_changed.id]
        assert member_roles_changed.event_type == (
            "project_member.roles_changed"
        )
        assert member_roles_changed.entity_type == "project_member"
        assert member_roles_changed.before == {
            "role_ids": [],
            "project_id": str(project_id),
            "user_id": str(user_id),
        }
        assert member_roles_changed.after == {
            "role_ids": [str(role_id)],
            "project_id": str(project_id),
            "user_id": str(user_id),
        }

        member_removed = fetched[removed.id]
        assert member_removed.event_type == "project_member.removed"
        assert member_removed.after is None
        assert member_removed.before == {
            "project_id": str(project_id),
            "user_id": str(user_id),
            "role_ids": [],
        }

        user_admin_changed = fetched[admin_changed.id]
        assert user_admin_changed.event_type == "user.admin_changed"
        assert user_admin_changed.project_id is None
        assert user_admin_changed.entity_type == "user"
        assert user_admin_changed.entity_id == user_id
        assert user_admin_changed.before == {"is_admin": False}
        assert user_admin_changed.after == {"is_admin": True}
