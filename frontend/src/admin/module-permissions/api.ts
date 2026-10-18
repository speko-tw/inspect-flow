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

export function getUserEffectiveAccess(userId: string, projectId?: string) {
  const query = new URLSearchParams()
  if (projectId) query.set('project_id', projectId)
  return request<EffectiveAccess>(
    `/users/${userId}/effective-access${query.size ? `?${query}` : ''}`,
  )
}

export function getUserParticipatingProjects(userId: string) {
  return request<{ items: ParticipatingProject[] }>(
    `/users/${userId}/participating-projects`,
  ).then((body) => body.items)
}

export function listModulePermissions(): Promise<ModulePermission[]> {
  return request<{ items: ModulePermission[] }>('/module-permissions').then(
    (body) => body.items,
  )
}

export function getUserModulePermissions(userId: string) {
  return request<{ permission_codes: string[]; delegated_modules: string[] }>(
    `/users/${userId}/module-permissions`,
  )
}

export function grantModulePermission(userId: string, code: string) {
  return request<void>(`/users/${userId}/module-permissions/${code}`, {
    method: 'PUT',
  })
}

export function revokeModulePermission(userId: string, code: string) {
  return request<void>(`/users/${userId}/module-permissions/${code}`, {
    method: 'DELETE',
  })
}

export function getRevokeImpact(userId: string, code: string) {
  return request<RevokeImpact>(
    `/users/${userId}/module-permissions/${code}/revoke-impact`,
  )
}

export function setModuleDelegation(
  userId: string,
  module: string,
  granted: boolean,
) {
  return request<void>(`/users/${userId}/module-delegations/${module}`, {
    method: granted ? 'PUT' : 'DELETE',
  })
}

export function listPermissionBundles() {
  return listAllPages<PermissionBundle>('/permission-bundles')
}

export function createPermissionBundle(input: {
  name: string
  permission_codes: string[]
}) {
  return request<PermissionBundle>('/permission-bundles', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updatePermissionBundle(
  id: string,
  input: { name: string; permission_codes: string[] },
) {
  return request<PermissionBundle>(`/permission-bundles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deletePermissionBundle(id: string) {
  return request<void>(`/permission-bundles/${id}`, { method: 'DELETE' })
}

export function applyPermissionBundle(userId: string, bundleId: string) {
  return request<{ user_id: string; granted_codes: string[] }>(
    `/users/${userId}/permission-bundles/${bundleId}:apply`,
    { method: 'POST' },
  )
}
