import { Route, Routes, useLocation } from 'react-router'

import RequireValidRouteIds from '../../../RequireValidRouteIds'
import RouteNotFound from '../../../RouteNotFound'
import { ROUTES } from '../../../routes'
import type { SuggestionMode } from './paths'
import SuggestionComparePage from './SuggestionComparePage'
import SuggestionDetailPage from './SuggestionDetailPage'
import SuggestionEditPage from './SuggestionEditPage'
import SuggestionListPage from './SuggestionListPage'

/**
 * 建議清單、詳情、修改與比較的子路由，掛在個人設定（`mine`）或範本管理
 * 頁（`review`）之下。比較只屬管理者；`:suggestionId` 先過路由 id 守衛，
 * 不把怪異網址拼進 API 路徑。
 */
export default function SuggestionRoutes({ mode }: { mode: SuggestionMode }) {
  const { pathname } = useLocation()
  // 管理外殼與設定頁共用同一棵路由樹；個人清單只屬 `/settings` 之下，
  // 不讓它在根路徑下也有一個沒登記的別名網址。
  if (mode === 'mine' && !pathname.startsWith(`${ROUTES.settings.path}/`)) {
    return <RouteNotFound />
  }
  return (
    <Routes>
      <Route index element={<SuggestionListPage mode={mode} />} />
      <Route
        element={
          <RequireValidRouteIds>
            <SuggestionDetailPage mode={mode} />
          </RequireValidRouteIds>
        }
        path=":suggestionId"
      />
      <Route
        element={
          <RequireValidRouteIds>
            <SuggestionEditPage mode={mode} />
          </RequireValidRouteIds>
        }
        path=":suggestionId/edit"
      />
      {mode === 'review' && (
        <Route
          element={
            <RequireValidRouteIds>
              <SuggestionComparePage />
            </RequireValidRouteIds>
          }
          path=":suggestionId/compare"
        />
      )}
      <Route element={<RouteNotFound />} path="*" />
    </Routes>
  )
}
