"""FEV-R16：內業照片下載使用的讀取回應契約。"""

from pydantic import BaseModel, ConfigDict, Field


class OfficePhotoReadResponse(BaseModel):
    """公開下載識別欄位，保留原有照片 metadata 與詳情歷程。"""

    model_config = ConfigDict(extra="allow")

    id: str
    point_ids: list[str]
    point_sequences: list[int] = Field(
        description="照片保存快照中的項次序號，依數值排序；無對應時為空。"
    )


class OfficePhotoPageResponse(BaseModel):
    """內業清單逐張帶入相同下載契約，分頁行為維持不變。"""

    items: list[OfficePhotoReadResponse]
    next_cursor: str | None
