"""Tests for migration ``e4b7a1c95d20`` (account redesign): the
upgrade/downgrade round trip, and the backfill and duplicate-name
rules of DOM-R54 / DOM-Q9 (DOM-AC45).

The database is stopped at the previous head (``c1a8e5d13f62``),
filled with old-shape rows through raw SQL (the ORM models describe
the *new* schema), then upgraded. Every write goes through
SQLAlchemy Core, so the same tests run on SQLite and PostgreSQL.
"""

import re
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Connection, Engine, inspect, text

from alembic import command
from app.db.base import uuid7
from app.db.engine import create_engine_from_settings, dispose_engine

_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"

_OLD_HEAD = "c1a8e5d13f62"
_NEW_HEAD = "325e0f21a831"
_NEW_PARENT = "e4b7a1c95d20"

_USERNAME_FORMAT = re.compile(r"[a-z][a-z0-9._-]{2,31}")


def _cfg() -> Config:
    return Config(str(_ALEMBIC_INI))


@pytest.fixture(autouse=True)
def _dispose_shared_engine() -> Generator[None, None, None]:
    dispose_engine()
    try:
        yield
    finally:
        dispose_engine()


@pytest.fixture
def engine(db_url) -> Generator[Engine, None, None]:
    """An engine on a database migrated to the *old* head."""
    command.upgrade(_cfg(), _OLD_HEAD)
    eng = create_engine_from_settings(db_url)
    try:
        yield eng
    finally:
        eng.dispose()


def _stamp(day: int) -> str:
    return datetime(2026, 1, day, tzinfo=UTC).isoformat()


class _Legacy:
    """Inserts old-shape rows, oldest first by ``day``."""

    def __init__(self, conn: Connection) -> None:
        self.conn = conn
        self.admin_id = uuid7()
        self._next_day = 1

    def _params(self, **kw) -> dict:
        day = self._next_day
        self._next_day += 1
        return {
            "now": _stamp(day),
            "admin": self.admin_id.hex,
            **{k: v.hex if hasattr(v, "hex") else v for k, v in kw.items()},
        }

    def user(
        self,
        *,
        email: str,
        company,
        employee_no: str,
        is_system: bool = False,
        user_id=None,
    ):
        user_id = user_id or uuid7()
        self.conn.execute(
            text(
                "INSERT INTO users (id, employee_no, company_id, "
                "department, location, name_en, name_zh, email, "
                "is_admin, is_system, created_at, updated_at, "
                "created_by, updated_by) VALUES (:id, :eno, :company, "
                "'Dept', 'Loc', 'Name', '姓名', :email, :is_admin, "
                ":is_system, :now, :now, :admin, :admin)"
            ),
            self._params(
                id=user_id,
                eno=employee_no,
                company=company,
                email=email,
                is_admin=is_system,
                is_system=is_system,
            ),
        )
        return user_id

    def company(self, *, name: str, kind: str = "customer"):
        company_id = uuid7()
        self.conn.execute(
            text(
                "INSERT INTO companies (id, code, name, kind, tax_id, "
                "is_active, created_at, updated_at, created_by, "
                "updated_by) VALUES (:id, :code, :name, :kind, "
                ":tax_id, :active, :now, :now, :admin, :admin)"
            ),
            self._params(
                id=company_id,
                code=f"C{self._next_day:03d}",
                name=name,
                kind=kind,
                # ``tax_id`` is unique in the old schema.
                tax_id=f"{self._next_day:08d}",
                active=True,
            ),
        )
        return company_id


def _seed(engine: Engine, emails: list[str], company_names: list[str]):
    """The built-in admin (with a company and names, as the old
    schema required) plus one ordinary user per email, all in the
    first company. Returns ``(company_ids, user_ids)``.
    """
    with engine.begin() as conn:
        legacy = _Legacy(conn)
        # ``users.company_id`` is deferred, so the admin (its own
        # creator) goes in before the company that names it.
        first_company = uuid7()
        legacy.user(
            email="builtin@x.example",
            company=first_company,
            employee_no="A0",
            is_system=True,
            user_id=legacy.admin_id,
        )
        company_ids = []
        for name in company_names:
            company_ids.append(legacy.company(name=name))
        # Re-point the admin at a real company: the placeholder id
        # above was only there to satisfy NOT NULL before any
        # company existed.
        conn.execute(
            text("UPDATE users SET company_id = :c WHERE id = :u"),
            {"c": company_ids[0].hex, "u": legacy.admin_id.hex},
        )
        user_ids = [
            legacy.user(
                email=email,
                company=company_ids[0],
                employee_no=f"E{i}",
            )
            for i, email in enumerate(emails)
        ]
    return company_ids, user_ids


