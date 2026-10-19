// 登入、變更密碼後沒有指定回到哪裡時的預設落點，只依後端 `/auth/me`
// 的存取摘要（#480）決定，前端不自行猜測：
//
// - 系統管理者或全專案進度主管 → `/admin/dashboard`
// - 委派者 → `/admin/people`
// - 有內業權限（含兩種權限都有）→ `/admin/projects`（我的專案清單）
// - 只有現場權限（含現場加範本）→ `/field`
// - 只有範本管理權限 → `/admin/templates`
// - 都沒有 → `/change-password`，由設定頁顯示無功能權限的說明
//
// 只決定 UI 導向；各頁能不能看由後端權限與 `RequireAuth` 把關。

import type { CurrentUser } from './api'
import { isSafeRedirectPath } from './safeRedirect'
import type { PreviousSession } from './sessionMemory'
import { ROUTES } from '../routes'
import { landingLabel as getLandingLabel } from '../terms'

type AccessSummary = Pick<
  CurrentUser,
  | 'is_admin'
  | 'has_office_access'
  | 'has_field_access'
  | 'can_create_project'
  | 'has_project_access'
  | 'has_template_access'
  | 'can_browse_templates'
  | 'can_manage_template_library'
  | 'delegated_modules'
> &
  Partial<Pick<CurrentUser, 'module_permissions' | 'has_project_access'>>

/** 依 TPL-R09 判斷是否具範本庫管理權，支援舊摘要欄位過渡。 */
export function canManageTemplateLibrary(user: AccessSummary): boolean {
  return user.can_manage_template_library ?? user.has_template_access
}

/** 依 TPL-R09 判斷是否可讀取範本庫，支援舊摘要欄位過渡。 */
export function canBrowseTemplates(user: AccessSummary): boolean {
  return user.can_browse_templates ?? canManageTemplateLibrary(user)
}

export function landingPath(user: AccessSummary): string {
  if (
    user.is_admin ||
    user.module_permissions?.includes('all_project_progress.read')
  ) {
    return ROUTES.dashboardIndex.path
  }
  if (user.delegated_modules.length > 0) {
    return ROUTES.adminPeople.path.replace('/:personId?', '')
  }
  if (user.has_office_access || user.can_create_project) {
    return ROUTES.adminProjects.path
  }
  if (user.has_field_access) return ROUTES.fieldTasks.path
  if (user.has_project_access) return ROUTES.adminProjects.path
  return canBrowseTemplates(user)
    ? ROUTES.adminTemplates.path
    : ROUTES.changePassword.path
}

/** 落點的白話名稱，用在「返回…」連結上。 */
export function landingLabel(path: string): string {
  if (
    path === ROUTES.adminIndex.path ||
    path === ROUTES.adminPeople.path.replace('/:personId?', '')
  ) {
    return getLandingLabel('account')
  }
  if (path === ROUTES.adminProjects.path) {
    return getLandingLabel('projects')
  }
  if (path === ROUTES.dashboardIndex.path) {
    return getLandingLabel('overview')
  }
  if (path === ROUTES.adminTemplates.path) {
    return getLandingLabel('templates')
  }
  if (path === ROUTES.changePassword.path) {
    return getLandingLabel('settings')
  }
  return getLandingLabel('tasks')
}

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * 這個帳號看得到這個站內路徑嗎（只決定 UI 導向，後端另有把關）。
 * 用在「登入後要不要回到原本的頁面」：`/admin`、`/field` 底下看不到的
 * 頁面不帶過去；其他路徑沒有權限差異（不存在的會由 404 頁處理）。
 */
export function canVisit(user: AccessSummary, path: string): boolean {
  const pathname = path.split(/[?#]/)[0]
  const fieldPrefix = ROUTES.fieldShell.path.replace(/\/\*$/, '')
  const adminPrefix = ROUTES.adminShell.path.replace(/\/\*$/, '')
  if (underPrefix(pathname, ROUTES.changePassword.path)) return true
  if (underPrefix(pathname, fieldPrefix)) {
    return user.is_admin || user.has_field_access
  }
  if (
    underPrefix(pathname, ROUTES.adminPeople.path.replace('/:personId?', ''))
  ) {
    return user.is_admin || user.delegated_modules.length > 0
  }
  if (!underPrefix(pathname, adminPrefix)) return true
  if (user.is_admin) return true
  if (underPrefix(pathname, ROUTES.adminTemplates.path)) {
    return canBrowseTemplates(user)
  }
  if (underPrefix(pathname, ROUTES.adminProjects.path)) {
    // 專案的範本頁也開給範本管理員；其餘專案頁屬內業。
    const templatePagePattern = new RegExp(
      `^${ROUTES.projectInspectionTemplates.path.replace(
        ':projectId',
        '[^/]+',
      )}/?$|^${ROUTES.projectTemplatesAlias.path.replace(
        ':projectId',
        '[^/]+',
      )}/?$`,
    )
    return (
      user.has_office_access ||
      user.has_project_access ||
      (canBrowseTemplates(user) && templatePagePattern.test(pathname))
    )
  }
  return false
}

/**
 * 登入成功後要去哪裡（#489）：
 *
 * - 剛主動登出：一律去落點，登出後按上一頁也不例外；
 * - 有上一位使用者：是同一人（例如逾時重新登入）才可回原頁，換人去落點；
 * - 沒有任何記錄（深層連結、重新整理後）：照 AUT-R29 回原頁。
 *
 * 回原頁一律還要原頁面是新帳號看得到的，否則去落點。
 */
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
