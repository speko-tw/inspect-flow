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
``UPDATE``/``DELETE FROM`` keyword and the table reference that
immediately follows: it does not scan the rest of the statement
text, so a table merely mentioning ``audit_logs`` elsewhere (for
example in a subquery) is never a false positive, and an unquoted
identifier match is greedy, so ``audit_logs_x`` is never mistaken
for ``audit_logs``. Out of scope, per ALG-R04's own text: a
database client outside this backend (e.g. a bare ``psql`` session)
is not covered -- there is no way for an in-process SQLAlchemy event
to intercept a connection this process never made.
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
    """
    return (
        rf'"(?P<{quoted_group}>[^"]*)"'
        rf"|(?P<{plain_group}>[A-Za-z_][A-Za-z0-9_]*)"
    )


# Matches the leading ``UPDATE``/``DELETE FROM`` keyword of a
# statement (case-insensitive, any leading whitespace/newlines),
# leaving the match position right at the start of the table
# reference that follows.
_OPERATION_RE = re.compile(
    r"\s*(?:(?P<update>UPDATE)|(?P<delete>DELETE\s+FROM))\s+",
    re.IGNORECASE,
)

# Matches the table reference right after that keyword: an optional
# ``schema.`` prefix (``main.audit_logs``, ``public.audit_logs``,
# each side independently quotable) followed by the table name
# itself.
_TABLE_REF_RE = re.compile(
    "(?:(?:" + _identifier("schema_q", "schema_u") + r")\.)?"
    "(?:" + _identifier("table_q", "table_u") + ")"
)

_AUDIT_LOGS_TABLE = "audit_logs"


def _targets_audit_logs(statement: str) -> bool:
    """Return whether ``statement`` is an ``UPDATE``/``DELETE FROM``
    whose target table is ``audit_logs`` -- covering every writing
    the spelling ALG-AC03 lists: unquoted, double-quoted, schema
    prefixed, mixed case, and leading whitespace/newlines all
    resolve to the same table name here.
    """
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
