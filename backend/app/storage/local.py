"""FEV-R01：本機檔名只用後端產生的 UUID，不接收原始檔名。"""

import os
from collections.abc import Iterator
from pathlib import Path
from typing import BinaryIO
from uuid import UUID, uuid4

from app.storage.base import Storage


class LocalStorage(Storage):
    """隔離於指定根目錄的串流儲存；拒絕非 UUID 鍵與符號連結。"""

    def __init__(self, root: Path) -> None:
        """只解析儲存根目錄；讀取與盤點不建立目錄（T1 唯讀維運）。"""
        self.root = root.resolve()

    def _path(self, key: UUID) -> Path:
        if not isinstance(key, UUID):
            raise ValueError("storage key must be a UUID")
        path = self.root / str(key)
        if path.is_symlink():
            raise ValueError("storage files must not be symlinks")
        return path

    def save(self, source: BinaryIO) -> UUID:
        """FEV-R06：獨占建立新檔，串流中途失敗時清除不完整檔。"""
        self.root.mkdir(parents=True, exist_ok=True)
        key = uuid4()
        path = self._path(key)
        # O_EXCL 防止碰撞覆寫；O_NOFOLLOW 防止以連結導向儲存區外。
        fd = os.open(
            path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
        )
        try:
            with os.fdopen(fd, "wb") as target:
                while chunk := source.read(64 * 1024):
                    target.write(chunk)
                target.flush()
                os.fsync(target.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
        return key

    def open(self, key: UUID) -> BinaryIO:
        """FEV-R13：僅提供內部唯讀串流，API 另行檢查登入與權限。"""
        return os.fdopen(
            os.open(self._path(key), os.O_RDONLY | os.O_NOFOLLOW), "rb"
        )

    def delete(self, key: UUID) -> None:
        """FEV-R06：容許重試清理，避免失敗交易殘留孤兒檔。"""
        self._path(key).unlink(missing_ok=True)

    def iter_keys(self) -> Iterator[UUID]:
        """只盤點 UUID 檔；遇到異常項目即報錯，不默默漏掉儲存內容。"""
        if not self.root.exists():
            return
        for path in self.root.iterdir():
            key = UUID(path.name)
            if path.name != str(key) or not self._path(key).is_file():
                raise ValueError("unexpected entry in storage directory")
            yield key
