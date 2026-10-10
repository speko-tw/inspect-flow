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
   replaces every SQL comment with a single space; every
   single-quoted string literal's contents with nothing (aware of
   PostgreSQL's ``E'...'`` backslash-escape convention, not only
   ``''`` doubling -- see there; SQLite has no such convention, but
   this guard fires on the raw SQL text before the DBAPI cursor ever
   sees it, so recognizing this PostgreSQL-only syntax against a
   SQLite ``Engine`` in a test is exercising the interception itself,
   never SQLite's own (nonexistent) support for it); every
   double-quoted
   (``"..."``) identifier with either the bare word ``audit_logs`` or
   an inert placeholder; and every ``U&"..."`` Unicode escape
   identifier, unconditionally, with the bare word ``audit_logs`` (it
   is never decoded -- see there) -- so none of these can hide a
   keyword, a table name, or make one look like it is there when it
   is not. A back-quoted or bracket-quoted identifier is deliberately
   left untouched, its content still fully visible to every check
   below -- see "Known limitations".
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
3. Otherwise, if it contains a DDL keyword (``DROP`` or ``ALTER``,
   anywhere -- covering ``DROP TABLE audit_logs``,
   ``ALTER TABLE audit_logs RENAME ...``/``DROP COLUMN ...``/
   ``ADD COLUMN ...`` alike: this module does not try to tell a
   destructive ``ALTER`` sub-action apart from a harmless one, the
   same coarse choice as everywhere else here), it is rejected when
   ``audit_logs`` or ``CASCADE`` is present, exactly like ``TRUNCATE``
   above (a fifth PR #253 review round: ``DROP TABLE``/``ALTER TABLE``
   were not covered at all before this, and a ``DROP ... CASCADE`` can
   reach ``audit_logs`` the same way ``TRUNCATE ... CASCADE`` can) --
   **unless** the connection this statement runs on was opened with
   the ``audit_log_ddl_allowed`` execution option set to true (see
   :func:`_block_audit_logs_mutation`), the one deliberate escape
   hatch in this whole module, needed because Alembic's own migrations
   must still be able to create, and one day alter, ``audit_logs``
   itself. That option affects *only* this DDL branch: a ``TRUNCATE``,
   or a statement matching the modification-keyword rule below, is
   rejected the same way regardless of it, so a migration can never
   use it to slip an ``UPDATE``/``DELETE``/``TRUNCATE`` past this
   guard, only genuine schema DDL.
4. Otherwise, it is rejected when the statement contains, anywhere,
   both a modification keyword (``UPDATE``, ``DELETE``, ``REPLACE``,
   ``MERGE`` -- covering a bare ``UPDATE``/``DELETE``, SQLite's
   ``REPLACE INTO``/``INSERT OR REPLACE`` (both contain the word
   ``REPLACE``), an ``INSERT ... ON CONFLICT ... DO UPDATE`` upsert
   (contains the word ``UPDATE``; ``DO NOTHING`` does not), and
   PostgreSQL 15's ``MERGE``) **and** ``audit_logs`` itself, in
   either order, anywhere in the statement -- including inside a
   ``WITH`` (CTE) statement in any shape, without this module trying
   to understand the CTE's structure at all.

None of these checks look at *where* ``audit_logs`` or the keyword
appears relative to each other, only that both are present (or, for
``TRUNCATE``/DDL, that ``audit_logs`` or ``CASCADE`` is present at
all): this is deliberately coarser than a real SQL parser, and known
to over-block some statements that do not actually touch
``audit_logs`` -- see "Known limitations" below. ``INSERT``/``SELECT``
against ``audit_logs`` with no modification keyword elsewhere in the
same statement, ``ON CONFLICT ... DO NOTHING``, ``CREATE``/``DROP``/
``ALTER`` of anything else, and any statement that never mentions
``audit_logs`` at all still pass through untouched.

:func:`_contains_audit_logs_token` recognizes ``audit_logs`` whether
unquoted, double-quoted, schema-prefixed (either side independently
quotable), or mixed case (ASCII-only, see below); a same-prefix but
different table (``audit_logs_x``, ``audit_logs$archive``,
``audit_logs中``, a double-quoted ``"audit_logs archive"``) is never
mistaken for ``audit_logs`` itself, and a table merely mentioning
``audit_logs`` inside an unrelated string literal or a *different*
double-quoted identifier's own name (for example a column aliased
``"UPDATE audit_logs"``) is never a false positive either -- both
are resolved by :func:`_normalize_sql` before anything else runs
(see there).

