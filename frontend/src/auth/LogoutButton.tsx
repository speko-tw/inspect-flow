// 共用的登出按鈕（AUT-R30）：Admin Web、Field Web 都用同一個。
// 只在登出 API 回應成功（2xx）時才清掉前端記住的使用者，讓外層
// 的 `RequireAuth` 導向 `/login`（見 `api.ts` 的 `logout` 與
// `RequireAuth` 的 `clear`）。失敗（非 2xx 或網路例外）時留在原
// 畫面並顯示錯誤訊息，因為伺服器端的登入狀態與 Cookie 可能仍然
// 有效，貿然清狀態會讓使用者誤以為已經登出。

import { useState } from 'react'

import { logout } from './api'
import { useCurrentUser } from './useCurrentUser'

const ERROR_MESSAGE = '登出失敗，請再試一次。'

export default function LogoutButton() {
  const { clear } = useCurrentUser()
  const [loggingOut, setLoggingOut] = useState(false)
  const [error, setError] = useState(false)

  async function handleClick() {
    setLoggingOut(true)
    setError(false)
    try {
      await logout()
      clear()
    } catch {
      setError(true)
      setLoggingOut(false)
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={loggingOut}>
        登出
      </button>
      {error && <p role="alert">{ERROR_MESSAGE}</p>}
    </>
  )
}
