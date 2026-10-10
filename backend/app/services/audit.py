"""Single write entry point for ``AuditLog`` rows, and the event
catalog it writes against (ALG-R05~ALG-R17, plan.md T2, issue #216).

:func:`record_audit_event` is the only place in the codebase that
constructs an ``AuditLog`` (ALG-R05): a caller passes only the event
code, the entity's id, and its ``before``/``after`` content --
``created_by`` comes from
:func:`app.services.operator.get_current_operator` (or, for a
"系統事件", the same built-in-admin lookup ``get_current_operator``
itself uses outside of a request -- see :func:`_resolve_system_operator`)
and ``created_at`` from :func:`app.db.clock.utc_now`, neither of
which the caller may override (there is no ``created_by=``/
``created_at=`` parameter at all, not merely one that is ignored).
``entity_type`` is not a parameter either: it comes from whichever
catalog entry ``event_type`` names.

The event catalog (:func:`register_audit_event`, ``_EVENT_CATALOG``)
is how ALG-R13 lets other specs (``external-identity-sync``) add new
event codes without a schema change: each entry only declares an
event code, the ``entity_type`` it records, its kind (a 新增/修改/刪除
event has a different required shape -- ALG-R09), the fields
``before``/``after`` may contain, which of those fields are "一律記錄"
(required in a 修改 event's ``before``/``after`` even when unchanged),
and two flags (ALG-R15, ALG-R16):

- ``system_event``: ``created_by`` is always the built-in ``admin``
  (``is_system = True``), regardless of request scope or who (if
  anyone) is logged in -- for an event a system process raises with
  nobody logged in (``user.locked``, AUT-R28).
- ``always_write``: skips ALG-R09's "只記有變動的欄位"/"無變動不寫" --
  every declared field must be present on both sides and is recorded
  even when unchanged (``user.password_set``: the difference is in
  the password hash, which must never be recorded at all, ALG-R08).

A third, narrower flag, ``before_optional``, only matters for a 修改
event: normally both ``before``/``after`` must be present (ALG-R09),
but spec.md's "``authentication`` 事件" table reads "之前沒有密碼時
為空值" the same way it reads a 新增 event's own "before 為空值" --
the *whole* ``before`` is ``None``, not a present dict with a
``None``-valued field (``user.password_set``: a user who never had a
password before has no prior ``is_temporary`` flag to report at
all). ``before_optional`` lets ``record_audit_event`` accept
``before=None`` for such an event while still requiring ``after``
(which must then carry every declared field, since it is the only
side with content); every other 修改 event still rejects
``before=None``. A declared field's *value* is never allowed to be
``None`` on either side, whether ``before_optional`` applies or not
-- see :func:`_validate_no_null_field_values`.

``docs/specs/audit-log/spec.md``'s "第一批事件" and "``authentication``
事件" tables are registered at the bottom of this module; a caller
elsewhere in the codebase (e.g. ``domain-model`` T7 issue #135,
``authentication`` T6/T8/T11) only ever calls
:func:`record_audit_event`, never touches ``_EVENT_CATALOG`` itself.
This module only registers the two ``authentication`` event codes
(ALG-R17) -- writing them at the actual set-password/lock-account
call sites is ``authentication``'s own T6/T8/T11 (issue #216's plan.md
explicitly excludes those call sites from this task).

Kept intentionally free of any import from ``app.api``: per
``app/services/operator.py``'s ``OperatorNotAuthenticatedError``
docstring, the Service layer must not depend on the API layer, so
:func:`_format_datetime` below duplicates (rather than imports)
``app/api/time_format.py``'s ``format_utc`` -- see that function's
docstring for why.
"""

import logging
import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.db import clock
from app.db.engine import get_session_factory
from app.models import AuditLog, User
from app.services.operator import (
    OperatorNotFoundError,
    get_current_operator,
    get_system_operator,
)

# ALG-R07: an event code's format, e.g. ``role.updated`` or
# ``project_member.roles_changed``. The segment before the dot is
# the "資料" segment and must equal the event's ``entity_type``
# (checked in :func:`register_audit_event`, not by this regex).
_EVENT_TYPE_RE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$")