A third PR #253 review round found that a quoted identifier's raw
text (kept verbatim by an earlier version of :func:`_normalize_sql`)
could itself be misread as unquoted SQL: ``"audit_logs archive"`` (a
distinct, legitimately-quoted table whose name merely starts with
``audit_logs``) or ``SELECT "UPDATE audit_logs" FROM other`` (a
harmless read using a quoted alias that happens to spell out a
keyword and a table name) would both wrongly trigger this guard, and
``"audİt_logs"`` (using U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE)
could too, because Python's ``re.IGNORECASE`` treats that character
as case-equivalent to plain ASCII ``i`` -- confirmed:
``re.fullmatch(r"i", "İ", re.IGNORECASE)`` is ``True``. Fixed
(initially for double-quoted, back-quoted, *and* bracket-quoted
identifiers alike -- see the next paragraph for why back-quoted and
bracket-quoted were later reverted) by resolving a quoted
identifier's content to either the bare word ``audit_logs`` (its own
content, doubled closing delimiters un-escaped,
ASCII-only-case-folded, equals ``audit_logs`` exactly) or a fixed
placeholder that can never match anything this module looks for,
*before* any keyword or identifier search runs -- so a quoted
identifier's own text can never again be scanned as if it were
unquoted syntax; and by making every comparison this module makes
against a fixed keyword ASCII-only case-folded (never fully
Unicode-case-folded), for the same reason.

A fourth PR #253 review round found that treating back-quoted and
bracket-quoted identifiers the same way -- *consuming* their content
up to a closing delimiter -- was itself a "swallows real content"
bug of exactly the kind ALG-R04 cannot tolerate even once:
PostgreSQL's ``[`` is not identifier quoting at all but
array/subscript syntax (``ARRAY[[1, 2], [3, 4]]``, ``arr[1]``), and
naively consuming up to the next unescaped ``]`` on a nested or
multi-dimensional array literal could swallow a real, subsequent
``UPDATE audit_logs`` into an inert placeholder, missing it
entirely -- an under-block, not merely an over-block. Since a
backtick has no competing meaning in either dialect but also gains
this module nothing precision-wise that leaving it untouched does
not already achieve just as safely (see below), *both* were
reverted to being left alone, untouched, in :func:`_normalize_sql`;
only double-quoting -- unambiguous in both PostgreSQL and SQLite,
with no competing syntax to collide with -- is still resolved by
content. The same round added ``U&"..."`` Unicode escape identifier
handling (PostgreSQL only): rather than decode its ``\\XXXX``
escapes (which this module does not attempt, to stay simple and
avoid a new place to get the decoding itself wrong), any ``U&"..."``
identifier is conservatively assumed to *possibly* spell
``audit_logs`` and replaced with that literal word unconditionally.

A fifth PR #253 review round found that every prior round had only
ever looked for *data*-modifying statements: ``DROP TABLE
audit_logs`` and ``ALTER TABLE audit_logs ...`` reached the database
completely unchecked, silently destroying the table (or a column of
it) rather than merely a row. Fixed by :func:`_contains_ddl_keyword`
(step 3 above) -- but unlike every other check in this module, this
one has to *also* have a legitimate way through: Alembic's own
migration for this very table (and any future one that adds a column
to it) issues exactly this kind of DDL against ``audit_logs`` on
purpose. Rather than try to distinguish "a migration's own DDL" from
"anyone else's" by further inspecting the SQL text -- the same trap
every earlier round fell into -- :func:`_block_audit_logs_mutation`
instead checks the *connection*: ``backend/alembic/env.py`` opens its
migration connection with the ``audit_log_ddl_allowed=True``
execution option (:meth:`_engine.Connection.execution_options`),
and only a connection carrying that option is exempted, and only from
this one DDL check -- never from the ``TRUNCATE`` or
modification-keyword checks, so a migration still cannot ``UPDATE``,
``DELETE``, or ``TRUNCATE`` this table through this same connection.
No other code in this codebase sets that option, so this exemption
otherwise never fires.

