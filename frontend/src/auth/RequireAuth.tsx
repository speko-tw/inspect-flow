// 未登入時導向登入頁的守衛（AUT-R29）。包住 `/admin/*`、
// `/field/*` 的路由元素；只擋 UI，後端的權限檢查（AUT-R18～
// AUT-R22）才是真正的防線（AUT-R31）。

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { fetchCurrentUser, type CurrentUser } from './api'
import { CurrentUserProvider } from './useCurrentUser'

type Status =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
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

  return (
    <CurrentUserProvider
      value={{
        user: status.user,
        clear: () => setStatus({ kind: 'unauthenticated' }),
      }}
    >
      {children}
    </CurrentUserProvider>
  )
}
