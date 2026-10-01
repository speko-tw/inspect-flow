// 角色管理 API（DOM-R55）。
//
// 與 `../api.ts` 共用同一個錯誤類別與通用訊息，只在這裡補角色專屬的
// 錯誤碼訊息。

import { ManagementApiError, managementErrorMessage } from '../api'

const API_BASE = '/api/v1'

// 一次最多取回的筆數（後端上限 100）；頁面不分頁，所以逐頁取完。
const PAGE_SIZE = 100

export interface Role {
  id: string
  name: string
  permission_codes: string[]
  // 目前持有此角色的專案成員筆數，以及這些成員涉及的專案數（PR-18）。
  member_count: number
  project_count: number
  created_at: string
  updated_at: string
}

export interface PermissionCode {
  code: string
  description: string
}

export interface RoleInput {
  name?: string
  permission_codes?: string[]
}

interface RolePage {
  items: Role[]
  next_cursor: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

/** 依序取回所有分頁，頁面本身不做分頁（分頁屬 #107）。 */
export async function listRoles(): Promise<Role[]> {
  const roles: Role[] = []
  let cursor: string | null = null
  do {
    const query: string = new URLSearchParams({
      limit: String(PAGE_SIZE),
      ...(cursor ? { cursor } : {}),
    }).toString()
    const page: RolePage = await request(`/roles?${query}`)
    roles.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return roles
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
