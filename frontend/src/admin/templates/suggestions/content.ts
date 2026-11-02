import { formatInspectionStandard } from '../../../ui/inspectionStandard'
import type { InspectionPoint, TemplateItem } from '../api'
import { validateItemFields } from '../itemFieldValidation'
import { forWire, localizeInspectionPoints } from '../templateEditorUtils'
import type { SuggestionStatus } from './api'

// 建議內容快照（TPL-R30）與共用項目編輯器模型之間的轉換、完整性檢查
// 與相鄰兩版差異。快照形狀對齊後端 `template_suggestions` 模型：項次與
// 欄位以 `logical_id` 在本件內穩定識別，不帶來源資料庫主鍵。

export interface SuggestionField {
  logical_id: string
  name: string
  field_type: 'text' | 'number'
  unit: string | null
  sort_order: number
}

export interface SuggestionNumericStandard {
  value: string | null
  condition: '<=' | '>=' | '=' | 'range'
  unit: string | null
  tolerance: string | null
  range_form?: 'interval' | 'tolerance' | null
  lower_bound?: string | null
  upper_bound?: string | null
  measurement_field_logical_id: string | null
}

export interface SuggestionPoint {
  logical_id: string
  sequence: number
  title: string
  instruction: string
  text_standard: { text: string } | null
  numeric_standard: SuggestionNumericStandard | null
  measurement_fields: SuggestionField[]
  evidence_requirements: Array<{
    evidence_type?: 'photo'
    required?: boolean
    min_count: number
    max_count?: number | null
  }>
}

export interface SuggestionContent {
  title: string
  instruction: string
  inspection_points: SuggestionPoint[]
}

/** 狀態文字與標籤變體；名稱沿用 TPL-R31 的狀態機用語。 */
export const SUGGESTION_STATUS: Record<
  SuggestionStatus,
  { label: string; variant: 'info' | 'warning' | 'success' | 'neutral' }
> = {
  PENDING: { label: '待審', variant: 'info' },
  RETURNED: { label: '退回', variant: 'warning' },
  APPROVED: { label: '已核准', variant: 'success' },
  WITHDRAWN: { label: '已撤回', variant: 'neutral' },
}

/** 名稱留白（退回件允許保存未完成內容，TPL-R32）時的顯示字。 */
export function displayTitle(title: string): string {
  return title.trim() || '（未填名稱）'
}

/** 轉成共用編輯器使用的項目草稿；`clientKey` 即穩定邏輯識別。 */
export function toEditorItem(content: SuggestionContent): TemplateItem {
  const points: InspectionPoint[] = content.inspection_points.map(
    (point, index) => ({
      clientKey: point.logical_id,
      sequence: index + 1,
      title: point.title,
      instruction: point.instruction,
      text_standard: point.text_standard,
      numeric_standard: point.numeric_standard
        ? {
            value: point.numeric_standard.value,
            condition: point.numeric_standard.condition,
            unit: point.numeric_standard.unit ?? '',
            tolerance: point.numeric_standard.tolerance,
            range_form: point.numeric_standard.range_form,
            lower_bound: point.numeric_standard.lower_bound,
            upper_bound: point.numeric_standard.upper_bound,
            measurement_field_client_id:
              point.numeric_standard.measurement_field_logical_id ?? undefined,
          }
        : null,
      measurement_fields: [...point.measurement_fields]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((field) => ({
          client_id: field.logical_id,
          clientKey: field.logical_id,
          name: field.name,
          field_type: field.field_type,
          unit: field.unit,
        })),
      evidence_requirements: point.evidence_requirements.map((entry) => ({
        min_count: entry.min_count,
      })),
    }),
  )
  return {
    system_id: '',
    sequence: 1,
    title: content.title,
    instruction: content.instruction,
    inspection_points: localizeInspectionPoints(points, {
      stablePointKeys: true,
      fillBoundFieldUnit: true,
    }),
  }
}

/** 每個項次的照片張數草稿（編輯器以字串保存，允許輸入中的空值）。 */
export function photoDraftOf(item: TemplateItem): Record<string, string> {
  return Object.fromEntries(
    item.inspection_points.map((point, index) => [
      String(index),
      String(point.evidence_requirements[0]?.min_count ?? 1),
    ]),
  )
}

