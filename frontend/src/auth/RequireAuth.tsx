// 未登入時導向登入頁、臨時密碼未變更時導向變更密碼頁的守衛
// （AUT-R29、AUT-R38）。包住 `/admin/*`、`/field/*`、
// `/change-password` 的路由元素；只擋 UI，後端的權限檢查
// （AUT-R18～AUT-R22、AUT-R33）才是真正的防線（AUT-R31）。

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { fetchCurrentUser, type CurrentUser } from './api'
import { forgetUser, rememberUser } from './sessionMemory'
import { CurrentUserProvider } from './useCurrentUser'

/**
 * 變更密碼頁的路徑。`must_change_password = true` 時導向這裡
 * （AUT-R38）；已經在這個路徑時不再導向，避免迴圈——`/change-password`
 * 本身也用 `RequireAuth` 包住（仍要求登入），但守衛不應該把它導向
 * 自己。
 */
const CHANGE_PASSWORD_PATH = '/change-password'

type Status =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'loggedOut' }
  | { kind: 'error' }
  | { kind: 'authenticated'; user: CurrentUser }

export default function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchCurrentUser()
      .then((user) => {
        if (cancelled) {
          return
        }
        if (user !== null) {
          rememberUser(user.id)
        }
        setStatus(
          user === null
            ? { kind: 'unauthenticated' }
            : { kind: 'authenticated', user },
        )
      })
      .catch(() => {
        // 目前使用者 API 回傳非 401 的錯誤（網路或 5xx）時不導向
        // 登入頁，只顯示錯誤，避免把「服務暫時不可用」誤判成
        // 「未登入」。
        if (!cancelled) {
          setStatus({ kind: 'error' })
        }
      })

    return () => {
      cancelled = true
    }
    // 只在這個守衛元件掛載時查一次；同一個 RequireAuth 底下的子
    // 路由切換不需要重新查詢登入狀態。
  }, [])

  if (status.kind === 'loading') {
    // 中性狀態：查詢結果出來前不畫任何東西，避免先閃一下登入頁
    // 才又跳回原本的畫面。
    return null
  }

  if (status.kind === 'error') {
    return <p role="alert">無法確認登入狀態，請稍後再試。</p>
  }

  if (status.kind === 'unauthenticated') {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" replace state={{ from }} />
  }

  if (status.kind === 'loggedOut') {
    // 主動登出：不帶 `from`。`from` 只留給「未登入直接開深層連結被
    // 擋」的情況，否則換別的身分登入時會被帶回上一個人的頁面。
    return <Navigate to="/login" replace />
  }

  if (
    status.user.must_change_password &&
    location.pathname !== CHANGE_PASSWORD_PATH
  ) {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={CHANGE_PASSWORD_PATH} replace state={{ from }} />
  }

  return (
    <CurrentUserProvider
      value={{
        user: status.user,
        clear: () => {
          // 主動登出：不留「上一位使用者」，下一位登入者不沿用任何
          // 原頁面（#489）。
          forgetUser()
          setStatus({ kind: 'loggedOut' })
        },
      }}
    >
      {children}
    </CurrentUserProvider>
  )
}
