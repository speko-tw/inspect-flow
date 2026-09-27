"""Tests for the initialization command (DOM-AC08, DOM-AC09).

Builds a temporary SQLite database migrated to head through the
real Alembic chain, matching ``backend/tests/services/conftest.py``'s
approach, so the command runs against real foreign keys, unique
constraints and ``NOT NULL`` columns rather than a mock.

``TestInitializeSystem`` exercises :func:`initialize_system` directly
(the write logic, given already-parsed input) while ``TestRun``
exercises :func:`run` end to end, including the "no prompting when
already initialized" behavior and both kinds of failure DOM-AC08
requires: a database constraint violation (a duplicate email) and a
model-level validation failure (an invalid email format) -- both
must leave every one of the three tables empty, matching DOM-R11's
"任何一步失敗時，整批都不生效".
"""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.cli.init_system import (
    _TEMPLATE_ROLE_NAMES,
    AccountInput,
    AlreadyInitializedError,
    CompanyInput,
    InputReader,
    initialize_system,
    main,
    run,
)
from app.db.engine import (
    create_engine_from_settings,
    dispose_engine,
    get_session_factory,
)
from app.db.settings import DATABASE_URL_ENV_VAR
from app.models import Company, Role, RolePermission, User

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


@pytest.fixture(autouse=True)
def _dispose_shared_engine():
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def db_url(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv(DATABASE_URL_ENV_VAR, url)
    return url


@pytest.fixture
def migrated_url(db_url: str) -> str:
    command.upgrade(Config(str(_ALEMBIC_INI)), "head")
    return db_url


@pytest.fixture
def engine(migrated_url: str):
    eng = create_engine_from_settings(migrated_url)
    try:
        yield eng
    finally:
        eng.dispose()


@pytest.fixture
def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine)


@pytest.fixture
def session(session_factory: sessionmaker[Session]):
    with session_factory() as sess:
        yield sess


def _count(session: Session, model: type) -> int:
    return len(session.scalars(select(model)).all())


def _valid_answers(
    *,
    company_code: str = "ACME",
    company_name: str = "Acme Corp",
    admin_employee_no: str = "A0001",
    admin_email: str = "admin@example.com",
    owner_employee_no: str = "A0002",
    owner_email: str = "owner@example.com",
) -> list[str]:
    """Answers in the exact order ``run`` prompts for them: the
    company's ``code``/``name``, then the admin account's six
    DOM-R01 fields, then the owner account's six DOM-R01 fields.
    """
    return [
        company_code,
        company_name,
        "IT",
        "HQ",
        admin_employee_no,
        "System Admin",
        "系統管理員",
        admin_email,
        "Management",
        "HQ",
        owner_employee_no,
        "Owner Person",
        "負責人",
        owner_email,
    ]


def _make_reader(answers: list[str]) -> InputReader:
    queue = list(answers)

    def _reader(prompt: str) -> str:
        if not queue:
            raise EOFError(f"no more test input left for prompt {prompt!r}")
        return queue.pop(0)

    return _reader


def _forbidden_reader(prompt: str) -> str:
    raise AssertionError(
        f"input_fn should not have been called (prompt: {prompt!r})"
    )


def _sample_admin_input(**overrides: str) -> AccountInput:
    fields: dict[str, str] = {
        "department": "IT",
        "location": "HQ",
        "employee_no": "A0001",
        "name_en": "System Admin",
        "name_zh": "系統管理員",
        "email": "admin@example.com",
    }
    fields.update(overrides)
    return AccountInput(**fields)


def _sample_owner_input(**overrides: str) -> AccountInput:
    fields: dict[str, str] = {
        "department": "Management",
        "location": "HQ",
        "employee_no": "A0002",
        "name_en": "Owner Person",
        "name_zh": "負責人",
        "email": "owner@example.com",
    }
    fields.update(overrides)
    return AccountInput(**fields)


