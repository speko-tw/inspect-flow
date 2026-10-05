import type { WorkflowSummary } from './api'

const FIELD_ONLY_CODES = new Set([
  'inspection_task.inspect',
  'inspection_task.read',
])

export function canViewIndoorSections(summary: WorkflowSummary): boolean {
  return summary.viewer_permission_codes.some(
    (code) => !FIELD_ONLY_CODES.has(code),
  )
}
