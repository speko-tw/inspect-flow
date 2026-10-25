// 角色管理 API（DOM-R55）。
//
// 與 `../api.ts` 共用同一個錯誤類別與通用訊息，只在這裡補角色專屬的
// 錯誤碼訊息。

import {
  listAllPages,
  ManagementApiError,
  managementErrorMessage,
  request,
} from '../api'

export interface Role {
  id: string
  name: string
  permission_codes: string[]
  // 目前持有此角色的不重複使用者數（同一人跨專案只算 1 人），以及涉及的專案數（PR-18）。
  user_count: number
  inactive_user_count: number
  project_count: number
  created_at: string
  updated_at: string
  is_assignable?: boolean
  is_external_allowed?: boolean
}

export interface PermissionCode {
  code: string
  description: string
}

export interface RoleInput {
  name?: string
  permission_codes?: string[]
  is_assignable?: boolean
  is_external_allowed?: boolean
}

/** DOM-R64：讀取單一建立者角色設定。 */
export function getCreatorRole(): Promise<{ role_id: string }> {
  return request('/roles/creator-role')
}

/** DOM-R64：更新建立者角色；後端會驗證角色資格並記錄稽核。 */
export function setCreatorRole(roleId: string): Promise<{ role_id: string }> {
  return request('/roles/creator-role', {
    method: 'PATCH',
    body: JSON.stringify({ role_id: roleId }),
  })
}

/** 依序取回所有分頁，頁面本身不做分頁（分頁屬 #107）。 */
export function listRoles(): Promise<Role[]> {
  return listAllPages<Role>('/roles')
}

export function getRole(id: string): Promise<Role> {
  return request(`/roles/${id}`)
}

export async function listPermissionCodes(): Promise<PermissionCode[]> {
  const body = await request<{ items: PermissionCode[] }>(
    '/roles/permission-codes',
  )
  return body.items
}

export function createRole(input: {
  name: string
  permission_codes: string[]
}): Promise<Role> {
  return request('/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateRole(id: string, input: RoleInput): Promise<Role> {
  return request(`/roles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteRole(id: string): Promise<void> {
  return request(`/roles/${id}`, { method: 'DELETE' })
}

const ROLE_ERROR_MESSAGES: Record<string, string> = {
  'role.name_conflict': '角色名稱已被使用（不分大小寫）。',
  'role.not_found': '找不到這個角色，可能已被刪除，請重新整理後再試。',
  'role.permission_code_invalid': '權限代碼無效，請重新整理頁面後再選擇。',
}

export function roleErrorMessage(error: unknown): string {
  if (
    error instanceof ManagementApiError &&
    error.code &&
    ROLE_ERROR_MESSAGES[error.code]
  ) {
    return ROLE_ERROR_MESSAGES[error.code]
  }
  return managementErrorMessage(error)
}
