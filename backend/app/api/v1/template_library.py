"""Category, system and inspection template endpoints (TPL T3)."""

from collections.abc import Sequence
from decimal import Decimal, InvalidOperation
from functools import partial
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.limits import (
    LONG_TEXT_MAX,
    MEASUREMENT_FIELDS_MAX,
    MIN_PHOTO_COUNT_MAX,
    NUMBER_TEXT_MAX,
    POINTS_MAX,
    TEMPLATES_MAX,
    TITLE_MAX,
    UNIT_MAX,
)
from app.api.pagination import page, write_call
from app.auth.access import (
    require_module_permission,
)
from app.auth.dependencies import get_db
from app.models import (
    TemplateCategory,
    TemplateEvidenceRequirement,
    TemplateInspectionPoint,
    TemplateItem,
    TemplateMeasurementField,
    TemplateNumericStandard,
    TemplateSystem,
    TemplateTextStandard,
)
from app.services.inspection_details import inspection_points_by_item
from app.services.template_library import (
    InvalidTemplateError,
    create_category,
    create_system,
    create_template,
    delete_category,
    delete_system,
    delete_template,
    park_template_names,
    rename_category,
    rename_system,
    replace_template,
    validate_system_structures,
)

category_router = APIRouter(
    prefix="/template-categories", tags=["template-library"]
)
system_router = APIRouter(
    prefix="/template-systems", tags=["template-library"]
)
template_router = APIRouter(prefix="/templates", tags=["template-library"])
_write = Depends(
    require_module_permission("template.manage"),
    scope="function",
)
_read = Depends(
    require_module_permission("template.use"),
    scope="function",
)
_db_dependency: Any = Depends(get_db, scope="function")
_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 100


class StrictBody(BaseModel):
    """拒絕多餘欄位，避免未知輸入被靜默忽略後造成錯誤成功回應。"""

    model_config = ConfigDict(extra="forbid")


class NameBody(StrictBody):
    """供類別與系統新增、改名端點共用的名稱欄位。"""

    name: str = Field(min_length=1, max_length=TITLE_MAX)

    @field_validator("name")
    @classmethod
    def nonblank(cls, name: str) -> str:
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
        # 舊用戶端未送 range_form 時沿用 tolerance，明確送 null 則交由
        # 後續欄位驗證拒絕，避免把錯誤輸入當成舊版省略欄位。
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
    # Exactly one photo requirement per point (#464): the count is
    # expressed by ``min_count``, never by repeating the requirement.
    evidence_requirements: list[EvidenceRequirementBody] = Field(
        min_length=1, max_length=1
    )

    @model_validator(mode="after")
    def one_standard(self):
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
        if not title.strip():
            raise ValueError("title cannot be blank")
        return title


class SystemTemplateBody(TemplateBody):
    """整系統覆蓋時可選擇既有範本識別碼的項目結構。"""

    id: UUID | None = None


class SystemTemplatesBody(StrictBody):
    """整個系統要保存的完整範本項目集合。"""

    items: list[SystemTemplateBody] = Field(max_length=TEMPLATES_MAX)


def _category(db: Session, category_id: UUID) -> TemplateCategory:
    category = db.get(TemplateCategory, category_id)
    if category is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return category


def _system(db: Session, system_id: UUID) -> TemplateSystem:
    system = db.get(TemplateSystem, system_id)
    if system is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return system


def _item(db: Session, template_id: UUID) -> TemplateItem:
    item = db.get(TemplateItem, template_id)
    if item is None:
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    return item


def _name_conflict(exc: IntegrityError) -> bool:
    """辨識各資料庫回報的唯一索引衝突，統一映射為名稱衝突。"""
    constraint = getattr(
        getattr(exc.orig, "diag", None), "constraint_name", None
    )
    indexes = (
        "ix_template_categories_name",
        "ix_template_systems_category_name",
        "ix_template_items_system_title",
    )
    detail = str(exc.orig).lower()
    return constraint in indexes or any(name in detail for name in indexes)


def _invalid_structure_constraint(exc: IntegrityError) -> bool:
    constraint = getattr(
        getattr(exc.orig, "diag", None), "constraint_name", None
    )
    names = (
        "uq_template_inspection_points_template_item_id",
        "pk_template_measurement_fields",
        "uq_template_measurement_fields_point_id",
        "uq_template_measurement_fields_point_id_type_unit",
        "uq_template_numeric_standards_measurement_field_id",
        "uq_template_evidence_point_type",
        "ck_template_measurement_fields_"
        "numeric_measurement_field_requires_unit",
    )
    detail = str(exc.orig).lower()
    sqlite_columns = (
        "template_inspection_points.template_item_id, "
        "template_inspection_points.sequence",
        "template_measurement_fields.id",
        "template_numeric_standards.measurement_field_id",
        "template_evidence_requirements.inspection_point_id, "
        "template_evidence_requirements.evidence_type",
    )
    return constraint in names or any(
        name in detail for name in (*names, *sqlite_columns)
    )


