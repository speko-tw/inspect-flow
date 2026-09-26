// 目前使用者的共用狀態：`RequireAuth` 驗證成功後把使用者資料放進
// 這個 context，讓被守衛的畫面（例如登出按鈕）不必自己再呼叫一次
// `GET /api/v1/auth/me`，也能在登出後把前端記住的使用者清掉
// （AUT-R30）。

import { createContext, useContext, type ReactNode } from 'react'

import type { CurrentUser } from './api'

interface CurrentUserContextValue {
  user: CurrentUser
  /** 登出後呼叫：清掉這個 context 記住的使用者，讓外層的
   * `RequireAuth` 回到「未登入」狀態並導向 `/login`。 */
  clear: () => void
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null)

export function CurrentUserProvider({
  value,
  children,
}: {
  value: CurrentUserContextValue
  children: ReactNode
}) {
  return (
    <CurrentUserContext.Provider value={value}>
      {children}
    </CurrentUserContext.Provider>
  )
}

/** 只能在 `RequireAuth` 的子樹內使用；否則代表元件放錯位置。 */
export function useCurrentUser(): CurrentUserContextValue {
  const value = useContext(CurrentUserContext)
  if (value === null) {
    throw new Error('useCurrentUser 必須在 RequireAuth 內使用')
  }
  return value
}
