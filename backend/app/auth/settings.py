"""Login state timeout settings (AUT-R15).

Both timeouts are read from environment variables so a deployment
can widen or narrow them without a code change; an unset or empty
value falls back to AUT-R15's defaults (idle 60 minutes, absolute
8 hours), matching how ``app.db.settings.get_database_url`` resolves
its own environment variable. Names are also listed in the repo
root's ``.env.example`` (AUT-AC15).
"""

import os
from dataclasses import dataclass
from datetime import timedelta

IDLE_TIMEOUT_ENV_VAR = "INSPECTFLOW_SESSION_IDLE_TIMEOUT_MINUTES"
ABSOLUTE_TIMEOUT_ENV_VAR = "INSPECTFLOW_SESSION_ABSOLUTE_TIMEOUT_HOURS"

_DEFAULT_IDLE_TIMEOUT = timedelta(minutes=60)
_DEFAULT_ABSOLUTE_TIMEOUT = timedelta(hours=8)


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
    idle_raw = os.environ.get(IDLE_TIMEOUT_ENV_VAR, "")
    absolute_raw = os.environ.get(ABSOLUTE_TIMEOUT_ENV_VAR, "")
    idle_timeout = (
        timedelta(minutes=float(idle_raw))
        if idle_raw
        else _DEFAULT_IDLE_TIMEOUT
    )
    absolute_timeout = (
        timedelta(hours=float(absolute_raw))
        if absolute_raw
        else _DEFAULT_ABSOLUTE_TIMEOUT
    )
    return SessionTimeouts(
        idle_timeout=idle_timeout, absolute_timeout=absolute_timeout
    )
