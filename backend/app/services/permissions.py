"""集中計算角色權限與專案存取範圍（DOM-R23、DOM-R26、DOM-R69）。

本模組只讀取呼叫時已 flush 的資料，不替呼叫端 flush，避免權限判斷
意外送出尚未完成的寫入。角色、帳號狀態與模組權限在同一組入口計算，
讓 API 與其他 Service 不必各自推導授權。

DOM-R35 登記權限代碼。讀取時先取出角色現有代碼再比對，避免把尚未
登記的代碼作為寫入值交給 BoundedString 驗證。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import distinct, event, func, select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_request_effective_access_cache
from app.models import (
    ProjectMember,
    ProjectMemberRole,
    RolePermission,
)
from app.permission_codes import MODULES
from app.services.module_permissions import (
    list_user_module_delegations,
    query_people_access,
    query_person_access,
)


@dataclass(frozen=True)
class EffectiveAccess:
    """集中回傳一個人的有效權限與專案身分快照。

    ``project_memberships`` 保留沒有角色的成員身分，因為部分端點只看
    是否為專案成員，不能把空的角色權限集合誤當成非成員。
    """

    is_active: bool
    is_admin: bool
    module_permissions: frozenset[str]
    delegated_modules: frozenset[str]
    project_permissions: frozenset[str]
    project_permissions_by_project: dict[uuid.UUID, frozenset[str]]
    project_memberships: frozenset[uuid.UUID] = frozenset()


@event.listens_for(Session, "after_flush")
def _clear_request_access_cache_after_flush(
    session: Session, flush_context
) -> None:
    """Flush 後清除請求快取，避免授權讀到寫入前的資料。"""
    cache = get_request_effective_access_cache()
    if cache is not None:
        cache.clear()


@event.listens_for(Session, "after_rollback")
def _clear_request_access_cache_after_rollback(session: Session) -> None:
    """DOM-R69、#712：回滾後不可保留未提交交易中計算的權限。"""
    cache = get_request_effective_access_cache()
    if cache is not None:
        cache.clear()


def calculate_effective_access(
    session: Session,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
) -> EffectiveAccess:
    """依 DOM-R69 集中計算模組權限、專案權限與成員身分。

    將這些結果放在同一個快照，避免各入口用不同查詢推導授權，並保留
    無角色成員的專案身分供只要求成員資格的端點使用。
    """
    cache = get_request_effective_access_cache()
    cache_key = (id(session), user_id, project_id)
    if cache is not None and not (
        session.new or session.dirty or session.deleted
    ):
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

    with session.no_autoflush:
        person = query_person_access(session, user_id=user_id)
        if person is None:
            result = EffectiveAccess(
                False,
                False,
                frozenset(),
                frozenset(),
                frozenset(),
                {},
            )
            if cache is not None:
                cache[cache_key] = result
            return result
        project_map = _project_permissions_by_project(
            session, user_id=user_id, project_id=project_id
        )
        delegated_modules = (
            frozenset(MODULES)
            if person.is_admin
            else frozenset(
                item.module
                for item in list_user_module_delegations(
                    session, user_id=user_id
                )
            )
        )
        project_codes = (
            project_map.get(project_id, frozenset())
            if project_id
            else frozenset()
        )
    result = EffectiveAccess(
        is_active=person.is_active,
        is_admin=person.is_admin,
        module_permissions=person.module_permissions,
        delegated_modules=delegated_modules,
        project_permissions=project_codes,
        project_permissions_by_project=project_map,
        project_memberships=frozenset(project_map),
    )
    if cache is not None and not (
        session.new or session.dirty or session.deleted
    ):
        cache[cache_key] = result
    return result


def project_member_ids_with_permission(
    session: Session,
    *,
    project_id: uuid.UUID,
    permission_code: str,
    active_only: bool = False,
    module_permission_code: str | None = None,
) -> frozenset[uuid.UUID]:
    """DOM-R69：回傳具指定動作權限且非 Admin 的專案成員。

    先由中央 Service 取得角色權限候選人，再由 DOM-R60 人員 Service
    批次核對帳號狀態與 Admin 身分，避免端點自行重算授權。
    IP-R12 呼叫端可要求只保留有效帳號與指定模組使用權，
    讓候選清單和實際指派驗證使用相同條件。
    """
    with session.no_autoflush:
        candidate_permissions: dict[uuid.UUID, set[str]] = {}
        rows = session.execute(
            select(ProjectMember.user_id, RolePermission.code)
            .select_from(ProjectMember)
            .join(
                ProjectMemberRole,
                ProjectMemberRole.project_member_id == ProjectMember.id,
            )
            .join(
                RolePermission,
                RolePermission.role_id == ProjectMemberRole.role_id,
            )
            .where(ProjectMember.project_id == project_id)
        ).all()
        for user_id, code in rows:
            if code == permission_code:
                candidate_permissions.setdefault(user_id, set()).add(code)
        people = query_people_access(
            session, user_ids=set(candidate_permissions)
        )
    return frozenset(
        user_id
        for user_id, person in people.items()
        if (person.is_active or not active_only)
        and not person.is_admin
        and permission_code in candidate_permissions[user_id]
        and (
            module_permission_code is None
            or module_permission_code in person.module_permissions
        )
    )


