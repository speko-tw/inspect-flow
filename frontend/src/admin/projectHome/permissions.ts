import type { WorkflowSummary } from './api'

const FIELD_ONLY_CODES = new Set([
  'inspection_task.inspect',
  'inspection_task.read',
])

/**
 * 有效權限碼只要有現場執行碼（inspect／read）以外的碼，
 * 就視為可進內業區段；ADM-R18 的 project.read 例外尚未實作
 * （隨 #538 任務 P）。
 */
export function canViewIndoorSections(summary: WorkflowSummary): boolean {
  return summary.viewer_permission_codes.some(
    (code) => !FIELD_ONLY_CODES.has(code),
  )
}