def _usernames(engine: Engine) -> list[str]:
    with engine.connect() as conn:
        return [
            row[0]
            for row in conn.execute(
                text(
                    "SELECT username FROM users "
                    "WHERE NOT is_system ORDER BY created_at"
                )
            )
        ]


class TestRoundTrip:
    def test_upgrade_downgrade_upgrade_on_an_empty_database(self, db_url):
        cfg = _cfg()
        command.upgrade(cfg, "head")
        command.downgrade(cfg, _OLD_HEAD)

        eng = create_engine_from_settings(db_url)
        try:
            inspector = inspect(eng)
            assert "setup_codes" not in inspector.get_table_names()
            user_columns = {c["name"] for c in inspector.get_columns("users")}
            company_columns = {
                c["name"] for c in inspector.get_columns("companies")
            }
        finally:
            eng.dispose()
        assert "username" not in user_columns
        assert {"code", "tax_id", "kind", "parent_id"} <= company_columns

        command.upgrade(cfg, "head")
        eng = create_engine_from_settings(db_url)
        try:
            inspector = inspect(eng)
            assert "setup_codes" in inspector.get_table_names()
            assert "username" in {
                c["name"] for c in inspector.get_columns("users")
            }
            assert "code" not in {
                c["name"] for c in inspector.get_columns("companies")
            }
        finally:
            eng.dispose()

    def test_account_migration_remains_in_single_chain(self):
        from alembic.script import ScriptDirectory

        script = ScriptDirectory.from_config(_cfg())
        assert len(script.get_heads()) == 1
        assert _NEW_HEAD in {row.revision for row in script.walk_revisions()}
        revision = script.get_revision(_NEW_HEAD)
        assert revision is not None
        assert revision.down_revision == _NEW_PARENT

    def test_rows_survive_the_round_trip(self, db_url, engine):
        _seed(
            engine,
            ["Anna.Deng@x.example", "bob@x.example"],
            ["Demo Co", "Other Co"],
        )
        cfg = _cfg()
        command.upgrade(cfg, "head")
        first = _usernames(engine)
        command.downgrade(cfg, _OLD_HEAD)
        command.upgrade(cfg, "head")

        assert _usernames(engine) == first == ["anna.deng", "bob"]

        with engine.connect() as conn:
            names = [
                r[0]
                for r in conn.execute(
                    text("SELECT name FROM companies ORDER BY created_at")
                )
            ]
        # The placeholder company created by the downgrade for the
        # built-in admin is kept as an ordinary company.
        assert names[:2] == ["Demo Co", "Other Co"]

    def test_downgrade_fills_what_the_old_schema_requires(
        self, db_url, engine
    ):
        _seed(engine, ["Anna.Deng@x.example"], ["Demo Co", "Other Co"])
        cfg = _cfg()
        command.upgrade(cfg, "head")
        command.downgrade(cfg, _OLD_HEAD)

        with engine.connect() as conn:
            admin = conn.execute(
                text(
                    "SELECT company_id, department, location, name_en, "
                    "name_zh, email, employee_no FROM users "
                    "WHERE is_system"
                )
            ).one()
            kinds = [
                r[0]
                for r in conn.execute(
                    text("SELECT kind FROM companies ORDER BY created_at")
                )
            ]
        # The old schema required all of these; none may be NULL.
        assert all(value is not None for value in admin)
        # The oldest company is the internal one, the rest customers.
        assert kinds[0] == "internal"
        assert set(kinds[1:]) == {"customer"}

    def test_downgrade_avoids_existing_placeholder_emails(
        self, db_url, engine
    ):
        _seed(
            engine,
            ["Admin@UNKNOWN.INVALID", "admin2@unknown.invalid"],
            ["Demo Co"],
        )
        cfg = _cfg()
        command.upgrade(cfg, "head")
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET email = NULL WHERE is_system"))

        command.downgrade(cfg, _OLD_HEAD)
        with engine.connect() as conn:
            emails = conn.execute(
                text("SELECT email, is_system FROM users")
            ).all()
        assert {email for email, is_system in emails if is_system} == {
            "admin3@unknown.invalid"
        }
        assert len({email.lower() for email, _ in emails}) == len(emails)

        command.upgrade(cfg, "head")
        with engine.connect() as conn:
            admin_email = conn.execute(
                text("SELECT email FROM users WHERE is_system")
            ).scalar_one()
        assert admin_email == "admin3@unknown.invalid"


