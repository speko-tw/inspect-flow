"""FEV-D21：離線維運重產 OFFICE；執行期間應暫停照片寫入並保留備份。

在 backend 執行 uv run --locked python -m app.cli.regenerate_office_versions。
使用既有 DB／儲存設定；每張獨立交易，遇鎖定略過，其餘錯誤立即停止。
事件登記及實際稽核由 T5 接入服務的 record_office_edit，同交易處理。
"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.errors import APIError
from app.db.engine import create_engine_from_settings
from app.models import Evidence, EvidenceVariant
from app.services.evidence_office import edit_office
from app.services.operator import get_system_operator


def regenerate_office_versions(session: Session) -> tuple[int, int]:
    """FEV-AC31：以系統 admin 沿用每張參數／圖層，不使用維運當下時間。"""
    operator_id = get_system_operator(session).id
    ids: list[tuple[UUID, UUID]] = [
        (task_id, photo_id)
        for task_id, photo_id in session.execute(
            select(Evidence.task_id, Evidence.id).order_by(Evidence.id),
        )
    ]
    session.rollback()
    changed, skipped = 0, 0
    for task_id, photo_id in ids:
        office = session.scalar(
            select(EvidenceVariant).where(
                EvidenceVariant.evidence_id == photo_id,
                EvidenceVariant.variant_type == "OFFICE",
            )
        )
        if office is None:
            raise RuntimeError("missing OFFICE variant")
        edit = dict(office.edit_params or {})
        session.rollback()
        try:
            edit_office(
                session,
                task_id=task_id,
                photo_id=photo_id,
                operator_id=operator_id,
                raw=edit,
                maintenance=True,
            )
        except APIError as exc:
            if exc.status_code != 409:
                raise
            skipped += 1
        else:
            changed += 1
    return changed, skipped


def main() -> int:
    """維運入口回報真實處理數；失敗保留 traceback 與非零退出碼。"""
    engine = create_engine_from_settings()
    try:
        with Session(engine) as session:
            changed, skipped = regenerate_office_versions(session)
        print(f"Regenerated: {changed}; skipped locked: {skipped}")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
