// 前後端共用權限目錄；專案權限描述與摘要由目錄帶入。
import permissionCodeContract from '../../permissionCodeContract'

const PERMISSION_DESCRIPTIONS = permissionCodeContract.codes
  .filter(({ scope }) => scope === 'project')
  .map(({ code, description }) => [code, description] as const)

// Role 只能包含 project-scope 權限碼；摘要不含 module 權限。
export const ROLE_SUMMARY_PHRASE_CODES = new Set(
  PERMISSION_DESCRIPTIONS.map(([code]) => code),
)

export const NO_PERMISSION_TEXT = '尚未設定任何權限'
export const UNKNOWN_PERMISSION_TEXT = '可使用部分功能'

export interface RolePermissionDetail {
  code: string
  label: string
}

function permissionLabel(
  code: string,
  descriptions?: Map<string, string>,
): string {
  return (
    descriptions?.get(code) ??
    PERMISSION_DESCRIPTIONS.find(([known]) => known === code)?.[1] ??
    UNKNOWN_PERMISSION_TEXT
  )
}

export function rolePermissionDetails(
  permissionCodes: string[],
  descriptions?: Map<string, string>,
): RolePermissionDetail[] {
  return [...new Set(permissionCodes)].map((code) => ({
    code,
    label: permissionLabel(code, descriptions),
  }))
}

/** 回傳一行白話說明，例如「可建立查核任務、派出查核任務」。 */
export function describeRole(
  permissionCodes: string[],
  descriptions?: Map<string, string>,
): string {
  if (permissionCodes.length === 0) return NO_PERMISSION_TEXT
  const labels = rolePermissionDetails(permissionCodes, descriptions).map(
    ({ label }) => label,
  )
  return formatRoleLabels(labels)
}

function formatRoleLabels(labels: string[]): string {
  const knownLabels = labels.filter(
    (label) => label !== UNKNOWN_PERMISSION_TEXT,
  )
  if (knownLabels.length === 0) return UNKNOWN_PERMISSION_TEXT
  if (knownLabels.length === labels.length) return `可${labels.join('、')}`
  return labels
    .map((label) => (label === UNKNOWN_PERMISSION_TEXT ? label : `可${label}`))
    .join('、')
}

/** 畫面預設的一句摘要；完整說明留在可展開清單。 */
export function summarizeRole(
  permissionCodes: string[],
  descriptions?: Map<string, string>,
): string {
  const details = rolePermissionDetails(permissionCodes, descriptions)
  if (details.length === 0) return NO_PERMISSION_TEXT

  const owned = new Set(details.map(({ code }) => code))
  const planningAndDispatch = [
    'inspection_plan.create',
    'inspection_task.create',
    'inspection_task.dispatch',
  ].every((code) => owned.has(code))
  const summarizedCodes = new Set<string>()
  if (planningAndDispatch) {
    summarizedCodes.add('inspection_task.create')
    summarizedCodes.add('inspection_task.dispatch')
  }

  const phrases = details.flatMap(({ code, label }) => {
    if (summarizedCodes.has(code)) return []
    return [
      planningAndDispatch && code === 'inspection_plan.create'
        ? '規劃與派出任務'
        : label,
    ]
  })
  const summary = formatRoleLabels(phrases.slice(0, 3))
  if (details.length > 3) return `${summary}等共 ${details.length} 項`
  return summary
}