def project_member_management_impact(
    session: Session,
    *,
    user_id: uuid.UUID,
    module_permission_code: str,
    project_permission_code: str,
) -> tuple[int, tuple[uuid.UUID, ...], tuple[uuid.UUID, ...]]:
    """集中計算撤回模組權限後的成員數與無管理者專案。

    Admin 依全域管理規則可管理其成員專案；其他管理者必須同時啟用、
    具模組使用權，並由角色取得專案管理權。
    """
    with session.no_autoflush:
        project_ids = tuple(
            sorted(
                set(
                    session.scalars(
                        select(ProjectMember.project_id).where(
                            ProjectMember.user_id == user_id
                        )
                    ).all()
                ),
                key=str,
            )
        )
        if not project_ids:
            return 0, (), ()
        member_count = (
            session.scalar(
                select(func.count(ProjectMember.id)).where(
                    ProjectMember.user_id == user_id
                )
            )
            or 0
        )
        rows = session.execute(
            select(
                ProjectMember.project_id,
                ProjectMember.user_id,
                RolePermission.code,
            )
            .select_from(ProjectMember)
            .outerjoin(
                ProjectMemberRole,
                ProjectMemberRole.project_member_id == ProjectMember.id,
            )
            .outerjoin(
                RolePermission,
                RolePermission.role_id == ProjectMemberRole.role_id,
            )
            .where(
                ProjectMember.project_id.in_(project_ids),
                ProjectMember.user_id != user_id,
            )
        ).all()
        members_by_project: dict[uuid.UUID, set[uuid.UUID]] = {}
        permissions_by_membership: dict[
            tuple[uuid.UUID, uuid.UUID], set[str]
        ] = {}
        for project_id, member_id, code in rows:
            members_by_project.setdefault(project_id, set()).add(member_id)
            if code is not None:
                permissions_by_membership.setdefault(
                    (project_id, member_id), set()
                ).add(code)
        people = query_people_access(
            session,
            user_ids=set().union(*members_by_project.values()),
        )
        managed_projects = set()
        for project_id, member_ids in members_by_project.items():
            for member_id in member_ids:
                person = people.get(member_id)
                if person is None or not person.is_active:
                    continue
                if person.is_admin or (
                    module_permission_code in person.module_permissions
                    and project_permission_code
                    in permissions_by_membership.get(
                        (project_id, member_id), set()
                    )
                ):
                    managed_projects.add(project_id)
                    break
    return (
        member_count,
        project_ids,
        tuple(
            project_id
            for project_id in project_ids
            if project_id not in managed_projects
        ),
    )


def _project_permissions_by_project(
    session: Session,
    *,
    user_id: uuid.UUID,
    project_id: uuid.UUID | None,
) -> dict[uuid.UUID, frozenset[str]]:
    # DOM-R36 允許成員沒有角色；保留其專案鍵，中央結果才能回答身分。
    query = (
        select(ProjectMember.project_id, RolePermission.code)
        .select_from(ProjectMember)
        .outerjoin(
            ProjectMemberRole,
            ProjectMemberRole.project_member_id == ProjectMember.id,
        )
        .outerjoin(
            RolePermission, RolePermission.role_id == ProjectMemberRole.role_id
        )
        .where(ProjectMember.user_id == user_id)
    )
    if project_id is not None:
        query = query.where(ProjectMember.project_id == project_id)
    grouped: dict[uuid.UUID, set[str]] = {}
    for key, code in session.execute(query).all():
        values = grouped.setdefault(key, set())
        if code is not None:
            values.add(code)
    return {key: frozenset(values) for key, values in grouped.items()}


def effective_permissions(
    session: Session, *, user_id: uuid.UUID, project_id: uuid.UUID
) -> frozenset[str]:
    """DOM-R26: the set of permission codes ``user_id`` effectively
    holds in ``project_id`` -- the union of every ``Role``'s codes
    across all of that ``ProjectMember``'s role assignments.

    Returns the empty set both when ``user_id`` is not a member of
    ``project_id`` at all, and when the membership exists but holds
    no role (DOM-R36) -- both cases simply match zero rows below,
    so neither needs a separate branch.
    """
    return calculate_effective_access(
        session, user_id=user_id, project_id=project_id
    ).project_permissions


@dataclass(frozen=True)
class RoleImpactScope:
    """DOM-R23: a ``Role``'s influence range before it is changed or
    deleted -- how many ``ProjectMember`` rows currently hold it
    (``member_count``), and how many distinct ``User``s that is
    (``user_count``, always at most ``member_count`` since the same
    person may hold the role on more than one project).
    """

    member_count: int
    user_count: int


def role_impact_scope(
    session: Session, *, role_id: uuid.UUID
) -> RoleImpactScope:
    """DOM-R23: count the ``ProjectMember`` rows holding ``role_id``
    and the distinct ``User``s among them. Both counts are ``0`` when
    nobody holds the role.
    """
    with session.no_autoflush:
        member_count, user_count = session.execute(
            select(
                func.count(ProjectMemberRole.project_member_id),
                func.count(distinct(ProjectMember.user_id)),
            )
            .select_from(ProjectMemberRole)
            .join(
                ProjectMember,
                ProjectMember.id == ProjectMemberRole.project_member_id,
            )
            .where(ProjectMemberRole.role_id == role_id)
        ).one()
    return RoleImpactScope(member_count=member_count, user_count=user_count)
