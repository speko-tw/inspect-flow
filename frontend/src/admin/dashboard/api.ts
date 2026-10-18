import { collectPages, HttpError } from '../../http'
import { request, type Page } from '../api'

/** ADM-R06：判斷是否可查全部專案，不要求 inspection.use。 */
export function hasGlobalDashboardAccess(user: {
  is_admin: boolean
  module_permissions: string[]
}): boolean {
  return (
    user.is_admin ||
    user.module_permissions.includes('all_project_progress.read')
  )
}

/** ADM-R06：以 Dashboard 專案 API 確認目前使用者的有效範圍。 */
export async function canOpenDashboard(user: {
  is_admin: boolean
  module_permissions: string[]
}): Promise<boolean> {
  if (hasGlobalDashboardAccess(user)) return true
  try {
    const page = await listDashboardProjects({ limit: 1 })
    return page.items.length > 0
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return false
    throw error
  }
}

/** ADM-R01：後台摘要指標，數值由後端依授權範圍計算。 */
export interface DashboardSummary {
  pending_count: number
  in_progress_count: number
  completed_count: number
  completion_rate: number
}

/** ADM-R04：單一專案的任務進度與完成率。 */
export interface DashboardProject {
  project_id: string
  name: string
  pending_count: number
  in_progress_count: number
  completed_count: number
  completion_denominator_count: number
  completion_rate: number
}

/** ADM-R04：可依游標續讀的專案進度清單。 */
export type DashboardProjectPage = Page<DashboardProject>

/** 專案進度清單支援的搜尋及游標參數。 */
export interface DashboardProjectListOptions {
  q?: string
  cursor?: string | null
  limit?: number
}

/** ADM-R05：工程師工作量依指派、開始與完成者分開回傳。 */
export interface DashboardEngineer {
  user_id: string
  username: string
  name_zh: string | null
  assigned_pending_count: number
  assigned_in_progress_count: number
  started_in_progress_count: number
  completed_by_count: number
}

/** ADM-R05：可依游標續讀的工程師工作量清單。 */
export type DashboardEngineerPage = Page<DashboardEngineer>

/** 工程師清單支援的專案、搜尋及游標參數。 */
export interface DashboardEngineerListOptions {
  projectId?: string
  q?: string
  cursor?: string | null
  limit?: number
}

/** 取得摘要；不傳專案 ID 時由後端檢查全部專案權限。 */
export function getDashboardSummary(
  projectId?: string,
): Promise<DashboardSummary> {
  const query = new URLSearchParams()
  if (projectId) query.set('project_id', projectId)
  const suffix = query.size ? `?${query.toString()}` : ''
  return request(`/admin/dashboard/summary${suffix}`)
}

/** 取得後端計算的專案進度，不在前端加總或推算。 */
export function listDashboardProjects(
  options: DashboardProjectListOptions = {},
): Promise<DashboardProjectPage> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 50),
  })
  if (options.q?.trim()) query.set('q', options.q.trim())
  if (options.cursor) query.set('cursor', options.cursor)
  return request(`/admin/dashboard/projects?${query.toString()}`)
}

/** 取得目前使用者有效權限可查看的所有專案。 */
export function listAllDashboardProjects(): Promise<DashboardProject[]> {
  return collectPages((cursor) =>
    listDashboardProjects({ cursor, limit: 100 }),
  )
}

/** 取得 API 計算的工程師歸屬數字，不將不同歸屬合併。 */
export function listDashboardEngineers(
  options: DashboardEngineerListOptions = {},
): Promise<DashboardEngineerPage> {
  const query = new URLSearchParams({
    limit: String(options.limit ?? 10),
  })
  if (options.projectId) query.set('project_id', options.projectId)
  if (options.q?.trim()) query.set('q', options.q.trim())
  if (options.cursor) query.set('cursor', options.cursor)
  return request(`/admin/dashboard/engineers?${query.toString()}`)
}
