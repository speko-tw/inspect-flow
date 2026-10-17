"""驗證範本管理員轉換與舊系統角色資料表移除。"""

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.config import Config
from sqlalchemy import Uuid, bindparam, inspect, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import AuditLog, User, UserModulePermission
from app.services.access_summary import summarize_access
from app.services.permissions import calculate_effective_access
from tests.db.conftest import create_root_user_with_company

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"
_PARENT_REVISION = "6eaaafbe0ef2"
_CONVERSION_PARENT = "9b7a6c2d1e45"


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


def _cfg() -> Config:
    return Config(str(_ALEMBIC_INI))


def _insert_legacy_assignment(session: Session, user: User) -> None:
    now = datetime.now(UTC)
    session.execute(
        text(
            """INSERT INTO system_role_assignments
               (id, created_at, updated_at, created_by, updated_by,
                user_id, role_code)
               VALUES (:id, :created_at, :updated_at, :created_by,
                       :updated_by, :user_id, 'template_admin')"""
        ).bindparams(
            bindparam("id", type_=Uuid()),
            bindparam("created_by", type_=Uuid()),
            bindparam("updated_by", type_=Uuid()),
            bindparam("user_id", type_=Uuid()),
        ),
        {
            "id": uuid4(),
            "created_at": now,
            "updated_at": now,
            "created_by": user.id,
            "updated_by": user.id,
            "user_id": user.id,
        },
    )


def test_template_admin_conversion_preserves_internal_and_external_read(
    db_url,
):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            internal = create_root_user_with_company(session, "M579I")
            external = create_root_user_with_company(session, "M579E")
            admin = create_root_user_with_company(session, "M579A")
            admin_without_role = create_root_user_with_company(
                session, "M579N"
            )
            external.is_external_collaborator = True
            admin.is_admin = True
            admin_without_role.is_admin = True
            session.add(
                UserModulePermission(
                    user_id=external.id,
                    permission_code="template.manage",
                    source="manual",
                )
            )
            _insert_legacy_assignment(session, internal)
            _insert_legacy_assignment(session, external)
            _insert_legacy_assignment(session, admin)
            session.commit()
            internal_id = internal.id
            external_id = external.id
            admin_id = admin.id
            admin_without_role_id = admin_without_role.id
            expected_legacy_rows = {
                (str(internal.id), "template_admin"),
                (str(external.id), "template_admin"),
                (str(admin.id), "template_admin"),
            }
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    engine = create_engine_from_settings(db_url)
    try:
        inspector = inspect(engine)
        assert "system_role_assignments" not in inspector.get_table_names()
        with Session(engine) as session:
            internal_access = calculate_effective_access(
                session, user_id=internal_id
            )
            external_access = calculate_effective_access(
                session, user_id=external_id
            )
            admin_access = calculate_effective_access(
                session, user_id=admin_id
            )
            assert internal_access.module_permissions == frozenset(
                {"template.manage", "template.use"}
            )
            assert external_access.module_permissions == frozenset(
                {"template.use"}
            )
            assert {"template.manage", "template.use"} <= (
                admin_access.module_permissions
            )
            admin_permissions = set(
                session.scalars(
                    select(UserModulePermission.permission_code).where(
                        UserModulePermission.user_id == admin_id
                    )
                ).all()
            )
            admin_without_role_permissions = set(
                session.scalars(
                    select(UserModulePermission.permission_code).where(
                        UserModulePermission.user_id == admin_without_role_id
                    )
                ).all()
            )
            assert {"template.manage", "template.use"} <= admin_permissions
            assert (
                not {
                    "template.manage",
                    "template.use",
                }
                & admin_without_role_permissions
            )
            internal_user = session.get(User, internal_id)
            external_user = session.get(User, external_id)
            assert internal_user is not None
            assert external_user is not None
            assert (
                summarize_access(session, internal_user).has_template_access
                is True
            )
            assert (
                summarize_access(session, external_user).has_template_access
                is False
            )
            assert session.scalars(
                select(UserModulePermission.permission_code).where(
                    UserModulePermission.user_id == external_id
                )
            ).all() == ["template.use"]
            external_permissions = session.scalars(
                select(UserModulePermission).where(
                    UserModulePermission.user_id == external_id
                )
            ).all()
            assert len(external_permissions) == 1
            assert external_permissions[0].source == "backfill"
            assert session.scalars(select(AuditLog)).all() == []
    finally:
        engine.dispose()

    command.downgrade(_cfg(), _CONVERSION_PARENT)
    downgraded_engine = create_engine_from_settings(db_url)
    try:
        with downgraded_engine.connect() as connection:
            restored_rows = {
                (str(UUID(str(user_id))), role_code)
                for user_id, role_code in connection.execute(
                    text(
                        "SELECT user_id, role_code "
                        "FROM system_role_assignments"
                    )
                )
            }
        assert restored_rows == {
            row
            for row in expected_legacy_rows
            if row[0] in {str(internal_id), str(admin_id)}
        }
    finally:
        downgraded_engine.dispose()


@pytest.mark.parametrize("is_admin", [False, True])
def test_downgrade_rejects_ambiguous_manual_template_manager(db_url, is_admin):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            manager = create_root_user_with_company(session, "M579M")
            manager.is_admin = is_admin
            session.add(
                UserModulePermission(
                    user_id=manager.id,
                    permission_code="template.manage",
                    source="manual",
                )
            )
            session.commit()
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    with pytest.raises(RuntimeError, match="cannot be mapped"):
        command.downgrade(_cfg(), _CONVERSION_PARENT)
