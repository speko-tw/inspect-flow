import type { AuditLogEntry } from './api'

/**
 * 事件碼對白話的對照表（#713）。鍵是後端事件目錄
 * （backend/app/services/audit.py 與 inspection_planning.py）實際登記的
 * 事件碼；後端新增事件時要補一列，沒補到的會顯示「其他操作」，
 * 不會露出英文事件碼。
 */
const EVENT_LABELS: Record<string, string> = {
  'creator_role.changed': '變更專案建立者的預設角色',
  'inspection_task.cancelled': '取消任務',
  'inspection_task.deleted': '刪除任務',
  'inspection_task.items_updated': '修改任務的查核項目',
  'inspection_task.location_updated': '修改任務位置',
  'inspection_task.renamed': '修改任務名稱',
  'inspection_task.restored': '恢復任務',
  'module_delegation.granted': '委派權限管理',
  'module_delegation.revoked': '收回權限委派',
  'module_permission.grant_denied': '開通權限被拒絕',
  'module_permission.granted': '開通權限',
  'module_permission.revoked': '收回權限',
  'permission_bundle.applied': '套用權限組合',
  'permission_bundle.created': '建立權限組合',
  'permission_bundle.deleted': '刪除權限組合',
  'permission_bundle.updated': '修改權限組合',
  'project.created': '建立專案',
  'project.updated': '修改專案',
  'project_inspection_item.updated': '修改查核項目',
  'project_member.assignment_denied': '指派成員角色被拒絕',
  'project_member.removed': '移除成員',
  'project_member.roles_changed': '調整成員角色',
  'project_zone.created': '建立分區',
  'project_zone.deleted': '刪除分區',
  'project_zone.updated': '修改分區',
  'role.created': '建立角色',
  'role.deleted': '刪除角色',
  'role.updated': '修改角色',
  'template_item.created_from_project': '由專案查核項目建立範本項目',
  'template_category.created': '建立範本工程類別',
  'template_category.deleted': '刪除範本工程類別',
  'template_category.updated': '修改範本工程類別',
  'template_item.created': '建立範本項目',
  'template_item.deleted': '刪除範本項目',
  'template_item.updated': '修改範本項目',
  'template_system.created': '建立範本系統',
  'template_system.deleted': '刪除範本系統',
  'template_system.updated': '修改範本系統',
  'project.template_applied': '套用範本',
  'user.active_changed': '停用或啟用帳號',
  'user.admin_changed': '變更帳號的系統管理身分',
  'user.company_changed': '修改帳號的公司與部門',
  'user.external_flag_changed': '變更帳號的外部協作身分',
  'user.locked': '登入失敗過多，帳號被鎖定',
  'user.password_set': '設定帳號密碼',
  'user.username_changed': '修改帳號名稱',
}

/** 對象類型的白話名稱；查不到時只說「對象」，不露出英文類型碼。 */
const ENTITY_LABELS: Record<string, string> = {
  creator_role: '角色',
  inspection_task: '任務',
  module_delegation: '權限委派',
  module_permission: '權限',
  permission_bundle: '權限組合',
  project: '專案',
  project_inspection_item: '查核項目',
  project_member: '成員',
  project_zone: '分區',
  role: '角色',
  template_item: '範本項目',
  template_category: '工程類別',
  template_system: '系統',
  user: '帳號',
}

export const UNKNOWN_EVENT_LABEL = '其他操作'

/**
 * 「事件類型」篩選的下拉選項：顯示白話、值仍是事件碼（API 契約不變）。
 * 停用與啟用共用一個事件碼，下拉只能選碼，所以用合併後的說法。
 */
export const EVENT_TYPE_OPTIONS: ReadonlyArray<{
  value: string
  label: string
}> = Object.entries(EVENT_LABELS).map(([value, label]) => ({
  value,
  label,
}))

function payloadOf(entry: AuditLogEntry): Record<string, unknown> {
  const value = entry.after ?? entry.before
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

/** 事件的白話名稱；停用與啟用共用一個事件碼，依改後狀態分開說。 */
export function eventLabel(entry: AuditLogEntry): string {
  if (entry.event_type === 'user.active_changed') {
    const active = (entry.after as { is_active?: unknown } | null)?.is_active
    if (active === true) return '啟用帳號'
    if (active === false) return '停用帳號'
  }
  return EVENT_LABELS[entry.event_type] ?? UNKNOWN_EVENT_LABEL
}

/**
 * 對象的白話描述，例如「帳號：安娜 (anna)」。權限、委派、成員這類
 * 紀錄真正受影響的是人，所以優先顯示那個帳號；其餘取紀錄內容的名稱
 * 欄位或專案清單。都查不到就只顯示對象類型，不顯示內部編號。
 */
export function entityLabel(
  entry: AuditLogEntry,
  lookup: {
    userName: (id: string) => string | null
    projectName: (id: string) => string | null
  },
): string {
  const payload = payloadOf(entry)
  const person =
    entry.entity_type === 'user'
      ? lookup.userName(entry.entity_id)
      : typeof payload.user_id === 'string'
        ? lookup.userName(payload.user_id)
        : null
  if (person) {
    return `${entry.entity_type === 'project_member' ? '成員' : '帳號'}：${person}`
  }
  const kind = ENTITY_LABELS[entry.entity_type] ?? '對象'
  const name =
    (typeof payload.name === 'string' && payload.name) ||
    (typeof payload.bundle_name === 'string' && payload.bundle_name) ||
    (entry.entity_type === 'project'
      ? lookup.projectName(entry.entity_id)
      : null)
  return name ? `${kind}：${name}` : kind
}
