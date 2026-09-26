// 登入頁（AUT-R29）。送出 email 與密碼到登入 API；失敗時只顯示
// 一種通用訊息，不透露是哪種原因（呼應後端 AUT-R06 的一致回應）。

import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { login } from './api'
import { isSafeRedirectPath } from './safeRedirect'

const GENERIC_ERROR_MESSAGE = 'Email 或密碼錯誤，請再試一次。'

interface RedirectState {
  from?: unknown
}

export default function LoginPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      await login(email, password)

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
    <main>
      <h1>登入</h1>
      <form onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
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
    </main>
  )
}
