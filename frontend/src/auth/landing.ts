// 登入、變更密碼後沒有指定回到哪裡時的預設落點：系統管理者進管理
// 頁（`/admin`），其他人進現場頁（`/field`）。只決定 UI 導向；各頁
// 能不能看由後端權限與 `RequireAuth` 把關。

import type { CurrentUser } from './api'

export function landingPath(user: Pick<CurrentUser, 'is_admin'>): string {
  return user.is_admin ? '/admin' : '/field'
}
