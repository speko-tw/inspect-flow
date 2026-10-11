// 路由入口的 id 守衛（#618 F-S01）：網址裡的 `projectId`、`itemId`
// 不是合法 id 格式時，直接顯示找不到（ADM-R25），不讓頁面元件拿
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
  // 專案 id 先判斷：專案無效時整頁都不該出現，不必再看項目 id。
  if ('projectId' in params && !isResourceId(params.projectId)) {
    return <ProjectNotFound />
  }
  if ('itemId' in params && !isResourceId(params.itemId)) {
    return (
      <RouteNotFound
        message="網址可能輸入錯誤，或這個查核項目已不存在。"
        title="找不到這個查核項目"
      />
    )
  }
  return children ?? <Outlet />
}
