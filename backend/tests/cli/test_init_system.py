"""Initialization command acceptance tests (AUT-AC54, AUT-AC55)."""

import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.auth.password_service import set_password
from app.auth.passwords import verify_password
from app.cli import init_system
from app.cli.init_system import run
from app.models import (
    AuditLog,
    Company,
    CreatorRoleSetting,
    PermissionBundle,
    PermissionBundlePermission,
    Role,
    RolePermission,
    SetupCode,
    User,
    UserPassword,
)

_CODE_RE = re.compile(r"First-login code: ([A-Za-z0-9_-]+)")
_VALID_PASSWORD = "VeryStrongPassword!"


def _code_from(output: list[str]) -> str:
    matches = [match for line in output if (match := _CODE_RE.fullmatch(line))]
    assert len(matches) == 1
    return matches[0].group(1)


def _counts(session: Session) -> tuple[int, ...]:
    return tuple(
        len(session.scalars(select(model)).all())
        for model in (
            User,
            Company,
            Role,
            RolePermission,
            CreatorRoleSetting,
            PermissionBundle,
            PermissionBundlePermission,
            SetupCode,
            AuditLog,
        )
    )


def test_aut_ac54_creates_only_system_rows_and_prints_one_code(
    session_factory: sessionmaker[Session],
) -> None:
    output: list[str] = []
    assert run(session_factory, output=output.append) == 0
    code = _code_from(output)

    with session_factory() as session:
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one()
        setup_code = session.scalars(select(SetupCode)).one()
        assert admin.username == "admin"
        assert admin.is_admin is True
        assert admin.company_id is None
        assert admin.email is None
        assert admin.name_zh is None
        assert admin.name_en is None
        assert session.scalars(select(UserPassword)).all() == []
        assert session.scalars(select(Company)).all() == []
        roles = {
            role.name: role for role in session.scalars(select(Role)).all()
        }
        assert set(roles) == {
            "專案工程師",
            "現場工程師",
            "專案查閱人員",
        }
        assert roles["專案工程師"].is_assignable is False
        assert roles["專案工程師"].is_external_allowed is False
        assert roles["現場工程師"].is_assignable is True
        assert roles["現場工程師"].is_external_allowed is False
        assert roles["專案查閱人員"].is_assignable is True
        assert roles["專案查閱人員"].is_external_allowed is True
        expected_read_codes = {
            "project.read",
            "project_inspection_item.read",
            "project_zone.read",
            "inspection_plan.read",
            "inspection_task.read",
        }
        expected_engineer_codes = {
            "project_member.manage",
            "project.update",
            "project.read",
            "project_inspection_item.edit",
            "project_inspection_item.read",
            "project_zone.read",
            "project_zone.manage",
            "inspection_plan.read",
            "inspection_plan.create",
            "inspection_plan.manage",
            "inspection_plan.archive",
            "inspection_plan.unarchive",
            "inspection_task.read",
            "inspection_task.manage",
            "inspection_task.create",
            "inspection_task.dispatch",
            "inspection_task.assign",
            "inspection_task.delete_draft",
            "inspection_task.cancel",
        }
        assert {
            item.code for item in roles["專案工程師"].permission_codes
        } == expected_engineer_codes
        assert {
            item.code for item in roles["現場工程師"].permission_codes
        } == expected_read_codes | {"inspection_task.inspect"}
        assert {
            item.code for item in roles["專案查閱人員"].permission_codes
        } == expected_read_codes
        setting = session.scalars(select(CreatorRoleSetting)).one()
        assert setting.role_id == roles["專案工程師"].id
        bundles = {
            bundle.name: {
                item.permission_code for item in bundle.permission_codes
            }
            for bundle in session.scalars(select(PermissionBundle)).all()
        }
        assert bundles == {
            "公司主管": {"project.use", "all_project_progress.read"},
            "專案工程師常用": {
                "project.use",
                "project.create",
                "inspection.use",
                "template.use",
            },
            "現場工程師常用": {"project.use", "inspection.use"},
        }
        assert setup_code.code_hash != code
        assert verify_password(setup_code.code_hash, code)
        assert setup_code.expires_at == setup_code.created_at + timedelta(
            hours=24
        )
        assert setup_code.voided_at is None
        assert _counts(session) == (
            1,
            0,
            3,
            len(session.scalars(select(RolePermission)).all()),
            1,
            3,
            8,
            1,
            0,
        )


