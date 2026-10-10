// 登入頁（AUT-R29）。送出帳號名稱或 email 與密碼到登入 API；認證
// 失敗時顯示通用訊息，不透露是哪種原因（呼應後端 AUT-R06 的一
// 致回應）；伺服器忙碌時另提示稍後再試。

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

import { ApiError, login } from './api'
import AuthLayout, { RequiredMark } from './AuthLayout'
import { loginTarget } from './landing'
import { previousSession } from './sessionMemory'
import { blockImeEnter, useSubmitGuard } from '../ui/submitGuard'

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
  const [errorField, setErrorField] = useState<'account' | 'password' | null>(
    null,
  )
  const [submitting, setSubmitting] = useState(false)
  const guard = useSubmitGuard()
  const accountInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (errorField === 'account') accountInput.current?.focus()
    if (errorField === 'password') passwordInput.current?.focus()
  }, [error, errorField])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!guard.enter()) return
    setError(null)
    setErrorField(null)

    if (account.trim() === '') {
      setError('請輸入帳號名稱或 Email。')
      setErrorField('account')
      guard.leave()
      return
    }
    if (password === '') {
      setError('請輸入密碼。')
      setErrorField('password')
      guard.leave()
      return
    }

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
      setErrorField('password')
    } finally {
      guard.leave()
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout title="登入" lead="請輸入帳號名稱或 Email 與密碼。">
      <form onKeyDown={blockImeEnter} onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="login-account">
            帳號名稱或 Email <RequiredMark />
          </label>
          <input
            id="login-account"
            name="username"
            type="text"
            autoComplete="username"
            ref={accountInput}
            required
            value={account}
            aria-invalid={errorField === 'account'}
            aria-describedby={
              errorField === 'account' ? 'login-account-error' : undefined
            }
            onChange={(event) => {
              setAccount(event.target.value)
              setError(null)
              setErrorField(null)
            }}
          />
          {errorField === 'account' && error !== null ? (
            <p
              className="auth-field-error"
              id="login-account-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="login-password">
            密碼 <RequiredMark />
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            ref={passwordInput}
            required
            value={password}
            aria-invalid={errorField === 'password'}
            aria-describedby={
              errorField === 'password' ? 'login-password-error' : undefined
            }
            onChange={(event) => {
              setPassword(event.target.value)
              setError(null)
              setErrorField(null)
            }}
          />
          {errorField === 'password' && error !== null ? (
            <p
              className="auth-field-error"
              id="login-password-error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
        <button className="btn-primary" type="submit" disabled={submitting}>
          登入
        </button>
      </form>
    </AuthLayout>
  )
}
