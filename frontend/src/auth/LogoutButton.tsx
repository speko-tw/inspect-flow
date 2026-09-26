// 共用的登出按鈕（AUT-R30）：Admin Web、Field Web 都用同一個。
// 不論登出 API 是否成功都清掉前端記住的使用者，讓外層的
// `RequireAuth` 導向 `/login`（見 `api.ts` 的 `logout` 與
// `RequireAuth` 的 `clear`）。

import { useState } from 'react'

import { logout } from './api'
import { useCurrentUser } from './useCurrentUser'

export default function LogoutButton() {
  const { clear } = useCurrentUser()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleClick() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      clear()
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={loggingOut}>
      登出
    </button>
  )
}