# ALG-R08: no event may declare a field whose name contains any of
# these (case-insensitive) -- a password, password hash, or session
# value must never reach ``before``/``after``, however it is named.
_FORBIDDEN_FIELD_SUBSTRINGS = ("password", "secret", "token", "session")


class AuditEventKind(StrEnum):
    """Which of ALG-R09's three shapes an event's ``before``/
    ``after`` must follow: 新增 (``before`` is ``None``), 修改 (both
    sides present, only changed fields plus any "一律記錄" fields),
    刪除 (``after`` is ``None``).
    """

    CREATED = "created"
    UPDATED = "updated"
    DELETED = "deleted"


@dataclass(frozen=True)
class AuditEventDefinition:
    """One event catalog entry (ALG-R11's "事件目錄"). ``fields`` is
    every field name this event's ``before``/``after`` may contain;
    ``always_recorded`` (a subset of ``fields``) lists which of them
    a 修改 event must include even when unchanged. ``system_event``
    and ``always_write`` are ALG-R15/ALG-R16's two flags;
    ``before_optional`` is a third, narrower one -- see this module's
    docstring.
    """

    event_type: str
    entity_type: str
    kind: AuditEventKind
    fields: frozenset[str]
    always_recorded: frozenset[str] = field(default_factory=frozenset)
    optional_fields: frozenset[str] = field(default_factory=frozenset)
    system_event: bool = False
    allow_system_event: bool = False
    always_write: bool = False
    before_optional: bool = False
    nullable_fields: frozenset[str] = field(default_factory=frozenset)


_EVENT_CATALOG: dict[str, AuditEventDefinition] = {}
_PENDING_AUDIT_EVENTS_KEY = "pending_independent_audit_events"
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _PendingAuditEvent:
    engine: Any
    event_type: str
    entity_id: uuid.UUID
    before: Mapping[str, Any] | None
    after: Mapping[str, Any] | None
    system_event: bool
    project_id: uuid.UUID | None
    audit_log_id: uuid.UUID
    operator_id: uuid.UUID | None


def begin_pending_independent_audit_events(
    session: Session,
) -> list[_PendingAuditEvent]:
    """Create a session queue flushed after rollback by the unit of work."""
    pending: list[_PendingAuditEvent] = []
    session.info[_PENDING_AUDIT_EVENTS_KEY] = pending
    return pending


def reset_pending_independent_audit_events(session: Session) -> None:
    session.info.pop(_PENDING_AUDIT_EVENTS_KEY, None)


def flush_pending_independent_audit_events(
    pending: list[_PendingAuditEvent],
) -> None:
    """Persist queued security events in independent transactions."""
    for item in pending:
        try:
            _write_independent_audit_event(item)
        except Exception:
            # The original rejection must remain the response. A failed
            # security-event write is logged for operational follow-up.
            logger.exception(
                "Failed to write independent audit event %s",
                item.event_type,
            )


class AuditEventRegistrationError(ValueError):
    """Base class for every rejection :func:`register_audit_event`
    raises; the event is not added to the catalog.
    """


class AuditEventAlreadyRegisteredError(AuditEventRegistrationError):
    """ALG-R13: two callers tried to register the same event code."""


class InvalidAuditEventDefinitionError(AuditEventRegistrationError):
    """The event code's format (ALG-R07), its "資料" segment against
    ``entity_type``, its ``always_recorded``/``fields`` relationship,
    or one of its field names (ALG-R08) is invalid.
    """