def template_library_error(exc: Exception) -> APIError | None:
    """將範本結構或約束錯誤轉成 API 契約錯誤，不吞掉未知例外。"""
    if isinstance(exc, InvalidTemplateError):
        return APIError(
            ErrorCode.REQUEST_VALIDATION_FAILED,
            422,
            fields=[
                {"path": field.path, "code": field.code}
                for field in exc.fields
            ],
        )
    if isinstance(exc, IntegrityError):
        if _name_conflict(exc):
            return APIError(ErrorCode.TEMPLATE_NAME_CONFLICT, 409)
        if _invalid_structure_constraint(exc):
            return APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    return None


template_write_call = partial(write_call, error_mapper=template_library_error)


def _summary(row) -> dict:
    data = {"id": row.id}
    for field in (
        "name",
        "category_id",
        "system_id",
        "sequence",
        "title",
        "instruction",
    ):
        if hasattr(row, field):
            data[field] = getattr(row, field)
    return data


def _category_summaries(
    db: Session, rows: Sequence[TemplateCategory]
) -> list[dict]:
    """附上系統數量；分組查詢避免每個類別各自執行一次 count。"""
    counts = {
        owner: total
        for owner, total in db.execute(
            select(TemplateSystem.category_id, func.count())
            .where(TemplateSystem.category_id.in_([row.id for row in rows]))
            .group_by(TemplateSystem.category_id)
        )
    }
    return [
        {**_summary(row), "system_count": counts.get(row.id, 0)}
        for row in rows
    ]


def _system_summaries(
    db: Session, rows: Sequence[TemplateSystem]
) -> list[dict]:
    """附上項目數量；分組查詢避免每個系統各自執行一次 count。"""
    counts = {
        owner: total
        for owner, total in db.execute(
            select(TemplateItem.system_id, func.count())
            .where(TemplateItem.system_id.in_([row.id for row in rows]))
            .group_by(TemplateItem.system_id)
        )
    }
    return [
        {**_summary(row), "item_count": counts.get(row.id, 0)} for row in rows
    ]


def template_item_details(
    db: Session, items: Sequence[TemplateItem]
) -> list[dict]:
    """Serialize template items with batched point queries."""
    points = inspection_points_by_item(
        db,
        [item.id for item in items],
        point_item_column=TemplateInspectionPoint.template_item_id,
        point_order_by=(
            TemplateInspectionPoint.sequence,
            TemplateInspectionPoint.id,
        ),
        measurement_field_model=TemplateMeasurementField,
        text_standard_model=TemplateTextStandard,
        numeric_standard_model=TemplateNumericStandard,
        evidence_requirement_model=TemplateEvidenceRequirement,
    )
    result = []
    for item in items:
        data = _summary(item)
        data["inspection_points"] = points.get(item.id, [])
        result.append(data)
    return result


def template_item_detail(db: Session, item: TemplateItem) -> dict:
    """序列化單一範本及其巢狀結構。"""
    return template_item_details(db, [item])[0]


@category_router.get("", dependencies=[_read])
def list_categories(
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,  # noqa
) -> dict:
    """列出可供瀏覽與套用的範本工程類別（TPL-R09）。"""
    return page(
        db,
        TemplateCategory,
        cursor=cursor,
        limit=limit,
        serialize_batch=lambda rows: _category_summaries(db, rows),
    )


@category_router.post("", status_code=201, dependencies=[_write])
def add_category(body: NameBody, db: Session = _db_dependency) -> dict:
    """建立範本工程類別；名稱衝突由資料庫約束轉為共用錯誤。"""
    return _category_summaries(
        db, [template_write_call(create_category, db, body.name)]
    )[0]


