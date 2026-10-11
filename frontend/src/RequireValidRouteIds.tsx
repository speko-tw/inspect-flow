// 路由入口的 id 守衛（#618 F-S01）：網址裡的具名路由參數（`projectId`、
// `itemId` 等）不是合法 id 格式時，直接顯示找不到（ADM-R25），不讓頁面元件拿
// 這個值去拼 API 路徑。放在路由層而不是各頁，是因為專案底下有十幾個
// 路由、且管理者與非管理者外殼各定義一份，守衛只寫一處才不會漏。

import type { ReactNode } from 'react'
import { Outlet, useParams } from 'react-router'

import { isResourceId } from './resourceId'
import RouteNotFound, { ProjectNotFound } from './RouteNotFound'

/**
 * 當作 layout route 的 element 使用（渲染 `<Outlet />`），或包住單一
 * 元素（傳 `children`）。
 */
export default function RequireValidRouteIds({
  children,
}: {
  children?: ReactNode
}) {
  const params = useParams()
  // 逐一驗證所有具名參數，而不是只認 `projectId`、`itemId`：日後新增的
  // 參數（例如 `:taskId`）掛在這個守衛底下就自動受保護，不會因為沒人
  // 記得回來改這裡而漏掉。`*` 是 splat 剩餘路徑，不是 id，不驗。
  const invalid = Object.entries(params)
    .filter(([name]) => name !== '*')
    .filter(([, value]) => !isResourceId(value))
    .map(([name]) => name)
  // 專案 id 先判斷：專案無效時整頁都不該出現，不必再看其他參數。
  if (invalid.includes('projectId')) return <ProjectNotFound />
  if (invalid.includes('itemId')) {
    return (
      <RouteNotFound
        message="網址可能輸入錯誤，或這個查核項目已不存在。"
        title="找不到這個查核項目"
      />
    )
  }
  if (invalid.length > 0) return <RouteNotFound />
  return children ?? <Outlet />
}
