"""Tests for ``app/services/audit.py`` (``docs/specs/audit-log/
spec.md`` T2, issue #216).

AC labels below follow that spec's numbering:

- ALG-AC04: the single entry point's ``created_by``/``created_at``
  come from the current-operator and clock entry points, never from
  the caller, in all three request-scope situations.
- ALG-AC05: a failure inside the same transaction as a write rolls
  back both the write and the audit row together.
- ALG-AC06: unregistered codes, undeclared fields, and an unchanged
  修改 event are all rejected without writing a row; no declared
  field name looks like a secret.
- ALG-AC09: registering a brand-new event needs no migration.
- ALG-AC10: every registered event code matches ALG-R07's format and
  its "資料" segment equals its ``entity_type``.
- ALG-AC12: a "系統事件" (``user.locked``) always resolves to the
  built-in admin, in or out of a request, logged in or not; a
  non-system event still requires a logged-in operator; an "每次都寫"
  event (``user.password_set``) writes successfully even with
  identical before/after.
- ALG-AC13: only catalogued events accept the ``system_event``
  declaration, in all request scopes.
- ALG-AC16: resetting admin reuses ``user.password_set`` without
  adding a reset-specific event code.

Fixtures (``session``, ``operator``, ``engine``, ``migrated_url``)
come from this directory's ``conftest.py``.
"""

import inspect
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from pydantic import BaseModel
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session, sessionmaker

from app.auth.dependencies import bind_request_scope, get_db, require_login
from app.auth.password_service import set_password
from app.cli.reset_admin_password import run as reset_admin_password
from app.db import clock
from app.db.base import uuid7
from app.db.unit_of_work import unit_of_work
from app.main import create_app
from app.models import AuditLog, Company
from app.services.audit import (
    _EVENT_CATALOG,
    _EVENT_TYPE_RE,
    AuditEventKind,
    InvalidAuditEventShapeError,
    UnchangedAuditFieldError,
    UndeclaredAuditFieldError,
    UnregisteredAuditEventError,
    record_audit_event,
    record_audit_event_in_independent_transaction,
    register_audit_event,
)
from app.services.companies import create_company, update_company
from app.services.operator import OperatorNotFoundError
from tests.auth.conftest import DEFAULT_TEST_PASSWORD, make_local_user

PASSWORD = DEFAULT_TEST_PASSWORD
_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_DIR / "alembic.ini"


def test_alg_ac14_ac15_management_event_catalog():
    username_event = _EVENT_CATALOG["user.username_changed"]
    company_event = _EVENT_CATALOG["user.company_changed"]
    assert username_event.fields == {"username"}
    assert company_event.fields == {
        "company_id",
        "employee_no",
        "department",
        "location",
    }
    assert company_event.always_recorded == company_event.fields
    assert company_event.nullable_fields == company_event.fields
    for definition in (username_event, company_event):
        assert _EVENT_TYPE_RE.match(definition.event_type)
        assert definition.entity_type == "user"
        for field_name in definition.fields:
            assert not any(
                secret in field_name
                for secret in ("password", "secret", "token", "session")
            )


def test_alg_ac19_to_ac24_two_layer_event_catalog():
    expected = {
        "module_permission.granted": {
            "user_id",
            "permission_code",
            "module",
            "source",
        },
        "module_permission.revoked": {
            "user_id",
            "permission_code",
            "module",
            "source",
        },
        "module_delegation.granted": {"user_id", "module"},
        "module_delegation.revoked": {"user_id", "module"},
        "permission_bundle.created": {"name", "permission_codes"},
        "permission_bundle.updated": {"name", "permission_codes"},
        "permission_bundle.deleted": {"name", "permission_codes"},
        "permission_bundle.applied": {
            "user_id",
            "bundle_id",
            "bundle_name",
            "permission_codes",
        },
        "creator_role.changed": {"creator_role_id"},
        "project.created": {
            "project_code",
            "name",
            "creator_role_user_id",
        },
        "project.updated": {
            "project_code",
            "name",
            "client_name",
            "site_location",
            "planned_start_date",
            "planned_completion_date",
        },
        "project_member.assignment_denied": {
            "project_id",
            "user_id",
            "role_ids",
            "reason",
        },
        "module_permission.grant_denied": {
            "user_id",
            "permission_codes",
            "bundle_id",
            "reason",
        },
        "user.external_flag_changed": {"is_external_collaborator"},
    }
    for event_type, fields in expected.items():
        definition = _EVENT_CATALOG[event_type]
        assert definition.fields == fields
        assert definition.entity_type == event_type.split(".", 1)[0]
        assert _EVENT_TYPE_RE.match(event_type)

    role_updated = _EVENT_CATALOG["role.updated"]
    assert {"is_assignable", "is_external_allowed"} <= role_updated.fields

    active_changed = _EVENT_CATALOG["user.active_changed"]
    assert active_changed.always_recorded == {"is_active"}
    assert active_changed.allow_system_event
    assert active_changed.optional_fields == active_changed.fields - {
        "is_active"
    }


