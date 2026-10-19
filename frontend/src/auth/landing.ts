import type { CurrentUser } from './api'
import { isSafeRedirectPath } from './safeRedirect'
import type { PreviousSession } from './sessionMemory'
import { canAccessRoute, routeForPath, ROUTES } from '../routes'
import type { LandingLabelKey } from '../terms'
import { landingLabel as getLandingLabel } from '../terms'

type AccessSummary = Pick<
  CurrentUser,
  | 'is_admin'
  | 'can_inspect_tasks'
  | 'can_create_project'
  | 'can_manage_project_planning_or_members'
  | 'has_project_access'
  | 'delegated_modules'
> &
  Partial<
    Pick<
      CurrentUser,
      | 'can_browse_templates'
      | 'can_manage_template_library'
      | 'module_permissions'
    >
  > &
  Partial<Pick<CurrentUser, 'id'>>

/** 保留範本頁面既有讀取與管理判斷，供頁面內分流使用。 */
export function canManageTemplateLibrary(user: {
  is_admin: boolean
  can_manage_template_library?: boolean
  module_permissions?: string[]
}): boolean {
  return Boolean(
    user.is_admin ||
    user.can_manage_template_library ||
    user.module_permissions?.includes('template.manage'),
  )
}

/** 判斷範本庫是否可讀取；僅供直接路由守衛與頁面呈現。 */
export function canBrowseTemplates(user: {
  is_admin: boolean
  has_template_access?: boolean
  can_browse_templates?: boolean
  can_manage_template_library?: boolean
  module_permissions?: string[]
}): boolean {
  return Boolean(
    user.can_browse_templates ||
    canManageTemplateLibrary(user) ||
    user.module_permissions?.includes('template.use'),
  )
}

/** 依權限摘要選擇固定的登入落點順序。 */
export function landingPath(user: AccessSummary): string {
  // ADM-R23：唯讀專案入口不取代現場人員的任務首頁。
  if (
    !user.is_admin &&
    user.can_inspect_tasks &&
    !user.can_create_project &&
    !user.can_manage_project_planning_or_members
  ) {
    return ROUTES.fieldTasks.path
  }
  const candidates = [
    ROUTES.dashboardIndex,
    ROUTES.adminProjects,
    ROUTES.fieldTasks,
    ROUTES.adminTemplates,
    ROUTES.adminIndex,
  ]
  const destination = candidates.find((route) => canAccessRoute(user, route))
  if (destination) {
    return destination === ROUTES.adminIndex
      ? ROUTES.adminIndex.path
      : destination.path
  }
  return ROUTES.settings.path
}

/** 落點的白話名稱，用在「返回…」連結上。 */
export function landingLabel(path: string): string {
  const labels: Array<[string, LandingLabelKey]> = [
    [ROUTES.adminPeople.path.replace('/:personId?', ''), 'account'],
    [ROUTES.adminProjects.path, 'projects'],
    [ROUTES.dashboardIndex.path, 'overview'],
    [ROUTES.adminTemplates.path, 'templates'],
    [ROUTES.settings.path, 'settings'],
    [ROUTES.fieldTasks.path, 'tasks'],
  ]
  const match = labels.find(([target]) => target === path)
  return getLandingLabel(match?.[1] ?? 'tasks')
}

/** 判斷登入後能否返回原頁；API 仍負責真正授權。 */
export function canVisit(user: AccessSummary, path: string): boolean {
  const pathname = path.split(/[?#]/)[0]
  if (!pathname) return false
  const route = routeForPath(pathname)
  return route ? canAccessRoute(user, route) : false
}

/** 驗證安全的原頁與前次登入身分後，決定登入成功目的地。 */
export function loginTarget(
  user: AccessSummary & Pick<CurrentUser, 'id'>,
  from: unknown,
  previous: PreviousSession,
): string {
  const mayReturn =
    previous.kind === 'none' ||
    (previous.kind === 'user' && previous.userId === user.id)
  if (mayReturn && isSafeRedirectPath(from) && canVisit(user, from)) {
    return from
  }
  return landingPath(user)
}
