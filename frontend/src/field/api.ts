// Field 清單請求使用同站 Cookie；回應欄位在此檢查後交給畫面。

import { HttpError, request } from '../http'

/** 工作台的 API 回傳非預期狀態碼時拋出。 */
export class FieldApiError extends HttpError {
  constructor(status: number, code?: string, details?: unknown) {
    super(status, code, details)
    this.name = 'FieldApiError'
  }
}

function getJson<T>(path: string): Promise<T> {
  return request<T>(path, undefined, FieldApiError)
}

export interface FieldTask {
  id: string
  project_id: string
  project_name: string
  status: 'PENDING' | 'IN_PROGRESS'
  dispatched_at: string
  location: { zone_name: string | null; location_text: string | null }
  suggested_assignee: { name_zh: string | null } | null
  item_summary: { first_title: string | null; item_count: number }
}

export interface FieldTaskPage {
  items: FieldTask[]
  next_cursor: string | null
}

/** 詳情只給顯示名稱與「是否為本人」，不給使用者 ID 或帳號。 */
export interface FieldPerson {
  name_zh: string | null
  is_me: boolean
}

export interface FieldTaskDetail extends Omit<
  FieldTask,
  'item_summary' | 'status' | 'suggested_assignee'
> {
  status: FieldTask['status'] | 'COMPLETED' | 'CANCELLED'
  suggested_assignee: FieldPerson | null
  /** 實際開始者；尚未開始為 null。 */
  started_by: FieldPerson | null
  /** 僅 CANCELLED 任務有值。 */
  cancellation_reason: string | null
  items: Array<{
    title: string
    instruction: string | null
    inspection_points: Array<{
      sequence: number
      title: string
      instruction: string | null
      text_standard: { text: string } | null
      numeric_standard: {
        value: string | null
        condition: '<=' | '>=' | '=' | 'range'
        unit: string
        tolerance: string | null
        range_form: 'interval' | 'tolerance' | null
        lower_bound: string | null
        upper_bound: string | null
        measurement_field_id: string | null
      } | null
      measurement_fields: Array<{
        id: string
        name: string
        field_type: 'text' | 'number'
        unit: string | null
      }>
      evidence_requirements: Array<{
        evidence_type: string
        required: boolean
        min_count: number
        max_count: number | null
      }>
    }>
  }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function numericText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  )
}

function optionalNumericText(value: unknown): value is string | null {
  return value === null || numericText(value)
}

function isFieldTask(value: unknown): value is FieldTask {
  if (!isRecord(value)) return false
  const location = value.location
  const assignee = value.suggested_assignee
  const summary = value.item_summary
  return (
    typeof value.id === 'string' &&
    typeof value.project_id === 'string' &&
    typeof value.project_name === 'string' &&
    (value.status === 'PENDING' || value.status === 'IN_PROGRESS') &&
    typeof value.dispatched_at === 'string' &&
    isRecord(location) &&
    optionalText(location.zone_name) &&
    optionalText(location.location_text) &&
    (assignee === null ||
      (isRecord(assignee) && optionalText(assignee.name_zh))) &&
    isRecord(summary) &&
    optionalText(summary.first_title) &&
    Number.isInteger(summary.item_count) &&
    Number(summary.item_count) >= 0
  )
}

function isNumericStandard(value: unknown): boolean {
  if (value === null) return true
  if (
    !isRecord(value) ||
    !optionalNumericText(value.value) ||
    !['<=', '>=', '=', 'range'].includes(String(value.condition)) ||
    typeof value.unit !== 'string' ||
    !optionalNumericText(value.tolerance) ||
    (value.range_form !== null &&
      value.range_form !== 'interval' &&
      value.range_form !== 'tolerance') ||
    !optionalNumericText(value.lower_bound) ||
    !optionalNumericText(value.upper_bound) ||
    !optionalText(value.measurement_field_id)
  ) {
    return false
  }
  if (value.condition !== 'range') return numericText(value.value)
  if (value.range_form === 'interval') {
    return numericText(value.lower_bound) || numericText(value.upper_bound)
  }
  return numericText(value.value) && numericText(value.tolerance)
}

