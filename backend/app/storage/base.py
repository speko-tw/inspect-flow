"""FEV-R01 的檔案介面；UUID 是內部鍵，不能當公開網址。"""

from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import BinaryIO
from uuid import UUID


class Storage(ABC):
    """圖片位元組的唯一存取邊界；失敗寫入須清理，刪除須可重試。"""

    @abstractmethod
    def save(self, source: BinaryIO) -> UUID:
        """產生新 UUID 鍵並串流保存；呼叫者負責 FEV-R06 的內容驗證。"""

    @abstractmethod
    def open(self, key: UUID) -> BinaryIO:
        """回傳唯讀串流；呼叫者須關閉，找不到時拋 FileNotFoundError。"""

    @abstractmethod
    def delete(self, key: UUID) -> None:
        """移除失敗交易或被取代的檔案；已不存在時仍成功。"""

    @abstractmethod
    def iter_keys(self) -> Iterator[UUID]:
        """只讀列出儲存鍵，供孤兒檔案盤點使用。"""
