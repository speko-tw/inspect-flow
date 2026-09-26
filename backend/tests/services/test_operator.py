"""Tests for ``app/services/operator.py``.

Fixtures (``session``) come from this directory's ``conftest.py``;
this module builds its own ``User``/``Company`` rows instead of
using the ``operator`` fixture, since the point here is exercising
:func:`get_current_operator` with zero, one and two ``is_system``
rows.
"""

import pytest

from app.services.operator import (
    MultipleOperatorsFoundError,
    OperatorNotFoundError,
    get_current_operator,
)
from tests.db.conftest import create_root_user_with_company


class TestGetCurrentOperator:
    def test_no_is_system_user_raises_operator_not_found(self, session):
        with pytest.raises(OperatorNotFoundError):
            get_current_operator(session)

    def test_two_is_system_users_raise_multiple_operators_found(self, session):
        first = create_root_user_with_company(session, "OPR010")
        first.is_system = True
        second = create_root_user_with_company(session, "OPR011")
        second.is_system = True
        session.flush()

        with pytest.raises(MultipleOperatorsFoundError):
            get_current_operator(session)