function isPoint(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    Number.isInteger(value.sequence) &&
    typeof value.title === 'string' &&
    optionalText(value.instruction) &&
    (value.text_standard === null ||
      (isRecord(value.text_standard) &&
        typeof value.text_standard.text === 'string')) &&
    isNumericStandard(value.numeric_standard) &&
    Array.isArray(value.measurement_fields) &&
    value.measurement_fields.every(
      (field: unknown) =>
        isRecord(field) &&
        typeof field.id === 'string' &&
        typeof field.name === 'string' &&
        (field.field_type === 'text' || field.field_type === 'number') &&
        optionalText(field.unit),
    ) &&
    Array.isArray(value.evidence_requirements) &&
    value.evidence_requirements.every(
      (evidence: unknown) =>
        isRecord(evidence) &&
        typeof evidence.evidence_type === 'string' &&
        typeof evidence.required === 'boolean' &&
        Number.isInteger(evidence.min_count) &&
        Number(evidence.min_count) >= 0 &&
        (evidence.max_count === null ||
          (Number.isInteger(evidence.max_count) &&
            Number(evidence.max_count) >= 0)),
    )
  )
}

function isFieldPerson(value: unknown): value is FieldPerson {
  return (
    isRecord(value) &&
    optionalText(value.name_zh) &&
    typeof value.is_me === 'boolean'
  )
}

function isFieldTaskDetail(value: unknown): value is FieldTaskDetail {
  if (!isRecord(value)) return false
  return (
    (value.suggested_assignee === null ||
      isFieldPerson(value.suggested_assignee)) &&
    (value.started_by === null || isFieldPerson(value.started_by)) &&
    optionalText(value.cancellation_reason) &&
    isFieldTask({
      ...value,
      status: 'PENDING',
      item_summary: {
        first_title: null,
        item_count: 0,
      },
    }) &&
    ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(
      String(value.status),
    ) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item: unknown) =>
        isRecord(item) &&
        typeof item.title === 'string' &&
        optionalText(item.instruction) &&
        Array.isArray(item.inspection_points) &&
        item.inspection_points.every(isPoint),
    )
  )
}

export async function fetchFieldTaskDetail(
  taskId: string,
): Promise<FieldTaskDetail> {
  const body = await getJson<unknown>(
    `/field/inspection-tasks/${encodeURIComponent(taskId)}`,
  )
  if (!isFieldTaskDetail(body)) {
    throw new Error('Field task detail response has an unexpected shape')
  }
  return body
}

/**
 * 開始查核（`POST /api/v1/inspection-tasks/{id}:start`）。後端覆核狀態、
 * 權限與計畫封存；非 2xx 拋出帶 `status` 與 `code` 的 `FieldApiError`。
 * 成功時只回傳後端確認的狀態，畫面不做樂觀更新。
 */
export async function startFieldTask(
  taskId: string,
): Promise<{ id: string; status: FieldTaskDetail['status'] }> {
  const body = await request<unknown>(
    `/inspection-tasks/${encodeURIComponent(taskId)}:start`,
    { method: 'POST' },
    FieldApiError,
  )
  if (
    !isRecord(body) ||
    typeof body.id !== 'string' ||
    !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].includes(
      String(body.status),
    )
  ) {
    throw new Error('Start task response has an unexpected shape')
  }
  return {
    id: body.id,
    status: body.status as FieldTaskDetail['status'],
  }
}

export async function fetchFieldTasks(params: {
  assignedToMe: boolean
  status: FieldTask['status'] | null
  cursor?: string | null
  limit?: number
}): Promise<FieldTaskPage> {
  const query = new URLSearchParams({
    assigned_to_me: String(params.assignedToMe),
    limit: String(params.limit ?? 10),
  })
  if (params.status) query.set('status', params.status)
  if (params.cursor) query.set('cursor', params.cursor)
  const body = await getJson<unknown>(`/field/inspection-tasks?${query}`)
  if (
    !isRecord(body) ||
    !Array.isArray(body.items) ||
    !body.items.every(isFieldTask) ||
    !optionalText(body.next_cursor)
  ) {
    throw new Error('Field task list response has an unexpected shape')
  }
  return { items: body.items, next_cursor: body.next_cursor }
}