A sixth PR #253 review round found two more bugs, both fixed
without adding any new rule. First, normalization replaced a quoted
identifier (or literal) with a bare word and no padding, so
``DELETE FROM"audit_logs"`` became ``FROMaudit_logs`` and never
matched: every replacement is now padded with a space on each side.
Second, the DDL step ran *before* the modification-keyword step and
returned early when ``audit_log_ddl_allowed`` was set, so any
``DROP``/``ALTER`` word anywhere (``UPDATE audit_logs ... AS
[DROP]``) turned the option into a bypass: the order is now
``TRUNCATE``, then modification keyword plus ``audit_logs`` token
(both decided without ever reading the option), and only then the
DDL rule, the sole step that reads it.

Known limitations -- deliberate false positives this trade-off
accepts (confirmed, by inspection, that nothing in this codebase's
own SQL hits any of them: the only code that ever writes to
``audit_logs`` is ``app/services/audit.py``'s single entry point,
which only ever does a plain ORM ``add``/``flush``, and nothing else
in ``app/`` reads ``AuditLog`` at all, so no statement in this
codebase ever combines a modification keyword with ``audit_logs``
unless it is genuinely one of the writes ALG-R04 means to block):

- A statement that modifies a *different* table while merely reading
  from ``audit_logs`` (a subquery, a correlated update, a ``MERGE``
  ``USING audit_logs``) is rejected even though ``audit_logs`` itself
  is never modified -- for example
  ``DELETE FROM other WHERE id IN (SELECT id FROM audit_logs)``.
- ``TRUNCATE`` or ``DROP``/``ALTER`` of an unrelated table with
  ``CASCADE`` is rejected even when nothing about that table's
  foreign keys or dependent objects could ever reach ``audit_logs``.