def register_audit_event(
    event_type: str,
    *,
    entity_type: str,
    kind: AuditEventKind,
    fields: Iterable[str],
    always_recorded: Iterable[str] = (),
    optional_fields: Iterable[str] = (),
    system_event: bool = False,
    allow_system_event: bool = False,
    always_write: bool = False,
    before_optional: bool = False,
    nullable_fields: Iterable[str] = (),
) -> None:
    """Add one event to the catalog (ALG-R11, ALG-R13): other specs
    (``external-identity-sync``) call this to register their own
    event codes without any change to this module or a migration.
    ``system_event`` and ``always_write`` are ALG-R15/ALG-R16's two
    flags; ``before_optional`` is a third, narrower one (see this
    module's docstring); all three default to ``False``.
    ``before_optional`` is only meaningful on a 修改 (``kind=
    AuditEventKind.UPDATED``) event -- a 新增 event's ``before`` is
    already always ``None`` (ALG-R09), and a 刪除 event has no
    ``after`` to fall back on.

    Raises:
        AuditEventAlreadyRegisteredError: ``event_type`` is already
            registered.
        InvalidAuditEventDefinitionError: ``event_type`` does not
            match ALG-R07's ``^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$``
            format, its "資料" segment does not equal ``entity_type``,
            ``always_recorded`` is not a subset of ``fields``,
            ``before_optional`` is set on a non-修改 event, or any
            field name contains ``password``/``secret``/``token``/
            ``session`` (case-insensitive, ALG-R08).
    """
    if event_type in _EVENT_CATALOG:
        raise AuditEventAlreadyRegisteredError(
            f"{event_type!r} is already registered (ALG-R13)"
        )
    if not _EVENT_TYPE_RE.match(event_type):
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r} does not match ALG-R07's "
            r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$ format"
        )
    data_segment = event_type.split(".", 1)[0]
    if data_segment != entity_type:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: the 資料 segment {data_segment!r} must "
            f"equal entity_type {entity_type!r} (ALG-R07)"
        )
    if before_optional and kind is not AuditEventKind.UPDATED:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: before_optional only applies to a 修改 "
            "event (kind=AuditEventKind.UPDATED)"
        )

    fields_set = frozenset(fields)
    always_recorded_set = frozenset(always_recorded)
    optional_fields_set = frozenset(optional_fields)
    nullable_fields_set = frozenset(nullable_fields)
    if not always_recorded_set <= fields_set:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: always_recorded {sorted(always_recorded_set)} "
            f"must be a subset of fields {sorted(fields_set)}"
        )
    if not optional_fields_set <= fields_set:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: optional_fields must be declared fields"
        )
    if not nullable_fields_set <= fields_set:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: nullable_fields must be declared fields"
        )
    for field_name in fields_set:
        lowered = field_name.lower()
        if any(bad in lowered for bad in _FORBIDDEN_FIELD_SUBSTRINGS):
            raise InvalidAuditEventDefinitionError(
                f"{event_type!r}: field {field_name!r} looks like it "
                "would hold a password/secret/token/session value "
                "(ALG-R08); it must not be declared"
            )

    _EVENT_CATALOG[event_type] = AuditEventDefinition(
        event_type=event_type,
        entity_type=entity_type,
        kind=kind,
        fields=fields_set,
        always_recorded=always_recorded_set,
        optional_fields=optional_fields_set,
        system_event=system_event,
        allow_system_event=allow_system_event,
        always_write=always_write,
        before_optional=before_optional,
        nullable_fields=nullable_fields_set,
    )


class AuditEventError(ValueError):
    """Base class for every rejection :func:`record_audit_event`
    raises (ALG-R05~ALG-R09, ALG-R15~ALG-R17): the write is refused
    before
    ``session.add``/``session.flush`` ever run, so no row is added
    and (ALG-R06) the surrounding transaction is free to roll back
    whatever else it was doing.
    """


class UnregisteredAuditEventError(AuditEventError):
    """ALG-R07: ``event_type`` was never registered."""


class UndeclaredAuditFieldError(AuditEventError):
    """ALG-R08: ``before``/``after`` names a field this event's
    catalog entry did not declare.
    """


class InvalidAuditEventShapeError(AuditEventError):
    """ALG-R09: ``before``/``after``'s shape does not match the
    event's kind (新增/修改/刪除), or a 修改 event is missing one of
    its "一律記錄" fields.
    """


