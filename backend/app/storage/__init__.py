"""FEV-R01：圖片經可替換的儲存介面存取，不進資料庫。"""

from app.storage.base import Storage
from app.storage.local import LocalStorage
from app.storage.settings import StorageSettings, get_storage_settings

__all__ = [
    "Storage",
    "LocalStorage",
    "StorageSettings",
    "get_storage_settings",
]
