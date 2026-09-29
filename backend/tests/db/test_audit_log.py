"""Tests for the ``audit_logs`` table and its append-only guard
(``docs/specs/audit-log/spec.md`` T1, issue #215).

AC labels below follow that spec's numbering:

- ALG-AC01: table structure -- every ``ALG-R01`` column present with
  the right nullability, UUID primary key, ``created_by`` foreign
  key, and no ``updated_at``/``updated_by`` (ALG-R02).
- ALG-AC02: ``created_by`` is the table's only foreign key;
  ``entity_id`` is not one (ALG-R03), so it accepts a UUID that
  matches no row anywhere.
- ALG-AC03: every ``UPDATE``/``DELETE`` reaching ``audit_logs`` --
  from an ORM flush, an ORM/Core bulk statement, or raw ``text()``
  SQL in any of the spellings the spec lists, plus a few cheap-to-add
  ones beyond it (a leading SQL comment, SQLite's ``UPDATE OR
  <algorithm>`` clause, PostgreSQL's ``ONLY``) -- is rejected and
  leaves the table unchanged, while ``INSERT``/``SELECT`` against
  ``audit_logs`` and any statement against another table still work.
  Issue #233 extends this to every other shape that modifies an
  existing row or removes all of them: ``TRUNCATE``, SQLite's
  ``REPLACE INTO``/``INSERT OR REPLACE INTO``, the
  ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert, and a ``WITH``
  (CTE) statement wrapping any of the above -- while
  ``ON CONFLICT DO NOTHING`` and a plain ``INSERT`` still work, and a
  CTE that is merely read from is not blocked. See
  ``app/models/audit_log.py``'s module docstring for the residual
  "Known limitations" issue #233 leaves undetected.

Same fixture pattern as ``test_role_member.py``/``test_company.py``:
migrates the database behind ``conftest.py``'s ``db_url`` fixture
with the real Alembic migration chain, then reads and writes it
exclusively through SQLAlchemy (DBF-R01). Runs against SQLite by
default and against PostgreSQL under ``--db-backend=postgresql``
(spec.md requires ALG-AC01~ALG-AC03 to pass on both).
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import Engine, bindparam, delete, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.types import JSON, Uuid

from alembic import command
from app.db import clock
from app.db.base import UTCDateTime, uuid7
from app.db.engine import create_engine_from_settings, dispose_engine
from app.models import AuditLog, User
from app.models.audit_log import AuditLogImmutableError, _targets_audit_logs
from tests.db.conftest import create_root_user_with_company

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
    """A ``User`` to use as ``created_by`` for ``AuditLog`` rows in
    these tests -- not itself under test.
    """
    user = create_root_user_with_company(session, "E920")
    session.commit()
    return user


def _new_log(operator: User, **kwargs) -> AuditLog:
    kwargs.setdefault("created_by", operator.id)
    kwargs.setdefault("event_type", "role.created")
    kwargs.setdefault("entity_type", "role")
    kwargs.setdefault("entity_id", uuid7())
    kwargs.setdefault("before", None)
    kwargs.setdefault("after", {"name": "Inspector"})
    return AuditLog(**kwargs)


def _read_all_audit_log_rows(engine: Engine) -> list[tuple]:
    """Read every column of every ``audit_logs`` row through a
    brand-new ``Connection`` opened just for this call, never the
    ``Session``/``Connection`` under test in the caller: proves a
    rejected write left the table unchanged using evidence that
    cannot be explained away by ORM identity-map caching or a
    not-yet-rolled-back transaction still being visible to the same
    session. Includes every column (notably ``created_at``, which
    an earlier version of this fixture omitted).
    """
    with engine.connect() as conn:
        rows = conn.execute(
            select(AuditLog.__table__).order_by(AuditLog.__table__.c.id)
        ).all()
    return sorted(tuple(row) for row in rows)


def test_migration_registers_audit_logs_table(migrated_url):
    """Guards ``app/models/__init__.py`` actually importing
    ``audit_log`` -- a missing import would leave the table off
    ``Base.metadata`` and this migration would never have matched
    it.
    """
    engine = create_engine_from_settings(migrated_url)
    try:
        table_names = inspect(engine).get_table_names()
    finally:
        engine.dispose()

    assert "audit_logs" in table_names


def test_migration_round_trip_with_explicit_revisions(db_url):
    """Migration round trip using this revision's own explicit id
    and its parent's, not a relative writing like ``-1``/``head``/
    ``base``: upgrades straight to ``4c38ff477939`` (this table's
    migration), downgrades one step to its parent ``710e91fda9cd``
    and checks ``audit_logs`` is gone while an earlier table
    survives, then upgrades back to ``4c38ff477939`` and checks
    ``audit_logs`` is back. ``test_migrations.py`` already covers
    the whole chain's ``base``/``head`` round trip; this is specific
    to the one step this migration adds.
    """
    cfg = _alembic_config()

    command.upgrade(cfg, "4c38ff477939")
    engine = create_engine_from_settings(db_url)
    try:
        assert "audit_logs" in inspect(engine).get_table_names()
    finally:
        engine.dispose()

    command.downgrade(cfg, "710e91fda9cd")
    engine = create_engine_from_settings(db_url)
    try:
        table_names = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()
    assert "audit_logs" not in table_names
    assert {"users", "roles", "project_members"} <= table_names

    command.upgrade(cfg, "4c38ff477939")
    engine = create_engine_from_settings(db_url)
    try:
        assert "audit_logs" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


class TestTableStructure:
    """ALG-AC01, ALG-AC02."""

    def test_columns_pk_and_nullability(self, engine):
        inspector = inspect(engine)

        pk = inspector.get_pk_constraint("audit_logs")
        assert pk["constrained_columns"] == ["id"]

        columns = {
            col["name"]: col for col in inspector.get_columns("audit_logs")
        }
        expected = {
            "id",
            "created_at",
            "created_by",
            "event_type",
            "entity_type",
            "entity_id",
            "before",
            "after",
        }
        assert expected <= columns.keys()
        assert "updated_at" not in columns
        assert "updated_by" not in columns

        assert columns["created_at"]["nullable"] is False
        assert columns["created_by"]["nullable"] is False
        assert columns["event_type"]["nullable"] is False
        assert columns["entity_type"]["nullable"] is False
        assert columns["entity_id"]["nullable"] is False
        assert columns["before"]["nullable"] is True
        assert columns["after"]["nullable"] is True

    def test_created_by_is_the_only_foreign_key(self, engine):
        """ALG-AC02: ``entity_id`` is not a foreign key (ALG-R03)."""
        foreign_keys = inspect(engine).get_foreign_keys("audit_logs")
        references = {
            fk["constrained_columns"][0]: (
                fk["referred_table"],
                fk["referred_columns"],
            )
            for fk in foreign_keys
        }
        assert references == {"created_by": ("users", ["id"])}

    def test_full_row_insert_succeeds(self, session, operator):
        log = _new_log(operator)
        session.add(log)
        session.commit()

        fetched = session.get(AuditLog, log.id)
        assert fetched is not None
        assert fetched.created_by == operator.id
        assert fetched.event_type == "role.created"
        assert fetched.entity_type == "role"
        assert fetched.before is None
        assert fetched.after == {"name": "Inspector"}

    @pytest.mark.parametrize(
        "field", ["created_by", "event_type", "entity_type", "entity_id"]
    )
    def test_required_field_null_is_rejected(self, session, operator, field):
        before = session.query(AuditLog).count()
        kwargs = {field: None}
        session.add(_new_log(operator, **kwargs))

        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(AuditLog).count() == before

    def test_created_by_pointing_to_nonexistent_user_is_rejected(
        self, session, operator
    ):
        before = session.query(AuditLog).count()
        session.add(_new_log(operator, created_by=uuid7()))

        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        assert session.query(AuditLog).count() == before

    def test_entity_id_pointing_to_nothing_is_accepted(
        self, session, operator
    ):
        """ALG-AC02: ``entity_id`` is only a UUID value, never
        validated against any table, so a value matching no row
        anywhere is still accepted.
        """
        log = _new_log(operator, entity_id=uuid7())
        session.add(log)
        session.commit()

        assert session.get(AuditLog, log.id) is not None


class TestRegexMatchesOnlyAuditLogsTable:
    """Unit tests for ``_targets_audit_logs`` itself (no database):
    proves the append-only guard's matching rule directly, including
    the "same-prefix but different table" case
    (``audit_logs_x``) called out in plan.md's risk section, without
    needing a second real table in the database just to exercise it.
    """

    @pytest.mark.parametrize(
        "statement",
        [
            "UPDATE audit_logs SET entity_type = 'x'",
            "UPDATE \"audit_logs\" SET entity_type = 'x'",
            "UPDATE main.audit_logs SET entity_type = 'x'",
            "UPDATE public.audit_logs SET entity_type = 'x'",
            "uPdAtE AUDIT_LOGS SET entity_type = 'x'",
            "\n\n   UPDATE audit_logs SET entity_type = 'x'",
            "DELETE FROM audit_logs",
            'DELETE FROM "audit_logs"',
            "DELETE FROM main.audit_logs",
            "DELETE FROM public.audit_logs",
            "dElEtE FrOm AUDIT_LOGS",
            "\n   DELETE FROM audit_logs",
            # A leading SQL comment (line or block, possibly more
            # than one) before the real keyword.
            "-- a comment\nUPDATE audit_logs SET entity_type = 'x'",
            "/* a comment */ DELETE FROM audit_logs",
            "-- one\n-- two\nUPDATE audit_logs SET entity_type = 'x'",
            "/* one */ /* two */ DELETE FROM audit_logs",
            # SQLite's ``UPDATE OR <algorithm>`` conflict-resolution
            # clause (UPDATE only -- SQLite has no ``DELETE OR``).
            "UPDATE OR REPLACE audit_logs SET entity_type = 'x'",
            "UPDATE OR ROLLBACK audit_logs SET entity_type = 'x'",
            "UPDATE OR ABORT audit_logs SET entity_type = 'x'",
            "UPDATE OR FAIL audit_logs SET entity_type = 'x'",
            "UPDATE OR IGNORE audit_logs SET entity_type = 'x'",
            # PostgreSQL's ``ONLY`` (excludes descendant partitions/
            # inheriting tables from the statement).
            "UPDATE ONLY audit_logs SET entity_type = 'x'",
            "DELETE FROM ONLY audit_logs",
            # A statement terminator or end-of-string right after the
            # bare table name is still a valid boundary (regression:
            # must not be broken by the boundary check added for
            # ``audit_logs$archive`` below).
            "UPDATE audit_logs;",
            "DELETE FROM audit_logs",
        ],
    )
    def test_matches_every_blocked_spelling(self, statement):
        assert _targets_audit_logs(statement) is True

    @pytest.mark.parametrize(
        "statement",
        [
            "INSERT INTO audit_logs (id) VALUES ('x')",
            "SELECT * FROM audit_logs",
            "UPDATE audit_logs_x SET entity_type = 'x'",
            "UPDATE \"audit_logs_x\" SET entity_type = 'x'",
            "DELETE FROM audit_logs_x",
            "UPDATE other_table SET entity_type = 'x'",
            "DELETE FROM users",
            "UPDATE users SET entity_type = 'audit_logs'",
            "-- a comment\nUPDATE users SET entity_type = 'x'",
            "UPDATE OR REPLACE audit_logs_x SET entity_type = 'x'",
            "UPDATE ONLY audit_logs_x SET entity_type = 'x'",
            "UPDATE ONLY users SET entity_type = 'x'",
            # Regression: an unquoted table name sharing the
            # ``audit_logs`` prefix but continuing with a character
            # outside this module's identifier class (``$``, a
            # non-ASCII letter) is a different table, not
            # ``audit_logs`` truncated -- a reviewer caught this
            # actually mis-firing against a real SQLite database.
            "UPDATE audit_logs$archive SET entity_type = 'x'",
            "DELETE FROM audit_logs$archive",
            "UPDATE audit_logs中 SET entity_type = 'x'",
            "DELETE FROM audit_logs中",
            # A quoted name never had this problem (its contents are
            # read verbatim to the closing quote), kept here as the
            # same regression's quoted-name counterpart.
            "UPDATE \"audit_logs$archive\" SET entity_type = 'x'",
        ],
    )
    def test_does_not_match_other_statements(self, statement):
        assert _targets_audit_logs(statement) is False


class TestRegexMatchesUpsertReplaceTruncateAndCte:
    """Unit tests for ``_targets_audit_logs`` (no database) covering
    issue #233's additions: upsert, ``REPLACE``, ``TRUNCATE``, and
    CTE-wrapped writes.
    """

    @pytest.mark.parametrize(
        "statement",
        [
            # INSERT ... ON CONFLICT ... DO UPDATE (PostgreSQL and
            # SQLite share this syntax).
            "INSERT INTO audit_logs (id) VALUES ('x') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
            "insert into audit_logs (id) values ('x') "
            "on conflict (id) do update set entity_type = 'x'",
            "INSERT INTO audit_logs (id) VALUES ('a'), ('b') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
            "INSERT INTO \"audit_logs\" (id) VALUES ('x') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
            "INSERT INTO public.audit_logs (id) VALUES ('x') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
            # SQLite's REPLACE INTO / INSERT OR REPLACE INTO.
            "REPLACE INTO audit_logs (id) VALUES ('x')",
            "INSERT OR REPLACE INTO audit_logs (id) VALUES ('x')",
            "insert or replace into audit_logs (id) values ('x')",
            "REPLACE INTO \"audit_logs\" (id) VALUES ('x')",
            # TRUNCATE, including a table list and PostgreSQL's ONLY.
            "TRUNCATE audit_logs",
            "TRUNCATE TABLE audit_logs",
            "TRUNCATE ONLY audit_logs",
            "TRUNCATE TABLE ONLY audit_logs",
            "TRUNCATE users, audit_logs",
            "TRUNCATE TABLE audit_logs, users",
            "truncate AUDIT_LOGS",
            'TRUNCATE "audit_logs"',
            "TRUNCATE public.audit_logs",
            # A CTE wrapping a mutation, either as the CTE's own body
            # (a PostgreSQL data-modifying CTE) or as the primary
            # statement the CTE list feeds.
            "WITH t AS (SELECT 1) UPDATE audit_logs SET entity_type = 'x'",
            "WITH t AS (SELECT 1) DELETE FROM audit_logs",
            "WITH t AS (DELETE FROM audit_logs RETURNING id) SELECT * FROM t",
            "WITH t AS (UPDATE audit_logs SET entity_type = 'x' "
            "RETURNING id) SELECT * FROM t",
            "WITH RECURSIVE t AS (DELETE FROM audit_logs RETURNING id) "
            "SELECT * FROM t",
            "WITH a AS (SELECT 1), t AS (DELETE FROM audit_logs) "
            "SELECT * FROM t",
            "WITH t AS (SELECT 1) TRUNCATE audit_logs",
            "WITH t AS (SELECT 1) REPLACE INTO audit_logs (id) VALUES ('x')",
            # A comment between the mutating keyword and the table
            # name (ALG-AC03's "關鍵字與表名之間夾註解" case), for
            # each newly-covered shape.
            "TRUNCATE /* c */ audit_logs",
            "REPLACE INTO -- c\naudit_logs (id) VALUES ('x')",
            "INSERT INTO /* c */ audit_logs (id) VALUES ('x') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
        ],
    )
    def test_matches_every_blocked_spelling(self, statement):
        assert _targets_audit_logs(statement) is True

    @pytest.mark.parametrize(
        "statement",
        [
            # ON CONFLICT DO NOTHING and a plain INSERT must never
            # be blocked.
            "INSERT INTO audit_logs (id) VALUES ('x') "
            "ON CONFLICT (id) DO NOTHING",
            "INSERT INTO audit_logs (id) VALUES ('x')",
            # A value's own literal text containing the phrase this
            # module searches for must not cause a false positive:
            # the VALUES tuple is skipped whole before searching for
            # a real ON CONFLICT clause.
            "INSERT INTO audit_logs (id, after) VALUES "
            "('x', 'on conflict do update, then on conflict do "
            "nothing') ON CONFLICT (id) DO NOTHING",
            "INSERT INTO audit_logs (id, after) VALUES "
            "('x', 'contains on conflict do update text')",
            # INSERT OR <algorithm> other than REPLACE never
            # overwrites an existing row.
            "INSERT OR IGNORE INTO audit_logs (id) VALUES ('x')",
            "INSERT OR ROLLBACK INTO audit_logs (id) VALUES ('x')",
            "INSERT OR ABORT INTO audit_logs (id) VALUES ('x')",
            "INSERT OR FAIL INTO audit_logs (id) VALUES ('x')",
            # A different, same-prefix table is never mistaken for
            # audit_logs by any of the new matchers.
            "TRUNCATE audit_logs_x",
            "TRUNCATE TABLE audit_logs$archive",
            "REPLACE INTO audit_logs_x (id) VALUES ('x')",
            "INSERT INTO audit_logs_x (id) VALUES ('x') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'x'",
            "TRUNCATE other_table",
            "TRUNCATE users, other_table",
            # A CTE that is only read from -- no mutation anywhere in
            # its body or in the primary statement -- is not blocked.
            "WITH t AS (SELECT * FROM audit_logs) SELECT * FROM t",
            "WITH t AS (SELECT * FROM users) "
            "SELECT * FROM t JOIN audit_logs ON t.id = audit_logs.id",
        ],
    )
    def test_does_not_match_other_statements(self, statement):
        assert _targets_audit_logs(statement) is False


class TestAppendOnlyGuard:
    """ALG-AC03: 19 blocked writes (4 ORM, 2 Core, 13 ``text()`` --
    the spec's own 10 spellings plus a leading SQL comment and
    SQLite's ``UPDATE OR IGNORE`` conflict clause each for UPDATE/
    DELETE where applicable), plus proof that inserts, reads, and
    writes to other tables are never mistakenly blocked.
    """

    @pytest.fixture
    def existing_log(self, session, operator) -> AuditLog:
        log = _new_log(operator)
        session.add(log)
        session.commit()
        return log

    @pytest.fixture
    def snapshot(self, engine, existing_log):
        """The full set of rows (every column, via a fresh
        ``Connection`` -- see :func:`_read_all_audit_log_rows`)
        before a blocked write is attempted, to prove content -- not
        only row count -- is unchanged afterwards. Deliberately does
        not depend on ``session``: reading through the same ORM
        session under test could look unchanged merely because nothing
        forced its identity map to refresh, which would prove nothing
        about what is actually stored.
        """

        def _read() -> list[tuple]:
            return _read_all_audit_log_rows(engine)

        return _read

    def test_orm_attribute_update_then_flush_is_rejected(
        self, session, existing_log, snapshot
    ):
        before = snapshot()
        existing_log.after = {"name": "Changed"}

        with pytest.raises(AuditLogImmutableError):
            session.flush()
        session.rollback()

        assert snapshot() == before

    def test_orm_delete_then_flush_is_rejected(
        self, session, existing_log, snapshot
    ):
        before = snapshot()
        session.delete(existing_log)

        with pytest.raises(AuditLogImmutableError):
            session.flush()
        session.rollback()

        assert snapshot() == before

    def test_orm_bulk_update_is_rejected(
        self, session, existing_log, snapshot
    ):
        before = snapshot()

        with pytest.raises(AuditLogImmutableError):
            session.execute(
                update(AuditLog)
                .where(AuditLog.id == existing_log.id)
                .values(entity_type="changed")
            )
        session.rollback()

        assert snapshot() == before

    def test_orm_bulk_delete_is_rejected(
        self, session, existing_log, snapshot
    ):
        before = snapshot()

        with pytest.raises(AuditLogImmutableError):
            session.execute(
                delete(AuditLog).where(AuditLog.id == existing_log.id)
            )
        session.rollback()

        assert snapshot() == before

    def test_core_update_is_rejected(self, engine, existing_log, snapshot):
        """ALG-AC03's Core ``update(audit_logs)``: a plain
        ``Connection.execute`` (no ``Session``/unit of work
        involved), unlike ``test_orm_bulk_update_is_rejected`` above.
        """
        before = snapshot()

        with engine.connect() as conn:
            with pytest.raises(AuditLogImmutableError):
                conn.execute(
                    update(AuditLog)
                    .where(AuditLog.id == existing_log.id)
                    .values(entity_type="changed")
                )
            conn.rollback()

        assert snapshot() == before

    def test_core_delete_is_rejected(self, engine, existing_log, snapshot):
        """ALG-AC03's Core ``delete(audit_logs)``: see
        ``test_core_update_is_rejected`` above.
        """
        before = snapshot()

        with engine.connect() as conn:
            with pytest.raises(AuditLogImmutableError):
                conn.execute(
                    delete(AuditLog).where(AuditLog.id == existing_log.id)
                )
            conn.rollback()

        assert snapshot() == before

    @staticmethod
    def _schema_prefix(engine: Engine) -> str:
        return "main" if engine.dialect.name == "sqlite" else "public"

    def _text_update_statements(self, engine: Engine) -> list[str]:
        schema = self._schema_prefix(engine)
        return [
            "UPDATE audit_logs SET entity_type = 'changed'",
            "UPDATE \"audit_logs\" SET entity_type = 'changed'",
            f"UPDATE {schema}.audit_logs SET entity_type = 'changed'",
            "uPdAtE AUDIT_LOGS SET entity_type = 'changed'",
            "\n\n   UPDATE audit_logs SET entity_type = 'changed'",
            # A leading SQL comment before the keyword.
            "-- audit-log guard test\n"
            "UPDATE audit_logs SET entity_type = 'changed'",
            # SQLite's ``UPDATE OR <algorithm>`` conflict clause.
            "UPDATE OR IGNORE audit_logs SET entity_type = 'changed'",
        ]

    def _text_delete_statements(self, engine: Engine) -> list[str]:
        schema = self._schema_prefix(engine)
        return [
            "DELETE FROM audit_logs",
            'DELETE FROM "audit_logs"',
            f"DELETE FROM {schema}.audit_logs",
            "dElEtE FrOm AUDIT_LOGS",
            "\n   DELETE FROM audit_logs",
            # A leading SQL comment before the keyword.
            "/* audit-log guard test */ DELETE FROM audit_logs",
        ]

    def test_text_updates_are_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_update_statements(engine):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def test_text_deletes_are_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_delete_statements(engine):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def _text_truncate_statements(self, engine: Engine) -> list[str]:
        schema = self._schema_prefix(engine)
        return [
            "TRUNCATE audit_logs",
            "TRUNCATE TABLE audit_logs",
            "TRUNCATE ONLY audit_logs",
            f"TRUNCATE TABLE {schema}.audit_logs",
            "truncate AUDIT_LOGS",
            "TRUNCATE users, audit_logs",
            # A leading SQL comment, and one between the keyword and
            # the table name.
            "-- audit-log guard test\nTRUNCATE audit_logs",
            "TRUNCATE /* audit-log guard test */ audit_logs",
        ]

    def _text_replace_statements(self, engine: Engine) -> list[str]:
        schema = self._schema_prefix(engine)
        return [
            "REPLACE INTO audit_logs (id) VALUES ('x')",
            "INSERT OR REPLACE INTO audit_logs (id) VALUES ('x')",
            f"REPLACE INTO {schema}.audit_logs (id) VALUES ('x')",
            "replace into AUDIT_LOGS (id) VALUES ('x')",
            # A comment between the keyword and the table name.
            "REPLACE INTO /* audit-log guard test */ audit_logs "
            "(id) VALUES ('x')",
        ]

    def _text_upsert_do_update_statements(
        self, engine: Engine, existing_id: str
    ) -> list[str]:
        schema = self._schema_prefix(engine)
        return [
            f"INSERT INTO audit_logs (id) VALUES ('{existing_id}') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'changed'",
            f"INSERT INTO {schema}.audit_logs (id) "
            f"VALUES ('{existing_id}') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'changed'",
            # A comment between INTO and the table name.
            f"INSERT INTO /* c */ audit_logs (id) "
            f"VALUES ('{existing_id}') "
            "ON CONFLICT (id) DO UPDATE SET entity_type = 'changed'",
        ]

    def _text_cte_mutation_statements(self, engine: Engine) -> list[str]:
        return [
            # The mutation as the primary statement a CTE feeds.
            "WITH t AS (SELECT 1) "
            "UPDATE audit_logs SET entity_type = 'changed'",
            "WITH t AS (SELECT 1) DELETE FROM audit_logs",
            # The mutation nested inside the CTE's own body
            # (PostgreSQL's data-modifying CTEs).
            "WITH t AS (DELETE FROM audit_logs RETURNING id) SELECT * FROM t",
        ]

    def test_text_truncate_is_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_truncate_statements(engine):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def test_text_replace_into_is_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_replace_statements(engine):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def test_text_upsert_do_update_is_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_upsert_do_update_statements(
            engine, existing_log.id.hex
        ):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def test_text_cte_mutation_is_all_rejected(
        self, engine, existing_log, snapshot
    ):
        before = snapshot()

        for statement in self._text_cte_mutation_statements(engine):
            with engine.connect() as conn:
                with pytest.raises(AuditLogImmutableError):
                    conn.execute(text(statement))
                conn.rollback()

        assert snapshot() == before

    def test_text_upsert_on_conflict_do_nothing_still_works(
        self, engine, operator, existing_log, snapshot
    ):
        """ALG-AC03/#233: ``ON CONFLICT ... DO NOTHING`` never
        modifies an existing row, so it must not be blocked -- here
        exercised against a real conflicting ``id`` (the insert is a
        no-op) to prove both that it is not rejected and that it
        genuinely leaves the row untouched (not merely that no
        exception was raised).
        """
        before = snapshot()

        insert_stmt = text(
            "INSERT INTO audit_logs "
            "(id, created_at, created_by, event_type, "
            "entity_type, entity_id, before, after) "
            "VALUES "
            "(:id, :created_at, :created_by, :event_type, "
            ":entity_type, :entity_id, :before, :after) "
            "ON CONFLICT (id) DO NOTHING"
        ).bindparams(
            bindparam("id", type_=Uuid),
            bindparam("created_at", type_=UTCDateTime),
            bindparam("created_by", type_=Uuid),
            bindparam("entity_id", type_=Uuid),
            bindparam("before", type_=JSON),
            bindparam("after", type_=JSON),
        )
        with engine.connect() as conn:
            conn.execute(
                insert_stmt,
                {
                    "id": existing_log.id,
                    "created_at": existing_log.created_at,
                    "created_by": operator.id,
                    "event_type": "role.updated",
                    "entity_type": "role",
                    "entity_id": uuid7(),
                    "before": None,
                    "after": {"name": "should-not-be-written"},
                },
            )
            conn.commit()

        assert snapshot() == before

    @pytest.mark.sqlite_only
    def test_insert_or_ignore_still_works(self, engine, operator):
        """SQLite's ``INSERT OR IGNORE`` (unlike ``INSERT OR
        REPLACE``) never overwrites an existing row, so it must not
        be blocked; used here as a plain insert (no real conflict).
        ``sqlite_only``: this syntax does not exist on PostgreSQL --
        the unit-level regex test already covers it not being
        blocked there too (the guard's check is dialect-agnostic).
        """
        before = len(_read_all_audit_log_rows(engine))
        new_id = uuid7()
        insert_stmt = text(
            "INSERT OR IGNORE INTO audit_logs "
            "(id, created_at, created_by, event_type, "
            "entity_type, entity_id, before, after) "
            "VALUES "
            "(:id, :created_at, :created_by, :event_type, "
            ":entity_type, :entity_id, :before, :after)"
        ).bindparams(
            bindparam("id", type_=Uuid),
            bindparam("created_at", type_=UTCDateTime),
            bindparam("created_by", type_=Uuid),
            bindparam("entity_id", type_=Uuid),
            bindparam("before", type_=JSON),
            bindparam("after", type_=JSON),
        )
        with engine.connect() as conn:
            conn.execute(
                insert_stmt,
                {
                    "id": new_id,
                    "created_at": clock.utc_now(),
                    "created_by": operator.id,
                    "event_type": "role.updated",
                    "entity_type": "role",
                    "entity_id": uuid7(),
                    "before": None,
                    "after": None,
                },
            )
            conn.commit()

        assert len(_read_all_audit_log_rows(engine)) == before + 1

    def test_text_insert_and_select_still_work(
        self, engine, operator, existing_log
    ):
        # Bound with explicit ``Uuid``/``UTCDateTime`` types (not
        # plain strings): the ``Uuid`` column type stores its value
        # in a backend-specific representation (SQLite: a 32-char
        # hex string with no dashes; PostgreSQL: its native ``uuid``
        # type) that neither DBAPI accepts as a raw Python
        # ``uuid.UUID`` object, so a raw ``text()`` write against a
        # ``Uuid``/``UTCDateTime`` column still needs SQLAlchemy's
        # own bind processing -- exactly like the ORM/Core paths
        # this same guard also covers.
        new_id = uuid7()
        insert_stmt = text(
            "INSERT INTO audit_logs "
            "(id, created_at, created_by, event_type, "
            "entity_type, entity_id, before, after) "
            "VALUES "
            "(:id, :created_at, :created_by, :event_type, "
            ":entity_type, :entity_id, :before, :after)"
        ).bindparams(
            bindparam("id", type_=Uuid),
            bindparam("created_at", type_=UTCDateTime),
            bindparam("created_by", type_=Uuid),
            bindparam("entity_id", type_=Uuid),
            bindparam("before", type_=JSON),
            bindparam("after", type_=JSON),
        )
        with engine.connect() as conn:
            conn.execute(
                insert_stmt,
                {
                    "id": new_id,
                    "created_at": existing_log.created_at,
                    "created_by": operator.id,
                    "event_type": "role.updated",
                    "entity_type": "role",
                    "entity_id": uuid7(),
                    "before": None,
                    "after": None,
                },
            )
            conn.commit()

            rows = conn.execute(text("SELECT id FROM audit_logs")).fetchall()

        assert len(rows) == 2

    def test_orm_insert_still_works(self, session, operator, existing_log):
        before = session.query(AuditLog).count()

        session.add(_new_log(operator, event_type="role.deleted"))
        session.commit()

        assert session.query(AuditLog).count() == before + 1

    def test_writes_to_other_tables_are_not_blocked(
        self, session, engine, operator, existing_log
    ):
        update_stmt = text(
            "UPDATE users SET department = 'Engineering' WHERE id = :id"
        ).bindparams(bindparam("id", type_=Uuid))
        with engine.connect() as conn:
            conn.execute(update_stmt, {"id": operator.id})
            conn.commit()

        session.expire_all()
        assert session.get(User, operator.id).department == "Engineering"

    def test_table_sharing_audit_logs_prefix_is_not_blocked(self, engine):
        """Regression for the false positive a reviewer found
        against a real SQLite database: a distinct table that
        merely starts with ``audit_logs`` -- here continuing with
        ``$``, a character PostgreSQL and SQLite both allow in an
        unquoted identifier but this module's identifier class does
        not -- must not be mistaken for ``audit_logs`` itself and
        blocked.
        """
        table = '"audit_logs$archive"'
        with engine.connect() as conn:
            conn.execute(
                text(
                    f"CREATE TABLE {table} (id INTEGER PRIMARY KEY, note TEXT)"
                )
            )
            conn.execute(
                text(f"INSERT INTO {table} (id, note) VALUES (1, 'original')")
            )
            conn.commit()

            conn.execute(
                text(f"UPDATE {table} SET note = 'changed' WHERE id = 1")
            )
            conn.commit()

            note = conn.execute(
                text(f"SELECT note FROM {table} WHERE id = 1")
            ).scalar()

        assert note == "changed"