def test_aut_ac55_rerun_replaces_code_and_refuses_configured_admin(
    session_factory: sessionmaker[Session],
) -> None:
    first_output: list[str] = []
    assert run(session_factory, output=first_output.append) == 0
    first_code = _code_from(first_output)

    with session_factory() as session:
        engineer = session.scalars(
            select(Role).where(Role.name == "專案工程師")
        ).one()
        engineer.is_assignable = True
        engineer.permission_codes[0].code = "inspection_task.inspect"
        bundle = session.scalars(
            select(PermissionBundle).where(
                PermissionBundle.name == "專案工程師常用"
            )
        ).one()
        bundle.permission_codes[
            0
        ].permission_code = "all_project_progress.read"
        session.commit()
        expected_role_codes = {item.code for item in engineer.permission_codes}
        expected_bundle_codes = {
            item.permission_code for item in bundle.permission_codes
        }
        role_permission_count = len(
            session.scalars(select(RolePermission)).all()
        )
        bundle_permission_count = len(
            session.scalars(select(PermissionBundlePermission)).all()
        )

    second_output: list[str] = []
    assert run(session_factory, output=second_output.append) == 0
    second_code = _code_from(second_output)
    assert second_code != first_code

    with session_factory() as session:
        rows = session.scalars(
            select(SetupCode).order_by(SetupCode.created_at)
        ).all()
        assert len(rows) == 2
        assert rows[0].voided_at is not None
        assert rows[1].voided_at is None
        assert verify_password(rows[1].code_hash, second_code)
        assert _counts(session) == (
            1,
            0,
            3,
            role_permission_count,
            1,
            3,
            bundle_permission_count,
            2,
            0,
        )
        engineer = session.scalars(
            select(Role).where(Role.name == "專案工程師")
        ).one()
        assert engineer.is_assignable is True
        assert {item.code for item in engineer.permission_codes} == (
            expected_role_codes
        )
        bundle = session.scalars(
            select(PermissionBundle).where(
                PermissionBundle.name == "專案工程師常用"
            )
        ).one()
        assert {
            item.permission_code for item in bundle.permission_codes
        } == expected_bundle_codes
        admin = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one()

    with session_factory() as session:
        admin = session.get(User, admin.id)
        assert admin is not None
        set_password(session, admin, _VALID_PASSWORD, is_temporary=False)
        session.commit()

    before: tuple[int, ...]
    with session_factory() as session:
        before = _counts(session)
    error_output: list[str] = []
    assert (
        run(
            session_factory,
            output=lambda _line: None,
            error_output=error_output.append,
        )
        == 1
    )
    assert error_output == ["System is already initialized."]
    with session_factory() as session:
        assert _counts(session) == before


def test_aut_ac54_failure_after_admin_creation_rolls_back_all_rows(
    session_factory: sessionmaker[Session], monkeypatch
) -> None:
    def fail_setup_code(_session: Session, _admin: User) -> str:
        raise RuntimeError("injected setup-code failure")

    monkeypatch.setattr(init_system, "issue_setup_code", fail_setup_code)
    try:
        run(session_factory, output=lambda _line: None)
    except RuntimeError as exc:
        assert str(exc) == "injected setup-code failure"
    else:
        raise AssertionError("initialization failure was swallowed")

    with session_factory() as session:
        assert _counts(session) == (0, 0, 0, 0, 0, 0, 0, 0, 0)