/**
 * 編輯器草稿轉回快照。照片張數無法解析時存 0：退回件允許保存未完成
 * 內容（TPL-R32），重送前的完整性檢查會擋下。
 */
export function fromEditorItem(
  item: TemplateItem,
  photos: Record<string, string>,
): SuggestionContent {
  const wire = forWire({
    ...item,
    inspection_points: item.inspection_points.map((point, index) => {
      const count = Number(photos[String(index)] ?? '1')
      return {
        ...point,
        evidence_requirements: [
          { min_count: Number.isFinite(count) ? Math.trunc(count) : 0 },
        ],
      }
    }),
  })
  return {
    title: wire.title,
    instruction: wire.instruction,
    inspection_points: wire.inspection_points.map((point, index) => {
      const numeric = point.numeric_standard
      return {
        logical_id: item.inspection_points[index].clientKey ?? '',
        sequence: index + 1,
        title: point.title,
        instruction: point.instruction,
        text_standard: point.text_standard,
        numeric_standard: numeric
          ? {
              value: numeric.value,
              condition: numeric.condition,
              unit: numeric.unit,
              tolerance: numeric.tolerance,
              range_form: numeric.range_form ?? null,
              lower_bound: numeric.lower_bound ?? null,
              upper_bound: numeric.upper_bound ?? null,
              measurement_field_logical_id:
                numeric.measurement_field_client_id ?? null,
            }
          : null,
        measurement_fields: point.measurement_fields.map(
          (field, fieldIndex) => ({
            logical_id: field.client_id ?? '',
            name: field.name,
            field_type: field.field_type,
            unit: field.unit,
            sort_order: fieldIndex,
          }),
        ),
        evidence_requirements: point.evidence_requirements.map((entry) => ({
          min_count: entry.min_count,
        })),
      }
    }),
  }
}

/** 兩份快照經同一條正規化路徑後是否相同，用來判斷「內容沒有變更」。 */
export function sameContent(
  a: SuggestionContent,
  b: SuggestionContent,
): boolean {
  const normalize = (content: SuggestionContent) => {
    const item = toEditorItem(content)
    return JSON.stringify(fromEditorItem(item, photoDraftOf(item)))
  }
  return normalize(a) === normalize(b)
}

/**
 * TPL-R32：重送時才要求完整合法。回傳以編輯器錯誤 key 為索引的訊息，
 * 沿用範本與專案項目頁相同的欄位規則（TPL-R13、TPL-R18）。
 */
export function completenessErrors(
  content: SuggestionContent,
): Record<string, string> {
  const item = toEditorItem(content)
  return validateItemFields(item, photoDraftOf(item), {
    stablePointErrorKeys: true,
  })
}

/** 單一項次的標準白話文字，供讀取畫面與差異比對共用。 */
export function standardText(point: SuggestionPoint): string {
  const numeric = point.numeric_standard
  return formatInspectionStandard({
    text_standard: point.text_standard,
    numeric_standard: numeric
      ? {
          ...numeric,
          measurement_field_client_key:
            numeric.measurement_field_logical_id ?? undefined,
        }
      : null,
    measurement_fields: point.measurement_fields.map((field) => ({
      clientKey: field.logical_id,
      unit: field.unit,
    })),
  })
}

/** 規格 TPL-AC36 的四種差異。 */
export type DifferenceKind = 'added' | 'removed' | 'modified' | 'reordered'

export const DIFFERENCE_LABELS: Record<DifferenceKind, string> = {
  added: '新增',
  removed: '刪除',
  modified: '修改',
  reordered: '重排',
}

export interface Difference {
  kind: DifferenceKind
  label: string
  before: string
  after: string
  /** 跳轉用：差異所在的項次；項目層級的差異為 null。 */
  pointId: string | null
}

function fieldDescription(field: SuggestionField): string {
  const detail =
    field.field_type === 'number'
      ? `數字，${field.unit?.trim() || '未填單位'}`
      : '文字'
  return `${field.name || '（未填名稱）'}（${detail}）`
}

