"""TPL-R11：共用完整範本結構驗證，讓來源快照與 API 使用相同規則。"""

from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from app.api.limits import (
    LONG_TEXT_MAX,
    MEASUREMENT_FIELDS_MAX,
    MIN_PHOTO_COUNT_MAX,
    NUMBER_TEXT_MAX,
    POINTS_MAX,
    TITLE_MAX,
    UNIT_MAX,
)


class StrictBody(BaseModel):
    """拒絕多餘欄位，避免未知輸入被靜默忽略後造成錯誤成功回應。"""

    model_config = ConfigDict(extra="forbid")


class NameBody(StrictBody):
    """供類別與系統新增、改名端點共用的名稱欄位。"""

    name: str = Field(min_length=1, max_length=TITLE_MAX)

    @field_validator("name")
    @classmethod
    def nonblank(cls, name: str) -> str:
        """避免空白名稱通過既有範本命名規則。"""
        if not name.strip():
            raise ValueError("name cannot be blank")
        return name


class TextStandardBody(StrictBody):
    """查核項次的文字標準輸入。"""

    text: str = Field(max_length=LONG_TEXT_MAX)


class NumericStandardBody(StrictBody):
    """驗證數值標準並保留舊版 range 請求格式相容性（TPL-R13）。"""

    value: str | None = Field(default=None, max_length=NUMBER_TEXT_MAX)
    condition: Literal["<=", ">=", "=", "range"]
    unit: str = Field(min_length=1, max_length=UNIT_MAX)
    tolerance: str | None = Field(default=None, max_length=NUMBER_TEXT_MAX)
    range_form: Literal["interval", "tolerance"] | None = None
    lower_bound: str | None = Field(default=None, max_length=NUMBER_TEXT_MAX)
    upper_bound: str | None = Field(default=None, max_length=NUMBER_TEXT_MAX)
    measurement_field_client_id: UUID

    @model_validator(mode="before")
    @classmethod
    def normalize_legacy_range(cls, data: Any) -> Any:
        """TPL-R13：維持舊版 range 請求的誤差省略相容性。"""
        # 舊用戶端省略 range_form 時，由 matching_fields 預設 tolerance。
        # 此時 tolerance 為 null 或空白補 "0"（TPL-R13）。
        # 明填 range_form: null 不算省略，交由 matching_fields 拒絕。
        if not isinstance(data, dict):
            return data
        if data.get("condition") != "range" or "range_form" in data:
            return data
        tolerance = data.get("tolerance")
        if tolerance is None or (
            isinstance(tolerance, str) and not tolerance.strip()
        ):
            return {**data, "tolerance": "0"}
        return data

    @field_validator("value", "tolerance", "lower_bound", "upper_bound")
    @classmethod
    def numeric_value(cls, value: str | None) -> str | None:
        """TPL-R13：只保留有限數值，避免無限值進入標準。"""
        if value is None:
            return None
        normalized = value.strip()
        try:
            number = Decimal(normalized)
        except InvalidOperation as exc:
            raise ValueError("value must be numeric") from exc
        if not number.is_finite():
            raise ValueError("value must be finite")
        return normalized

    @model_validator(mode="after")
    def matching_fields(self):
        """TPL-R13：依區間型態限制數值、誤差與上下界的組合。"""
        if (
            self.condition == "range"
            and "range_form" not in self.model_fields_set
        ):
            self.range_form = "tolerance"
        bounds = (self.lower_bound, self.upper_bound)
        if self.condition != "range":
            if (
                self.value is None
                or self.range_form is not None
                or any(bound is not None for bound in bounds)
            ):
                raise ValueError("non-range standards need value only")
        elif self.range_form == "interval":
            if (
                self.value is not None
                or self.tolerance is not None
                or self.lower_bound is None
                or self.upper_bound is None
            ):
                raise ValueError("interval needs ordered bounds only")
            if Decimal(self.lower_bound) > Decimal(self.upper_bound):
                raise ValueError("lower_bound exceeds upper_bound")
        elif self.range_form == "tolerance":
            if (
                self.value is None
                or self.tolerance is None
                or Decimal(self.tolerance) < 0
                or any(bound is not None for bound in bounds)
            ):
                raise ValueError("tolerance needs value and nonnegative error")
        else:
            raise ValueError("range_form is required for range")
        return self

    @field_validator("unit")
    @classmethod
    def nonblank_unit(cls, unit: str) -> str:
        """TPL-R11：數值單位不能只含空白。"""
        normalized = unit.strip()
        if not normalized:
            raise ValueError("unit cannot be blank")
        return normalized


class MeasurementFieldBody(StrictBody):
    """範本預先定義的單一實測欄位。"""

    client_id: UUID
    name: str = Field(min_length=1, max_length=TITLE_MAX)
    field_type: Literal["text", "number"]
    unit: str | None = Field(default=None, max_length=UNIT_MAX)

    @field_validator("unit")
    @classmethod
    def nonblank_unit(cls, unit: str | None) -> str | None:
        """TPL-R11：區分省略單位與不合法的空白單位。"""
        if unit is None:
            return None
        normalized = unit.strip()
        if not normalized:
            raise ValueError("unit cannot be blank")
        return normalized


class EvidenceRequirementBody(StrictBody):
    """範本項次的照片需求；現場結果不屬範本資料。"""

    min_count: int = Field(default=1, ge=1, le=MIN_PHOTO_COUNT_MAX)


class PointBody(StrictBody):
    """範本中的單一查核項次及其標準、實測欄位與照片需求。"""

    sequence: int = Field(ge=1, le=32767)
    title: str = Field(max_length=TITLE_MAX)
    instruction: str = Field(max_length=LONG_TEXT_MAX)
    text_standard: TextStandardBody | None = None
    numeric_standard: NumericStandardBody | None = None
    measurement_fields: list[MeasurementFieldBody] = Field(
        default_factory=list, max_length=MEASUREMENT_FIELDS_MAX
    )
    # TPL-R11、#464：張數以 min_count 表達，不以重複照片需求列表示。
    evidence_requirements: list[EvidenceRequirementBody] = Field(
        min_length=1, max_length=1
    )

    @model_validator(mode="after")
    def one_standard(self):
        """TPL-R11：同一項次不得同時套用文字與數值標準。"""
        if (
            self.text_standard is not None
            and self.numeric_standard is not None
        ):
            raise ValueError("choose either a text or numeric standard")
        return self


class TemplateBody(StrictBody):
    """單一範本的完整結構請求；更新採整體覆蓋（TPL-R02）。"""

    system_id: UUID
    sequence: int = Field(ge=1, le=32767)
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    instruction: str = Field(max_length=LONG_TEXT_MAX)
    inspection_points: list[PointBody] = Field(
        default_factory=list, max_length=POINTS_MAX
    )

    @field_validator("title")
    @classmethod
    def nonblank_title(cls, title: str) -> str:
        """TPL-R03：避免空白標題成為正式範本名稱。"""
        if not title.strip():
            raise ValueError("title cannot be blank")
        return title
