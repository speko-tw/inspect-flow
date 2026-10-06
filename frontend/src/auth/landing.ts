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

export function landingPath(
  user: Pick<
    CurrentUser,
    | 'is_admin'
    | 'has_office_access'
    | 'has_field_access'
    | 'has_template_access'
  >,
): string {
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
