// 使用者與公司管理 API（DOM-R04、DOM-R05、DOM-R06、DOM-R14）。

import {
  HttpError,
  httpErrorMessage,
  listAllPages as listAllHttpPages,
  request as httpRequest,
  type PageParams,
} from '../http'

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

export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

export interface ListPageOptions {
  q?: string
  cursor?: string | null
  limit?: number
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
  is_external_collaborator: boolean
  is_admin?: boolean
}

export interface CreatedUser extends User {
  temporary_password: string
}

/** API 管理錯誤的 code 是錯誤 envelope 內的 `error.code`。 */
export class ManagementApiError extends HttpError {
  constructor(status: number, code?: string, details?: unknown) {
    super(status, code, details)
    this.name = 'ManagementApiError'
  }
}

export function request<T>(path: string, init?: RequestInit): Promise<T> {
  return httpRequest<T>(path, init, ManagementApiError)
}

/** 走完分頁，失敗拋 `ManagementApiError`（其他功能區共用）。 */
export function listAllPages<T>(
  path: string,
  params?: PageParams,
): Promise<T[]> {
  return listAllHttpPages<T>(path, params, ManagementApiError)
}

function listPath(path: string, options: ListPageOptions = {}): string {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
  })
  if (options.q?.trim()) params.set('q', options.q.trim())
  if (options.cursor) params.set('cursor', options.cursor)
  return `${path}?${params.toString()}`
}

export function listUsersPage(
  options: ListPageOptions = {},
): Promise<Page<User>> {
  return request(listPath('/users', options))
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

export function listCompaniesPage(
  options: ListPageOptions = {},
): Promise<Page<Company>> {
  return request(listPath('/companies', options))
}

export async function listCompanies(): Promise<Company[]> {
  return listAllPages('/companies')
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
  'user.builtin_protected': '內建 admin 帳號不可修改或停用。',
  'user.last_admin': '系統至少要保留一位啟用中的管理者。',
  'user.external_managed': '此帳號的基本資料由外部來源管理。',
  'user.external_not_qualified': '外部協作人員不可指派系統管理者權限。',
  'company.inactive': '不能把使用者連結到已停用的公司。',
  'user.username_conflict': '帳號名稱已被使用。',
  'user.email_conflict': 'Email 已被使用。',
  'user.employee_no_conflict': '這家公司已有相同工號。',
  'company.name_conflict': '公司名稱已被使用。',
  'project.member_conflict': '這位使用者已經是此專案的成員。',
  'auth.password_invalid': '密碼長度不符合要求。',
}

export function managementErrorMessage(error: unknown): string {
  return httpErrorMessage(error, { codes: ERROR_MESSAGES })
}
