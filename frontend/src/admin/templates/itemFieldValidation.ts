import type { TemplateItem } from './api'
import { boundField, rangeForm } from './templateEditorUtils'

/**
 * 依 TPL-R13、TPL-R18 統一兩頁送出前的欄位檢查與錯誤文案。
 * 名稱唯一範圍由頁面覆核；專案以穩定項次識別維持增刪後的錯誤對應。
 */
export function validateItemFields(
  item: TemplateItem,
  photos: Record<string, string>,
  { stablePointErrorKeys = false } = {},
): Record<string, string> {
  const result: Record<string, string> = {}
  if (!item.title.trim()) result.title = '請填寫查核項目名稱'
  if (item.inspection_points.length === 0) {
    result.points = '請至少新增一個查核項次'
  }
  item.inspection_points.forEach((point, pointIndex) => {
    const identity = stablePointErrorKeys
      ? (point.clientKey ?? point.id ?? pointIndex)
      : pointIndex
    const key = `point:${identity}`
    if (!point.title.trim()) result[`${key}:title`] = '請填寫項次標題'
    point.measurement_fields.forEach((field, fieldIndex) => {
      const base = `${key}:field:${fieldIndex}`
      if (!field.name.trim()) {
        result[`${base}:name`] = '請填寫欄位名稱'
      }
      if (field.field_type === 'number' && !field.unit?.trim()) {
        result[`${base}:unit`] = '請填寫單位'
      }
    })
    const standard = point.numeric_standard
    if (standard) {
      if (!boundField(point)) {
        result[`${key}:binding`] = '請選擇要用來判定的數字欄位'
      }
      if (standard.condition === 'range') {
        if (rangeForm(standard) === 'interval') {
          const lower = Number(standard.lower_bound)
          const upper = Number(standard.upper_bound)
          if (!standard.lower_bound?.trim() || !Number.isFinite(lower)) {
            result[`${key}:lower`] = '請填寫有效的下限'
          }
          if (!standard.upper_bound?.trim() || !Number.isFinite(upper)) {
            result[`${key}:upper`] = '請填寫有效的上限'
          }
          if (
            Boolean(standard.lower_bound?.trim()) &&
            Boolean(standard.upper_bound?.trim()) &&
            Number.isFinite(lower) &&
            Number.isFinite(upper) &&
            lower > upper
          ) {
            result[`${key}:range`] = '下限不能大於上限'
          }
        } else {
          if (
            !standard.value?.trim() ||
            !Number.isFinite(Number(standard.value))
          ) {
            result[`${key}:value`] = '請填寫有效的標準值'
          }
          const tolerance = Number(standard.tolerance)
          if (!standard.tolerance?.trim() || !Number.isFinite(tolerance)) {
            result[`${key}:tolerance`] = '請填寫有效的容許誤差'
          } else if (tolerance < 0) {
            result[`${key}:tolerance`] = '容許誤差不能小於 0'
          }
        }
      } else {
        if (
          !standard.value?.trim() ||
          !Number.isFinite(Number(standard.value))
        ) {
          result[`${key}:value`] = '請填寫有效的標準值'
        }
        if (standard.tolerance?.trim()) {
          const tolerance = Number(standard.tolerance)
          if (!Number.isFinite(tolerance)) {
            result[`${key}:tolerance`] = '請填寫有效的容許誤差'
          }
        }
      }
    }
    if (point.text_standard && !point.text_standard.text.trim()) {
      result[`${key}:text`] = '請填寫標準文字'
    }
    const photoCount = photos[String(pointIndex)] ?? '1'
    if (
      !photoCount.trim() ||
      !Number.isInteger(Number(photoCount)) ||
      Number(photoCount) < 1
    ) {
      result[`${key}:photos`] = '照片至少需要 1 張'
    }
  })
  return result
}
