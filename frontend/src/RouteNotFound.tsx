// 登入後的畫面裡「找不到」的共用顯示（#493）：專案、任務、查核項目的
// id 無效或不存在，以及專案底下不存在的子路徑。「回首頁」連到這個
// 帳號的落點（`landing.ts`），不依賴 `/` 再導一次。

import { landingPath } from './auth/landing'
import { useCurrentUser } from './auth/useCurrentUser'
import NotFoundPage, { type NotFoundPageProps } from './NotFoundPage'

export default function RouteNotFound(
  props: Omit<NotFoundPageProps, 'homeTo' | 'embedded'>,
) {
  const { user } = useCurrentUser()
  return <NotFoundPage {...props} embedded homeTo={landingPath(user)} />
}

/** 專案 id 格式不對或不存在。 */
export function ProjectNotFound() {
  return (
    <RouteNotFound
      title="找不到這個專案"
      message="網址可能輸入錯誤，或這個專案已不存在。"
    />
  )
}