function boundName(point: SuggestionPoint): string {
  const id = point.numeric_standard?.measurement_field_logical_id
  return (
    point.measurement_fields.find((field) => field.logical_id === id)?.name ||
    '未綁定'
  )
}

/**
 * 依穩定邏輯識別比對相鄰兩版，列出項次與欄位的新增、刪除、修改、重排
 * （TPL-AC36）。只比對兩版都有的識別，缺的一側算新增或刪除，所以改名
 * 的項次是「修改」而不是「刪一增一」。
 */
export function computeDifferences(
  before: SuggestionContent,
  after: SuggestionContent,
): Difference[] {
  const out: Difference[] = []
  const add = (
    kind: DifferenceKind,
    label: string,
    from: string,
    to: string,
    pointId: string | null,
  ) => out.push({ kind, label, before: from, after: to, pointId })
  const changed = (
    label: string,
    from: string,
    to: string,
    pointId: string | null,
  ) => {
    if (from !== to) add('modified', label, from, to, pointId)
  }
  changed('查核項目名稱', before.title, after.title, null)
  changed('檢查說明', before.instruction, after.instruction, null)

  const ids = (points: SuggestionPoint[]) => points.map((p) => p.logical_id)
  const beforeIds = new Set(ids(before.inspection_points))
  const afterIds = new Set(ids(after.inspection_points))
  const sharedBefore = before.inspection_points.filter((p) =>
    afterIds.has(p.logical_id),
  )
  const sharedAfter = after.inspection_points.filter((p) =>
    beforeIds.has(p.logical_id),
  )
  if (ids(sharedBefore).join() !== ids(sharedAfter).join()) {
    add(
      'reordered',
      '查核項次',
      sharedBefore.map((p) => p.title).join('／'),
      sharedAfter.map((p) => p.title).join('／'),
      null,
    )
  }
  for (const point of before.inspection_points) {
    if (!afterIds.has(point.logical_id)) {
      add('removed', '查核項次', point.title, '（已移除）', point.logical_id)
    }
  }
  for (const point of after.inspection_points) {
    const id = point.logical_id
    const old = before.inspection_points.find((p) => p.logical_id === id)
    if (!old) {
      add('added', '查核項次', '（無）', point.title, id)
      continue
    }
    const name = point.title || '（未填標題）'
    changed(`${name}／標題`, old.title, point.title, id)
    changed(`${name}／說明`, old.instruction, point.instruction, id)
    changed(`${name}／標準`, standardText(old), standardText(point), id)
    changed(`${name}／綁定欄位`, boundName(old), boundName(point), id)
    changed(
      `${name}／照片張數`,
      String(old.evidence_requirements[0]?.min_count ?? ''),
      String(point.evidence_requirements[0]?.min_count ?? ''),
      id,
    )
    const oldFieldIds = new Set(
      old.measurement_fields.map((f) => f.logical_id),
    )
    const newFieldIds = new Set(
      point.measurement_fields.map((f) => f.logical_id),
    )
    const byOrder = (fields: SuggestionField[]) =>
      [...fields].sort((a, b) => a.sort_order - b.sort_order)
    const oldShared = byOrder(old.measurement_fields).filter((f) =>
      newFieldIds.has(f.logical_id),
    )
    const newShared = byOrder(point.measurement_fields).filter((f) =>
      oldFieldIds.has(f.logical_id),
    )
    if (
      oldShared.map((f) => f.logical_id).join() !==
      newShared.map((f) => f.logical_id).join()
    ) {
      add(
        'reordered',
        `${name}／實測欄位`,
        oldShared.map((f) => f.name).join('／'),
        newShared.map((f) => f.name).join('／'),
        id,
      )
    }
    for (const field of old.measurement_fields) {
      if (!newFieldIds.has(field.logical_id)) {
        add('removed', `${name}／欄位`, field.name, '（已移除）', id)
      }
    }
    for (const field of point.measurement_fields) {
      const original = old.measurement_fields.find(
        (f) => f.logical_id === field.logical_id,
      )
      if (!original) {
        add('added', `${name}／欄位`, '（無）', field.name, id)
      } else {
        changed(
          `${name}／欄位`,
          fieldDescription(original),
          fieldDescription(field),
          id,
        )
      }
    }
  }
  return out
}
