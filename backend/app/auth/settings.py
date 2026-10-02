"""Login state timeouts and password lockout settings (AUT-R15/R28).

Both timeouts are read from environment variables so a deployment
can widen or narrow them without a code change; an unset or empty
value falls back to AUT-R15's defaults (idle 60 minutes, absolute
8 hours), matching how ``app.db.settings.get_database_url`` resolves
its own environment variable. Names are also listed in the repo
root's ``.env.example`` (AUT-AC15).

AUT-R28's three lockout defaults live below as constants. Their
environment overrides are also resolved on each call, with unset or
empty values falling back to those defaults (AUT-AC48).

Every value that is set must be a positive integer; ``0``, negative
numbers, decimals and non-numeric text raise
``InvalidAuthSettingError`` naming the variable, because such a
value would silently disable a lockout or log users out at once.
``create_app`` calls ``validate_auth_settings`` so a bad value stops
the server at startup instead of failing on the first login.
"""

import os
from dataclasses import dataclass
from datetime import timedelta

IDLE_TIMEOUT_ENV_VAR = "INSPECTFLOW_SESSION_IDLE_TIMEOUT_MINUTES"
ABSOLUTE_TIMEOUT_ENV_VAR = "INSPECTFLOW_SESSION_ABSOLUTE_TIMEOUT_HOURS"

_DEFAULT_IDLE_TIMEOUT = timedelta(minutes=60)
_DEFAULT_ABSOLUTE_TIMEOUT = timedelta(hours=8)

FAILURE_THRESHOLD_ENV_VAR = "INSPECTFLOW_LOGIN_FAILURE_THRESHOLD"
FAILURE_WINDOW_ENV_VAR = "INSPECTFLOW_LOGIN_FAILURE_WINDOW_MINUTES"
LOCKOUT_DURATION_ENV_VAR = "INSPECTFLOW_LOGIN_LOCKOUT_MINUTES"

SETUP_FAILURE_THRESHOLD_ENV_VAR = "INSPECTFLOW_SETUP_FAILURE_THRESHOLD"
SETUP_FAILURE_WINDOW_ENV_VAR = "INSPECTFLOW_SETUP_FAILURE_WINDOW_MINUTES"
SETUP_LOCKOUT_DURATION_ENV_VAR = "INSPECTFLOW_SETUP_LOCKOUT_MINUTES"

_DEFAULT_FAILURE_THRESHOLD = 10
_DEFAULT_FAILURE_WINDOW = timedelta(minutes=15)
_DEFAULT_LOCKOUT_DURATION = timedelta(minutes=15)

_DEFAULT_SETUP_FAILURE_THRESHOLD = 10
_DEFAULT_SETUP_FAILURE_WINDOW = timedelta(minutes=15)
_DEFAULT_SETUP_LOCKOUT_DURATION = timedelta(minutes=15)


class InvalidAuthSettingError(ValueError):
    """An auth environment variable is set to an unusable value."""


def _read_positive_int(name: str, default: int) -> int:
    """Return ``name`` as a positive integer; unset or empty -> default.

    Decimals, zero, negatives and non-numeric text raise
    ``InvalidAuthSettingError`` that names the variable and value.
    """
    raw = os.environ.get(name, "")
    if not raw:
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        value = 0
    if value <= 0:
        raise InvalidAuthSettingError(
            f"{name} must be a positive integer, got {raw!r}"
        )
    return value


def _read_duration(name: str, unit: str, default: timedelta) -> timedelta:
    """Return ``name`` as a ``timedelta`` of ``unit`` (``minutes`` or
    ``hours``); unset or empty -> default."""
    default_value = int(default / timedelta(**{unit: 1}))
    value = _read_positive_int(name, default_value)
    try:
        return timedelta(**{unit: value})
    except OverflowError:
        raise InvalidAuthSettingError(
            f"{name} is too large, got {os.environ.get(name)!r}"
        ) from None


@dataclass(frozen=True)
class LockoutSettings:
    failure_threshold: int
    failure_window: timedelta
    lockout_duration: timedelta


@dataclass(frozen=True)
class SetupLockoutSettings:
    failure_threshold: int
    failure_window: timedelta
    lockout_duration: timedelta


def get_setup_lockout_settings() -> SetupLockoutSettings:
    """Read AUT-R45 settings at call time."""
    return SetupLockoutSettings(
        failure_threshold=_read_positive_int(
            SETUP_FAILURE_THRESHOLD_ENV_VAR, _DEFAULT_SETUP_FAILURE_THRESHOLD
        ),
        failure_window=_read_duration(
            SETUP_FAILURE_WINDOW_ENV_VAR,
            "minutes",
            _DEFAULT_SETUP_FAILURE_WINDOW,
        ),
        lockout_duration=_read_duration(
            SETUP_LOCKOUT_DURATION_ENV_VAR,
            "minutes",
            _DEFAULT_SETUP_LOCKOUT_DURATION,
        ),
    )


def get_lockout_settings() -> LockoutSettings:
    """Read AUT-R28 values at call time so env overrides take effect."""
    return LockoutSettings(
        failure_threshold=_read_positive_int(
            FAILURE_THRESHOLD_ENV_VAR, _DEFAULT_FAILURE_THRESHOLD
        ),
        failure_window=_read_duration(
            FAILURE_WINDOW_ENV_VAR, "minutes", _DEFAULT_FAILURE_WINDOW
        ),
        lockout_duration=_read_duration(
            LOCKOUT_DURATION_ENV_VAR, "minutes", _DEFAULT_LOCKOUT_DURATION
        ),
    )


@dataclass(frozen=True)
class SessionTimeouts:
    """The two AUT-R15 deadlines, both as ``timedelta``."""

    idle_timeout: timedelta
    absolute_timeout: timedelta


def get_session_timeouts() -> SessionTimeouts:
    """Resolve the current idle/absolute timeouts from the
    environment.

    This is a plain function (not a module-level constant) so a
    changed environment variable -- as tests do with
    ``monkeypatch`` -- takes effect on the next call instead of
    only at import time.
    """
    return SessionTimeouts(
        idle_timeout=_read_duration(
            IDLE_TIMEOUT_ENV_VAR, "minutes", _DEFAULT_IDLE_TIMEOUT
        ),
        absolute_timeout=_read_duration(
            ABSOLUTE_TIMEOUT_ENV_VAR, "hours", _DEFAULT_ABSOLUTE_TIMEOUT
        ),
    )


def validate_auth_settings() -> None:
    """Resolve every auth setting once so a bad value fails fast.

    Raises ``InvalidAuthSettingError`` for the first invalid variable.
    """
    get_session_timeouts()
    get_lockout_settings()
    get_setup_lockout_settings()
