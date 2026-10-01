// 尚未完成首次設定時，把 `/`、`/login` 導向 `/setup`（AUT-R29）。
// 依 `GET /api/v1/setup/status` 判斷；這只是 UI 導向，真正的防線
// 是後端的 setup 路由（AUT-R44）。

import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'

import { fetchSetupRequired } from './api'

type Status = 'loading' | 'required' | 'done'

export default function SetupGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    let cancelled = false

    fetchSetupRequired()
      .then((required) => {
        if (!cancelled) {
          setStatus(required ? 'required' : 'done')
        }
      })
      .catch(() => {
        // 狀態查不到時不擋人：照常顯示原本的畫面，已完成設定的系
        // 統不會因為這個端點暫時失敗而打不開登入頁。
        if (!cancelled) {
          setStatus('done')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (status === 'loading') {
    return null
  }

  if (status === 'required') {
    return <Navigate to="/setup" replace />
  }

  return children
}