class UnchangedAuditFieldError(AuditEventError):
    """ALG-R09's "應不寫": a 修改 event's ``before``/``after`` are
    identical after normalization, or a field that is not "一律記錄"
    has the same value on both sides. A 修改 event must record only
    the fields that actually changed, plus whichever fields the
    catalog marks "一律記錄" -- this is a deliberately strict reading
    of ALG-R09's "應", not merely "應 not write" the whole row.
    """


def _format_datetime(value: datetime) -> str:
    """API-R09's UTC, whole-second, ``Z``-suffixed format -- see this
    module's docstring for why this duplicates rather than imports
    ``app/api/time_format.py``'s ``format_utc``.
    """
    if value.tzinfo is None:
        raise ValueError("audit event datetime values must be timezone-aware")
    truncated = value.astimezone(UTC).replace(microsecond=0)
    return truncated.strftime("%Y-%m-%dT%H:%M:%SZ")


def _normalize_value(value: Any) -> Any:
    """ALG-R10: a ``uuid.UUID`` becomes a string; a ``datetime``
    becomes an API-R09 string; a ``set``/``frozenset``/``list``/
    ``tuple`` becomes a sorted array of its (recursively normalized)
    elements. Anything else (``str``, ``bool``, ``int``, ...) passes
    through unchanged -- notably, a collection of permission codes is
    only ever sorted here, never looked up against anything (that
    check belongs to the bind layer, issue #131).
    """
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return _format_datetime(value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, set | frozenset | list | tuple):
        return sorted(_normalize_value(item) for item in value)
    return value


def _normalize_payload(
    payload: Mapping[str, Any] | None,
) -> dict[str, Any] | None:
    if payload is None:
        return None
    return {key: _normalize_value(value) for key, value in payload.items()}


def _validate_fields(
    definition: AuditEventDefinition,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> None:
    for payload in (before, after):
        if payload is None:
            continue
        extra = set(payload) - definition.fields
        if extra:
            raise UndeclaredAuditFieldError(
                f"{definition.event_type}: field(s) {sorted(extra)} are "
                "not declared for this event (ALG-R08)"
            )


def _validate_no_null_field_values(
    definition: AuditEventDefinition,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> None:
    """A present ``before``/``after`` dict's fields must never carry
    a Python ``None`` value: "this field has no value" is already
    spelled by omitting the whole ``before``/``after`` (a 新增/刪除
    event, or -- for ``before_optional`` -- a 修改 event with no
    prior state at all), so a ``None``-valued field would be a
    second, redundant way to say the same thing. This is what keeps
    ``user.password_set``'s ``is_temporary`` a plain ``bool`` on
    every row that has one at all, rather than sometimes a ``bool``
    and sometimes ``None``.

    The opt-in ``nullable_fields`` exception lets
    ``user.company_changed`` record unlinked company and personnel
    fields as null on either side without changing other events.
    """
    for payload in (before, after):
        if payload is None:
            continue
        for field_name, value in payload.items():
            if value is None and field_name not in definition.nullable_fields:
                raise InvalidAuditEventShapeError(
                    f"{definition.event_type}: field {field_name!r} "
                    "must not be None -- omit the whole before/after "
                    "instead of recording a null field value (ALG-R09)"
                )


def _reject_unchanged_update(
    definition: AuditEventDefinition,
    before: dict[str, Any],
    after: dict[str, Any],
) -> None:
    if before == after:
        raise UnchangedAuditFieldError(
            f"{definition.event_type}: before and after are identical "
            "after normalization (ALG-R09)"
        )
    for field_name in before.keys() & after.keys():
        if field_name in definition.always_recorded:
            continue
        if before[field_name] == after[field_name]:
            raise UnchangedAuditFieldError(
                f"{definition.event_type}: field {field_name!r} did not "
                "change -- a 修改 event may only record changed fields "
                "(ALG-R09)"
            )


def _validate_shape(
    definition: AuditEventDefinition,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> None:
    if definition.kind is AuditEventKind.CREATED:
        if before is not None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 新增 event's before must "
                "be None (ALG-R09)"
            )
        if after is None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 新增 event's after must "
                "not be None (ALG-R09)"
            )
        missing = definition.fields - definition.optional_fields - after.keys()
        if missing:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: field(s) {sorted(missing)} "
                "must be present in after (ALG-R09, ALG-R11)"
            )
    elif definition.kind is AuditEventKind.DELETED:
        if after is not None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 刪除 event's after must "
                "be None (ALG-R09)"
            )
        if before is None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 刪除 event's before must "
                "not be None (ALG-R09)"
            )
        required = definition.fields - definition.optional_fields
        missing = required - before.keys()
        if missing:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: field(s) {sorted(missing)} "
                "must be present in before (ALG-R09, ALG-R11)"
            )
    else:
        if after is None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 修改 event's after must "
                "not be None (ALG-R09)"
            )
        if before is None:
            if not definition.before_optional:
                raise InvalidAuditEventShapeError(
                    f"{definition.event_type}: a 修改 event needs both "
                    "before and after (ALG-R09)"
                )
            # before_optional: before's absence means "no prior
            # state to report" (e.g. no password set yet), not "no
            # change" -- after is the only side with content, so it
            # alone must carry every declared field.
            missing = definition.fields - after.keys()
            if missing:
                raise InvalidAuditEventShapeError(
                    f"{definition.event_type}: field(s) "
                    f"{sorted(missing)} must be present in after "
                    "when before is None (ALG-R09, before_optional)"
                )
            return
        # ALG-R16: an "每次都寫" event requires every declared field
        # present on both sides (not only its "一律記錄" subset), since
        # none of them can be dropped for being unchanged.
        required = definition.always_recorded
        if definition.always_write:
            required = required | definition.fields
        missing = required - (before.keys() & after.keys())
        if missing:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: field(s) {sorted(missing)} "
                "must be present in both before and after (ALG-R11, "
                "ALG-R16)"
            )
        if not definition.always_write:
            _reject_unchanged_update(definition, before, after)


