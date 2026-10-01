// 使用者與公司管理 API（DOM-R04、DOM-R05、DOM-R06、DOM-R14）。

const API_BASE = '/api/v1'

export interface User {
  id: string
  username: string
  email: string | null
  name_zh: string | null
  name_en: string | null
  company_id: string | null
  department: string | null
  location: string | null
  employee_no: string | null
  extension_1: string | null
  extension_2: string | null
  mobile: string | null
  line_id: string | null
  wechat_id: string | null
  responsibilities: string | null
  auth_source: string
  is_active: boolean
  is_admin: boolean
  is_system: boolean
}

export interface Company {
  id: string
  name: string
  is_active: boolean
}

export interface ActiveCompanyUsers {
  count: number
  users: Array<Pick<User, 'id' | 'username' | 'name_zh'>>
}

export type UserInput = {
  username: string
  email: string
  name_zh: string
  name_en?: string | null
  company_id?: string | null
  department?: string | null
  location?: string | null
  employee_no?: string | null
  is_admin?: boolean
}

export interface CreatedUser extends User {
  temporary_password: string
}

/** API 管理錯誤的 code 是錯誤 envelope 內的 `error.code`。 */
export class ManagementApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, code?: string) {
    super(`管理 API 錯誤（狀態碼 ${status}）`)
    this.name = 'ManagementApiError'
    this.status = status
    this.code = code
  }
}

export async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let code: string | undefined
    try {
      const body = (await response.json()) as {
        error?: { code?: string }
      }
      code = body.error?.code
    } catch {
      // 非 JSON 錯誤回應使用通用訊息。
    }
    throw new ManagementApiError(response.status, code)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export function listUsers(): Promise<User[]> {
  return request('/users')
}

export function createUser(input: UserInput): Promise<CreatedUser> {
  return request('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateUser(
  id: string,
  input: Partial<UserInput>,
): Promise<User> {
  return request(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function linkUserCompany(
  id: string,
  companyId: string | null,
  fields: Pick<UserInput, 'department' | 'location' | 'employee_no'> = {},
): Promise<User> {
  return request(`/users/${id}/company`, {
    method: 'PUT',
    body: JSON.stringify({ company_id: companyId, ...fields }),
  })
}

export function setUserAdmin(id: string, isAdmin: boolean): Promise<User> {
  return request(`/users/${id}/admin`, {
    method: 'PUT',
    body: JSON.stringify({ is_admin: isAdmin }),
  })
}

export function setUserActive(id: string, isActive: boolean): Promise<User> {
  return request(`/users/${id}/active`, {
    method: 'PUT',
    body: JSON.stringify({ is_active: isActive }),
  })
}

export function listCompanies(): Promise<Company[]> {
  return request('/companies')
}

export function createCompany(name: string): Promise<Company> {
  return request('/companies', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function renameCompany(id: string, name: string): Promise<Company> {
  return request(`/companies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

export function setCompanyActive(
  id: string,
  isActive: boolean,
  disableUserIds: string[] = [],
): Promise<Company> {
  return request(`/companies/${id}/active`, {
    method: 'PUT',
    body: JSON.stringify({
      is_active: isActive,
      disable_user_ids: disableUserIds,
    }),
  })
}

export function listActiveCompanyUsers(
  id: string,
): Promise<ActiveCompanyUsers> {
  return request(`/companies/${id}/active-users`)
}

const ERROR_MESSAGES: Record<string, string> = {
  'request.validation_failed': '資料格式不正確，請檢查輸入內容。',
  'resource.not_found': '找不到這筆資料，請重新整理後再試。',
  'server.internal_error': '系統發生錯誤，請稍後再試。',
  'permission.denied': '你沒有權限執行這項操作。',
  'user.builtin_protected': '內建 admin 帳號不可修改或停用。',
  'user.last_admin': '系統至少要保留一位啟用中的管理者。',
  'user.external_managed': '此帳號的基本資料由外部來源管理。',
  'company.inactive': '不能把使用者連結到已停用的公司。',
  'user.username_conflict': '帳號名稱已被使用。',
  'user.email_conflict': 'Email 已被使用。',
  'user.employee_no_conflict': '這家公司已有相同工號。',
  'company.name_conflict': '公司名稱已被使用。',
  'project.member_conflict': '這位使用者已經是此專案的成員。',
  'auth.password_invalid': '密碼長度不符合要求。',
}

export function managementErrorMessage(error: unknown): string {
  if (!(error instanceof ManagementApiError)) {
    return '無法連線到伺服器，請稍後再試。'
  }
  if (error.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code]
  }
  if (error.status === 401) {
    return '登入狀態已失效，請重新登入。'
  }
  if (error.status === 403) {
    return '你沒有權限執行這項操作。'
  }
  return '操作失敗，請稍後再試。'
}
