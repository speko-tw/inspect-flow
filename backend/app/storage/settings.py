"""FEV-R06、R17：集中照片儲存與資源上限設定，不依賴工作目錄。"""

import os
from dataclasses import dataclass
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class StorageSettings:
    """T2 的串流大小與解碼像素限制來源；不在 Storage 層重做影像驗證。"""

    root: Path
    max_file_bytes: int
    max_decode_pixels: int


def _positive_integer(name: str, default: int) -> int:
    value = os.environ.get(name, "")
    if not value:
        return default
    if not value.isascii() or not value.isdecimal() or int(value) <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return int(value)


def get_storage_settings() -> StorageSettings:
    """FEV-R17：未設定或空值用預設；非法上限或相對路徑直接拒絕。"""
    root = Path(
        os.environ.get("INSPECTFLOW_EVIDENCE_STORAGE_ROOT")
        or _BACKEND / "data" / "evidence"
    )
    if not root.is_absolute():
        raise ValueError("INSPECTFLOW_EVIDENCE_STORAGE_ROOT must be absolute")
    return StorageSettings(
        root=root,
        max_file_bytes=_positive_integer(
            "INSPECTFLOW_EVIDENCE_MAX_FILE_BYTES", 30 * 1024 * 1024
        ),
        max_decode_pixels=_positive_integer(
            "INSPECTFLOW_EVIDENCE_MAX_DECODE_PIXELS", 40_000_000
        ),
    )
