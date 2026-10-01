// 登入頁（AUT-R29）。送出帳號名稱或 email 與密碼到登入 API；失敗
// 時只顯示一種通用訊息，不透露是哪種原因（呼應後端 AUT-R06 的一
// 致回應）。

import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { login } from './api'
import AuthLayout from './AuthLayout'
import { isSafeRedirectPath } from './safeRedirect'

const GENERIC_ERROR_MESSAGE = '帳號或密碼錯誤，請再試一次。'

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
      await login(account, password)

      const state = location.state as RedirectState | null
      const from = state?.from
      navigate(isSafeRedirectPath(from) ? from : '/', { replace: true })
    } catch {
      // 401（帳密錯誤）、422（本體不合法）或其他狀態碼一律顯示同
      // 一則訊息，不因原因不同而改變文字。
      setError(GENERIC_ERROR_MESSAGE)
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
        <button type="submit" disabled={submitting}>
          登入
        </button>
      </form>
    </AuthLayout>
  )
}
