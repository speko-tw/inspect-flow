// Field 清單請求使用同站 Cookie；回應欄位在此檢查後交給畫面。

const API_BASE = '/api/v1'

/** 工作台的 API 回傳非預期狀態碼時拋出。 */
export class FieldApiError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`API 錯誤（狀態碼 ${status}）`)
    this.name = 'FieldApiError'
    this.status = status
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new FieldApiError(response.status)
  }
  return (await response.json()) as T
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

export interface FieldTaskDetail extends Omit<
  FieldTask,
  'item_summary' | 'status'
> {
  status: FieldTask['status'] | 'COMPLETED' | 'CANCELLED'
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

export interface MyProject {
  id: string
  project_code: string
  name: string
  client_name: string
  site_location: string
  planned_start_date: string | null
  planned_completion_date: string | null
  role_names: string[]
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

function isFieldTaskDetail(value: unknown): value is FieldTaskDetail {
  if (!isRecord(value)) return false
  return (
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

/** Project template flow fallback for members who cannot list all projects. */
export function fetchMyProjects(): Promise<MyProject[]> {
  return getJson<MyProject[]>('/me/projects')
}