def _resolve_system_operator(session: Session) -> User:
    """ALG-R15's operator for a "系統事件": the built-in system
    account (``is_system = True``), resolved exactly like
    :func:`app.services.operator.get_current_operator` already does
    for its own "outside of any request" fallback -- reusing that
    function's own exceptions
    (:class:`app.services.operator.OperatorNotFoundError`,
    :class:`app.services.operator.MultipleOperatorsFoundError`)
    rather than inventing new ones, so a system event's "not found"/
    "more than one" failure looks identical to the ordinary
    fallback's.

    Deliberately does not call :func:`get_current_operator` itself:
    that function only reaches this same query when
    ``in_request_scope()`` is ``False``, but ALG-R15 requires the
    built-in ``admin`` even *inside* a request (bound to a logged-in
    user or not) -- ``user.locked`` is written while handling an
    anonymous login request.
    """
    return get_system_operator(session)


def record_audit_event(
    session: Session,
    event_type: str,
    *,
    entity_id: uuid.UUID,
    before: Mapping[str, Any] | None,
    after: Mapping[str, Any] | None,
    system_event: bool = False,
    project_id: uuid.UUID | None = None,
) -> AuditLog:
    """Write one audit event in the caller's transaction (ALG-R05)."""
    return _record_audit_event(
        session,
        event_type,
        entity_id=entity_id,
        before=before,
        after=after,
        system_event=system_event,
        project_id=project_id,
        audit_log_id=None,
    )


