// 專案與專案成員管理 API（DOM-R40～DOM-R44、專案管理 API 介面段）。

import { listAllPages, request } from '../api'

export interface ProjectWarning {
  code: string
}

/** DOM-R76：本公司在這個案子的角色，值取自後端的角色登記表。 */
export interface CompanyRole {
  value: string
  label: string
  inspection_level: string
}

/**
 * DOM-R76：開案時前端預設選取的角色值；選項本身仍由
 * `GET /project-company-roles` 提供，不在畫面寫死（ADM-R40）。
 */
export const DEFAULT_COMPANY_ROLE = 'contractor'

export interface Project {
  id: string
  project_code: string
  name: string
  client_name: string
  site_location: string
  company_role: string
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
  // ADM-R40：開案一律明確送出，不靠後端預設值。
  company_role: string
  planned_start_date: string | null
  planned_completion_date: string | null
  /** ADM-R32：Admin 選填；建立時同交易指派建立者角色。 */
  creator_role_user_id?: string
}

/** 修改專案；改本公司角色時必須同時帶原因（DOM-R76、ADM-R42）。 */
export type ProjectUpdateInput = Partial<ProjectInput> & {
  company_role_change_reason?: string
}

/** ADM-R26：成員跨專案使用權限的摘要。 */
export interface ModuleStatus {
  project_use: boolean
  inspection_use: boolean
}

/** ADM-R26：專案成員清單回傳的顯示與權限狀態。 */
export interface ProjectMember {
  id: string
  user_id: string
  username: string
  role_ids: string[]
  /** 與 role_ids 同序；含不可指派的角色（例如專案建立者角色）。 */
  role_names: string[]
  name_zh: string | null
  email: string | null
  company_id: string | null
  company_name: string | null
  is_active: boolean
  is_external_collaborator: boolean
  module_status: ModuleStatus
}

/** ADM-R34：可指派角色及外部協作者可用狀態。 */
export interface Role {
  id: string
  name: string
  permission_codes: string[]
  is_external_allowed: boolean
}

/** ADM-R26：可加入專案的人員與畫面顯示所需的公司、模組狀態。 */
export interface MemberCandidate {
  id: string
  username: string
  name_zh: string | null
  company_name: string | null
  is_external_collaborator: boolean
  module_status: ModuleStatus
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

/** DOM-R76：登記表中的本公司角色，依登記順序。 */
export function listCompanyRoles(): Promise<CompanyRole[]> {
  return request<{ items: CompanyRole[] }>('/project-company-roles').then(
    (page) => page.items,
  )
}

export function updateProject(
  id: string,
  input: ProjectUpdateInput,
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

/** 專案範圍的候選清單，權限同 `project_member.manage`（#481）。 */
export function listMemberCandidates(
  projectId: string,
): Promise<MemberCandidate[]> {
  return listAllPages(`/projects/${projectId}/member-candidates`)
}

export function listAssignableRoles(projectId: string): Promise<Role[]> {
  return listAllPages(`/projects/${projectId}/assignable-roles`)
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

/** `GET /me/projects` 的一筆：我參與的專案（#290、#480）。 */
export interface MyProject {
  id: string
  project_code: string
  name: string
  client_name: string
  site_location: string
  planned_start_date: string | null
  planned_completion_date: string | null
  role_names: string[]
  /** 我在這個專案有內業權限碼；唯讀專案此值為 false。 */
  has_office_access: boolean
  can_apply_templates: boolean
}

export function listMyProjects(): Promise<MyProject[]> {
  return request('/me/projects')
}
