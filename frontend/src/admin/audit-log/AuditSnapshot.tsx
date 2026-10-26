import permissionCodeContract from '../../permissionCodeContract'

// T13：只解讀事件目錄的常用欄位；不猜不認得的識別碼或歷史名稱。
const FIELD_LABELS: Record<string, string> = {
  role_ids: '專案角色',
  name: '名稱',
  title: '名稱',
  username: '帳號名稱',
  name_zh: '姓名',
  email: '電子郵件',
  is_active: '啟用狀態',
  is_admin: '系統管理者',
  is_assignable: '非管理者可指派',
  is_external_allowed: '外部協作帳號可用',
  is_external_collaborator: '外部協作人員',
  account_expires_on: '帳號到期日',
  company_id: '公司',
  employee_no: '工號',
  department: '部門',
  location: '辦公地點',
  project_code: '專案代碼',
  client_name: '業主',
  site_location: '工地',
  company_role: '本公司角色',
  company_role_change_reason: '變更角色原因',
  permission_codes: '權限',
  permission_code: '權限',
  module: '功能',
  source: '來源',
  reason: '原因',
  status: '狀態',
  sequence: '順序',
  instruction: '說明',
  location_text: '位置',
  user_id: '帳號',
  project_id: '專案',
  creator_role_user_id: '建立者角色人選',
  inspection_points: '查核項次',
  source_name: '來源名稱',
  item_count: '查核項目數量',
}
const VALUE_LABELS: Record<string, string> = {
  project: '專案',
  inspection: '查核',
  template: '範本',
  manual: '手動設定',
  bundle: '權限組合',
  implied: '自動包含',
  backfill: '既有資料回填',
  system: '系統',
  contractor: '承攬施工方',
  supervisor: '監造方',
  PENDING: '待執行',
  IN_PROGRESS: '進行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  account_expired: '帳號已到期',
  last_membership_removed: '已移出最後專案',
}
const permissionNames = new Map(
  permissionCodeContract.codes.map((item) => [
    item.code,
    item.description.replace('模組', '功能'),
  ]),
)
const UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i

type Lookup = {
  roleName?: (id: string) => string | null
  userName: (id: string) => string | null
  projectName: (id: string) => string | null
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return value == null ? {} : { status: value }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function readable(
  value: unknown,
  field: string,
  lookup: Lookup,
): string | null {
  if (value == null) return field.endsWith('_id') ? null : '未設定'
  if (field === 'inspection_points') {
    const items = Array.isArray(value) ? value : record(value).items
    return Array.isArray(items) ? `${items.length} 項` : null
  }
  if (typeof value === 'boolean') {
    return field === 'is_active'
      ? value
        ? '啟用'
        : '停用'
      : value
        ? '是'
        : '否'
  }
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const items = value
      .map((item) => readable(item, field, lookup))
      .filter((item): item is string => Boolean(item))
    return items.length ? items.join('、') : value.length ? null : '無'
  }
  if (typeof value !== 'string') return null
  if (field === 'role_ids') {
    return lookup.roleName?.(value) ?? '已刪除的角色'
  }
  if (field.endsWith('user_id')) return lookup.userName(value)
  if (field === 'project_id') return lookup.projectName(value)
  if (field.endsWith('_id') || field.endsWith('_ids') || UUID.test(value)) {
    return null
  }
  if (field === 'permission_codes' || field === 'permission_code') {
    return permissionNames.get(value) ?? null
  }
  if (
    ['module', 'source', 'reason', 'status', 'company_role'].includes(field)
  ) {
    return VALUE_LABELS[value] ?? null
  }
  return value || '未設定'
}

/** T13：差異表只列變動欄位；新增／刪除保留白話內容，不露原始識別碼。 */
export function AuditChanges({
  before,
  after,
  lookup,
  eventType,
}: {
  eventType?: string
  before: unknown
  after: unknown
  lookup: Lookup
}) {
  if (eventType === 'user.password_set') {
    return (
      <p role="status">
        {record(after).is_temporary === false
          ? '已變更密碼（不記錄密碼內容）'
          : '已重設臨時密碼（不記錄密碼內容）'}
      </p>
    )
  }
  const previous = record(before)
  const current = record(after)
  const keys = [
    ...new Set([...Object.keys(previous), ...Object.keys(current)]),
  ]
  const rows = keys
    .filter(
      (key) =>
        FIELD_LABELS[key] &&
        canonical(previous[key]) !== canonical(current[key]),
    )
    .map((key) => ({
      key,
      label: FIELD_LABELS[key],
      before: readable(previous[key], key, lookup),
      after: readable(current[key], key, lookup),
    }))
    .filter((row) => row.before !== null || row.after !== null)
  const creation = before == null
  const deletion = after == null
  return (
    <section className="audit-entry-changes" aria-label="改了什麼">
      <h3>{creation ? '新增內容' : deletion ? '刪除前內容' : '改了什麼'}</h3>
      {rows.length === 0 ? (
        <p>這次沒有可顯示的欄位變更。</p>
      ) : creation || deletion ? (
        <dl className="audit-summary-fields">
          {rows
            .filter((row) => (creation ? row.after : row.before) !== null)
            .map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{creation ? row.after : row.before}</dd>
              </div>
            ))}
        </dl>
      ) : (
        <table className="audit-diff">
          <thead>
            <tr>
              <th>欄位</th>
              <th>改前</th>
              <th>改後</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">{row.label}</th>
                <td data-label="改前">{row.before ?? '—'}</td>
                <td data-label="改後">{row.after ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
