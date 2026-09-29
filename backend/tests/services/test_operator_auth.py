"""Tests for T5's authentication-aware rewrite of
``app/services/operator.py`` (AUT-AC09, issue #153).

Fixtures (``session``, ``operator``, ``engine``, ``migrated_url``)
come from this directory's ``conftest.py``. ``make_local_user``/
``DEFAULT_TEST_PASSWORD`` are a plain module import (not fixture
sharing -- pytest only shares a ``conftest.py``'s fixtures with its
own directory and below, ``tests/services/`` is a sibling of
``tests/auth/``) from ``tests/auth/conftest.py``, matching the
pattern that file's own docstring already uses for
``tests/db/conftest.py``.

``test_operator.py`` already covers the "outside of any request"
fallback (``OperatorNotFoundError``/``MultipleOperatorsFoundError``
with zero/two ``is_system`` rows) -- this module does not repeat
those cases, since T5's change does not touch that code path at all.
"""

import inspect

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import bind_request_scope, get_db, require_login
from app.main import create_app
from app.models import Company, User
from app.services.companies import create_company
from app.services.operator import (
    OperatorNotAuthenticatedError,
    get_current_operator,
)
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user

PASSWORD = DEFAULT_TEST_PASSWORD


class _CreateCompanyBody(BaseModel):
    code: str


