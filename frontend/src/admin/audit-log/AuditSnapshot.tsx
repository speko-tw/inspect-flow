import type { ReactNode } from 'react'

import permissionCodeContract from '../../permissionCodeContract'

const FIELD_LABELS: Record<string, string> = {
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
  auth_source: '帳號來源',
  department: '部門',
  employee_no: '工號',
  location: '辦公地點',
  name_en: '英文姓名',
  company_name: '公司',
  project_code: '專案代碼',
  client_name: '業主',
  site_location: '工地',
  company_role: '本公司角色',
  sequence: '順序',
  instruction: '說明',
  system_name: '系統',
  category_name: '工程類別',
  source_category_name: '來源工程類別',
  source_system_name: '來源系統',
  source_name: '來源名稱',
  bundle_name: '權限組合',
  permission_codes: '權限',
  permission_code: '權限',
  restored_permission_codes: '恢復的權限',
  removed_permission_codes: '移除的權限',
  module: '功能',
  source: '來源',
  reason: '原因',
  status: '狀態',
  inspection_points: '查核點',
  measurement_fields: '量測欄位',
  evidence_requirements: '佐證要求',
  text_standard: '文字標準',
  numeric_standard: '數值標準',
  text: '文字',
  value: '數值',
  unit: '單位',
  field_type: '欄位類型',
  sort_order: '顯示順序',
  required: '必填',
  evidence_type: '佐證類型',
  min_count: '最少數量',
  max_count: '最多數量',
  condition: '比較方式',
  tolerance: '容許誤差',
  range_form: '範圍方式',
  lower_bound: '下限',
  upper_bound: '上限',
  measurement_field: '量測欄位',
  note: '備註',
  notes: '備註',
  location_text: '位置',
  must_change_password: '下次登入必須變更密碼',
}

const VALUE_LABELS: Record<string, string> = {
  range: '範圍',
  local: '本系統帳號',
  external: '外部身分',
  manual: '手動設定',
  bundle: '權限組合',
  system: '系統',
  project: '專案',
  inspection: '查核',
  template: '範本',
  number: '數字',
  numeric: '數字',
  text: '文字',
  TEXT: '文字',
  NUMBER: '數字',
  photo: '照片',
  field_photo: '現場照片',
  office_photo: '內業照片',
  interval: '區間',
  tolerance: '容許誤差',
  direct: '直接值',
  bounds: '上下限',
  '=': '等於',
  '==': '等於',
  '>': '大於',
  '>=': '大於或等於',
  '<': '小於',
  '<=': '小於或等於',
  PENDING: '待執行',
  IN_PROGRESS: '進行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  DRAFT: '草稿',
  account_expired: '帳號已到期',
  last_membership_removed: '已移出最後一個專案',
}

const ENUM_FIELDS = new Set([
  'auth_source',
  'module',
  'source',
  'reason',
  'status',
  'field_type',
  'evidence_type',
  'condition',
  'range_form',
])

const permissionNames = new Map(
  permissionCodeContract.codes.map((item) => [
    item.code,
    item.description.replace('模組', '功能'),
  ]),
)

function readableValue(value: unknown, field: string): ReactNode {
  if (value == null) return '無'
  if (typeof value === 'boolean') {
    if (field === 'is_active') return value ? '啟用' : '停用'
    return value ? '是' : '否'
  }
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (field.includes('permission_code')) {
      return permissionNames.get(value) ?? '未登記的權限（詳見進階）'
    }
    if (ENUM_FIELDS.has(field)) {
      return VALUE_LABELS[value] ?? '其他（詳見進階）'
    }
    return value || '無'
  }
  if (Array.isArray(value)) {
    if (!value.length) return '無'
    return (
      <ol>
        {value.map((item, index) => (
          <li key={index}>{readableValue(item, field)}</li>
        ))}
      </ol>
    )
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (Array.isArray(record.items) && Object.keys(record).length === 1) {
      return readableValue(record.items, field)
    }
    return <ReadableObject value={record} />
  }
  return '無'
}

function ReadableObject({ value }: { value: Record<string, unknown> }) {
  // T13：未知欄位及識別碼留在進階原文，不猜名稱或以現況冒充歷史快照。
  const fields = Object.entries(value).filter(([key]) => FIELD_LABELS[key])
  if (!fields.length) return <p>其他內容請查看進階資料。</p>
  return (
    <dl className="audit-readable-fields">
      {fields.map(([key, item]) => (
        <div key={key}>
          <dt>{FIELD_LABELS[key]}</dt>
          <dd>{readableValue(item, key)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** T13：先呈現白話快照；原始內容完整保留在另行展開的進階區。 */
export function AuditSnapshot({ value }: { value: unknown }) {
  if (value == null) return <p>無</p>
  return <>{readableValue(value, '')}</>
}