class TestInitializeSystem:
    def test_creates_company_admin_owner_and_template_roles(
        self, session: Session
    ):
        company_row, admin_user, owner_user, roles = initialize_system(
            session,
            company=CompanyInput(code="ACME", name="Acme Corp"),
            admin=_sample_admin_input(),
            owner=_sample_owner_input(),
        )
        session.commit()

        assert company_row.code == "ACME"
        assert company_row.name == "Acme Corp"
        assert company_row.kind == "internal"
        assert company_row.created_by == admin_user.id
        assert company_row.updated_by == admin_user.id

        assert admin_user.email == "admin@example.com"
        assert admin_user.is_admin is True
        assert admin_user.is_system is True
        assert admin_user.created_by == admin_user.id
        assert admin_user.updated_by == admin_user.id
        assert admin_user.company_id == company_row.id

        assert owner_user.email == "owner@example.com"
        assert owner_user.is_admin is True
        assert owner_user.is_system is False
        assert owner_user.created_by == admin_user.id
        assert owner_user.updated_by == admin_user.id
        assert owner_user.company_id == company_row.id

        assert [role.name for role in roles] == list(_TEMPLATE_ROLE_NAMES)
        for role in roles:
            assert role.created_by == admin_user.id
            assert role.updated_by == admin_user.id
            has_permission_codes = (
                session.scalars(
                    select(RolePermission).where(
                        RolePermission.role_id == role.id
                    )
                ).first()
                is not None
            )
            assert not has_permission_codes

        assert _count(session, Company) == 1
        assert _count(session, User) == 2
        assert _count(session, Role) == 3
        assert _count(session, RolePermission) == 0

    def test_refuses_and_writes_nothing_when_already_initialized(
        self, session: Session
    ):
        initialize_system(
            session,
            company=CompanyInput(code="ACME", name="Acme Corp"),
            admin=_sample_admin_input(),
            owner=_sample_owner_input(),
        )
        session.commit()

        with pytest.raises(AlreadyInitializedError):
            initialize_system(
                session,
                company=CompanyInput(code="OTHER", name="Other Co"),
                admin=_sample_admin_input(
                    employee_no="B0001", email="second-admin@example.com"
                ),
                owner=_sample_owner_input(
                    employee_no="B0002", email="second-owner@example.com"
                ),
            )
        session.rollback()

        assert _count(session, Company) == 1
        assert _count(session, User) == 2
        assert _count(session, Role) == 3


class TestRun:
    def test_success_creates_company_admin_owner_and_roles(
        self, session_factory: sessionmaker[Session]
    ):
        exit_code = run(
            _make_reader(_valid_answers()), session_factory=session_factory
        )
        assert exit_code == 0

        with session_factory() as check:
            assert _count(check, Company) == 1
            assert _count(check, User) == 2
            assert _count(check, Role) == 3
            assert _count(check, RolePermission) == 0

            admin = check.scalars(
                select(User).where(User.is_system.is_(True))
            ).one()
            owner = check.scalars(
                select(User).where(
                    User.is_system.is_(False), User.is_admin.is_(True)
                )
            ).one()
            assert admin.email == "admin@example.com"
            assert owner.email == "owner@example.com"
            assert owner.created_by == admin.id
            assert owner.updated_by == admin.id

            role_names = {
                role.name for role in check.scalars(select(Role)).all()
            }
            assert role_names == set(_TEMPLATE_ROLE_NAMES)

    def test_duplicate_email_fails_and_writes_nothing(
        self, session_factory: sessionmaker[Session]
    ):
        answers = _valid_answers(owner_email="admin@example.com")
        exit_code = run(_make_reader(answers), session_factory=session_factory)
        assert exit_code == 1

        with session_factory() as check:
            assert _count(check, Company) == 0
            assert _count(check, User) == 0
            assert _count(check, Role) == 0

    def test_invalid_email_format_fails_and_writes_nothing(
        self, session_factory: sessionmaker[Session]
    ):
        answers = _valid_answers(owner_email="owner-without-at-sign")
        exit_code = run(_make_reader(answers), session_factory=session_factory)
        assert exit_code == 1

        with session_factory() as check:
            assert _count(check, Company) == 0
            assert _count(check, User) == 0
            assert _count(check, Role) == 0

    def test_second_run_reports_already_initialized_without_prompting(
        self, session_factory: sessionmaker[Session]
    ):
        first_exit_code = run(
            _make_reader(_valid_answers()), session_factory=session_factory
        )
        assert first_exit_code == 0

        second_exit_code = run(
            _forbidden_reader,
            session_factory=session_factory,
        )
        assert second_exit_code == 0

        with session_factory() as check:
            assert _count(check, Company) == 1
            assert _count(check, User) == 2
            assert _count(check, Role) == 3
            admin = check.scalars(
                select(User).where(User.is_system.is_(True))
            ).one()
            assert admin.email == "admin@example.com"


class TestMain:
    def test_uses_builtin_input_and_the_shared_engine(
        self,
        migrated_url: str,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """``main`` (unlike ``run`` in the tests above) takes no
        ``session_factory`` override, so this is the one test
        proving the real wiring -- the shared engine
        (``app.db.engine.get_session_factory``) and the plain
        ``input`` builtin -- actually works end to end.
        """
        answers = _valid_answers()

        def _fake_input(prompt: str = "") -> str:
            return answers.pop(0)

        monkeypatch.setattr("builtins.input", _fake_input)

        exit_code = main()
        assert exit_code == 0

        with get_session_factory()() as check:
            assert _count(check, Company) == 1
            assert _count(check, User) == 2
            assert _count(check, Role) == 3
