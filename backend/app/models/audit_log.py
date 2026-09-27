"""``AuditLog`` model and its "append-only" database guard
(ALG-R01~ALG-R04).

Not to be confused with ``app/models/_audit.py``'s ``AuditMixin``
(the ``created_by``/``updated_by`` columns most models share): that
mixin records who last touched *any* row, while this module records
a standalone, permanent history of security-relevant changes
(role/permission changes -- see ``docs/specs/audit-log/spec.md``).
``AuditLog`` does not use ``AuditMixin`` or
``app.db.base.TimestampedBase``: ALG-R02 explicitly forbids
``updated_at``/``updated_by`` on this table, since a row that could
record "last modified by" would suggest it can be modified at all
(ALG-R04).

``event_type``/``entity_type`` get an unbounded ``String`` column,
the same choice ``app/models/company.py``'s ``kind`` and
``app/models/user.py``'s ``external_source``/``external_id`` make
for a column the spec does not fix a length limit for: ALG-R07's
event-code format and ALG-R11's registered-event-catalog check are
the write-entry-point's job (plan.md T2, issue #216), not this
table's.

``entity_id`` is deliberately **not** a foreign key (ALG-R03): the
entity it names (for example a deleted ``Role``) may no longer
exist, and a foreign key would either block that deletion or cascade
it into deleting the audit record itself -- exactly what ALG-R04
exists to prevent.

Append-only guard (ALG-R04, plan.md's "攔截靠比對 SQL 文字" risk):
:func:`_block_audit_logs_mutation` is registered on the ``Engine``
*class* itself, via ``@event.listens_for(Engine, ...)``, rather than
on one specific engine instance. SQLAlchemy's ``before_cursor_execute``
event fires right before the final, fully compiled SQL text is
handed to the DBAPI cursor -- after the ORM's unit of work, any
Core ``update()``/``delete()`` construct, and any raw ``text()``
string have all already been compiled down to that same SQL text --
so one textual check here covers every write path without needing
to special-case each one, and listening on the class means every
``Engine`` any code creates (including a test's own
``create_engine_from_settings`` call) is covered automatically, with
no per-engine wiring required.

The check itself only looks at the statement's leading
``UPDATE``/``DELETE FROM`` keyword (skipping any leading whitespace
and SQL comments, and SQLite's ``UPDATE OR <conflict-algorithm>``
and PostgreSQL's ``ONLY`` in between) and the table reference that
immediately follows: it does not scan the rest of the statement
text, so a table merely mentioning ``audit_logs`` elsewhere (for
example in a subquery, or a string literal in another table's
``SET`` clause) is never a false positive; an unquoted identifier
match is both greedy *and* boundary-checked (see
``_table_identifier``'s docstring), so neither ``audit_logs_x`` nor
a same-prefix table using characters outside this module's
identifier class (``audit_logs$archive``, ``audit_logs中``) is ever
mistaken for ``audit_logs``.

Known limitations -- these never reach the leading-keyword check
above, so they are not covered: a database client outside this
backend (e.g. a bare ``psql`` session; there is no way for an
in-process SQLAlchemy event to intercept a connection this process
never made -- out of scope per ALG-R04's own text); a mutation
wrapped in a CTE (``WITH ... UPDATE/DELETE ...``); an
``INSERT ... ON CONFLICT DO UPDATE`` upsert; SQLite's
``REPLACE INTO``/``INSERT OR REPLACE``; and ``TRUNCATE``. None of
these begin with a bare ``UPDATE``/``DELETE FROM`` keyword, so this
guard does not (yet) recognize them as a write to ``audit_logs``.
"""

import re
import uuid
from datetime import datetime

from sqlalchemy import Engine, ForeignKey, String, event
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid

from app.db import clock
from app.db.base import Base, UTCDateTime, uuid7


class AuditLogImmutableError(Exception):
    """Raised by :func:`_block_audit_logs_mutation` when SQL sent to
    any ``Engine`` would ``UPDATE`` or ``DELETE`` from
    ``audit_logs`` (ALG-R04). The write is rejected before it ever
    reaches the database; the table's contents are unchanged.
    """


