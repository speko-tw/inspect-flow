import type { WorkflowSummary } from './api'

const FIELD_ONLY_CODES = new Set([
  'inspection_task.inspect',
  'inspection_task.read',
])

/** 依 ADM-R18 導開純現場使用者，判斷只看有效權限碼。 */
export function canViewIndoorSections(summary: WorkflowSummary): boolean {
  return summary.viewer_permission_codes.some(
    (code) => !FIELD_ONLY_CODES.has(code),
  )
}
