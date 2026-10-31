"""T1 唯讀維運：列出儲存有檔、資料庫無記錄的 UUID，不刪除檔案。

在 backend 執行 ``uv run --locked python -m app.cli.check_evidence_storage``。
使用 INSPECTFLOW_DATABASE_URL 與照片儲存設定；盤點期間應暫停寫入，
避免把尚未提交交易的新檔誤認為孤兒；輸出只供維運，不是 API。
"""

from collections.abc import Iterator
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session

from app.db.settings import get_database_url
from app.models import EvidenceVariant
from app.storage import LocalStorage, Storage, get_storage_settings


def orphan_keys(session: Session, storage: Storage) -> Iterator[UUID]:
    """比對所有版本鍵（含軟刪與作廢），不寫入資料庫或儲存。"""
    referenced = set(session.scalars(select(EvidenceVariant.storage_key)))
    yield from (key for key in storage.iter_keys() if key not in referenced)


def _readonly_engine() -> Engine:
    url = make_url(get_database_url())
    if url.get_backend_name() == "sqlite":
        if not url.database or url.database == ":memory:":
            raise ValueError("inventory requires an existing database")
        # 不能沿用一般 engine：它會建目錄並設定 WAL；盤點只開既有檔案。
        database = quote(str(Path(url.database).resolve()), safe="/")
        url = url.set(database=f"file:{database}").update_query_dict(
            {"mode": "ro", "uri": "true"}
        )
        return create_engine(url)
    return create_engine(url).execution_options(postgresql_readonly=True)


def main() -> int:
    """只在成功完成盤點後輸出，資料庫或儲存錯誤以非零退出。"""
    storage = LocalStorage(get_storage_settings().root)
    engine = _readonly_engine()
    try:
        with Session(engine) as session:
            keys = sorted(orphan_keys(session, storage), key=str)
    finally:
        engine.dispose()
    for key in keys:
        print(key)
    print(f"orphan files: {len(keys)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