def _identifier(quoted_group: str, plain_group: str) -> str:
    """A regex fragment matching one SQL identifier, either
    double-quoted (captured as ``quoted_group``, contents verbatim)
    or a plain, unquoted word (captured as ``plain_group``). The
    plain alternative is greedy over word characters, so it always
    consumes an entire identifier like ``audit_logs_x`` rather than
    stopping early at ``audit_logs``.

    Used for the optional ``schema.`` prefix in ``_TABLE_REF_RE``
    below, where a following literal ``.`` is already the
    boundary -- unlike the table name itself, which needs
    :func:`_table_identifier`'s extra check (see there).
    """
    return (
        rf'"(?P<{quoted_group}>[^"]*)"'
        rf"|(?P<{plain_group}>[A-Za-z_][A-Za-z0-9_]*)"
    )


# What may legally follow a bare table reference in the statement
# shapes this guard looks at: whitespace (before ``SET``/``WHERE``),
# a statement terminator (``;``), or a punctuation character that
# could follow it inside a larger expression (``(``, ``,``, ``)``),
# or nothing at all (end of the string).
_IDENTIFIER_BOUNDARY = r"(?=[\s;,()]|\Z)"


def _table_identifier(quoted_group: str, plain_group: str) -> str:
    """Like :func:`_identifier`, but for the table name itself: the
    unquoted alternative additionally requires (via a lookahead,
    consuming no characters) that what follows the matched word is
    one of ``_IDENTIFIER_BOUNDARY``'s characters, not simply that
    ``[A-Za-z0-9_]`` runs out.

    Without this, ``audit_logs$archive`` -- a different table that
    merely starts with ``audit_logs`` -- would match only its
    ``audit_logs`` prefix and be mistaken for the real table:
    PostgreSQL and SQLite both accept ``$`` and non-ASCII letters in
    an *unquoted* identifier, characters this module's identifier
    character class never included, so the old plain-greedy match
    would stop right there and call that a match. The boundary
    lookahead makes that same "ran out of matchable characters"
    case fail instead of silently succeeding: with nothing after
    ``audit_logs`` in ``_IDENTIFIER_BOUNDARY``'s set, there is no
    length this identifier can back off to that both stays a valid
    ``[A-Za-z_][A-Za-z0-9_]*`` word *and* is immediately followed by
    a real boundary character, so the whole alternative fails to
    match and :func:`_targets_audit_logs` correctly reports no
    match. A double-quoted identifier never had this problem: its
    contents are read verbatim up to the closing quote, so
    ``"audit_logs$archive"`` was already never mistaken for
    ``audit_logs``.
    """
    return (
        rf'"(?P<{quoted_group}>[^"]*)"'
        rf"|(?P<{plain_group}>[A-Za-z_][A-Za-z0-9_]*){_IDENTIFIER_BOUNDARY}"
    )


# A leading SQL line comment (``-- ...`` to end of line/string) or
# block comment (``/* ... */``, not itself nested), or plain
# whitespace -- whatever precedes the statement's real keyword.
_LEADING_TRIVIA_RE = re.compile(
    r"(?:\s+|--[^\n]*(?:\n|\Z)|/\*.*?\*/)",
    re.DOTALL,
)


def _skip_leading_trivia(statement: str) -> str:
    """Strip every leading run of whitespace and SQL comments
    (mixed, any number of times) off the front of ``statement``, so
    ``_OPERATION_RE`` below always sees the statement's real leading
    keyword. Only comments *before* that keyword are handled: one
    appearing later in the statement (e.g. between ``UPDATE`` and
    the table name) is not something ALG-AC03 asks for and is left
    alone.
    """
    pos = 0
    while True:
        match = _LEADING_TRIVIA_RE.match(statement, pos)
        if match is None or match.end() == pos:
            return statement[pos:]
        pos = match.end()


