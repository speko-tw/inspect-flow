"""Category, system and inspection template endpoints (TPL T3)."""

from collections.abc import Sequence
from functools import partial
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.errors import APIError, ErrorCode
from app.api.limits import TEMPLATES_MAX
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
from app.template_structure import (
    EvidenceRequirementBody as EvidenceRequirementBody,
)
from app.template_structure import (
    MeasurementFieldBody as MeasurementFieldBody,
)
from app.template_structure import (
    NameBody as NameBody,
)
from app.template_structure import (
    NumericStandardBody as NumericStandardBody,
)
from app.template_structure import (
    PointBody as PointBody,
)

# TPL T16：保留原匯出名稱；抽離驗證模型不改動既有路由契約。
from app.template_structure import (
    StrictBody as StrictBody,
)
from app.template_structure import (
    TemplateBody as TemplateBody,
)
from app.template_structure import (
    TextStandardBody as TextStandardBody,
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
    """辨識三個名稱唯一索引的衝突（TPL-R03）。"""
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