@category_router.patch("/{category_id}", dependencies=[_write])
def patch_category(
    category_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    """更新類別名稱並回傳含系統數量的摘要。"""
    category = _category(db, category_id)
    return _category_summaries(
        db, [template_write_call(rename_category, db, category, body.name)]
    )[0]


@category_router.delete(
    "/{category_id}", status_code=204, dependencies=[_write]
)
def remove_category(category_id: UUID, db: Session = _db_dependency) -> None:
    """只允許刪除空類別，避免級聯刪除使用中的範本結構。"""
    category = _category(db, category_id)
    occupied = db.scalar(
        select(TemplateSystem.id)
        .where(TemplateSystem.category_id == category_id)
        .limit(1)
    )
    if occupied is not None:
        raise APIError(ErrorCode.TEMPLATE_CATEGORY_NOT_EMPTY, 409)
    delete_category(db, category)


@category_router.get(
    "/{category_id}/systems",
    dependencies=[_read],
)
def list_systems(
    category_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    """列出指定類別的系統，並以游標分頁避免載入整棵範本樹。"""
    _category(db, category_id)
    return page(
        db,
        TemplateSystem,
        cursor=cursor,
        limit=limit,
        filters=(TemplateSystem.category_id == category_id,),
        serialize_batch=lambda rows: _system_summaries(db, rows),
    )


@category_router.post(
    "/{category_id}/systems", status_code=201, dependencies=[_write]
)
def add_system(
    category_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    """在指定類別建立系統。"""
    category = _category(db, category_id)
    return _system_summaries(
        db, [template_write_call(create_system, db, category, body.name)]
    )[0]


@system_router.patch("/{system_id}", dependencies=[_write])
def patch_system(
    system_id: UUID, body: NameBody, db: Session = _db_dependency
) -> dict:
    """更新系統名稱並回傳含項目數量的摘要。"""
    system = _system(db, system_id)
    return _system_summaries(
        db, [template_write_call(rename_system, db, system, body.name)]
    )[0]


@system_router.delete("/{system_id}", status_code=204, dependencies=[_write])
def remove_system(system_id: UUID, db: Session = _db_dependency) -> None:
    """只允許刪除空系統，保護其下範本項目。"""
    system = _system(db, system_id)
    occupied = db.scalar(
        select(TemplateItem.id)
        .where(TemplateItem.system_id == system_id)
        .limit(1)
    )
    if occupied is not None:
        raise APIError(ErrorCode.TEMPLATE_SYSTEM_NOT_EMPTY, 409)
    delete_system(db, system)


@template_router.get("", dependencies=[_read])
def list_templates(
    system_id: UUID | None = None,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    """列出範本摘要，可選擇限制在單一系統內。"""
    filters = ()
    if system_id is not None:
        _system(db, system_id)
        filters = (TemplateItem.system_id == system_id,)
    return page(
        db,
        TemplateItem,
        cursor=cursor,
        limit=limit,
        filters=filters,
        serialize=_summary,
    )


@template_router.post("", status_code=201, dependencies=[_write])
def add_template(body: TemplateBody, db: Session = _db_dependency) -> dict:
    """建立完整查核項目範本並回傳其巢狀結構。"""
    _system(db, body.system_id)
    item = template_write_call(create_template, db, body.model_dump())
    return template_item_detail(db, item)


@template_router.get("/{template_id}", dependencies=[_read])
def get_template(template_id: UUID, db: Session = _db_dependency) -> dict:
    """讀取單一範本的完整查核項次與欄位定義。"""
    return template_item_detail(db, _item(db, template_id))


@template_router.put("/{template_id}", dependencies=[_write])
def put_template(
    template_id: UUID, body: TemplateBody, db: Session = _db_dependency
) -> dict:
    """以請求中的完整結構取代單一範本（TPL-R02）。"""
    item = _item(db, template_id)
    _system(db, body.system_id)
    updated = template_write_call(
        replace_template, db, item, body.model_dump()
    )
    return template_item_detail(db, updated)


@template_router.delete(
    "/{template_id}", status_code=204, dependencies=[_write]
)
def remove_template(template_id: UUID, db: Session = _db_dependency) -> None:
    """刪除單一範本；已套用到專案的副本不受影響（TPL-R08）。"""
    delete_template(db, _item(db, template_id))


@system_router.get("/{system_id}/templates", dependencies=[_read])
def get_system_templates(
    system_id: UUID,
    cursor: str | None = None,
    limit: int = Query(default=_PAGE_SIZE, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = _db_dependency,
) -> dict:
    """取得系統內範本及完整結構，供整系統編輯載入。"""
    _system(db, system_id)
    return page(
        db,
        TemplateItem,
        cursor=cursor,
        limit=limit,
        filters=(TemplateItem.system_id == system_id,),
        serialize_batch=lambda items: template_item_details(db, items),
    )


@system_router.put("/{system_id}/templates", dependencies=[_write])
def put_system_templates(
    system_id: UUID, body: SystemTemplatesBody, db: Session = _db_dependency
) -> dict:
    """原子替換系統範本集合，避免驗證或寫入失敗留下部分更新。"""
    _system(db, system_id)
    entries = body.items
    if any(entry.system_id != system_id for entry in entries):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    ids = [entry.id for entry in entries if entry.id is not None]
    names = [entry.title.strip().casefold() for entry in entries]
    if len(set(ids)) != len(ids):
        raise APIError(ErrorCode.REQUEST_VALIDATION_FAILED, 422)
    if len(set(names)) != len(names):
        raise APIError(ErrorCode.TEMPLATE_NAME_CONFLICT, 409)
    payloads = [entry.model_dump(exclude={"id"}) for entry in entries]
    template_write_call(validate_system_structures, payloads)
    existing = db.scalars(
        select(TemplateItem).where(TemplateItem.system_id == system_id)
    ).all()
    by_id = {item.id: item for item in existing}
    if any(identifier not in by_id for identifier in ids):
        raise APIError(ErrorCode.RESOURCE_NOT_FOUND, 404)
    audit_before = template_write_call(park_template_names, db, existing)
    for item in existing:
        if item.id not in ids:
            delete_template(db, item, audit_before=audit_before[item.id])
    saved = []
    for entry, data in zip(entries, payloads, strict=True):
        if entry.id is None:
            item = template_write_call(create_template, db, data)
        else:
            item = template_write_call(
                replace_template,
                db,
                by_id[entry.id],
                data,
                audit_before[entry.id],
            )
        saved.append(item)
    return {"items": template_item_details(db, saved)}
