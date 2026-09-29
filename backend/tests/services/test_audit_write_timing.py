"""ALG-AC11: write-timing acceptance test for the audit-log events
DOM-R22 requires (audit-log plan.md T4, issue #218).

This module owns no Service code: DOM-R22's write entry points
(``Role`` create/update/delete, ``ProjectMember`` role assignment and
removal, ``User.is_admin``) are ``domain-model`` T7's own
implementation (issue #135, ``app/services/roles.py``,
``app/services/project_members.py``, ``app/services/users.py``).
This file only drives ALG-AC11's operation sequence through those
Service-layer entry points and checks the resulting ``AuditLog``
rows -- per plan.md's note under audit-log's T4/T7 division of
labor, a mismatch found here is a Bug against ``domain-model``, not
something this file fixes itself.

Every other requirement the event catalog and its shapes must
satisfy (ALG-R07~ALG-R10, the event catalog itself) is already
covered by ``tests/db/test_audit_events.py`` and
``tests/services/test_audit.py``; this file only exercises ALG-R14's
"恰好一筆" timing through the real call sequence ALG-AC11 spells out.

Fixtures (``session``, ``operator``) come from this directory's
``conftest.py``.
"""

import uuid
from typing import Any

import pytest
from sqlalchemy import select

from app.models import AuditLog, Project, ProjectMember
from app.services.project_members import (
    add_project_member,
    assign_role,
    remove_project_member,
)
from app.services.roles import create_role, delete_role, update_role
from app.services.users import (
    LastActiveAdminRemovalError,
    set_is_active,
    set_is_admin,
)
from tests.db.conftest import create_root_user_with_company


def _new_project(creator, code: str) -> Project:
    return Project(
        project_code=code,
        name="示範廠機電工程",
        client_name="示範業主",
        site_location="示範工地",
        created_by=creator.id,
        updated_by=creator.id,
    )


def _field(payload: object, key: str) -> Any:
    """Read one field out of an ``AuditLog.before``/``after`` value
    (typed ``dict | list | None`` at the model level) -- every
    payload this module reads is a ``dict``, so this both narrows
    that for type-checking and gives a clear failure if it were not.
    """
    assert isinstance(payload, dict)
    return payload[key]


class _NewRowTracker:
    """Isolates the ``AuditLog`` rows one Service call writes from
    everything already in the table, without relying on
    ``created_at``/``id`` ordering across rows that may land in the
    same millisecond (``app/db/base.py``'s ``uuid7`` only embeds a
    millisecond timestamp, and the real clock's resolution is not
    guaranteed either). Each call to :meth:`diff` returns exactly the
    rows added since the previous call (or since construction), by
    excluding every id already seen.
    """

    def __init__(self, session) -> None:
        self._session = session
        # ``_excluded_ids`` starts as every row already in the table
        # (the Given setup's own writes) purely so :meth:`diff` never
        # reports them; it grows to also cover each row already
        # returned by a previous :meth:`diff` call. ``_new_ids`` only
        # ever collects rows this tracker itself reported as new, for
        # :attr:`all_ids`'s final "nothing else landed" check.
        self._excluded_ids: set[uuid.UUID] = set(
            session.scalars(select(AuditLog.id)).all()
        )
        self._new_ids: list[uuid.UUID] = []

    def diff(self) -> list[AuditLog]:
        rows = list(
            self._session.scalars(
                select(AuditLog).where(AuditLog.id.notin_(self._excluded_ids))
            ).all()
        )
        self._excluded_ids.update(row.id for row in rows)
        self._new_ids.extend(row.id for row in rows)
        return rows

    @property
    def all_ids(self) -> frozenset[uuid.UUID]:
        return frozenset(self._new_ids)

    def assert_one(self, event_type: str) -> AuditLog:
        rows = self.diff()
        assert len(rows) == 1, (
            f"expected exactly one new AuditLog row for {event_type!r}, "
            f"got {[r.event_type for r in rows]}"
        )
        assert rows[0].event_type == event_type
        return rows[0]

    def assert_none(self) -> None:
        assert self.diff() == []


