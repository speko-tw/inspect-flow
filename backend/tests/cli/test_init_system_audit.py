"""Test that the initialization command writes no audit records
(ALG-AC08, ALG-R12).

Builds a temporary SQLite database migrated to head through the
real Alembic chain (same approach as
``backend/tests/cli/test_init_system.py``), runs the initialization
command's success case end to end, and checks ``audit_logs`` is
still empty afterwards -- not because nothing was written at all
(a vacuous pass), but despite the command having actually created a
company, two users and the three template roles.
"""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.cli.init_system import InputReader, run
from app.db.engine import create_engine_from_settings, dispose_engine
from app.db.settings import DATABASE_URL_ENV_VAR
from app.models import AuditLog, Company, Role, User

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


def _count(session: Session, model: type) -> int:
    return len(session.scalars(select(model)).all())


def _valid_answers() -> list[str]:
    """Answers in the exact order ``run`` prompts for them: the
    company's ``code``/``name``, then the admin account's six
    DOM-R01 fields, then the owner account's six DOM-R01 fields.
    Demo values only (no real company name).
    """
    return [
        "ACME",
        "Acme Corp",
        "IT",
        "HQ",
        "A0001",
        "System Admin",
        "系統管理員",
        "admin@example.com",
        "Management",
        "Branch",
        "A0002",
        "Owner Person",
        "負責人",
        "owner@example.com",
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


class TestInitializationWritesNoAuditRecords:
    def test_success_case_writes_no_audit_records(
        self, session_factory: sessionmaker[Session]
    ):
        exit_code = run(
            _make_reader(_valid_answers()), session_factory=session_factory
        )
        assert exit_code == 0

        with session_factory() as check:
            # DOM-AC08's success case actually happened -- guards
            # against a vacuous "0 audit records" pass.
            assert _count(check, Company) == 1
            assert _count(check, User) == 2
            assert _count(check, Role) == 3

            assert _count(check, AuditLog) == 0

    def test_already_initialized_case_also_writes_no_audit_records(
        self,
        session_factory: sessionmaker[Session],
        capsys: pytest.CaptureFixture[str],
    ):
        first_exit_code = run(
            _make_reader(_valid_answers()), session_factory=session_factory
        )
        assert first_exit_code == 0

        capsys.readouterr()
        second_exit_code = run(
            _forbidden_reader,
            session_factory=session_factory,
        )
        assert second_exit_code == 0
        assert "系統已初始化，未寫入任何資料。" in capsys.readouterr().out

        with session_factory() as check:
            assert _count(check, Company) == 1
            assert _count(check, User) == 2
            assert _count(check, Role) == 3

            assert _count(check, AuditLog) == 0
