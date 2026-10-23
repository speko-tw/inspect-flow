"""專案成員人數的共用計算（DOM-R77）。"""

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import ProjectMember, User
from app.services.account_status import effectively_active_user_clause


def count_active_project_members(
    session: Session, project_ids: set[UUID]
) -> dict[UUID, int]:
    """共用批次計算有效啟用成員，避免各摘要口徑分歧（DOM-R77）。"""
    if not project_ids:
        return {}
    rows = session.execute(
        select(ProjectMember.project_id, func.count(ProjectMember.id))
        .join(User, User.id == ProjectMember.user_id)
        .where(
            ProjectMember.project_id.in_(project_ids),
            effectively_active_user_clause(),
        )
        .group_by(ProjectMember.project_id)
    )
    counts = {project_id: count for project_id, count in rows}
    return {
        project_id: counts.get(project_id, 0) for project_id in project_ids
    }
