"""Fixtures shared across more than one ``backend/tests/``
subpackage. Anything only one subpackage needs stays in that
subpackage's own ``conftest.py`` (e.g. ``tests/db/conftest.py``'s
``db_url``); this file is only for fixtures reused across
subpackage boundaries.
"""

import pytest

from app import permission_codes
from app.api.errors import DescribedStrEnum


class _TestPermissionCode(DescribedStrEnum):
    """Test-only registry standing in for the production
    ``PermissionCode`` (``app/permission_codes.py``).
    Mirrors ``tests/contract/test_error_envelope.py``'s
    ``SupersetCode``/``SwappedCode`` pattern (API-AC10b): a
    throwaway ``DescribedStrEnum`` subclass exercised in tests,
    never a member added to the production ``PermissionCode``.

    ``EVIDENCE_CREATE``/``EVIDENCE_UPDATE`` were added for T4's
    AUT-AC44 (``tests/auth/test_access.py``), which needs a code per
    non-read action to prove Admin passes every one of them.
    """

    REPORT_READ = ("report.read", "test")
    REPORT_APPROVE = ("report.approve", "test")
    EVIDENCE_READ = ("evidence.read", "test")
    EVIDENCE_CREATE = ("evidence.create", "test")
    EVIDENCE_UPDATE = ("evidence.update", "test")
    EVIDENCE_DELETE = ("evidence.delete", "test")
    PROJECT_MEMBER_MANAGE = ("project_member.manage", "test")


@pytest.fixture
def registered_permission_codes(
    monkeypatch: pytest.MonkeyPatch,
) -> type[DescribedStrEnum]:
    """Swap DOM-R35's active registry for ``_TestPermissionCode`` for
    the duration of one test, then restore it -- lets a test exercise
    the registered/unregistered behavior without ever registering a
    fake code against the real ``PermissionCode``.

    Shared by ``tests/db/test_role_member.py`` (T3, DOM-AC25) and the
    future T5 (``tests/services/test_permissions.py``)/T7
    (``tests/services/test_roles.py``) tasks (plan.md), which is why
    it lives here rather than under ``tests/db/`` alone.
    """
    monkeypatch.setattr(
        permission_codes, "_active_registry", _TestPermissionCode
    )
    return _TestPermissionCode
