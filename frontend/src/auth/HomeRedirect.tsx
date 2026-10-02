// `/` 不是獨立頁面，只負責把人導到該去的地方：未登入到 `/login`，
// 已登入依身分到預設落點（見 `landing.ts`）。導向前先查一次目前
// 使用者，讀到的一定是最新狀態（例如剛變更完密碼）。

import { useEffect, useState } from 'react'
import { Navigate } from 'react-router'

import { fetchCurrentUser } from './api'
import { landingPath } from './landing'

type Status =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'redirect'; to: string }

export default function HomeRedirect() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    fetchCurrentUser()
      .then((user) => {
        if (!cancelled) {
          setStatus({
            kind: 'redirect',
            to: user === null ? '/login' : landingPath(user),
          })
        }
      })
      .catch(() => {
        // 非 401 的錯誤（網路或 5xx）不當成未登入，只顯示錯誤。
        if (!cancelled) {
          setStatus({ kind: 'error' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (status.kind === 'loading') {
    return null
  }

  if (status.kind === 'error') {
    return <p role="alert">無法確認登入狀態，請稍後再試。</p>
  }

  return <Navigate to={status.to} replace />
}
