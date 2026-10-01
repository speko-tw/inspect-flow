// 首次設定頁（AUT-R29、AUT-R44）。三步：
// (1) 輸入首次登入碼；
// (2) 設定 admin 密碼（兩次確認，長度依 AUT-R04），此時才把碼與
//     密碼一起送出（後端一次驗證兩者）；
// (3) 設定成功後 admin 已登入（Cookie 由瀏覽器處理），新增第一個
//     使用者，重用管理頁的 `UserForm`（AUT-R46），完成後顯示一次
//     臨時密碼。第 3 步可略過直接進管理頁。
//
// 進入時只查一次 setup 狀態：設定成功後狀態會變成 false，流程進
// 行中不能因此被導走。

import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { listCompanies, type Company, type CreatedUser } from '../admin/api'
import UserForm from '../admin/UserForm'
import { ApiError } from '../auth/api'
import AuthLayout from '../auth/AuthLayout'
import { fetchSetupRequired, setAdminPassword, setupErrorMessage } from './api'

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

const STEP_LABELS = ['首次登入碼', '設定 admin 密碼', '新增第一個使用者']

type Step =
  | { kind: 'checking' }
  | { kind: 'unavailable' }
  | { kind: 'closed' }
  | { kind: 'code' }
  | { kind: 'password' }
  | { kind: 'first-user' }
  | { kind: 'created'; user: CreatedUser }

/** `current` 超過步驟數（4）代表全部完成。 */
function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="steps" aria-label="設定步驟">
      {STEP_LABELS.map((label, index) => {
        const number = index + 1
        const state =
          number < current ? 'done' : number === current ? 'current' : 'todo'
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="steps-num" aria-hidden="true">
              {state === 'done' ? '✓' : number}
            </span>
            <span className="steps-label">{label}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default function SetupPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'checking' })
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [completed, setCompleted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesError, setCompaniesError] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchSetupRequired()
      .then((required) => {
        if (!cancelled) {
          setStep({ kind: required ? 'code' : 'closed' })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStep({ kind: 'unavailable' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function loadCompanies() {
    try {
      setCompanies(await listCompanies())
    } catch {
      setCompaniesError(true)
    }
  }

  function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (code.trim() === '') {
      setError('請輸入首次登入碼。')
      return
    }
    setError('')
    setStep({ kind: 'password' })
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setCompleted(false)

    // 長度以 Unicode 字元（code point）計算，與後端一致（AUT-R04）。
    const length = [...password].length
    if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      setError(
        `密碼長度必須介於 ${MIN_PASSWORD_LENGTH} 到 ` +
          `${MAX_PASSWORD_LENGTH} 個字元。`,
      )
      return
    }
    if (password !== confirmation) {
      setError('兩次輸入的密碼不一致。')
      return
    }

    setSubmitting(true)
    try {
      await setAdminPassword(code.trim(), password)
      setPassword('')
      setConfirmation('')
      setCode('')
      setStep({ kind: 'first-user' })
      void loadCompanies()
    } catch (caught) {
      setError(setupErrorMessage(caught))
      if (caught instanceof ApiError && caught.status === 409) {
        setCompleted(true)
      } else if (caught instanceof ApiError && caught.status === 401) {
        // 碼不對：回到第 1 步重新輸入，密碼一併清掉。
        setCode('')
        setPassword('')
        setConfirmation('')
        setStep({ kind: 'code' })
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (step.kind === 'checking') {
    return null
  }

  if (step.kind === 'closed') {
    return <Navigate to="/login" replace />
  }

  if (step.kind === 'unavailable') {
    return (
      <AuthLayout title="首次設定">
        <p role="alert">無法確認系統狀態，請稍後再試。</p>
      </AuthLayout>
    )
  }

  if (step.kind === 'created') {
    return (
      <AuthLayout title="首次設定" progress={<StepIndicator current={4} />}>
        <section aria-labelledby="temporary-password-heading" role="status">
          <h2 id="temporary-password-heading">使用者已新增</h2>
          <p>
            請將以下臨時密碼交給 {step.user.username}
            。首次登入時必須變更密碼；離開此頁後無法再次查看。
          </p>
          <output aria-label="臨時密碼">{step.user.temporary_password}</output>
        </section>
        <button
          className="btn-primary"
          onClick={() => navigate('/admin')}
          type="button"
        >
          已抄下，進入管理頁
        </button>
      </AuthLayout>
    )
  }

  if (step.kind === 'first-user') {
    return (
      <AuthLayout
        title="首次設定"
        lead="admin 密碼已設定，你已登入。接著新增第一個使用者。"
        progress={<StepIndicator current={3} />}
        wide
      >
        {companiesError && (
          <p role="alert">無法載入公司清單，使用者將先不連結公司。</p>
        )}
        <UserForm
          companies={companies}
          onCreated={(user) => setStep({ kind: 'created', user })}
        />
        <button onClick={() => navigate('/admin')} type="button">
          略過，進入管理頁
        </button>
      </AuthLayout>
    )
  }

  if (step.kind === 'code') {
    return (
      <AuthLayout
        title="首次設定"
        lead="請輸入初始化指令（make init）印出的首次登入碼。"
        progress={<StepIndicator current={1} />}
      >
        <form onSubmit={submitCode} noValidate>
          <div>
            <label htmlFor="setup-code">首次登入碼</label>
            <input
              id="setup-code"
              name="code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </div>
          {error && <p role="alert">{error}</p>}
          <button type="submit">下一步</button>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="首次設定"
      lead="設定 admin 的密碼，長度 8 到 128 個字元。"
      progress={<StepIndicator current={2} />}
    >
      <form onSubmit={submitPassword} noValidate>
        <div>
          <label htmlFor="setup-password">新密碼</label>
          <input
            id="setup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="setup-password-confirm">再次輸入新密碼</label>
          <input
            id="setup-password-confirm"
            name="password-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        {completed && <Link to="/login">前往登入頁</Link>}
        <button type="submit" disabled={submitting}>
          {submitting ? '設定中…' : '設定密碼'}
        </button>
        <button
          disabled={submitting}
          onClick={() => {
            setError('')
            setStep({ kind: 'code' })
          }}
          type="button"
        >
          上一步
        </button>
      </form>
    </AuthLayout>
  )
}
