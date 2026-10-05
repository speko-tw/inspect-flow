// 專案與專案成員管理 API（DOM-R40～DOM-R44、專案管理 API 介面段）。

import { request } from '../api'

export interface ProjectWarning {
  code: string
}

export interface Project {
  id: string
  project_code: string
  name: string
  client_name: string
  site_location: string
  planned_start_date: string | null
  planned_completion_date: string | null
  warnings: ProjectWarning[]
}

export interface ProjectPage {
  items: Project[]
  next_cursor: string | null
}

export type ProjectInput = {
  project_code: string
  name: string
  client_name: string
  site_location: string
  planned_start_date: string | null
  planned_completion_date: string | null
}

export interface ProjectMember {
  id: string
  user_id: string
  username: string
  role_ids: string[]
  name_zh: string | null
  email: string | null
  company_id: string | null
  company_name: string | null
  is_active: boolean
}

export interface Role {
  id: string
  name: string
  permission_codes: string[]
}

export const DUPLICATE_CODE_WARNING = 'project_code.duplicate'

export function hasDuplicateCodeWarning(project: Project): boolean {
  return project.warnings.some(
    (warning) => warning.code === DUPLICATE_CODE_WARNING,
  )
}

export function listProjectsPage(
  options: {
    q?: string
    cursor?: string | null
    limit?: number
  } = {},
): Promise<ProjectPage> {
  const params = new URLSearchParams({
    limit: String(options.limit ?? 50),
  })
  if (options.q?.trim()) params.set('q', options.q.trim())
  if (options.cursor) params.set('cursor', options.cursor)
  return request(`/projects?${params.toString()}`)
}

export function getProject(id: string): Promise<Project> {
  return request(`/projects/${id}`)
}

export function createProject(input: ProjectInput): Promise<Project> {
  return request('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProject(
  id: string,
  input: Partial<ProjectInput>,
): Promise<Project> {
  return request(`/projects/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function listProjectMembers(
  projectId: string,
): Promise<ProjectMember[]> {
  return request(`/projects/${projectId}/members`)
}

export function addProjectMember(
  projectId: string,
  userId: string,
  roleIds: string[],
): Promise<ProjectMember> {
  return request(`/projects/${projectId}/members`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, role_ids: roleIds }),
  })
}

export function setProjectMemberRoles(
  projectId: string,
  userId: string,
  roleIds: string[],
): Promise<ProjectMember> {
  return request(`/projects/${projectId}/members/${userId}/roles`, {
    method: 'PUT',
    body: JSON.stringify({ role_ids: roleIds }),
  })
}

export function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<void> {
  return request(`/projects/${projectId}/members/${userId}`, {
    method: 'DELETE',
  })
}

export function personLabel(person: {
  username: string
  name_zh: string | null
}): string {
  return person.name_zh
    ? `${person.name_zh}（${person.username}）`
    : person.username
}
