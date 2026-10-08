// 登入、變更密碼後沒有指定回到哪裡時的預設落點，只依後端 `/auth/me`
// 的存取摘要（#480）決定，前端不自行猜測：
//
// - 系統管理者 → `/admin`
// - 有內業權限（含兩種權限都有）→ `/admin/projects`（我的專案清單）
// - 只有現場權限（含現場加範本）→ `/field`
// - 只有範本管理權限 → `/admin/templates`
// - 都沒有 → `/field`，由該頁顯示沒有權限的說明
//
// 只決定 UI 導向；各頁能不能看由後端權限與 `RequireAuth` 把關。

import type { CurrentUser } from './api'
import { isSafeRedirectPath } from './safeRedirect'
import type { PreviousSession } from './sessionMemory'

type AccessSummary = Pick<
  CurrentUser,
  'is_admin' | 'has_office_access' | 'has_field_access' | 'has_template_access'
>

export function landingPath(user: AccessSummary): string {
  if (user.is_admin) return '/admin'
  if (user.has_office_access) return '/admin/projects'
  if (user.has_field_access) return '/field'
  return user.has_template_access ? '/admin/templates' : '/field'
}

/** 落點的白話名稱，用在「返回…」連結上。 */
export function landingLabel(path: string): string {
  if (path === '/admin') return '管理頁'
  if (path === '/admin/projects') return '我的專案'
  if (path === '/admin/templates') return '範本管理'
  return '今日任務'
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
  if (underPrefix(pathname, '/change-password')) return true
  if (underPrefix(pathname, '/field')) {
    return user.is_admin || user.has_field_access
  }
  if (!underPrefix(pathname, '/admin')) return true
  if (user.is_admin) return true
  if (underPrefix(pathname, '/admin/templates')) {
    return user.has_template_access
  }
  if (underPrefix(pathname, '/admin/projects')) {
    // 專案的範本頁也開給範本管理員；其餘專案頁屬內業。
    const templatePage = /^\/admin\/projects\/[^/]+\/templates\/?$/
    return (
      user.has_office_access ||
      (user.has_template_access && templatePage.test(pathname))
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