# SQLite's ``UPDATE OR <algorithm>`` conflict-resolution clause
# (https://sqlite.org/lang_conflict.html). Deliberately excludes
# ``REPLACE`` when it starts a statement on its own (bare
# ``REPLACE INTO``) or follows ``INSERT OR`` -- neither begins with
# ``UPDATE``, so ``_OPERATION_RE`` below never reaches them anyway;
# this constant only spells out the algorithm names legal after
# ``UPDATE OR``.
_SQLITE_CONFLICT_ALGORITHMS = r"(?:REPLACE|ROLLBACK|ABORT|FAIL|IGNORE)"

# Matches the leading ``UPDATE``/``DELETE FROM`` keyword of a
# statement (case-insensitive; ``statement`` is assumed already run
# through :func:`_skip_leading_trivia`), followed by SQLite's
# optional ``OR <algorithm>`` clause (``UPDATE`` only) and/or
# PostgreSQL's optional ``ONLY`` keyword (both ``UPDATE`` and
# ``DELETE FROM``), leaving the match position right at the start of
# the table reference that follows.
_OPERATION_RE = re.compile(
    r"\s*(?:"
    rf"(?P<update>UPDATE)(?:\s+OR\s+{_SQLITE_CONFLICT_ALGORITHMS})?"
    r"|(?P<delete>DELETE\s+FROM)"
    r")\s+(?:ONLY\s+)?",
    re.IGNORECASE,
)

# Matches the table reference right after that keyword: an optional
# ``schema.`` prefix (``main.audit_logs``, ``public.audit_logs``,
# each side independently quotable) followed by the table name
# itself (with its own boundary check -- see
# ``_table_identifier``'s docstring).
_TABLE_REF_RE = re.compile(
    "(?:(?:" + _identifier("schema_q", "schema_u") + r")\.)?"
    "(?:" + _table_identifier("table_q", "table_u") + ")"
)

_AUDIT_LOGS_TABLE = "audit_logs"


def _targets_audit_logs(statement: str) -> bool:
    """Return whether ``statement`` is an ``UPDATE``/``DELETE FROM``
    whose target table is ``audit_logs`` -- covering every writing
    the spelling ALG-AC03 lists: unquoted, double-quoted, schema
    prefixed, mixed case, and leading whitespace/newlines/comments
    all resolve to the same table name here, as do SQLite's
    ``UPDATE OR <algorithm>`` and PostgreSQL's ``ONLY``.
    """
    statement = _skip_leading_trivia(statement)
    op_match = _OPERATION_RE.match(statement)
    if op_match is None:
        return False
    table_match = _TABLE_REF_RE.match(statement, op_match.end())
    if table_match is None:
        return False
    table_name = table_match.group("table_q")
    if table_name is None:
        table_name = table_match.group("table_u")
    return table_name is not None and table_name.lower() == _AUDIT_LOGS_TABLE


@event.listens_for(Engine, "before_cursor_execute")
def _block_audit_logs_mutation(
    conn: object,
    cursor: object,
    statement: str,
    parameters: object,
    context: object,
    executemany: bool,
) -> None:
    """ALG-R04: reject any ``UPDATE``/``DELETE`` reaching
    ``audit_logs``, from whichever layer produced it -- ORM flush,
    ORM/Core bulk ``update()``/``delete()``, or raw ``text()`` SQL.
    ``INSERT``/``SELECT`` against ``audit_logs``, and any statement
    against another table (including one merely named
    ``audit_logs_x``), pass through untouched.
    """
    if _targets_audit_logs(statement):
        raise AuditLogImmutableError(
            "audit_logs is append-only; UPDATE/DELETE are rejected (ALG-R04)"
        )


class AuditLog(Base):
    """A permanent, append-only record of one security-relevant
    change (ALG-R01): who (``created_by``), when (``created_at``),
    on what (``entity_type``/``entity_id``), which kind of change
    (``event_type``), and its content before/after
    (``before``/``after``, both nullable -- ALG-R01, ALG-R09).

    Deliberately has no ``updated_at``/``updated_by`` (ALG-R02) and
    no relationship/back-reference from ``User`` (unlike
    ``created_by`` columns elsewhere): nothing about this table is
    meant to be navigated from the ``User`` side, only written once
    and read by ``entity_id``/``event_type``.
    """

    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid7
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=clock.utc_now
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    # ALG-R03: intentionally not a foreign key -- see module
    # docstring.
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    before: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