def _record_audit_event(
    session: Session,
    event_type: str,
    *,
    entity_id: uuid.UUID,
    before: Mapping[str, Any] | None,
    after: Mapping[str, Any] | None,
    system_event: bool = False,
    project_id: uuid.UUID | None = None,
    audit_log_id: uuid.UUID | None = None,
    operator_id: uuid.UUID | None = None,
) -> AuditLog:
    """The single entry point for writing an ``AuditLog`` row
    (ALG-R05). ``entity_type`` is not a parameter: it comes from
    ``event_type``'s catalog entry. ``created_by`` comes from
    :func:`app.services.operator.get_current_operator` (or, for a
    "系統事件", :func:`_resolve_system_operator`) and ``created_at``
    from :func:`app.db.clock.utc_now` -- there is no way for a caller
    to supply either.

    Only ``session.flush()``s (ALG-R06): the caller's own
    transaction (``app.db.unit_of_work``) commits or rolls back the
    row together with whatever else it did.

    Raises:
        UnregisteredAuditEventError: ``event_type`` is not in the
            catalog (ALG-R07).
        UndeclaredAuditFieldError: ``before``/``after`` names a field
            the event does not declare (ALG-R08).
        InvalidAuditEventShapeError: ``before``/``after``'s shape
            does not match the event's kind, a "一律記錄" field is
            missing, or a declared field's value is ``None``
            (ALG-R09).
        UnchangedAuditFieldError: a 修改 event's before/after are
            identical, or a non-"一律記錄" field did not change
            (ALG-R09).
        app.services.operator.OperatorNotAuthenticatedError: called
            during an HTTP request with nobody logged in (ALG-R05,
            AUT-R09).
        app.services.operator.OperatorNotFoundError:
        app.services.operator.MultipleOperatorsFoundError: see
            :func:`app.services.operator.get_current_operator`.
    """
    definition = _EVENT_CATALOG.get(event_type)
    if definition is None:
        raise UnregisteredAuditEventError(
            f"{event_type!r} is not a registered audit event (ALG-R07)"
        )

    normalized_before = _normalize_payload(before)
    normalized_after = _normalize_payload(after)

    _validate_fields(definition, normalized_before, normalized_after)
    _validate_no_null_field_values(
        definition, normalized_before, normalized_after
    )
    _validate_shape(definition, normalized_before, normalized_after)

    if system_event and not (
        definition.system_event or definition.allow_system_event
    ):
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r} cannot be declared as a system event"
        )

    operator = (
        session.get(User, operator_id)
        if operator_id is not None
        else (
            _resolve_system_operator(session)
            if definition.system_event or system_event
            else get_current_operator(session)
        )
    )
    if operator is None:
        raise OperatorNotFoundError(
            f"Audit operator {operator_id} does not exist"
        )
    log_values = dict(
        created_at=clock.utc_now(),
        created_by=operator.id,
        event_type=event_type,
        entity_type=definition.entity_type,
        entity_id=entity_id,
        before=normalized_before,
        after=normalized_after,
    )
    if audit_log_id is not None:
        log_values["id"] = audit_log_id
    if project_id is not None and "project_id" in AuditLog.__mapper__.attrs:
        log_values["project_id"] = project_id
    log = AuditLog(**log_values)
    session.add(log)
    session.flush()
    return log


def record_audit_event_in_independent_transaction(
    session: Session,
    event_type: str,
    *,
    entity_id: uuid.UUID,
    before: Mapping[str, Any] | None,
    after: Mapping[str, Any] | None,
    system_event: bool = False,
    project_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """Write a security event independently of the caller's transaction.

    In a request unit of work, validate and queue the event immediately;
    it is written only if the request fails, after the unit of work rolls
    back. A successful request discards the queue. Outside that queue, the
    event is written immediately using an independent session. On SQLite,
    an already-flushed non-unit-of-work session can still hold the write
    lock and self-block that immediate path; use the request unit of work
    for denied writes. The passed session supplies the target engine only;
    its pending writes and transaction are untouched.
    """
    bind = session.get_bind()
    engine = bind.engine if isinstance(bind, Connection) else bind
    pending = session.info.get(_PENDING_AUDIT_EVENTS_KEY)
    audit_log_id = uuid.uuid4()
    definition = _EVENT_CATALOG.get(event_type)
    if definition is None:
        raise UnregisteredAuditEventError(
            f"{event_type!r} is not a registered audit event (ALG-R07)"
        )
    normalized_before = _normalize_payload(before)
    normalized_after = _normalize_payload(after)
    _validate_fields(definition, normalized_before, normalized_after)
    _validate_no_null_field_values(
        definition, normalized_before, normalized_after
    )
    _validate_shape(definition, normalized_before, normalized_after)
    if system_event and not (
        definition.system_event or definition.allow_system_event
    ):
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r} cannot be declared as a system event"
        )
    if pending is not None:
        operator = (
            _resolve_system_operator(session)
            if definition.system_event or system_event
            else get_current_operator(session)
        )
        pending.append(
            _PendingAuditEvent(
                engine=engine,
                event_type=event_type,
                entity_id=entity_id,
                before=normalized_before,
                after=normalized_after,
                system_event=system_event,
                project_id=project_id,
                audit_log_id=audit_log_id,
                operator_id=operator.id,
            )
        )
        return audit_log_id
    item = _PendingAuditEvent(
        engine=engine,
        event_type=event_type,
        entity_id=entity_id,
        before=normalized_before,
        after=normalized_after,
        system_event=system_event,
        project_id=project_id,
        audit_log_id=audit_log_id,
        operator_id=None,
    )
    return _write_independent_audit_event(item)


