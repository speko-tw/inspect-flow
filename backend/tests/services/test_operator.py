"""Tests for ``app/services/operator.py``.

Fixtures (``session``) come from this directory's ``conftest.py``;
this module builds its own ``User``/``Company`` rows instead of
using the ``operator`` fixture, since the point here is exercising
:func:`get_current_operator` with zero, one and two ``is_system``
rows.
"""

import pytest
from sqlalchemy import text, update

from app.models import User
from app.services.operator import (
    MultipleOperatorsFoundError,
    OperatorNotFoundError,
    get_current_operator,
    get_system_operator,
)
from tests.db.conftest import create_root_user_with_company, make_system_admin


class TestGetCurrentOperator:
    def test_no_is_system_user_raises_operator_not_found(self, session):
        with pytest.raises(OperatorNotFoundError):
            get_current_operator(session)

    def test_two_is_system_users_raise_multiple_operators_found(self, session):
        first = create_root_user_with_company(session, "OPR010")
        make_system_admin(first)
        second = create_root_user_with_company(session, "OPR011")
        session.flush()
        # A second built-in account cannot exist under the schema
        # (``username = 'admin'`` is required and unique, DOM-R45/
        # DOM-R50), so this defensive case is arranged with SQLite's
        # CHECK enforcement switched off for this one statement.
        session.execute(text("PRAGMA ignore_check_constraints = ON"))
        session.execute(
            update(User)
            .where(User.id == second.id)
            .values(
                is_system=True,
                is_admin=True,
                company_id=None,
                department=None,
                location=None,
                employee_no=None,
                name_zh=None,
                name_en=None,
            )
        )
        session.execute(text("PRAGMA ignore_check_constraints = OFF"))
        session.expire_all()

        with pytest.raises(MultipleOperatorsFoundError):
            get_current_operator(session)


def test_shared_system_operator_lookup_returns_builtin_account(session):
    operator = create_root_user_with_company(session, "OPR012")
    make_system_admin(operator)
    session.flush()

    assert get_system_operator(session) is operator