- A harmless ``ALTER TABLE audit_logs ADD COLUMN ...`` (run on a
  connection *without* the ``audit_log_ddl_allowed`` execution
  option -- see the fifth PR #253 review round, above) is rejected
  the same as a destructive ``DROP COLUMN``/``RENAME``: this module
  does not try to tell them apart.
- The SQL ``REPLACE(...)`` string function, or a column, table, or
  alias literally named ``update``, ``delete``, ``replace``,
  ``merge``, ``drop``, or ``alter``, would trigger the same false
  positive if it ever appeared in a statement that also mentions
  ``audit_logs``.
- A back-quoted or bracket-quoted identifier is left completely
  unresolved (see the fourth PR #253 review round, above): SQLite's
  `` `audit_logs` ``/``[audit_logs]`` are still correctly detected
  (their content is never consumed, so the bare word ``audit_logs``
  inside them is still found like any other token), but a
  *different*, legitimately-quoted identifier merely containing
  ``audit_logs`` or a modification keyword in its own name --
  `` `audit_logs archive` ``, ``[audit_logs archive]``,
  ``` SELECT `UPDATE audit_logs` FROM other ``` -- is now rejected
  too, unlike the equivalent double-quoted case.
- Any ``U&"..."`` Unicode escape identifier is rejected together with
  a modification keyword regardless of what it actually spells (its
  escapes are never decoded -- see above), so a statement using one
  to name a table entirely unrelated to ``audit_logs`` is rejected
  too.
- A database client outside this backend (e.g. a bare ``psql``
  session) is not covered at all -- there is no way for an
  in-process SQLAlchemy event to intercept a connection this process
  never made; out of scope per ALG-R04's own text.
- A PostgreSQL dollar-quoted string (``$$...$$``/``$tag$...$tag$``)
  or a non-standard backslash-escaped quote inside a plain (non-``E``)
  single-quoted string (``standard_conforming_strings = off``) is not
  recognized by :func:`_normalize_sql` as a string literal (an
  ``E'...'`` escape string, PostgreSQL's own convention (SQLite has
  no equivalent), *is* -- see there), so text inside one of these two
  remaining forms is not normalized away; database-level protection
  for these two (issue #232) is the accepted mitigation, since a
  reliable text-only check for either is not practical. A nested
  block comment (``/* /* ... */ ... */``, non-standard but PostgreSQL
  accepts it) is matched non-greedily, ending at the first ``*/`` the
  same way the original leading-trivia check always did.
"""

import re
import uuid
from datetime import datetime

from sqlalchemy import Connection, Engine, ForeignKey, Index, String, event
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid

from app.db import clock
from app.db.base import Base, UTCDateTime, uuid7


class AuditLogImmutableError(Exception):
    """Raised by :func:`_block_audit_logs_mutation` when SQL sent to
    any ``Engine`` would modify an existing ``audit_logs`` row,
    remove all of its rows, change its schema, or (conservatively)
    looks like it might, per :func:`_targets_audit_logs` (ALG-R04).
    The write is rejected before it ever reaches the database; the
    table's contents and schema are unchanged.
    """


_ASCII_FOLD_TABLE = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"
)


def _ascii_fold(text: str) -> str:
    """Lowercase only plain ASCII letters; every other character --
    including one that merely *looks* like an ASCII letter, or that
    some other case-folding scheme treats as equivalent to one (for
    example U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE, which
    Python's ``re.IGNORECASE`` treats as case-equivalent to ASCII
    ``i``) -- passes through unchanged. Comparing an ``_ascii_fold``ed
    string against a fixed, all-ASCII word can therefore only ever
    succeed on that exact spelling, case aside: used everywhere this
    module compares text against a keyword or against ``audit_logs``,
    instead of a case-insensitive regex or :meth:`str.lower`, both of
    which fold at least some non-ASCII characters together with
    ASCII ones (see the module docstring's account of PR #253's
    third review round).
    """
    return text.translate(_ASCII_FOLD_TABLE)


def _is_escape_string_prefix(statement: str, quote_pos: int) -> bool:
    """Return whether the ``'`` at ``quote_pos`` in ``statement``
    opens a PostgreSQL "escape string" (``E'...'``; SQLite has no
    equivalent, but see the module docstring for why this guard
    still needs to recognize it): the character right before it is
    ``E``/``e``, and the character
    before *that* (if any) is not itself part of a longer identifier
    -- so a column or table merely ending in ``e`` right before an
    ordinary string (``table_e'x'``, however unlikely) is never
    mistaken for the ``E`` prefix.
    """
    if quote_pos == 0 or statement[quote_pos - 1] not in ("E", "e"):
        return False
    before = quote_pos - 2
    return before < 0 or not re.match(r"[\w$]", statement[before])


def _consume_delimited_identifier(
    statement: str, pos: int, close_char: str
) -> "tuple[str, int]":
    """Consume a double-quoted identifier's body starting at ``pos``
    (its first content character, already past the opening ``"``),
    where a doubled ``close_char`` is the standard escape for one
    literal ``close_char`` inside. Returns the content with every
    doubled ``close_char`` un-escaped to one, and the index right
    after the identifier's closing delimiter. ``close_char`` is
    always ``"`` -- kept as a parameter only because a plain
    double-quoted identifier and a ``U&"..."`` Unicode escape
    identifier (see :func:`_is_unicode_escape_identifier_prefix`)
    both call this with the same delimiter, from two different call
    sites in :func:`_normalize_sql`.
    """
    length = len(statement)
    content: list[str] = []
    while pos < length:
        if statement[pos] == close_char:
            if pos + 1 < length and statement[pos + 1] == close_char:
                content.append(close_char)
                pos += 2
                continue
            pos += 1
            break
        content.append(statement[pos])
        pos += 1
    return "".join(content), pos


_INERT_PLACEHOLDER = "_q_"


def _resolve_quoted_identifier(inner: str) -> str:
    """Return ``audit_logs`` if a double-quoted identifier's own
    content (delimiters already stripped, any doubled ``"`` already
    un-escaped to one) names ``audit_logs`` (:func:`_ascii_fold`ed,
    so case aside but never across a non-ASCII look-alike); otherwise
    :data:`_INERT_PLACEHOLDER`, a fixed token that can never equal
    ``audit_logs`` or contain a modification keyword, so a
    *different* quoted identifier's own text -- which could be
    anything, e.g. a column alias literally named
    ``"UPDATE audit_logs"`` -- is never scanned as if it were
    unquoted SQL syntax (PR #253's third review round).

    Double-quoting is the only identifier-quoting style this
    resolves by content: a PR #253 fourth review round found that
    back-quoted and bracket-quoted identifiers cannot be *consumed*
    (their delimiters, unlike ``"``, both have another, much more
    common meaning -- SQLite accepts a backtick anywhere a plain
    word character could also start a bare identifier, and
    PostgreSQL's ``[`` is array/subscript syntax, not identifier
    quoting at all), so this module no longer tries: see the module
    docstring's "Known limitations".
    """
    if _ascii_fold(inner) == "audit_logs":
        return "audit_logs"
    return _INERT_PLACEHOLDER


def _is_unicode_escape_identifier_prefix(statement: str, pos: int) -> bool:
    """Return whether ``statement`` at ``pos`` starts a PostgreSQL
    Unicode escape identifier (``U&"..."``, optionally followed by
    its own ``UESCAPE 'c'`` clause): ``U``/``u`` immediately followed
    by ``&"`` (no whitespace, per the standard), with the character
    before it, if any, not itself part of a longer identifier.
    """
    if pos + 2 >= len(statement):
        return False
    if statement[pos] not in ("U", "u"):
        return False
    if statement[pos + 1] != "&" or statement[pos + 2] != '"':
        return False
    before = pos - 1
    return before < 0 or not re.match(r"[\w$]", statement[before])


def _normalize_sql(statement: str) -> str:
    """Return a copy of ``statement`` with every SQL comment
    (``-- ...`` to end of line, ``/* ... */``) replaced by a single
    space; every single-quoted string literal's contents (handling
    ``''`` as an escaped quote, and, for an ``E'...'`` escape string,
    also a backslash-escaped character -- see
    :func:`_is_escape_string_prefix`) replaced by nothing (``''``);
    every double-quoted identifier replaced per
    :func:`_resolve_quoted_identifier`; and every ``U&"..."`` Unicode
    escape identifier replaced by the literal word ``audit_logs``,
    unconditionally (see :func:`_is_unicode_escape_identifier_prefix`
    -- its ``\\XXXX`` escapes are never decoded, so this module
    cannot tell whether one actually spells ``audit_logs``, and
    conservatively assumes it might) -- run once, before any other
    check in this module, so a keyword or table name that only
    *appears* inside a comment, a literal value's own text, or a
    *different* double-quoted identifier's own name can never be
    mistaken for a real one. A comment always becomes exactly one
    space rather than nothing, so two keywords a comment used to sit
    between (for example ``DELETE/*c*/FROM``) stay correctly
    separated; a literal and a quoted identifier are likewise each
    padded with one space on both sides, so an adjacent keyword that
    had no whitespace before or after it (``DELETE FROM"audit_logs"``,
    ``DROP TABLE"audit_logs"``) does not fuse with the replacement
    into one bogus word (PR #253's sixth review round). A
    back-quoted or bracket-quoted identifier is
    deliberately *not* specially handled -- see the module
    docstring's "Known limitations".
    """
    pieces: list[str] = []
    pos = 0
    length = len(statement)
    while pos < length:
        char = statement[pos]
        if char == "'":
            escape_aware = _is_escape_string_prefix(statement, pos)
            pos += 1
            while pos < length:
                if escape_aware and statement[pos] == "\\":
                    pos += 2
                    continue
                if statement[pos] == "'":
                    if pos + 1 < length and statement[pos + 1] == "'":
                        pos += 2
                        continue
                    pos += 1
                    break
                pos += 1
            pieces.append(" '' ")
            continue
        if _is_unicode_escape_identifier_prefix(statement, pos):
            _, pos = _consume_delimited_identifier(statement, pos + 3, '"')
            pieces.append(" audit_logs ")
            continue
        if char == '"':
            inner, pos = _consume_delimited_identifier(statement, pos + 1, '"')
            pieces.append(f" {_resolve_quoted_identifier(inner)} ")
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


_TRUNCATE_LEADING_RE = re.compile(r"TRUNCATE\b", re.IGNORECASE | re.ASCII)


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


_CASCADE_KEYWORD_RE = re.compile(r"\bCASCADE\b", re.IGNORECASE | re.ASCII)


def _contains_cascade_keyword(statement: str) -> bool:
    """Return whether ``CASCADE`` appears anywhere in ``statement``
    (already normalized). Only ever consulted for a statement
    :func:`_is_truncate_statement` already confirmed is a
    ``TRUNCATE``, where ``CASCADE`` truncates every table with a
    foreign key referencing the table(s) named -- see the module
    docstring for why this does not check *which* table is named.
    """
    return _CASCADE_KEYWORD_RE.search(statement) is not None


_DDL_KEYWORD_RE = re.compile(r"\b(?:DROP|ALTER)\b", re.IGNORECASE | re.ASCII)


def _contains_ddl_keyword(statement: str) -> bool:
    """Return whether ``statement`` (already normalized) contains,
    anywhere, ``DROP`` or ``ALTER`` -- covering ``DROP TABLE
    audit_logs`` and every ``ALTER TABLE audit_logs ...`` sub-action
    (``RENAME``, ``DROP COLUMN``, ``ADD COLUMN``, ...) alike, the
    same coarse, "which specific sub-action" no-parsing choice as
    everywhere else in this module (PR #253's fifth review round;
    see the module docstring for the ``audit_log_ddl_allowed``
    escape hatch this check alone honors).
    """
    return _DDL_KEYWORD_RE.search(statement) is not None


_MODIFICATION_KEYWORD_RE = re.compile(
    r"\b(?:UPDATE|DELETE|REPLACE|MERGE)\b", re.IGNORECASE | re.ASCII
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


_IDENTIFIER_RUN_RE = re.compile(r"[\w$]+")


def _contains_audit_logs_token(statement: str) -> bool:
    r"""Return whether ``audit_logs`` appears anywhere in
    ``statement`` (already normalized -- a quoted/back-quoted/
    bracket-quoted identifier has already been resolved to either the
    bare word ``audit_logs`` or an inert placeholder by
    :func:`_resolve_quoted_identifier`, so only unquoted spellings
    ever reach this function) as its own identifier: schema prefixed
    or not (a preceding ``.`` is not a word character, so
    ``public.audit_logs`` still matches, and so does
    ``"public".audit_logs`` after normalization resolves the quoted
    schema segment to its own placeholder).

    Finds every maximal run of identifier characters (Python's
    Unicode-aware ``\w``, plus ``$``, which PostgreSQL and SQLite
    both also allow in an unquoted identifier) and
    :func:`_ascii_fold`s each one before comparing it to
    ``audit_logs`` -- rather than a single case-insensitive regex
    match -- for two reasons: the boundary itself must stay
    Unicode-aware so a longer identifier merely containing
    ``audit_logs`` as a substring (``my_audit_logs``,
    ``audit_logs_x``, ``audit_logs$archive``, ``audit_logs中``) is
    never mistaken for ``audit_logs`` itself (a non-identifier
    character immediately after it, such as ``audit_logs*`` --
    PostgreSQL's include-descendants marker on ``TRUNCATE`` -- does
    not stop the match); but the *comparison* must not be
    Unicode-case-insensitive, or a look-alike identifier such as
    ``audİt_logs`` (U+0130) would wrongly compare equal (see the
    module docstring).
    """
    for match in _IDENTIFIER_RUN_RE.finditer(statement):
        if _ascii_fold(match.group()) == "audit_logs":
            return True
    return False


_DDL_ALLOWED_OPTION = "audit_log_ddl_allowed"


def _targets_audit_logs(statement: str, *, ddl_allowed: bool = False) -> bool:
    """Return whether ``statement`` should be rejected as a write to
    ``audit_logs`` (ALG-R04) -- see the module docstring for the
    full rationale, what this covers, and the false positives it
    deliberately accepts in exchange for not missing a real one.

    Check order matters: ``TRUNCATE`` and a modification keyword
    (``UPDATE``/``DELETE``/``REPLACE``/``MERGE``, which also covers
    ``ON CONFLICT ... DO UPDATE``) together with an ``audit_logs``
    token are decided first and rejected *without ever looking at*
    ``ddl_allowed`` -- so no ``DROP``/``ALTER`` word anywhere in the
    statement (for instance an ``AS [DROP]`` alias) can turn the
    option into a bypass. Only the last step, the DDL rule, reads
    ``ddl_allowed`` (from the calling connection's
    :data:`_DDL_ALLOWED_OPTION` execution option -- see
    :func:`_block_audit_logs_mutation`).
    """
    statement = _normalize_sql(statement)
    if _is_truncate_statement(statement):
        return _contains_audit_logs_token(
            statement
        ) or _contains_cascade_keyword(statement)
    if _contains_modification_keyword(
        statement
    ) and _contains_audit_logs_token(statement):
        return True
    if _contains_ddl_keyword(statement):
        if ddl_allowed:
            return False
        return _contains_audit_logs_token(
            statement
        ) or _contains_cascade_keyword(statement)
    return False


@event.listens_for(Engine, "before_cursor_execute")
def _block_audit_logs_mutation(
    conn: Connection,
    cursor: object,
    statement: str,
    parameters: object,
    context: object,
    executemany: bool,
) -> None:
    """ALG-R04: reject any write reaching ``audit_logs`` that would
    modify an existing row, remove all of its rows, or change its
    schema, from whichever layer produced it -- ORM flush, ORM/Core
    bulk ``update()``/``delete()``, or raw ``text()`` SQL, including
    ``TRUNCATE`` (plain or ``CASCADE``), SQLite's ``REPLACE INTO``/
    ``INSERT OR REPLACE``, an ``INSERT ... ON CONFLICT ... DO UPDATE``
    upsert, ``MERGE``, ``DROP TABLE``/``ALTER TABLE`` (plain or
    ``CASCADE``), and any of these wrapped in a ``WITH`` (CTE)
    statement in any shape (issue #233). ``INSERT``/``SELECT``
    against ``audit_logs`` with no modification keyword elsewhere in
    the same statement, ``ON CONFLICT DO NOTHING``, and any statement
    that never mentions ``audit_logs`` at all pass through untouched
    -- see the module docstring for the false positives this
    deliberately does not try to avoid.

    ``conn``'s :data:`_DDL_ALLOWED_OPTION` execution option (set only
    by ``backend/alembic/env.py``, on the connection it runs
    migrations through -- see the module docstring's account of the
    fifth PR #253 review round) is the one way *any* code can get a
    DDL statement against ``audit_logs`` past this guard, and it
    exempts DDL only: it has no effect on the ``TRUNCATE`` or
    modification-keyword checks.
    """
    ddl_allowed = bool(conn.get_execution_options().get(_DDL_ALLOWED_OPTION))
    if _targets_audit_logs(statement, ddl_allowed=ddl_allowed):
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
    __table_args__ = (
        Index("ix_audit_logs_created_at_id", "created_at", "id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid7
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime, nullable=False, default=clock.utc_now
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String, nullable=False)
    entity_type: Mapped[str] = mapped_column(String, nullable=False)
    # ALG-R03: intentionally not a foreign key -- see module
    # docstring.
    entity_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    before: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    after: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
