// 登入頁（AUT-R29）。送出帳號名稱或 email 與密碼到登入 API；認證
// 失敗時顯示通用訊息，不透露是哪種原因（呼應後端 AUT-R06 的一
// 致回應）；伺服器忙碌時另提示稍後再試。

import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ApiError, login } from './api'
import AuthLayout from './AuthLayout'
import { loginTarget } from './landing'
import { previousSession } from './sessionMemory'

const GENERIC_ERROR_MESSAGE = '帳號或密碼錯誤，請再試一次。'
const BUSY_ERROR_MESSAGE = '伺服器暫時忙碌，請稍後再試。'

interface RedirectState {
  from?: unknown
}

export default function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [account, setAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const user = await login(account, password)

      const state = location.state as RedirectState | null
      navigate(loginTarget(user, state?.from, previousSession()), {
        replace: true,
      })
    } catch (caught) {
      // 503 是伺服器暫時無法寫入，不應誤導成帳密錯誤。
      setError(
        caught instanceof ApiError && caught.status === 503
          ? BUSY_ERROR_MESSAGE
          : GENERIC_ERROR_MESSAGE,
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="登入" lead="請輸入帳號名稱或 Email 與密碼。">
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="login-account">帳號名稱或 Email</label>
          <input
            id="login-account"
            name="username"
            type="text"
            autoComplete="username"
            required
            value={account}
            onChange={(event) => setAccount(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="login-password">密碼</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error !== null ? <p role="alert">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={submitting}>
          登入
        </button>
      </form>
    </AuthLayout>
  )
}