def test_alg_ac26_denial_event_survives_request_transaction_rollback(
    session, operator
):
    session.commit()
    session.add(Company(name="Rolled Back Company"))

    event_id = record_audit_event_in_independent_transaction(
        session,
        "module_permission.grant_denied",
        entity_id=uuid.uuid4(),
        before=None,
        after={
            "user_id": uuid.uuid4(),
            "permission_codes": ["project.create"],
            "reason": "delegation_scope_exceeded",
        },
    )
    session.rollback()

    assert (
        session.query(Company).filter_by(name="Rolled Back Company").count()
        == 0
    )
    persisted = session.get(AuditLog, event_id)
    assert persisted is not None
    assert persisted.created_by == operator.id
    assert persisted.event_type == "module_permission.grant_denied"
    assert persisted.after["permission_codes"] == ["project.create"]
    assert persisted.after["reason"] == "delegation_scope_exceeded"


class _RecordAuditBody(BaseModel):
    entity_id: str


def _client_with_login_required_audit_route() -> TestClient:
    """A needs-login route that writes one ``user.admin_changed``
    row through :func:`record_audit_event` (ALG-AC04's "已綁定 U 的
    請求範圍").
    """
    app = create_app()
    router = APIRouter()

    def record_test_event(
        body: _RecordAuditBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _user=Depends(require_login),  # noqa: B008
    ) -> dict[str, str]:
        log = record_audit_event(
            db,
            "user.admin_changed",
            entity_id=uuid.UUID(body.entity_id),
            before={"is_admin": False},
            after={"is_admin": True},
        )
        return {
            "id": str(log.id),
            "created_by": str(log.created_by),
        }

    router.add_api_route(
        "/api/v1/test/audit-events",
        record_test_event,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(app, base_url="https://testserver")


def _client_with_public_audit_route() -> TestClient:
    """A public route (only ``bind_request_scope``, nobody logged
    in) writing the same event -- ALG-AC04's "沒有登入者的請求範圍".
    """
    app = create_app()
    router = APIRouter()

    def record_test_event_public(
        body: _RecordAuditBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _scope: None = Depends(bind_request_scope),  # noqa: B008
    ) -> dict[str, str]:
        record_audit_event(
            db,
            "user.admin_changed",
            entity_id=uuid.UUID(body.entity_id),
            before={"is_admin": False},
            after={"is_admin": True},
        )
        return {}

    router.add_api_route(
        "/api/v1/test/audit-events-public",
        record_test_event_public,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(
        app, base_url="https://testserver", raise_server_exceptions=False
    )


class _GenericAuditBody(BaseModel):
    """ALG-AC12 needs to drive several different event codes/shapes
    through the same two routes below, unlike ALG-AC04's fixed
    ``user.admin_changed`` body.
    """

    event_type: str
    entity_id: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


def _client_with_generic_login_required_route() -> TestClient:
    """A needs-login route that writes whatever event
    ``_GenericAuditBody`` names (ALG-AC12's "已綁定 U 的請求範圍").
    """
    app = create_app()
    router = APIRouter()

    def record_generic_event(
        body: _GenericAuditBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _user=Depends(require_login),  # noqa: B008
    ) -> dict[str, str]:
        log = record_audit_event(
            db,
            body.event_type,
            entity_id=uuid.UUID(body.entity_id),
            before=body.before,
            after=body.after,
        )
        return {"id": str(log.id), "created_by": str(log.created_by)}

    router.add_api_route(
        "/api/v1/test/generic-audit-events",
        record_generic_event,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(app, base_url="https://testserver")


def _client_with_generic_public_route() -> TestClient:
    """A public route (only ``bind_request_scope``, nobody logged
    in) writing whatever event ``_GenericAuditBody`` names
    (ALG-AC12's "沒有登入者的請求範圍"). ``raise_server_exceptions=
    False`` since some of ALG-AC12's calls through this route are
    expected to fail (a non-system event with nobody logged in).
    """
    app = create_app()
    router = APIRouter()

    def record_generic_event_public(
        body: _GenericAuditBody,
        db: Session = Depends(get_db),  # noqa: B008 -- FastAPI's DI
        _scope: None = Depends(bind_request_scope),  # noqa: B008
    ) -> dict[str, str]:
        log = record_audit_event(
            db,
            body.event_type,
            entity_id=uuid.UUID(body.entity_id),
            before=body.before,
            after=body.after,
        )
        return {"id": str(log.id), "created_by": str(log.created_by)}

    router.add_api_route(
        "/api/v1/test/generic-audit-events-public",
        record_generic_event_public,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(
        app, base_url="https://testserver", raise_server_exceptions=False
    )


class _SystemEventAuditBody(BaseModel):
    event_type: str
    entity_id: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    system_event: bool = False


def _client_with_system_event_audit_route(
    *, requires_login: bool
) -> TestClient:
    app = create_app()
    router = APIRouter()

    if requires_login:

        def record_event_logged_in(
            body: _SystemEventAuditBody,
            db: Session = Depends(get_db),  # noqa: B008
            _user=Depends(require_login),  # noqa: B008
        ) -> dict[str, str]:
            log = record_audit_event(
                db,
                body.event_type,
                entity_id=uuid.UUID(body.entity_id),
                before=body.before,
                after=body.after,
                system_event=body.system_event,
            )
            return {"created_by": str(log.created_by)}

        endpoint = record_event_logged_in
        raise_server_exceptions = True
    else:

        def record_event_public(
            body: _SystemEventAuditBody,
            db: Session = Depends(get_db),  # noqa: B008
            _scope: None = Depends(bind_request_scope),  # noqa: B008
        ) -> dict[str, str]:
            log = record_audit_event(
                db,
                body.event_type,
                entity_id=uuid.UUID(body.entity_id),
                before=body.before,
                after=body.after,
                system_event=body.system_event,
            )
            return {"created_by": str(log.created_by)}

        endpoint = record_event_public
        raise_server_exceptions = False

    router.add_api_route(
        "/api/v1/test/system-event-audit",
        endpoint,
        methods=["POST"],
        status_code=201,
    )
    app.include_router(router)
    return TestClient(
        app,
        base_url="https://testserver",
        raise_server_exceptions=raise_server_exceptions,
    )


class TestAlgAc04SingleEntryPointOperatorAndClock:
    def test_outside_request_uses_builtin_admin_and_fixed_clock(
        self, session, operator
    ):
        fixed = datetime(2026, 2, 2, 3, 4, 5, tzinfo=UTC)
        clock.set_clock(lambda: fixed)
        try:
            log = record_audit_event(
                session,
                "role.created",
                entity_id=uuid7(),
                before=None,
                after={
                    "name": "Inspector",
                    "permission_codes": ["report.approve"],
                },
            )
        finally:
            clock.reset_clock()

        assert log.created_by == operator.id
        assert log.created_at == fixed

    def test_bound_request_scope_records_that_user_and_fixed_clock(
        self, session, migrated_url
    ):
        fixed = datetime(2026, 3, 3, 4, 5, 6, tzinfo=UTC)
        user = make_local_user(session, "AUD004")
        session.commit()
        clock.set_clock(lambda: fixed)
        try:
            client = _client_with_login_required_audit_route()
            login_resp = client.post(
                "/api/v1/auth/login",
                json={"login": user.email, "password": PASSWORD},
            )
            assert login_resp.status_code == 200

            resp = client.post(
                "/api/v1/test/audit-events",
                json={"entity_id": str(uuid7())},
            )
        finally:
            clock.reset_clock()

        assert resp.status_code == 201
        assert resp.json()["created_by"] == str(user.id)

        session.expire_all()
        log = session.get(AuditLog, uuid.UUID(resp.json()["id"]))
        assert log is not None
        assert log.created_by == user.id
        assert log.created_at == fixed

    def test_no_login_in_request_scope_is_rejected_and_writes_nothing(
        self, session, migrated_url
    ):
        before_count = session.query(AuditLog).count()
        client = _client_with_public_audit_route()

        resp = client.post(
            "/api/v1/test/audit-events-public",
            json={"entity_id": str(uuid7())},
        )

        assert resp.status_code == 500
        session.expire_all()
        assert session.query(AuditLog).count() == before_count

    def test_entry_point_has_no_operator_or_time_parameters(self):
        params = inspect.signature(record_audit_event).parameters
        assert "created_by" not in params
        assert "created_at" not in params

        with pytest.raises(TypeError):
            record_audit_event(
                None,  # pyright: ignore[reportArgumentType]
                "role.created",
                entity_id=uuid7(),
                before=None,
                after={"name": "x", "permission_codes": []},
                created_by=uuid7(),  # pyright: ignore[reportCallIssue]
            )
        fixed_now = datetime.now(UTC)
        with pytest.raises(TypeError):
            record_audit_event(
                None,  # pyright: ignore[reportArgumentType]
                "role.created",
                entity_id=uuid7(),
                before=None,
                after={"name": "x", "permission_codes": []},
                created_at=fixed_now,  # pyright: ignore[reportCallIssue]
            )


class TestAlgAc05TransactionalWrite:
    def test_rolls_back_company_change_on_later_exception(
        self, session, operator
    ):
        company = create_company(session, name="Audit Co A")
        session.commit()
        original_name = company.name
        before_count = session.query(AuditLog).count()

        class _BoomError(Exception):
            pass

        with pytest.raises(_BoomError):
            with unit_of_work() as uow_session:
                uow_company = uow_session.get(Company, company.id)
                assert uow_company is not None
                update_company(uow_session, uow_company, name="Renamed A")
                record_audit_event(
                    uow_session,
                    "role.created",
                    entity_id=uuid7(),
                    before=None,
                    after={"name": "R1", "permission_codes": []},
                )
                raise _BoomError()

        session.expire_all()
        assert session.get(Company, company.id).name == original_name
        assert session.query(AuditLog).count() == before_count

    def test_rolls_back_company_change_on_unregistered_event_code(
        self, session, operator
    ):
        company = create_company(session, name="Audit Co B")
        session.commit()
        original_name = company.name
        before_count = session.query(AuditLog).count()

        with pytest.raises(UnregisteredAuditEventError):
            with unit_of_work() as uow_session:
                uow_company = uow_session.get(Company, company.id)
                assert uow_company is not None
                update_company(uow_session, uow_company, name="Renamed B")
                record_audit_event(
                    uow_session,
                    "role.renamed",
                    entity_id=uuid7(),
                    before=None,
                    after={"name": "x"},
                )

        session.expire_all()
        assert session.get(Company, company.id).name == original_name
        assert session.query(AuditLog).count() == before_count


class TestAlgAc06RejectedWrites:
    def test_unregistered_event_code_is_rejected(self, session, operator):
        before_count = session.query(AuditLog).count()

        with pytest.raises(UnregisteredAuditEventError):
            record_audit_event(
                session,
                "role.renamed",
                entity_id=uuid7(),
                before=None,
                after={"name": "x"},
            )

        assert session.query(AuditLog).count() == before_count

    def test_undeclared_field_is_rejected(self, session, operator):
        before_count = session.query(AuditLog).count()

        with pytest.raises(UndeclaredAuditFieldError):
            record_audit_event(
                session,
                "role.updated",
                entity_id=uuid7(),
                before={"name": "Old"},
                after={"name": "New", "password_hash": "x"},
            )

        assert session.query(AuditLog).count() == before_count

    def test_identical_before_after_is_rejected(self, session, operator):
        before_count = session.query(AuditLog).count()

        with pytest.raises(UnchangedAuditFieldError):
            record_audit_event(
                session,
                "role.updated",
                entity_id=uuid7(),
                before={"name": "Same"},
                after={"name": "Same"},
            )

        assert session.query(AuditLog).count() == before_count

    def test_no_declared_field_name_looks_like_a_secret(self):
        forbidden = ("password", "secret", "token", "session")
        for definition in _EVENT_CATALOG.values():
            for field_name in definition.fields:
                lowered = field_name.lower()
                assert not any(bad in lowered for bad in forbidden), (
                    definition.event_type,
                    field_name,
                )


class TestAlgAc09NewEventNeedsNoSchemaChange:
    _TEST_EVENT_TYPE = "user.audit_test_probe"

    @pytest.fixture(autouse=True)
    def _restore_catalog(self):
        try:
            yield
        finally:
            _EVENT_CATALOG.pop(self._TEST_EVENT_TYPE, None)

    def test_registering_and_writing_a_new_event_needs_no_migration(
        self, session, operator, engine
    ):
        cfg = Config(str(_ALEMBIC_INI))
        heads_before = ScriptDirectory.from_config(cfg).get_heads()
        assert len(heads_before) == 1
        columns_before = {
            col["name"] for col in sa_inspect(engine).get_columns("audit_logs")
        }

        register_audit_event(
            self._TEST_EVENT_TYPE,
            entity_type="user",
            kind=AuditEventKind.UPDATED,
            fields=("department", "location", "name_en"),
        )
        log = record_audit_event(
            session,
            self._TEST_EVENT_TYPE,
            entity_id=uuid7(),
            before={"department": "Old"},
            after={"department": "New"},
        )
        session.commit()

        session.expire_all()
        fetched = session.get(AuditLog, log.id)
        assert fetched is not None
        assert fetched.event_type == self._TEST_EVENT_TYPE
        assert fetched.entity_type == "user"
        assert fetched.before == {"department": "Old"}
        assert fetched.after == {"department": "New"}

        heads_after = ScriptDirectory.from_config(cfg).get_heads()
        columns_after = {
            col["name"] for col in sa_inspect(engine).get_columns("audit_logs")
        }
        assert heads_after == heads_before
        assert columns_after == columns_before


class TestAlgAc10EventCodeFormat:
    def test_every_registered_event_code_matches_format_and_entity_type(
        self,
    ):
        for event_type, definition in _EVENT_CATALOG.items():
            assert _EVENT_TYPE_RE.match(event_type) is not None
            data_segment = event_type.split(".", 1)[0]
            assert data_segment == definition.entity_type


class TestAlgAc12SystemEventAndAlwaysWriteFlags:
    """ALG-AC12: ``user.locked`` (system_event) always resolves to
    the built-in admin, whether nobody is logged in or U is;
    ``user.password_set`` (always_write) and ``role.created``
    (neither flag) still require a logged-in operator; identical
    before/after does not stop ``user.password_set`` from writing.
    """

    def test_system_event_without_builtin_operator_raises_not_found(
        self, session, monkeypatch
    ):
        query_result = Mock()
        query_result.one_or_none.return_value = None
        monkeypatch.setattr(session, "scalars", lambda *_args: query_result)

        with pytest.raises(OperatorNotFoundError):
            record_audit_event(
                session,
                "user.locked",
                entity_id=uuid7(),
                before=None,
                after={"locked_until": "2026-03-03T00:00:00Z"},
            )

    def test_system_event_and_always_write_flags(
        self, session, operator, migrated_url
    ):
        admin = operator
        user = make_local_user(session, "AUD012")
        session.commit()

        public_client = _client_with_generic_public_route()

        locked_no_login = public_client.post(
            "/api/v1/test/generic-audit-events-public",
            json={
                "event_type": "user.locked",
                "entity_id": str(user.id),
                "before": None,
                "after": {"locked_until": "2026-01-01T00:00:00Z"},
            },
        )
        assert locked_no_login.status_code == 201
        assert locked_no_login.json()["created_by"] == str(admin.id)

        password_set_no_login = public_client.post(
            "/api/v1/test/generic-audit-events-public",
            json={
                "event_type": "user.password_set",
                "entity_id": str(user.id),
                "before": {"is_temporary": True},
                "after": {"is_temporary": True},
            },
        )
        assert password_set_no_login.status_code == 500

        role_created_no_login = public_client.post(
            "/api/v1/test/generic-audit-events-public",
            json={
                "event_type": "role.created",
                "entity_id": str(uuid7()),
                "before": None,
                "after": {"name": "R012", "permission_codes": []},
            },
        )
        assert role_created_no_login.status_code == 500

        session.expire_all()
        before_count = session.query(AuditLog).count()

        login_client = _client_with_generic_login_required_route()
        login_resp = login_client.post(
            "/api/v1/auth/login",
            json={"login": user.email, "password": PASSWORD},
        )
        assert login_resp.status_code == 200

        locked_u_scope = login_client.post(
            "/api/v1/test/generic-audit-events",
            json={
                "event_type": "user.locked",
                "entity_id": str(user.id),
                "before": None,
                "after": {"locked_until": "2026-02-02T00:00:00Z"},
            },
        )
        assert locked_u_scope.status_code == 201
        assert locked_u_scope.json()["created_by"] == str(admin.id)

        password_set_body = {
            "event_type": "user.password_set",
            "entity_id": str(user.id),
            "before": {"is_temporary": True},
            "after": {"is_temporary": True},
        }
        password_set_u_scope_1 = login_client.post(
            "/api/v1/test/generic-audit-events", json=password_set_body
        )
        assert password_set_u_scope_1.status_code == 201
        assert password_set_u_scope_1.json()["created_by"] == str(user.id)

        password_set_u_scope_2 = login_client.post(
            "/api/v1/test/generic-audit-events", json=password_set_body
        )
        assert password_set_u_scope_2.status_code == 201
        assert password_set_u_scope_2.json()["created_by"] == str(user.id)

        session.expire_all()
        # ``before_count`` already includes the successful no-login
        # ``user.locked`` write; the U-scoped block adds 3 more
        # (locked + 2 password_set), the two no-login rejections add
        # none.
        assert session.query(AuditLog).count() == before_count + 3


class TestAlgAc13SetupSystemEventAndAc16AdminReset:
    def test_alg_ac13_declared_system_event_is_limited_to_catalog_entries(
        self, session, operator, migrated_url
    ):
        admin = operator
        user = make_local_user(session, "AUD013")
        session.commit()

        outside_request = record_audit_event(
            session,
            "user.password_set",
            entity_id=user.id,
            before=None,
            after={"is_temporary": False},
            system_event=True,
        )
        assert outside_request.created_by == admin.id
        outside_request_without_declaration = record_audit_event(
            session,
            "user.password_set",
            entity_id=user.id,
            before=None,
            after={"is_temporary": False},
            system_event=False,
        )
        assert outside_request_without_declaration.created_by == admin.id
        session.commit()

        public_client = _client_with_system_event_audit_route(
            requires_login=False
        )
        route = "/api/v1/test/system-event-audit"

        role_as_system = public_client.post(
            route,
            json={
                "event_type": "role.created",
                "entity_id": str(uuid7()),
                "before": None,
                "after": {"name": "R013", "permission_codes": []},
                "system_event": True,
            },
        )
        assert role_as_system.status_code == 500

        no_login_without_declaration = public_client.post(
            route,
            json={
                "event_type": "user.password_set",
                "entity_id": str(user.id),
                "before": None,
                "after": {"is_temporary": False},
                "system_event": False,
            },
        )
        assert no_login_without_declaration.status_code == 500

        no_login_with_declaration = public_client.post(
            route,
            json={
                "event_type": "user.password_set",
                "entity_id": str(user.id),
                "before": None,
                "after": {"is_temporary": False},
                "system_event": True,
            },
        )
        assert no_login_with_declaration.status_code == 201
        assert no_login_with_declaration.json()["created_by"] == str(admin.id)

        login_client = _client_with_system_event_audit_route(
            requires_login=True
        )
        login = login_client.post(
            "/api/v1/auth/login",
            json={"login": user.email, "password": PASSWORD},
        )
        assert login.status_code == 200
        user_as_system = login_client.post(
            route,
            json={
                "event_type": "user.password_set",
                "entity_id": str(user.id),
                "before": None,
                "after": {"is_temporary": False},
                "system_event": True,
            },
        )
        assert user_as_system.status_code == 201
        assert user_as_system.json()["created_by"] == str(admin.id)

        user_without_declaration = login_client.post(
            route,
            json={
                "event_type": "user.password_set",
                "entity_id": str(user.id),
                "before": None,
                "after": {"is_temporary": False},
                "system_event": False,
            },
        )
        assert user_without_declaration.status_code == 201
        assert user_without_declaration.json()["created_by"] == str(user.id)

    def test_alg_ac16_admin_reset_reuses_password_set_catalog_entry(
        self, session, operator
    ):
        admin = operator
        set_password(
            session,
            admin,
            "AuditResetInitial!",
            is_temporary=False,
        )
        session.commit()
        catalog_before = frozenset(_EVENT_CATALOG)
        audit_count_before = session.query(AuditLog).count()
        factory = sessionmaker(bind=session.get_bind())

        assert (
            reset_admin_password(
                "AuditResetNext!",
                "AuditResetNext!",
                factory,
                output=lambda _line: None,
            )
            == 0
        )

        session.expire_all()
        password_set_rows = (
            session.query(AuditLog)
            .filter(AuditLog.event_type == "user.password_set")
            .order_by(AuditLog.created_at)
            .all()
        )
        assert frozenset(_EVENT_CATALOG) == catalog_before
        assert len(password_set_rows) == 2
        assert session.query(AuditLog).count() == audit_count_before + 1
        reset_row = password_set_rows[-1]
        assert reset_row.entity_id == admin.id
        assert reset_row.created_by == admin.id
        assert reset_row.after == {"is_temporary": False}


class TestAlgR09BeforeOptionalForPasswordSet:
    """Follow-up to ALG-AC12: ``user.password_set``'s
    ``before_optional`` flag (a user who never had a password before
    has no prior ``is_temporary`` flag to report at all, spec.md's
    "之前沒有密碼時為空值") versus every other 修改 event, which still
    rejects ``before=None``; and a declared field's value is never
    allowed to be ``None`` on either side.
    """

    def test_password_set_before_none_succeeds_and_reads_back_as_null(
        self, session, operator
    ):
        log = record_audit_event(
            session,
            "user.password_set",
            entity_id=uuid7(),
            before=None,
            after={"is_temporary": True},
        )
        session.commit()

        session.expire_all()
        fetched = session.get(AuditLog, log.id)
        assert fetched is not None
        assert fetched.before is None
        assert fetched.after == {"is_temporary": True}

    def test_password_set_null_field_value_is_rejected(
        self, session, operator
    ):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "user.password_set",
                entity_id=uuid7(),
                before={"is_temporary": None},
                after={"is_temporary": True},
            )

        assert session.query(AuditLog).count() == before_count

    def test_role_updated_before_none_is_still_rejected(
        self, session, operator
    ):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "role.updated",
                entity_id=uuid7(),
                before=None,
                after={"name": "New Name"},
            )

        assert session.query(AuditLog).count() == before_count


class TestAlgR09CreatedDeletedRequireAllDeclaredFields:
    """PR #237 review (comment 4114338417): a 新增 event's ``after``
    and a 刪除 event's ``before`` must be a dict containing *every*
    declared field, not merely a dict (an empty ``{}`` was wrongly
    accepted before this fix, for both an ordinary event and a
    ``system_event`` one).
    """

    def test_role_created_with_empty_after_is_rejected(
        self, session, operator
    ):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "role.created",
                entity_id=uuid7(),
                before=None,
                after={},
            )

        assert session.query(AuditLog).count() == before_count

    def test_role_created_missing_one_field_is_rejected(
        self, session, operator
    ):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "role.created",
                entity_id=uuid7(),
                before=None,
                after={"name": "R"},
            )

        assert session.query(AuditLog).count() == before_count

    def test_role_deleted_with_empty_before_is_rejected(
        self, session, operator
    ):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "role.deleted",
                entity_id=uuid7(),
                before={},
                after=None,
            )

        assert session.query(AuditLog).count() == before_count

    def test_user_locked_with_empty_after_is_rejected(self, session, operator):
        before_count = session.query(AuditLog).count()

        with pytest.raises(InvalidAuditEventShapeError):
            record_audit_event(
                session,
                "user.locked",
                entity_id=uuid7(),
                before=None,
                after={},
            )

        assert session.query(AuditLog).count() == before_count