class TestAlgAc11WriteTimingSequence:
    """ALG-AC11: given two enabled Admins, a ``Role`` R1 already held
    by two ``ProjectMember`` rows, and a ``Project`` P, run DOM-R22's
    full change sequence through the ``domain-model`` T7 Service
    entry points. Each successful change writes exactly one audit
    event, in order; a change ALG-R14 excludes (adding a member with
    no role) or one the Service layer rejects (taking away the last
    active Admin, disabling a non-Admin account) writes none.
    ``created_by`` is the current operator on every row written.
    """

    def test_full_sequence(
        self, session, operator, registered_permission_codes
    ):
        # -- Given -----------------------------------------------
        # The built-in ``admin`` is always an active Admin (DOM-R50), which
        # would keep DOM-R07 from ever triggering. DOM-AC06 specifies a
        # database without one, so this test data disables it directly
        # (the Service layer would refuse, DOM-R06); it stays the
        # operator that get_current_operator() returns.
        operator.is_active = False
        session.flush()
        # Two enabled Admins, neither the built-in system account
        # (``operator``) itself, so DOM-R06's built-in-account
        # protection never interferes with DOM-R07's check below.
        admin_1 = create_root_user_with_company(session, "ADM11-1")
        admin_1.is_admin = True
        admin_2 = create_root_user_with_company(session, "ADM11-2")
        admin_2.is_admin = True

        # R1 carries a non-empty permission code so role.deleted's
        # before content below exercises a real permission_codes
        # value, not just an empty one.
        role_1 = create_role(
            session, name="R1-AC11", permission_codes={"report.approve"}
        )
        project = _new_project(operator, "P-AC11")
        member_a_user = create_root_user_with_company(session, "MA-AC11")
        member_b_user = create_root_user_with_company(session, "MB-AC11")
        session.add(project)
        session.flush()
        member_a = add_project_member(
            session,
            project_id=project.id,
            user_id=member_a_user.id,
            role_ids=[role_1.id],
        )
        member_b = add_project_member(
            session,
            project_id=project.id,
            user_id=member_b_user.id,
            role_ids=[role_1.id],
        )
        session.commit()
        assert member_a.id is not None and member_b.id is not None

        tracker = _NewRowTracker(session)

        # -- When (ALG-AC11's operation sequence) -----------------

        # 1. 新增角色 R2 -> role.created
        role_2 = create_role(
            session, name="R2-AC11", permission_codes={"report.read"}
        )
        session.commit()
        row = tracker.assert_one("role.created")
        assert row.entity_id == role_2.id
        assert row.created_by == operator.id
        assert row.before is None
        assert row.after == {
            "name": "R2-AC11",
            "permission_codes": ["report.read"],
        }

        # 2. R2 改名 -> role.updated
        update_role(session, role_2, name="R2-AC11-Renamed")
        session.commit()
        row = tracker.assert_one("role.updated")
        assert row.entity_id == role_2.id
        assert row.before == {"name": "R2-AC11"}
        assert row.after == {"name": "R2-AC11-Renamed"}

        # 3. 把 U 加入 P 並指派 R2 -> project_member.roles_changed
        user_u = create_root_user_with_company(session, "U-AC11")
        member_u = add_project_member(
            session,
            project_id=project.id,
            user_id=user_u.id,
            role_ids=[role_2.id],
        )
        session.commit()
        row = tracker.assert_one("project_member.roles_changed")
        assert row.entity_id == member_u.id
        assert row.before == {
            "role_ids": [],
            "project_id": str(project.id),
            "user_id": str(user_u.id),
        }
        assert row.after == {
            "role_ids": [str(role_2.id)],
            "project_id": str(project.id),
            "user_id": str(user_u.id),
        }

        # 4. 替 U 再加 R1 -> project_member.roles_changed
        assign_role(session, member_u, role_1.id)
        session.commit()
        row = tracker.assert_one("project_member.roles_changed")
        assert row.entity_id == member_u.id
        assert row.before == {
            "role_ids": [str(role_2.id)],
            "project_id": str(project.id),
            "user_id": str(user_u.id),
        }
        assert row.after == {
            "role_ids": sorted([str(role_1.id), str(role_2.id)]),
            "project_id": str(project.id),
            "user_id": str(user_u.id),
        }

        # 5. 把 V 加入 P 但不指派角色 -> DOM-R22 範圍外，不寫紀錄
        user_v = create_root_user_with_company(session, "V-AC11")
        member_v = add_project_member(
            session, project_id=project.id, user_id=user_v.id
        )
        session.commit()
        tracker.assert_none()

        # 6. 刪除 R1 -> role.deleted，project_member_ids 恰為前置
        #    的兩筆（member_a、member_b）與 U，且沒有另寫
        #    roles_changed（tracker.assert_one 已確認只新增一筆）。
        role_1_id = role_1.id
        delete_role(session, role_1)
        session.commit()
        row = tracker.assert_one("role.deleted")
        assert row.entity_id == role_1_id
        assert row.after is None
        assert _field(row.before, "name") == "R1-AC11"
        assert _field(row.before, "permission_codes") == ["report.approve"]
        assert set(_field(row.before, "project_member_ids")) == {
            str(member_a.id),
            str(member_b.id),
            str(member_u.id),
        }

        # 7. 把 V 移出 P -> project_member.removed
        member_v_id = member_v.id
        remove_project_member(session, member_v)
        session.commit()
        row = tracker.assert_one("project_member.removed")
        assert row.entity_id == member_v_id
        assert row.after is None
        assert row.before == {
            "project_id": str(project.id),
            "user_id": str(user_v.id),
            "role_ids": [],
        }

        # 8. 取消一位 Admin 的 is_admin -> user.admin_changed
        #    （admin_2 仍是啟用中的 Admin，DOM-R07 不擋）
        set_is_admin(session, admin_1, False)
        session.commit()
        row = tracker.assert_one("user.admin_changed")
        assert row.entity_id == admin_1.id
        assert row.before == {"is_admin": True}
        assert row.after == {"is_admin": False}

        # 9. 嘗試取消最後一位 Admin 的 is_admin -> 被拒絕，不寫紀錄
        #    （admin_1 已不是 Admin，operator 本身不是 Admin，
        #    admin_2 是唯一啟用中的 Admin）
        with pytest.raises(LastActiveAdminRemovalError):
            set_is_admin(session, admin_2, False)
        session.commit()
        tracker.assert_none()

        # 10. 停用一位非 Admin 的帳號 -> DOM-R22 範圍外，不寫紀錄
        set_is_active(session, user_u, False)
        session.commit()
        tracker.assert_none()

        # -- Then: every row this sequence wrote has the current
        #    operator as its creator, and nothing else landed in
        #    audit_logs beyond the seven asserted above.
        assert (
            session.scalars(
                select(AuditLog.created_by).where(
                    AuditLog.id.in_(tracker.all_ids)
                )
            ).all()
            == [operator.id] * 7
        )
        assert tracker.diff() == []

        # Sanity: R1's role assignment rows are indeed gone (cascade),
        # so a stray, un-audited roles_changed cannot have been
        # missed by only checking entity_id above.
        assert session.get(ProjectMember, member_u.id) is not None
