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

Two PR review rounds (issue #233) each found a real bypass or false
positive in an earlier version of this check that tried to parse
*where* in the statement ``audit_logs`` was referenced (a bare
leading ``UPDATE``/``DELETE``, then progressively upsert/``REPLACE``/
``TRUNCATE``/CTE-specific parsing, then a normalization pass to stop
comments and string literals from confusing that parsing). Each fix
closed one hole and opened room for the next one (a comment between
two halves of a compound keyword, a comment hiding a paren inside a
CTE body, PostgreSQL's ``SEARCH``/``CYCLE`` clauses on a recursive
CTE, ``TRUNCATE ... CASCADE`` cascading into ``audit_logs`` through a
foreign key without even naming it). Rather than continue adding
syntax-specific parsing, this module now deliberately trades
precision for safety:

1. :func:`_normalize_sql` still runs first, unchanged in spirit: it
   replaces every SQL comment with a single space and every
   single-quoted string literal's contents with nothing, so neither
   can hide a keyword, a table name, or (for the checks below) make
   one look like it is there when it is not.
2. If the normalized statement is a ``TRUNCATE`` (checked only by
   its leading keyword -- ``TRUNCATE`` is a standalone statement,
   never nested inside another one), it is rejected when
   ``audit_logs`` appears anywhere in it, in any of the spellings
   :func:`_contains_audit_logs_token` recognizes, **or** when it
   contains the word ``CASCADE`` at all, regardless of which table
   is named: ``CASCADE`` truncates every table with a foreign key
   referencing the truncated one (and ``audit_logs.created_by``
   references ``users.id``), and working out from the statement text
   alone whether some *other* table's ``CASCADE`` would ever reach
   ``audit_logs`` is exactly the kind of parsing this module is
   moving away from.
3. Otherwise, it is rejected when the statement contains, anywhere,
   both a modification keyword (``UPDATE``, ``DELETE``, ``REPLACE``,
   ``MERGE`` -- covering a bare ``UPDATE``/``DELETE``, SQLite's
   ``REPLACE INTO``/``INSERT OR REPLACE`` (both contain the word
   ``REPLACE``), an ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert
   (contains the word ``UPDATE``; ``DO NOTHING`` does not), and
   PostgreSQL 15's ``MERGE``) **and** ``audit_logs`` itself, in
   either order, anywhere in the statement -- including inside a
   ``WITH`` (CTE) statement in any shape, without this module trying
   to understand the CTE's structure at all.

Neither check looks at *where* ``audit_logs`` or the keyword appears
relative to each other, only that both are present (or, for
``TRUNCATE``, that ``audit_logs`` or ``CASCADE`` is present at all):
this is deliberately coarser than a real SQL parser, and known to
over-block some statements that do not actually touch ``audit_logs``
-- see "Known limitations" below. ``INSERT``/``SELECT`` against
``audit_logs`` with no modification keyword elsewhere in the same
statement, ``ON CONFLICT ... DO NOTHING``, and any statement that
never mentions ``audit_logs`` at all still pass through untouched.

:func:`_contains_audit_logs_token` recognizes ``audit_logs`` whether
unquoted, double-quoted, schema-prefixed (either side independently
quotable), or mixed case; an unquoted match is boundary-checked (see
its docstring) so neither ``audit_logs_x`` nor a same-prefix table
using characters outside this module's identifier class
(``audit_logs$archive``, ``audit_logs中``) is ever mistaken for
``audit_logs``, and a table merely mentioning ``audit_logs`` inside
an unrelated string literal is never a false positive either (that
text no longer exists after :func:`_normalize_sql` runs).

Known limitations -- deliberate false positives this trade-off
accepts (confirmed, by inspection, that nothing in this codebase's
own SQL hits any of them: the only code that ever writes to
``audit_logs`` is ``app/services/audit.py``'s single entry point,
which only ever does a plain ``session.add``/``session.flush``, and
nothing else in ``app/`` reads ``AuditLog`` at all, so no statement
in this codebase ever combines a modification keyword with
``audit_logs`` unless it is genuinely one of the writes ALG-R04
means to block):

- A statement that modifies a *different* table while merely reading
  from ``audit_logs`` (a subquery, a correlated update, a ``MERGE``
  ``USING audit_logs``) is rejected even though ``audit_logs`` itself
  is never modified -- for example
  ``DELETE FROM other WHERE id IN (SELECT id FROM audit_logs)``.
- ``TRUNCATE`` of an unrelated table with ``CASCADE`` is rejected
  even when nothing about that table's foreign keys could ever reach
  ``audit_logs``.
- The SQL ``REPLACE(...)`` string function, or a column, table, or
  alias literally named ``update``, ``delete``, ``replace``, or
  ``merge``, would trigger the same false positive if it ever
  appeared in a statement that also mentions ``audit_logs``.
- A database client outside this backend (e.g. a bare ``psql``
  session) is not covered at all -- there is no way for an
  in-process SQLAlchemy event to intercept a connection this process
  never made; out of scope per ALG-R04's own text.
- A PostgreSQL dollar-quoted string (``$$...$$``/``$tag$...$tag$``)
  or a non-standard backslash-escaped quote inside a single-quoted
  string (``standard_conforming_strings = off``) is not recognized
  by :func:`_normalize_sql` as a string literal, so text inside one
  of these is not normalized away; and a nested block comment
  (``/* /* ... */ ... */``, non-standard but PostgreSQL accepts it)
  is matched non-greedily, ending at the first ``*/`` the same way
  the original leading-trivia check always did.
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
    any ``Engine`` would modify an existing ``audit_logs`` row,
    remove all of its rows, or (conservatively) looks like it might,
    per :func:`_targets_audit_logs` (ALG-R04). The write is rejected
    before it ever reaches the database; the table's contents are
    unchanged.
    """


def _normalize_sql(statement: str) -> str:
    """Return a copy of ``statement`` with every SQL comment
    (``-- ...`` to end of line, ``/* ... */``) replaced by a single
    space, and every single-quoted string literal's contents
    (handling ``''`` as an escaped quote) replaced by nothing
    (``''``) -- run once, before any other check in this module, so
    a keyword or table name that only *appears* inside a comment or
    a literal value's own text can never be mistaken for a real one.
    A comment always becomes exactly one space rather than nothing,
    so two keywords a comment used to sit between (for example
    ``DELETE/*c*/FROM``) stay correctly separated. A double-quoted
    identifier is copied through unchanged: its contents are read
    verbatim by :func:`_contains_audit_logs_token` already, and are
    never string data that could hide a comment marker or a keyword.
    """
    pieces: list[str] = []
    pos = 0
    length = len(statement)
    while pos < length:
        char = statement[pos]
        if char == "'":
            pos += 1
            while pos < length:
                if statement[pos] == "'":
                    if pos + 1 < length and statement[pos + 1] == "'":
                        pos += 2
                        continue
                    pos += 1
                    break
                pos += 1
            pieces.append("''")
            continue
        if char == '"':
            start = pos
            pos += 1
            while pos < length:
                if statement[pos] == '"':
                    if pos + 1 < length and statement[pos + 1] == '"':
                        pos += 2
                        continue
                    pos += 1
                    break
                pos += 1
            pieces.append(statement[start:pos])
            continue
        if statement.startswith("--", pos):
            newline = statement.find("\n", pos)
            pos = length if newline == -1 else newline
            pieces.append(" ")
            continue
        if statement.startswith("/*", pos):
            end = statement.find("*/", pos + 2)
            pos = length if end == -1 else end + 2
            pieces.append(" ")
            continue
        pieces.append(char)
        pos += 1
    return "".join(pieces)


_LEADING_WHITESPACE_RE = re.compile(r"\s+")


def _skip_leading_whitespace(statement: str) -> str:
    """Strip leading whitespace off the front of ``statement``, so
    :func:`_is_truncate_statement` always sees its real leading
    keyword. ``statement`` is assumed already normalized (a leading
    comment has already become a leading space by then).
    """
    match = _LEADING_WHITESPACE_RE.match(statement)
    return statement if match is None else statement[match.end() :]


_TRUNCATE_LEADING_RE = re.compile(r"TRUNCATE\b", re.IGNORECASE)


def _is_truncate_statement(statement: str) -> bool:
    """Return whether ``statement`` (already normalized) is a
    ``TRUNCATE`` statement, checked only by its leading keyword:
    unlike ``UPDATE``/``DELETE``/``REPLACE``/``MERGE``, ``TRUNCATE``
    is always a standalone top-level statement, never nested inside
    a CTE or any other statement, so there is no need to search for
    it anywhere but the front.
    """
    match = _TRUNCATE_LEADING_RE.match(_skip_leading_whitespace(statement))
    return match is not None


_CASCADE_KEYWORD_RE = re.compile(r"\bCASCADE\b", re.IGNORECASE)


def _contains_cascade_keyword(statement: str) -> bool:
    """Return whether ``CASCADE`` appears anywhere in ``statement``
    (already normalized). Only ever consulted for a statement
    :func:`_is_truncate_statement` already confirmed is a
    ``TRUNCATE``, where ``CASCADE`` truncates every table with a
    foreign key referencing the table(s) named -- see the module
    docstring for why this does not check *which* table is named.
    """
    return _CASCADE_KEYWORD_RE.search(statement) is not None


_MODIFICATION_KEYWORD_RE = re.compile(
    r"\b(?:UPDATE|DELETE|REPLACE|MERGE)\b", re.IGNORECASE
)


def _contains_modification_keyword(statement: str) -> bool:
    """Return whether ``statement`` (already normalized) contains,
    anywhere, a keyword that can modify or remove an existing row:
    a bare ``UPDATE``/``DELETE``; SQLite's ``REPLACE INTO``/
    ``INSERT OR REPLACE`` (both contain the word ``REPLACE``); an
    ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert (contains the
    word ``UPDATE`` -- ``DO NOTHING`` does not, so it is correctly
    excluded); or PostgreSQL 15's ``MERGE``. Deliberately does not
    check where the keyword sits relative to ``audit_logs`` -- see
    the module docstring's known limitations.
    """
    return _MODIFICATION_KEYWORD_RE.search(statement) is not None


_AUDIT_LOGS_TOKEN_RE = re.compile(
    r'"audit_logs"' r"|(?<![\w$])audit_logs(?![\w$])",
    re.IGNORECASE,
)


def _contains_audit_logs_token(statement: str) -> bool:
    r"""Return whether ``audit_logs`` appears anywhere in
    ``statement`` (already normalized) as its own identifier --
    unquoted (schema prefixed or not: a preceding ``.`` is not a
    word character, so ``public.audit_logs`` still matches) or
    double-quoted exactly as ``"audit_logs"``. The unquoted
    alternative is boundary-checked on both sides with Python's
    Unicode-aware ``\w`` (plus ``$``, which PostgreSQL and SQLite
    both also allow in an unquoted identifier): neither a longer
    identifier merely containing ``audit_logs`` as a substring
    (``my_audit_logs``, ``audit_logs_x``, ``audit_logs$archive``,
    ``audit_logs中``) is ever mistaken for ``audit_logs`` itself,
    while a non-identifier character immediately after it
    (``audit_logs*``, as PostgreSQL's include-descendants marker on
    ``TRUNCATE``) does not stop the match.
    """
    return _AUDIT_LOGS_TOKEN_RE.search(statement) is not None


def _targets_audit_logs(statement: str) -> bool:
    """Return whether ``statement`` should be rejected as a write to
    ``audit_logs`` (ALG-R04) -- see the module docstring for the
    full rationale, what this covers, and the false positives it
    deliberately accepts in exchange for not missing a real one.
    """
    statement = _normalize_sql(statement)
    if _is_truncate_statement(statement):
        return _contains_audit_logs_token(
            statement
        ) or _contains_cascade_keyword(statement)
    if _contains_modification_keyword(statement):
        return _contains_audit_logs_token(statement)
    return False


@event.listens_for(Engine, "before_cursor_execute")
def _block_audit_logs_mutation(
    conn: object,
    cursor: object,
    statement: str,
    parameters: object,
    context: object,
    executemany: bool,
) -> None:
    """ALG-R04: reject any write reaching ``audit_logs`` that would
    modify an existing row or remove all of its rows, from whichever
    layer produced it -- ORM flush, ORM/Core bulk
    ``update()``/``delete()``, or raw ``text()`` SQL, including
    ``TRUNCATE`` (plain or ``CASCADE``), SQLite's ``REPLACE INTO``/
    ``INSERT OR REPLACE``, an ``INSERT ... ON CONFLICT ... DO UPDATE``
    upsert, ``MERGE``, and any of these wrapped in a ``WITH`` (CTE)
    statement in any shape (issue #233). ``INSERT``/``SELECT``
    against ``audit_logs`` with no modification keyword elsewhere in
    the same statement, ``ON CONFLICT DO NOTHING``, and any statement
    that never mentions ``audit_logs`` at all pass through untouched
    -- see the module docstring for the false positives this
    deliberately does not try to avoid.
    """
    if _targets_audit_logs(statement):
        raise AuditLogImmutableError(
            "audit_logs is append-only; this write is rejected (ALG-R04)"
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
