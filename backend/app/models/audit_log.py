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

Before any of that keyword/table matching runs, :func:`_normalize_sql`
first collapses every SQL comment (``-- ...``, ``/* ... */``) to a
single space and every single-quoted string literal's contents to
nothing (``''``): a first PR #253 review round found that matching
straight against the raw statement missed a comment inserted between
two keywords or between a keyword and the table name (``DELETE/*c*/
FROM``, ``UPDATE audit_logs/*c*/SET``), a comment hiding a close
paren that should have ended a CTE body early, and a literal value
(for example in a later ``RETURNING`` clause) whose own text happened
to contain the words ``on conflict do update``. Normalizing once,
before any other check, means every matcher below -- keyword
boundaries, table-name boundaries, paren pairing, the ``ON CONFLICT``
search -- only ever sees the statement's real structure, never text
that a comment or a literal value merely happens to contain.

Once normalized, the check looks at the statement's leading keyword
and the table reference that immediately follows it -- for a bare
``UPDATE``/``DELETE FROM`` (skipping SQLite's ``UPDATE OR
<conflict-algorithm>`` and PostgreSQL's ``ONLY`` in between), and
(issue #233) for every other shape that modifies an existing
``audit_logs`` row or removes all of its rows: PostgreSQL's
``TRUNCATE [TABLE] [ONLY] audit_logs`` (checked against every table
in its comma-separated list, not only the first); SQLite's
``REPLACE INTO``/``INSERT OR REPLACE INTO``; PostgreSQL's and
SQLite's shared ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert
(``DO NOTHING`` and a plain ``INSERT`` are never blocked); and a
``WITH`` (CTE) statement wrapping any of the above, whether the
mutation is the CTE's own body (PostgreSQL's data-modifying CTEs,
e.g. ``WITH t AS (DELETE FROM audit_logs RETURNING id) SELECT ...``)
or the primary statement the CTE list feeds
(``WITH t AS (...) UPDATE audit_logs SET ...``). None of this scans
the rest of the statement text beyond what each shape's own grammar
requires, so a table merely mentioning ``audit_logs`` elsewhere (for
example in a subquery, or a string literal in another table's
``SET`` clause) is never a false positive; an unquoted identifier
match is both greedy *and* boundary-checked (see
``_table_identifier``'s docstring), so neither ``audit_logs_x`` nor
a same-prefix table using characters outside this module's
identifier class (``audit_logs$archive``, ``audit_logs中``) is ever
mistaken for ``audit_logs``.

Known limitations -- these are not covered: a database client
outside this backend (e.g. a bare ``psql`` session; there is no way
for an in-process SQLAlchemy event to intercept a connection this
process never made -- out of scope per ALG-R04's own text); a
PostgreSQL dollar-quoted string (``$$...$$``/``$tag$...$tag$``) or a
non-standard backslash-escaped quote inside a single-quoted string
(``standard_conforming_strings = off``), neither of which
:func:`_normalize_sql` recognizes as a string literal, so a comment
marker or keyword hidden inside one of these would not be
normalized away -- not a shape this codebase's own SQL ever
produces; a nested block comment (``/* /* ... */ ... */``,
non-standard but PostgreSQL accepts it), which is treated the same
way the original leading-trivia check always did (matched
non-greedily, so it ends at the first ``*/``); and a ``WITH``
statement using CTE syntax this module's regex-based parsing does
not recognize (for example a dialect extension it does not know),
in which case that CTE's own body is not checked but the primary
statement following it still is.
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
    any ``Engine`` would modify an existing ``audit_logs`` row or
    remove all of its rows, in any of the shapes
    :func:`_targets_audit_logs` recognizes (ALG-R04). The write is
    rejected before it ever reaches the database; the table's
    contents are unchanged.
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


def _normalize_sql(statement: str) -> str:
    """Return a copy of ``statement`` with every SQL comment
    (``-- ...`` to end of line, ``/* ... */``) replaced by a single
    space, and every single-quoted string literal's contents
    (handling ``''`` as an escaped quote) replaced by nothing
    (``''``) -- run once, before any other matcher in this module,
    so a keyword, table name, or clause that only *appears* inside a
    comment or a literal value's own text can never be mistaken for
    a real one (see the module docstring's account of PR #253's
    review). A comment always becomes exactly one space rather than
    nothing, so two keywords a comment used to sit between (for
    example ``DELETE/*c*/FROM``) stay correctly separated. A
    double-quoted identifier is copied through unchanged: its
    contents are read verbatim by :func:`_identifier`/
    :func:`_table_identifier` already, and are never string data
    that could hide a comment marker or a keyword.
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


# Plain whitespace: every SQL comment this module's matchers could
# meet has already become a single space, via _normalize_sql above,
# by the time any of them runs.
_LEADING_TRIVIA_RE = re.compile(r"\s+")


def _trivia_end(statement: str, pos: int) -> int:
    """Return the index in ``statement`` right after the run of
    whitespace starting at ``pos`` (empty if there is none).
    """
    match = _LEADING_TRIVIA_RE.match(statement, pos)
    return pos if match is None else match.end()


def _skip_leading_trivia(statement: str) -> str:
    """Strip leading whitespace off the front of ``statement``, so
    the matchers below always see the statement's real leading
    keyword.
    """
    return statement[_trivia_end(statement, 0) :]


# SQLite's ``UPDATE OR <algorithm>`` conflict-resolution clause
# (https://sqlite.org/lang_conflict.html), also reused (as
# ``INSERT OR <algorithm>``) by ``_REPLACE_INTO_KEYWORD_RE`` below.
_SQLITE_CONFLICT_ALGORITHMS = r"(?:REPLACE|ROLLBACK|ABORT|FAIL|IGNORE)"

_UPDATE_KEYWORD_RE = re.compile(
    rf"UPDATE(?:\s+OR\s+{_SQLITE_CONFLICT_ALGORITHMS})?", re.IGNORECASE
)
_DELETE_FROM_KEYWORD_RE = re.compile(r"DELETE\s+FROM", re.IGNORECASE)
_ONLY_KEYWORD_RE = re.compile(r"ONLY\b", re.IGNORECASE)

# Matches the table reference right after a leading keyword: an
# optional ``schema.`` prefix (``main.audit_logs``,
# ``public.audit_logs``, each side independently quotable) followed
# by the table name itself (with its own boundary check -- see
# ``_table_identifier``'s docstring).
_TABLE_REF_RE = re.compile(
    "(?:(?:" + _identifier("schema_q", "schema_u") + r")\.)?"
    "(?:" + _table_identifier("table_q", "table_u") + ")"
)

_AUDIT_LOGS_TABLE = "audit_logs"


def _table_ref_is_audit_logs(match: "re.Match[str] | None") -> bool:
    """Return whether a match of ``_TABLE_REF_RE`` names
    ``audit_logs`` -- shared by every matcher below so "is this
    table audit_logs?" is decided the same way everywhere.
    """
    if match is None:
        return False
    name = match.group("table_q")
    if name is None:
        name = match.group("table_u")
    return name is not None and name.lower() == _AUDIT_LOGS_TABLE


def _matches_update_delete(statement: str) -> bool:
    """The original ALG-AC03 shapes: a bare ``UPDATE``/``DELETE
    FROM`` (with SQLite's ``OR <algorithm>`` and/or PostgreSQL's
    ``ONLY``) whose table is ``audit_logs``. ``statement`` is
    assumed already run through :func:`_skip_leading_trivia`.
    """
    match = _UPDATE_KEYWORD_RE.match(statement)
    if match is None:
        match = _DELETE_FROM_KEYWORD_RE.match(statement)
    if match is None:
        return False
    pos = _trivia_end(statement, match.end())
    only_match = _ONLY_KEYWORD_RE.match(statement, pos)
    if only_match is not None:
        pos = _trivia_end(statement, only_match.end())
    return _table_ref_is_audit_logs(_TABLE_REF_RE.match(statement, pos))


_TRUNCATE_KEYWORD_RE = re.compile(r"TRUNCATE\b", re.IGNORECASE)
_TABLE_KEYWORD_RE = re.compile(r"TABLE\b", re.IGNORECASE)


def _matches_truncate(statement: str) -> bool:
    """PostgreSQL's ``TRUNCATE [TABLE] [ONLY] name [*] [, ...]``:
    checks every table in the comma-separated list, not only the
    first, since ``TRUNCATE users, audit_logs`` would otherwise slip
    through. SQLite has no ``TRUNCATE`` statement at all, but this
    guard fires on the raw SQL text before it ever reaches the DBAPI
    cursor (see the module docstring), so a test can exercise this
    against a SQLite ``Engine`` without SQLite itself ever needing
    to understand the statement.
    """
    match = _TRUNCATE_KEYWORD_RE.match(statement)
    if match is None:
        return False
    pos = _trivia_end(statement, match.end())
    table_kw_match = _TABLE_KEYWORD_RE.match(statement, pos)
    if table_kw_match is not None:
        pos = _trivia_end(statement, table_kw_match.end())

    while True:
        only_match = _ONLY_KEYWORD_RE.match(statement, pos)
        if only_match is not None:
            pos = _trivia_end(statement, only_match.end())
        table_ref = _TABLE_REF_RE.match(statement, pos)
        if table_ref is None:
            return False
        if _table_ref_is_audit_logs(table_ref):
            return True
        pos = table_ref.end()
        if pos < len(statement) and statement[pos] == "*":
            pos += 1
        pos = _trivia_end(statement, pos)
        if pos < len(statement) and statement[pos] == ",":
            pos = _trivia_end(statement, pos + 1)
            continue
        return False


_REPLACE_INTO_KEYWORD_RE = re.compile(
    r"(?:REPLACE|INSERT\s+OR\s+REPLACE)\s+INTO", re.IGNORECASE
)


def _matches_replace_into(statement: str) -> bool:
    """SQLite's ``REPLACE INTO``/``INSERT OR REPLACE INTO``: both
    delete any existing conflicting row and insert the new one in
    its place, so both count as a modification of an existing row,
    the same as ``INSERT ... ON CONFLICT ... DO UPDATE`` below.
    ``INSERT OR IGNORE``/``ROLLBACK``/``ABORT``/``FAIL`` are
    deliberately not matched here: on a conflict they skip the new
    row or abort the statement, but never touch an existing row's
    contents.
    """
    match = _REPLACE_INTO_KEYWORD_RE.match(statement)
    if match is None:
        return False
    pos = _trivia_end(statement, match.end())
    return _table_ref_is_audit_logs(_TABLE_REF_RE.match(statement, pos))


def _find_matching_paren(statement: str, open_index: int) -> int:
    """Return the index of the ``)`` matching the ``(`` at
    ``open_index`` in ``statement``. Tracks single- and
    double-quoted strings (each ends only at its own matching,
    non-doubled quote) so a parenthesis inside a string literal --
    for example inside an ``INSERT``'s literal value list, or a
    quoted identifier -- is never mistaken for real nesting. Returns
    ``len(statement)`` if no matching close paren is found (an
    unterminated/malformed statement), which callers treat as
    "nothing more to skip".
    """
    depth = 0
    pos = open_index
    length = len(statement)
    while pos < length:
        char = statement[pos]
        if char in ("'", '"'):
            quote = char
            pos += 1
            while pos < length:
                if statement[pos] == quote:
                    if pos + 1 < length and statement[pos + 1] == quote:
                        pos += 2
                        continue
                    pos += 1
                    break
                pos += 1
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return pos
        pos += 1
    return length


def _skip_paren_group(statement: str, pos: int) -> int:
    """If ``statement[pos]`` is ``(``, return the trivia-skipped
    index right after its matching close paren; otherwise return
    ``pos`` unchanged.
    """
    if pos < len(statement) and statement[pos] == "(":
        paren_end = _find_matching_paren(statement, pos) + 1
        return _trivia_end(statement, paren_end)
    return pos


_INSERT_INTO_KEYWORD_RE = re.compile(r"INSERT\s+INTO", re.IGNORECASE)
_ON_CONFLICT_DO_RE = re.compile(
    r"\bON\s+CONFLICT\b.*?\bDO\s+(?P<action>UPDATE|NOTHING)\b",
    re.IGNORECASE | re.DOTALL,
)


def _matches_insert_on_conflict_do_update(statement: str) -> bool:
    """PostgreSQL's and SQLite's shared
    ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert: only the
    ``DO UPDATE`` form modifies an existing row, so
    ``ON CONFLICT DO NOTHING`` and a plain ``INSERT`` with no
    ``ON CONFLICT`` clause at all must both pass through untouched.

    Searches for ``ON CONFLICT`` anywhere after the table name,
    rather than only right after a ``VALUES (...)`` list, because
    ``statement`` has already been through :func:`_normalize_sql`:
    every string literal's own content -- wherever in the statement
    it appears, including a later ``RETURNING`` clause, not only an
    inserted value -- has already been emptied out, so nothing
    literal can be mistaken for this clause.
    """
    match = _INSERT_INTO_KEYWORD_RE.match(statement)
    if match is None:
        return False
    pos = _trivia_end(statement, match.end())
    table_match = _TABLE_REF_RE.match(statement, pos)
    if table_match is None or not _table_ref_is_audit_logs(table_match):
        return False
    conflict_match = _ON_CONFLICT_DO_RE.search(statement, table_match.end())
    return (
        conflict_match is not None
        and conflict_match.group("action").upper() == "UPDATE"
    )


_WITH_KEYWORD_RE = re.compile(r"WITH\b", re.IGNORECASE)
_RECURSIVE_KEYWORD_RE = re.compile(r"RECURSIVE\b", re.IGNORECASE)
_AS_KEYWORD_RE = re.compile(r"AS\b", re.IGNORECASE)
_MATERIALIZED_RE = re.compile(r"(?:NOT\s+)?MATERIALIZED\b", re.IGNORECASE)
_CTE_NAME_RE = re.compile(_identifier("cte_name_q", "cte_name_u"))


def _skip_one_cte(statement: str, pos: int) -> "tuple[str | None, int]":
    """Parse one ``name [(col, ...)] AS [[NOT] MATERIALIZED] (body)``
    common table expression starting at ``pos`` (already past the
    ``WITH``/``RECURSIVE`` keyword or a preceding comma). Returns
    ``(body, index_after_close_paren)`` on success -- ``body`` being
    the subquery's own text with its enclosing parens stripped -- or
    ``(None, pos)`` if what follows does not parse as a CTE
    definition (this module gives up rather than guessing at
    non-standard syntax; see the module docstring's "Known
    limitations").
    """
    name_match = _CTE_NAME_RE.match(statement, pos)
    if name_match is None:
        return None, pos
    pos = _trivia_end(statement, name_match.end())
    pos = _skip_paren_group(statement, pos)  # optional column list
    as_match = _AS_KEYWORD_RE.match(statement, pos)
    if as_match is None:
        return None, pos
    pos = _trivia_end(statement, as_match.end())
    materialized_match = _MATERIALIZED_RE.match(statement, pos)
    if materialized_match is not None:
        pos = _trivia_end(statement, materialized_match.end())
    if pos >= len(statement) or statement[pos] != "(":
        return None, pos
    close = _find_matching_paren(statement, pos)
    return statement[pos + 1 : close], _trivia_end(statement, close + 1)


def _targets_audit_logs_after_with(statement: str) -> bool:
    """Handles a statement beginning with ``WITH`` (ALG-AC03's CTE
    case). ``statement`` is assumed already run through
    :func:`_skip_leading_trivia`. Every CTE's own body is checked
    recursively (catching a PostgreSQL data-modifying CTE such as
    ``WITH t AS (DELETE FROM audit_logs RETURNING id) SELECT ...``,
    where the mutation is nested *inside* the CTE rather than being
    the statement's primary clause), and whatever primary statement
    follows the CTE list is then checked the same way a non-``WITH``
    statement would be (catching
    ``WITH t AS (...) UPDATE audit_logs SET ...``, where the CTE
    itself is untouched but the statement consuming it is the
    mutation). A CTE that is merely read from (no mutation in its
    body or in the primary statement) is correctly never blocked.
    """
    with_match = _WITH_KEYWORD_RE.match(statement)
    if with_match is None:
        return False
    pos = _trivia_end(statement, with_match.end())
    recursive_match = _RECURSIVE_KEYWORD_RE.match(statement, pos)
    if recursive_match is not None:
        pos = _trivia_end(statement, recursive_match.end())

    while True:
        body, next_pos = _skip_one_cte(statement, pos)
        if body is None:
            break
        if _targets_audit_logs(body):
            return True
        pos = next_pos
        if pos < len(statement) and statement[pos] == ",":
            pos = _trivia_end(statement, pos + 1)
            continue
        break

    return _targets_audit_logs_without_with(statement[pos:])


def _targets_audit_logs_without_with(statement: str) -> bool:
    """Every shape ALG-AC03/issue #233 lists except the ``WITH``
    case above (which recurses back into this function for the
    primary statement following a CTE list).
    """
    statement = _skip_leading_trivia(statement)
    return (
        _matches_update_delete(statement)
        or _matches_truncate(statement)
        or _matches_replace_into(statement)
        or _matches_insert_on_conflict_do_update(statement)
    )


def _targets_audit_logs(statement: str) -> bool:
    """Return whether ``statement`` performs a write that modifies
    an existing ``audit_logs`` row or removes all of its rows -- see
    the module docstring for the full list of shapes covered
    (unquoted, double-quoted, schema-prefixed, mixed-case and
    whitespace/comment variation all resolve the same way) and the
    "Known limitations" this does not cover.

    Runs :func:`_normalize_sql` first, every time: this function is
    also how a CTE body recurses back in (see
    :func:`_targets_audit_logs_after_with`), and that substring has
    already been normalized once as part of the outer statement, so
    normalizing again here is idempotent -- a comment or a string
    literal that no longer exists in the text cannot be "found"
    again.
    """
    statement = _skip_leading_trivia(_normalize_sql(statement))
    if _targets_audit_logs_after_with(statement):
        return True
    return _targets_audit_logs_without_with(statement)


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
    modify an existing row or remove all of its rows, from
    whichever layer produced it -- ORM flush, ORM/Core bulk
    ``update()``/``delete()``, or raw ``text()`` SQL, including
    ``TRUNCATE``, SQLite's ``REPLACE INTO``/``INSERT OR REPLACE``,
    an ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert, and any of
    these wrapped in a ``WITH`` (CTE) statement (issue #233).
    ``INSERT``/``SELECT`` against ``audit_logs``,
    ``ON CONFLICT DO NOTHING``, and any statement against another
    table (including one merely named ``audit_logs_x``), pass
    through untouched.
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
