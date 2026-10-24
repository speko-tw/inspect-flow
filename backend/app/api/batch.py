"""批次操作的共用數量限制（ADM-R13、#414）。"""

from pydantic import BaseModel

from app.api.errors import APIError, ErrorCode

MAX_BATCH_ITEMS = 200


class BatchLimitedRequest(BaseModel):
    """標記沿用 ADM-R13 白話數量錯誤的請求，避免影響其他清單。"""


def require_batch_size(size: int) -> None:
    """在查詢與鎖列前限制整批大小，避免大量輸入占用交易資源。"""
    if size > MAX_BATCH_ITEMS:
        raise APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            details=["一次最多選取 200 筆，請減少數量後再試。"],
        )
