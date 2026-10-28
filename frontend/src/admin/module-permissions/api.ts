import { listAllPages, request } from '../api'

export interface ModulePermission {
  code: string
  module: string
  description: string
}

export interface PermissionBundle {
  id: string
  name: string
  permission_codes: string[]
  created_at: string
  updated_at: string
}

export interface RevokeImpact {
  membership_count: number
  projects: Array<{ id: string; name: string }>
  projects_becoming_unmanaged: Array<{ id: string; name: string }>
}

export interface EffectiveAccess {
  user: { id: string; is_active: boolean; is_admin: boolean }
  module_permissions: Array<{
    code: string
    module: string
    source: string
  }>
  project_roles?: Array<{
    id: string
    name: string
    permission_codes: string[]
  }>
  diagnostics: Array<{
    action: string
    module: string
    required_module_codes: string[]
    required_project_codes: string[]
    allowed: boolean
    missing_layers: string[]
    missing_codes: string[]
  }>
}

export interface ParticipatingProject {
  id: string
  project_code: string
  name: string
  roles: Array<{ id: string; name: string }>
}

// 路徑中的 id 與模組代碼一律先編碼，避免含 `/`、`?` 的值改變請求目標
// （#711）。
const enc = encodeURIComponent

export function getUserEffectiveAccess(userId: string, projectId?: string) {
  const query = new URLSearchParams()
  if (projectId) query.set('project_id', projectId)
  return request<EffectiveAccess>(
    `/users/${enc(userId)}/effective-access${query.size ? `?${query}` : ''}`,
  )
}

export function getUserParticipatingProjects(userId: string) {
  return request<{ items: ParticipatingProject[] }>(
    `/users/${enc(userId)}/participating-projects`,
  ).then((body) => body.items)
}

export function listModulePermissions(): Promise<ModulePermission[]> {
  return request<{ items: ModulePermission[] }>('/module-permissions').then(
    (body) => body.items,
  )
}

export function getUserModulePermissions(userId: string) {
  return request<{ permission_codes: string[]; delegated_modules: string[] }>(
    `/users/${enc(userId)}/module-permissions`,
  )
}

export function grantModulePermission(userId: string, code: string) {
  return request<void>(
    `/users/${enc(userId)}/module-permissions/${enc(code)}`,
    {
      method: 'PUT',
    },
  )
}

export function revokeModulePermission(userId: string, code: string) {
  return request<void>(
    `/users/${enc(userId)}/module-permissions/${enc(code)}`,
    {
      method: 'DELETE',
    },
  )
}

export function getRevokeImpact(userId: string, code: string) {
  return request<RevokeImpact>(
    `/users/${enc(userId)}/module-permissions/${enc(code)}/revoke-impact`,
  )
}

export function setModuleDelegation(
  userId: string,
  module: string,
  granted: boolean,
) {
  return request<void>(
    `/users/${enc(userId)}/module-delegations/${enc(module)}`,
    {
      method: granted ? 'PUT' : 'DELETE',
    },
  )
}

export function listPermissionBundles() {
  return listAllPages<PermissionBundle>('/permission-bundles')
}

export function applyPermissionBundle(userId: string, bundleId: string) {
  return request<{ user_id: string; granted_codes: string[] }>(
    `/users/${enc(userId)}/permission-bundles/${enc(bundleId)}:apply`,
    { method: 'POST' },
  )
}