class TestDomAc45BackfillOnExistingData:
    """DOM-AC45: the built-in admin becomes ``admin`` with no company
    or names; other users get their email prefix, lowercased and
    made unique; ``companies`` loses its four columns.
    """

    def test_spec_example(self, db_url, engine):
        _seed(
            engine,
            [
                "Anna.Deng@x.example",
                "anna.deng@y.example",
                "bob@x.example",
            ],
            ["Demo Co", "Old Co"],
        )
        command.upgrade(_cfg(), "head")

        with engine.connect() as conn:
            admin = conn.execute(
                text(
                    "SELECT username, company_id, department, location, "
                    "employee_no, name_zh, name_en, is_admin FROM users "
                    "WHERE is_system"
                )
            ).one()
            company_names = {
                r[0] for r in conn.execute(text("SELECT name FROM companies"))
            }
        assert admin.username == "admin"
        assert admin.company_id is None
        assert admin.department is None
        assert admin.location is None
        assert admin.employee_no is None
        assert admin.name_zh is None
        assert admin.name_en is None
        assert bool(admin.is_admin) is True

        usernames = _usernames(engine)
        assert usernames[0] == "anna.deng"
        assert usernames[1] != "anna.deng"
        assert usernames[1].startswith("anna.deng")
        assert usernames[1][len("anna.deng") :].isdigit()
        assert usernames[2] == "bob"
        assert len(set(usernames)) == 3
        assert all(_USERNAME_FORMAT.fullmatch(u) for u in usernames)

        assert {"Demo Co", "Old Co"} <= company_names
        columns = {c["name"] for c in inspect(engine).get_columns("companies")}
        assert columns == {
            "id",
            "name",
            "is_active",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
        }


class TestDomQ9BackfillRules:
    """The rules DOM-R54 leaves to the migration (documented in the
    migration's docstring): unusable email prefixes, reserved words,
    duplicates, and duplicate company names.
    """

    @pytest.mark.parametrize(
        ("email", "expected"),
        [
            ("a@x.example", "a00"),
            ("ab@x.example", "ab0"),
            ("1abc@x.example", "u1abc"),
            ("_abc@x.example", "u_abc"),
            ("carol+tag@x.example", "carol_tag"),
            ("Bob.Lee_2-x@x.example", "bob.lee_2-x"),
            ("root@x.example", "root2"),
            ("system@x.example", "system2"),
            ("admin@y.example", "admin2"),
            ("x" * 40 + "@x.example", "x" * 28),
        ],
    )
    def test_single_email_prefix_rule(self, db_url, engine, email, expected):
        _seed(engine, [email], ["Demo Co"])
        command.upgrade(_cfg(), "head")

        assert _usernames(engine) == [expected]

    def test_duplicates_get_the_smallest_free_number_oldest_first(
        self, db_url, engine
    ):
        _seed(
            engine,
            [
                "bob@x.example",
                "BOB@y.example",
                "bob@z.example",
                "bob2@x.example",
            ],
            ["Demo Co"],
        )
        command.upgrade(_cfg(), "head")

        # Rows are handled oldest first: the plain name goes to the
        # first, then ``bob2``, ``bob3``; the fourth user's own
        # prefix (``bob2``) is already taken, so it gets a number.
        names = _usernames(engine)
        assert names[0] == "bob"
        assert names[1] == "bob2"
        assert names[2] == "bob3"
        assert names[3] not in {"bob", "bob2", "bob3"}
        assert len(set(names)) == 4

    def test_prefix_that_collides_with_the_builtin_admin_gets_a_number(
        self, db_url, engine
    ):
        _seed(engine, ["admin@x.example"], ["Demo Co"])
        command.upgrade(_cfg(), "head")

        assert _usernames(engine) == ["admin2"]

    def test_duplicate_and_blank_company_names(self, db_url, engine):
        _seed(
            engine,
            [],
            ["Demo Co", "demo co ", " DEMO CO", "Other Co", "   "],
        )
        command.upgrade(_cfg(), "head")

        with engine.connect() as conn:
            names = [
                r[0]
                for r in conn.execute(
                    text("SELECT name FROM companies ORDER BY created_at")
                )
            ]
        # Oldest keeps its name; later case/whitespace variants get a
        # numbered suffix; a blank name becomes ``Company``.
        assert names == [
            "Demo Co",
            "demo co (2)",
            "DEMO CO (3)",
            "Other Co",
            "Company",
        ]
        assert len({n.lower() for n in names}) == len(names)
