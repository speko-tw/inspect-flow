"""驗證範本管理員轉換與舊系統角色資料表移除。"""

from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.config import Config
from sqlalchemy import Uuid, bindparam, inspect, select, text
from sqlalchemy.orm import Session

from alembic import command
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import (
    AuditLog,
    Project,
    ProjectMember,
    ProjectMemberRole,
    Role,
    RolePermission,
    User,
    UserModulePermission,
)
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


def _add_legacy_project_template_read(
    session: Session, actor: User, user: User
) -> None:
    role = Role(
        name=f"舊範本讀取 {user.id.hex[:8]}",
        is_external_allowed=True,
        created_by=actor.id,
        updated_by=actor.id,
        permission_codes=[RolePermission(code="project_inspection_item.edit")],
    )
    project = Project(
        project_code=f"P-{user.id.hex[:8]}",
        name="舊範本讀取路徑",
        client_name="測試業主",
        site_location="測試工地",
        created_by=actor.id,
        updated_by=actor.id,
    )
    session.add_all([role, project])
    session.flush()
    session.add(
        ProjectMember(
            project_id=project.id,
            user_id=user.id,
            created_by=actor.id,
            updated_by=actor.id,
            role_assignments=[ProjectMemberRole(role=role)],
        )
    )


def _current_revision(db_url: str) -> str:
    engine = create_engine_from_settings(db_url)
    try:
        with engine.connect() as connection:
            return connection.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar_one()
    finally:
        engine.dispose()


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
            _add_legacy_project_template_read(session, internal, external)
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
                {"template.use", "project.use", "inspection.use"}
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
                select(UserModulePermission.permission_code)
                .where(UserModulePermission.user_id == external_id)
                .where(
                    UserModulePermission.permission_code.in_(
                        {"template.manage", "template.use"}
                    )
                )
            ).all() == ["template.use"]
            external_permissions = session.scalars(
                select(UserModulePermission)
                .where(UserModulePermission.user_id == external_id)
                .where(
                    UserModulePermission.permission_code.in_(
                        {"template.manage", "template.use"}
                    )
                )
            ).all()
            assert len(external_permissions) == 1
            assert external_permissions[0].source == "backfill"
            assert session.scalars(select(AuditLog)).all() == []
    finally:
        engine.dispose()


def _assert_downgrade_rejected_without_changes(
    db_url: str,
    user_id,
    expected_permission: tuple[str, str],
) -> None:
    engine = create_engine_from_settings(db_url)
    try:
        with Session(engine) as session:
            before = session.execute(
                select(
                    UserModulePermission.permission_code,
                    UserModulePermission.source,
                )
                .where(UserModulePermission.user_id == user_id)
                .where(
                    UserModulePermission.permission_code.in_(
                        {"template.manage", "template.use"}
                    )
                )
                .order_by(UserModulePermission.permission_code)
            ).all()
    finally:
        engine.dispose()

    with pytest.raises(RuntimeError) as error:
        command.downgrade(_cfg(), _CONVERSION_PARENT)
    message = str(error.value)
    assert str(user_id) in message
    assert "1 人" in message
    assert "不支援含範本權限資料的降版" in message
    assert "升級前的資料庫備份還原（PR-13）" in message

    engine = create_engine_from_settings(db_url)
    try:
        assert (
            "system_role_assignments" not in inspect(engine).get_table_names()
        )
        with Session(engine) as session:
            after = session.execute(
                select(
                    UserModulePermission.permission_code,
                    UserModulePermission.source,
                )
                .where(UserModulePermission.user_id == user_id)
                .where(
                    UserModulePermission.permission_code.in_(
                        {"template.manage", "template.use"}
                    )
                )
                .order_by(UserModulePermission.permission_code)
            ).all()
    finally:
        engine.dispose()
    assert after == before
    assert expected_permission in after
    assert _current_revision(db_url) == "b72e4c19f6a3"


def test_empty_template_permissions_allow_empty_legacy_table(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    command.upgrade(_cfg(), "head")
    command.downgrade(_cfg(), _CONVERSION_PARENT)

    engine = create_engine_from_settings(db_url)
    try:
        inspector = inspect(engine)
        assert "system_role_assignments" in inspector.get_table_names()
        with engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT COUNT(*) FROM system_role_assignments")
                ).scalar_one()
                == 0
            )
    finally:
        engine.dispose()
    assert _current_revision(db_url) == _CONVERSION_PARENT


def test_downgrade_rejects_internal_backfill_without_changes(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            manager = create_root_user_with_company(session, "M579M")
            _insert_legacy_assignment(session, manager)
            session.commit()
            manager_id = manager.id
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    _assert_downgrade_rejected_without_changes(
        db_url, manager_id, ("template.manage", "backfill")
    )


def test_downgrade_rejects_external_manual_use_without_changes(db_url):
    command.upgrade(_cfg(), _PARENT_REVISION)
    old_engine = create_engine_from_settings(db_url)
    try:
        with Session(old_engine) as session:
            external = create_root_user_with_company(session, "M579E")
            external.is_external_collaborator = True
            _insert_legacy_assignment(session, external)
            session.add(
                UserModulePermission(
                    user_id=external.id,
                    permission_code="template.use",
                    source="manual",
                )
            )
            session.commit()
            external_id = external.id
    finally:
        old_engine.dispose()

    command.upgrade(_cfg(), "head")
    _assert_downgrade_rejected_without_changes(
        db_url, external_id, ("template.use", "manual")
    )
