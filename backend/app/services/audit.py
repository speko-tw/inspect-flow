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

import re
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import MultipleResultsFound
from sqlalchemy.orm import Session

from app.db import clock
from app.models import AuditLog, User
from app.services.operator import (
    MultipleOperatorsFoundError,
    OperatorNotFoundError,
    get_current_operator,
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
    and ``always_write`` are ALG-R15/ALG-R16's two flags -- see this
    module's docstring.
    """

    event_type: str
    entity_type: str
    kind: AuditEventKind
    fields: frozenset[str]
    always_recorded: frozenset[str] = field(default_factory=frozenset)
    system_event: bool = False
    always_write: bool = False


_EVENT_CATALOG: dict[str, AuditEventDefinition] = {}


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
    system_event: bool = False,
    always_write: bool = False,
) -> None:
    """Add one event to the catalog (ALG-R11, ALG-R13): other specs
    (``external-identity-sync``) call this to register their own
    event codes without any change to this module or a migration.
    ``system_event`` and ``always_write`` are ALG-R15/ALG-R16's two
    flags (see this module's docstring); both default to ``False``.

    Raises:
        AuditEventAlreadyRegisteredError: ``event_type`` is already
            registered.
        InvalidAuditEventDefinitionError: ``event_type`` does not
            match ALG-R07's ``^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$``
            format, its "資料" segment does not equal ``entity_type``,
            ``always_recorded`` is not a subset of ``fields``, or any
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

    fields_set = frozenset(fields)
    always_recorded_set = frozenset(always_recorded)
    if not always_recorded_set <= fields_set:
        raise InvalidAuditEventDefinitionError(
            f"{event_type!r}: always_recorded {sorted(always_recorded_set)} "
            f"must be a subset of fields {sorted(fields_set)}"
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
        system_event=system_event,
        always_write=always_write,
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
    elif definition.kind is AuditEventKind.DELETED:
        if after is not None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 刪除 event's after must "
                "be None (ALG-R09)"
            )
    else:
        if before is None or after is None:
            raise InvalidAuditEventShapeError(
                f"{definition.event_type}: a 修改 event needs both "
                "before and after (ALG-R09)"
            )
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
    try:
        operator = session.scalars(
            select(User).where(User.is_system.is_(True))
        ).one_or_none()
    except MultipleResultsFound as exc:
        raise MultipleOperatorsFoundError(
            "more than one is_system=True User found; DOM-R11/DOM-R13 "
            "expect exactly one once the system has been initialized"
        ) from exc
    if operator is None:
        raise OperatorNotFoundError(
            "no is_system=True User found; has the initialization "
            "command (DOM-R11) been run against this database?"
        )
    return operator


def record_audit_event(
    session: Session,
    event_type: str,
    *,
    entity_id: uuid.UUID,
    before: Mapping[str, Any] | None,
    after: Mapping[str, Any] | None,
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
            does not match the event's kind, or a "一律記錄" field is
            missing (ALG-R09).
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
    _validate_shape(definition, normalized_before, normalized_after)

    operator = (
        _resolve_system_operator(session)
        if definition.system_event
        else get_current_operator(session)
    )
    log = AuditLog(
        created_at=clock.utc_now(),
        created_by=operator.id,
        event_type=event_type,
        entity_type=definition.entity_type,
        entity_id=entity_id,
        before=normalized_before,
        after=normalized_after,
    )
    session.add(log)
    session.flush()
    return log


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
    fields=("name", "permission_codes"),
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

# `authentication` 事件 (docs/specs/audit-log/spec.md#authentication-事件,
# ALG-R17). Registered here per ALG-R13; written at the actual
# set-password/lock-account call sites by `authentication`'s own
# T6/T8/T11 (issue #216's plan.md excludes those call sites from this
# task).
register_audit_event(
    "user.password_set",
    entity_type="user",
    kind=AuditEventKind.UPDATED,
    # "之前沒有密碼時為空值" (spec.md) is read here as the *value* of
    # is_temporary being None on the before side when there was no
    # prior password to report a flag for -- before/after stay
    # present dicts (still a 修改 shape, ALG-R09), not a ``None``
    # payload: this event can also just change the flag on an
    # existing password, which only a 修改 shape covers uniformly.
    # Not exercised by this module's own tests (ALG-AC12 only covers
    # the "flag unchanged" case) -- authentication's own T6 call site
    # is where this reading gets its real test.
    fields=("is_temporary",),
    always_write=True,
)
register_audit_event(
    "user.locked",
    entity_type="user",
    kind=AuditEventKind.CREATED,
    fields=("locked_until",),
    system_event=True,
)
