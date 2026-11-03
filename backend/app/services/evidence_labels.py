"""FEV-R13、R22：固定一般、更正與改善照片的標示來源契約。"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID


@dataclass(frozen=True)
class ImprovementLabelContext:
    """由有效改善結果追溯的任務、項目快照與專案來源。"""

    result_id: UUID
    is_effective: bool
    is_nonconforming: bool
    task_id: UUID
    task_inspection_item_id: UUID
    snapshot_revision: int
    project_name: str | None
    item_title: str | None
    zone_name: str | None
    location_text: str | None


def _location(zone_name: str | None, location_text: str | None) -> str:
    return "／".join(value for value in (zone_name, location_text) if value)


def build_label_source(
    *,
    source_kind: Literal["normal", "correction", "improvement"],
    project_name: str | None,
    item_title: str | None,
    zone_name: str | None,
    location_text: str | None,
    uploader_name: str | None,
    uploaded_at: datetime,
    result_id: UUID | None = None,
    resolve_result: Callable[[UUID], ImprovementLabelContext | None]
    | None = None,
) -> dict[str, str | None]:
    """FEV-AC32、AC34：來源只取本次任務或有效改善結果快照。"""
    if source_kind not in {"normal", "correction", "improvement"}:
        raise ValueError("unknown evidence label source kind")
    if source_kind == "improvement":
        if result_id is None or resolve_result is None:
            raise ValueError("improvement upload requires a result")
        context = resolve_result(result_id)
        if (
            context is None
            or context.result_id != result_id
            or not context.is_effective
            or not context.is_nonconforming
            or context.snapshot_revision < 1
        ):
            raise ValueError("improvement result is not an effective finding")
        project_name = context.project_name
        item_title = context.item_title
        zone_name = context.zone_name
        location_text = context.location_text
    elif result_id is not None or resolve_result is not None:
        raise ValueError("result is only valid for improvement uploads")
    return {
        "project_name": project_name,
        "item_title": item_title,
        "location": _location(zone_name, location_text),
        "uploader_name": uploader_name,
        "uploaded_at": uploaded_at.isoformat().replace("+00:00", "Z"),
    }