def _write_independent_audit_event(item: _PendingAuditEvent) -> uuid.UUID:
    factory = get_session_factory(item.engine)
    with factory.begin() as independent_session:
        log = _record_audit_event(
            independent_session,
            item.event_type,
            entity_id=item.entity_id,
            before=item.before,
            after=item.after,
            system_event=item.system_event,
            project_id=item.project_id,
            audit_log_id=item.audit_log_id,
            operator_id=item.operator_id,
        )
        event_id = log.id
    return event_id


# 第一批事件 (docs/specs/audit-log/spec.md#第一批事件, ALG-R11).
register_audit_event(
    "role.created",
    entity_type="role",
    kind=AuditEventKind.CREATED,
    fields=("name", "permission_codes"),
)
register_audit_event(
    "role.updated",
    entity_type="role",
    kind=AuditEventKind.UPDATED,
    fields=(
        "name",
        "permission_codes",
        "is_assignable",
        "is_external_allowed",
    ),
)
register_audit_event(
    "role.deleted",
    entity_type="role",
    kind=AuditEventKind.DELETED,
    fields=("name", "permission_codes", "project_member_ids"),
)
register_audit_event(
    "project_member.roles_changed",
    entity_type="project_member",
    kind=AuditEventKind.UPDATED,
    fields=("role_ids", "project_id", "user_id"),
    always_recorded=("project_id", "user_id"),
)
register_audit_event(
    "project_member.removed",
    entity_type="project_member",
    kind=AuditEventKind.DELETED,
    fields=("project_id", "user_id", "role_ids"),
)
register_audit_event(
    "user.admin_changed",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    fields=("is_admin",),
)
register_audit_event(
    "user.username_changed",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    fields=("username",),
)
register_audit_event(
    "user.company_changed",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    fields=("company_id", "employee_no", "department", "location"),
    always_recorded=("company_id", "employee_no", "department", "location"),
    nullable_fields=("company_id", "employee_no", "department", "location"),
)
register_audit_event(
    "system_role_assignment.created",
    entity_type="system_role_assignment",
    kind=AuditEventKind.CREATED,
    fields=("user_id", "role_code"),
)
register_audit_event(
    "system_role_assignment.deleted",
    entity_type="system_role_assignment",
    kind=AuditEventKind.DELETED,
    fields=("user_id", "role_code"),
)
register_audit_event(
    "template_item.created_from_project",
    entity_type="template_item",
    kind=AuditEventKind.CREATED,
    fields=("project_id", "project_inspection_item_id", "system_id"),
)