def _client_with_company_route() -> TestClient:
    """A test-only, needs-login route that writes one ``Company``
    through the Service layer (AUT-AC09's "會透過目前操作者入口寫入
    一筆 Company 的路由").

    A plain ``def`` handler, not ``async def``: FastAPI/Starlette
    dispatch a sync route handler through a worker thread
    (``anyio.to_thread.run_sync``, see
    ``app.auth.dependencies.require_login``'s docstring), so this
    proves the request-scoped operator ``require_login`` sets is
    actually visible from inside that thread, not only from the
    coroutine that resolved the dependency.
    """
    app = create_app()
    router = APIRouter()

    def create_test_company(
        body: _CreateCompanyBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _user: User = Depends(require_login),  # noqa: B008
    ) -> dict[str, str]:
        company = create_company(db, name=f"AC09 {body.code}")
        return {
            "id": str(company.id),
            "created_by": str(company.created_by),
            "updated_by": str(company.updated_by),
        }

    assert not inspect.iscoroutinefunction(create_test_company)
    router.add_api_route(
        "/api/v1/test/companies",
        create_test_company,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(app, base_url="https://testserver")


def _company_count(session: Session) -> int:
    session.expire_all()
    count = session.scalar(select(func.count()).select_from(Company))
    assert count is not None
    return count


class TestAutAc09CurrentOperatorEntryPoint:
    def test_logged_in_caller_is_recorded_as_created_by(
        self, session, migrated_url
    ):
        user = make_local_user(session, "OPR900")
        client = _client_with_company_route()

        login_resp = client.post(
            "/api/v1/auth/login",
            json={"email": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200

        resp = client.post("/api/v1/test/companies", json={"code": "AC09A"})

        assert resp.status_code == 201
        body = resp.json()
        assert body["created_by"] == str(user.id)
        assert body["updated_by"] == str(user.id)

    def test_no_cookie_is_rejected_and_writes_nothing(
        self, session, migrated_url
    ):
        client = _client_with_company_route()
        before = _company_count(session)

        resp = client.post("/api/v1/test/companies", json={"code": "AC09B"})

        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "auth.not_authenticated"
        assert _company_count(session) == before

    def test_direct_service_call_outside_a_request_uses_builtin_admin(
        self, session, operator
    ):
        company = create_company(session, name="AC09C Co")

        assert company.created_by == operator.id
        assert company.updated_by == operator.id


class TestAutR09NotLoggedInDuringRequestIsRejected:
    """Unit-level complement to AC09: a request that only marked
    itself as "in progress" (``bind_request_scope``) without anyone
    logged in must reject rather than fall back to the built-in
    ``admin`` (AUT-R09).

    Uses a bare ``FastAPI()`` app with no exception handlers
    registered -- not ``app.main.create_app()`` -- so the raised
    :class:`OperatorNotAuthenticatedError` propagates to the test
    unchanged instead of being turned into an opaque 500 response by
    the catch-all handler ``register_error_handlers`` installs; this
    is Starlette's ``TestClient`` default behavior
    (``raise_server_exceptions=True``), not private API poking.
    """

    def test_bind_request_scope_alone_raises_not_authenticated(
        self, migrated_url
    ):
        app = FastAPI()

        def probe(
            db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
            _scope: None = Depends(bind_request_scope),  # noqa: B008
        ) -> None:
            get_current_operator(db)

        app.add_api_route("/probe", probe, methods=["GET"])
        client = TestClient(app, base_url="https://testserver")

        with pytest.raises(OperatorNotAuthenticatedError):
            client.get("/probe")


class TestForgottenRouteStillRejectedByAppLevelScope:
    """Reviewer's required counter-example (PR #187): a route built
    on ``app.main.create_app()`` that depends on neither
    ``require_login`` nor ``bind_request_scope`` directly must still
    be rejected for an anonymous caller.

    Before this fix, such a route left ``in_request_scope()`` at
    ``False`` (nothing ever called ``bind_request_scope``), so
    ``get_current_operator`` treated it as "not a request" and fell
    back to the built-in ``admin`` -- an anonymous POST would
    succeed with ``created_by = admin`` instead of failing (AUT-R09,
    plan.md's T5 risk section). ``create_app()`` now applies
    ``Depends(bind_request_scope)`` at the app level
    (``backend/app/main.py``), so every route -- including one that
    forgets to declare an access level -- runs inside the request
    scope, and an anonymous write raises
    ``OperatorNotAuthenticatedError``, which the catch-all handler
    turns into a 500 ``server.internal_error`` with the transaction
    rolled back (``app.db.unit_of_work``).

    Depends on the ``operator`` fixture (a committed ``is_system``
    row) rather than a bare empty database: without one, the "not a
    request" fallback path in ``get_current_operator`` raises its
    own ``OperatorNotFoundError`` regardless of this fix, which would
    also surface as a 500 and mask whether the fix actually did
    anything. With a built-in admin present, the pre-fix behavior is
    a *successful* 201 with ``created_by`` set to that admin -- the
    exact silent-fallback bug this test guards against -- so only
    the fix turns this into a rejected write.
    """

    def test_route_without_explicit_scope_rejects_anonymous_write(
        self, session, migrated_url, operator
    ):
        # ``operator`` only flushes (tests/services/conftest.py);
        # commit so the TestClient's own DB connection (a separate
        # connection to the same SQLite file, opened through
        # ``app.db.unit_of_work``) can see this row.
        session.commit()
        app = create_app()
        router = APIRouter()

        def create_test_company_no_scope(
            body: _CreateCompanyBody,
            db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        ) -> dict[str, str]:
            company = create_company(db, name=f"AC09 {body.code}")
            return {"id": str(company.id)}

        assert not inspect.iscoroutinefunction(create_test_company_no_scope)
        router.add_api_route(
            "/api/v1/test/companies-no-scope",
            create_test_company_no_scope,
            methods=["POST"],
            status_code=201,
        )
        app.include_router(router)
        # ``raise_server_exceptions=False``: create_app()'s catch-all
        # handler turns the unhandled exception into a JSON 500
        # response, but Starlette's ``ServerErrorMiddleware``
        # re-raises the original exception after sending it anyway
        # (so it is still visible to e.g. logging middleware) --
        # this is Starlette's documented ``TestClient`` behavior,
        # not private API poking, and matches how this module's own
        # ``_client_with_company_route`` test client is used for the
        # 401 case above (a plain ``APIError`` does not hit this
        # code path since it is not the catch-all handler).
        client = TestClient(
            app, base_url="https://testserver", raise_server_exceptions=False
        )
        before = _company_count(session)

        resp = client.post(
            "/api/v1/test/companies-no-scope", json={"code": "AC09D"}
        )

        assert resp.status_code == 500
        assert resp.json()["error"]["code"] == "server.internal_error"
        assert _company_count(session) == before
