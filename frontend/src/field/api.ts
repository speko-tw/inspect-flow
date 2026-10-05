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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
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