# `authentication` 事件 (docs/specs/audit-log/spec.md#authentication-事件,
# ALG-R17). Registered here per ALG-R13; written at the actual
# set-password/lock-account call sites by `authentication`'s own
# T6/T8/T11 (issue #216's plan.md excludes those call sites from this
# task).
register_audit_event(
    "user.password_set",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    # "之前沒有密碼時為空值" (spec.md) reads the same way a 新增 event's
    # own "before 為空值" does elsewhere in this same table: the
    # *whole* before is None (before_optional), not a present dict
    # with a None-valued is_temporary -- see this module's docstring
    # and _validate_no_null_field_values.
    fields=("is_temporary",),
    always_write=True,
    before_optional=True,
    allow_system_event=True,
)
register_audit_event(
    "user.locked",
    entity_type="user",
    kind=AuditEventKind.CREATED,
    fields=("locked_until",),
    system_event=True,
)

# Two-layer permission and project events (ALG-R25~ALG-R28, plan.md T6).
register_audit_event(
    "user.active_changed",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    fields=(
        "is_active",
        "reason",
        "restored_permission_codes",
        "removed_permission_codes",
        "restored_delegated_modules",
        "removed_delegated_modules",
        "restored_project_ids",
        "removed_project_ids",
        "cleared_task_ids",
    ),
    always_recorded=("is_active",),
    optional_fields=(
        "reason",
        "restored_permission_codes",
        "removed_permission_codes",
        "restored_delegated_modules",
        "removed_delegated_modules",
        "restored_project_ids",
        "removed_project_ids",
        "cleared_task_ids",
    ),
    allow_system_event=True,
)
register_audit_event(
    "user.external_flag_changed",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    fields=("is_external_collaborator",),
)

for _event_type, _entity_type, _kind, _fields, _always in (
    (
        "module_permission.granted",
        "module_permission",
        AuditEventKind.CREATED,
        ("user_id", "permission_code", "module", "source"),
        (),
    ),
    (
        "module_permission.revoked",
        "module_permission",
        AuditEventKind.DELETED,
        ("user_id", "permission_code", "module", "source"),
        (),
    ),
    (
        "module_delegation.granted",
        "module_delegation",
        AuditEventKind.CREATED,
        ("user_id", "module"),
        (),
    ),
    (
        "module_delegation.revoked",
        "module_delegation",
        AuditEventKind.DELETED,
        ("user_id", "module"),
        (),
    ),
    (
        "permission_bundle.created",
        "permission_bundle",
        AuditEventKind.CREATED,
        ("name", "permission_codes"),
        (),
    ),
    (
        "permission_bundle.updated",
        "permission_bundle",
        AuditEventKind.UPDATED,
        ("name", "permission_codes"),
        (),
    ),
    (
        "permission_bundle.deleted",
        "permission_bundle",
        AuditEventKind.DELETED,
        ("name", "permission_codes"),
        (),
    ),
    (
        "permission_bundle.applied",
        "permission_bundle",
        AuditEventKind.CREATED,
        ("user_id", "bundle_id", "bundle_name", "permission_codes"),
        (),
    ),
    (
        "creator_role.changed",
        "creator_role",
        AuditEventKind.UPDATED,
        ("creator_role_id",),
        ("creator_role_id",),
    ),
):
    register_audit_event(
        _event_type,
        entity_type=_entity_type,
        kind=_kind,
        fields=_fields,
        always_recorded=_always,
    )

register_audit_event(
    "project.created",
    entity_type="project",
    kind=AuditEventKind.CREATED,
    fields=("project_code", "name", "creator_role_user_id"),
    optional_fields=("creator_role_user_id",),
)
register_audit_event(
    "project.updated",
    entity_type="project",
    kind=AuditEventKind.UPDATED,
    fields=(
        "project_code",
        "name",
        "client_name",
        "site_location",
        "planned_start_date",
        "planned_completion_date",
    ),
    nullable_fields=("planned_start_date", "planned_completion_date"),
)
register_audit_event(
    "project_member.assignment_denied",
    entity_type="project_member",
    kind=AuditEventKind.CREATED,
    fields=("project_id", "user_id", "role_ids", "reason"),
)
register_audit_event(
    "module_permission.grant_denied",
    entity_type="module_permission",
    kind=AuditEventKind.CREATED,
    fields=("user_id", "permission_codes", "bundle_id", "reason"),
    optional_fields=("bundle_id",),
)
