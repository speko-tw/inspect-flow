import type { WorkflowSummary } from './api'

const FIELD_ONLY_CODES = new Set([
  'inspection_task.inspect',
  'inspection_task.read',
])

/**
 * 依後端回傳的有效權限碼判斷內業入口；`project.read` 也可唯讀進入。
 * 後端已依 AUT-R19 排除缺少模組可使用權的專案代碼。
 */
export function canViewIndoorSections(summary: WorkflowSummary): boolean {
  return summary.viewer_permission_codes.some(
    (code) => !FIELD_ONLY_CODES.has(code),
  )
}
