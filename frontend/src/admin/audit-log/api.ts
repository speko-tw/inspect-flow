import { request } from '../api'

export interface AuditLogEntry {
  id: string
  created_at: string
  created_by: string
  project_id: string | null
  event_type: string
  entity_type: string
  entity_id: string
  before: unknown
  after: unknown
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  next_cursor: string | null
}

export interface AuditLogFilters {
  project_id: string
  actor_id: string
  from: string
  to: string
  event_type: string
}

export function listAuditLogs(
  filters: AuditLogFilters,
  cursor: string | null,
): Promise<AuditLogPage> {
  const query = new URLSearchParams({ limit: '50' })
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value)
  }
  if (cursor) query.set('cursor', cursor)
  return request(`/audit-logs?${query.toString()}`)
}
