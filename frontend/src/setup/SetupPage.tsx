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

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'

import { listCompanies, type Company, type CreatedUser } from '../admin/api'
import TemporaryPassword from '../admin/TemporaryPassword'
import UserForm from '../admin/UserForm'
import { ApiError } from '../auth/api'
import AuthLayout, { RequiredMark } from '../auth/AuthLayout'
import {
  FieldError,
  Form,
  FormActionButton,
  FormSubmitButton,
} from '../ui/Form'
import { fetchSetupRequired, setAdminPassword, setupErrorMessage } from './api'

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

/**
 * 步驟標籤以「詞組」為單位。窄螢幕放不下整句時，只能在詞組之間
 * 換行（CSS 把每個詞組設成 inline-block），不會把「使用者」拆出
 * 孤字（#306）。把詞組直接接起來就是完整標籤；詞組尾端的空格會
 * 留在詞組外，一行放得下時看起來和原本一樣。
 */
const STEP_LABELS = [
  ['首次登入碼'],
  ['設定 admin ', '密碼'],
  ['新增第一個', '使用者'],
]

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
      {STEP_LABELS.map((phrases, index) => {
        const label = phrases.join('')
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
            <span className="steps-label">
              {phrases.map((phrase) => (
                <Fragment key={phrase}>
                  <span className="steps-phrase">{phrase.trimEnd()}</span>
                  {phrase.endsWith(' ') ? ' ' : null}
                </Fragment>
              ))}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function SetupPage() {
  const [step, setStep] = useState<Step>({ kind: 'checking' })
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [errorField, setErrorField] = useState<
    'code' | 'password' | 'confirmation' | 'form' | null
  >(null)
  const [errorAttempt, setErrorAttempt] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesError, setCompaniesError] = useState(false)
  const codeInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmationInput = useRef<HTMLInputElement>(null)

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
      setErrorField('code')
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    setError('')
    setErrorField(null)
    setStep({ kind: 'password' })
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setErrorField(null)
    setCompleted(false)

    // 長度以 Unicode 字元（code point）計算，與後端一致（AUT-R04）。
    const length = [...password].length
    if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
      setError(
        `密碼長度必須介於 ${MIN_PASSWORD_LENGTH} 到 ` +
          `${MAX_PASSWORD_LENGTH} 個字元。`,
      )
      setErrorField('password')
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    if (password !== confirmation) {
      setError('兩次輸入的密碼不一致。')
      setErrorField('confirmation')
      setErrorAttempt((attempt) => attempt + 1)
      return
    }

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
        setErrorField('form')
        setErrorAttempt((attempt) => attempt + 1)
      } else if (caught instanceof ApiError && caught.status === 401) {
        // 碼不對：回到第 1 步重新輸入，密碼一併清掉。
        setCode('')
        setPassword('')
        setConfirmation('')
        setStep({ kind: 'code' })
        setErrorField('code')
        setErrorAttempt((attempt) => attempt + 1)
      } else if (caught instanceof ApiError && caught.status === 422) {
        setErrorField('password')
        setErrorAttempt((attempt) => attempt + 1)
      } else {
        setErrorField('form')
        setErrorAttempt((attempt) => attempt + 1)
      }
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
        <section
          aria-labelledby="temporary-password-heading"
          className="notice-success"
          role="status"
        >
          <h2 id="temporary-password-heading">使用者已新增</h2>
          <p>
            請將以下臨時密碼交給 {step.user.username}
            。首次登入時必須變更密碼；離開此頁後無法再次查看。
          </p>
          <TemporaryPassword password={step.user.temporary_password} />
        </section>
        <Link className="btn btn-primary" to="/admin">
          已抄下，進入管理頁
        </Link>
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
        <Link className="btn" to="/admin">
          略過，進入管理頁
        </Link>
      </AuthLayout>
    )
  }

  if (step.kind === 'code') {
    return (
      <AuthLayout
        title="首次設定"
        lead="請輸入 make init 印出的首次登入碼。"
        progress={<StepIndicator current={1} />}
      >
        <Form
          error={errorField === 'form' ? error : undefined}
          onSubmit={submitCode}
          noValidate
        >
          <div>
            <label htmlFor="setup-code">
              首次登入碼 <RequiredMark />
            </label>
            <input
              id="setup-code"
              name="code"
              type="text"
              autoComplete="off"
              spellCheck={false}
              ref={codeInput}
              required
              value={code}
              aria-invalid={errorField === 'code'}
              aria-describedby={
                errorField === 'code' ? 'setup-code-error' : undefined
              }
              onChange={(event) => {
                setCode(event.target.value)
                setError('')
                setErrorField(null)
              }}
            />
            {errorField === 'code' && error ? (
              <FieldError
                focusRequest={errorAttempt}
                focusTarget={codeInput}
                id="setup-code-error"
                tabIndex={-1}
              >
                {error}
              </FieldError>
            ) : null}
          </div>
          <FormSubmitButton className="btn-primary">下一步</FormSubmitButton>
        </Form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="首次設定"
      lead="設定 admin 的密碼，長度 8 到 128 個字元。"
      progress={<StepIndicator current={2} />}
    >
      <Form
        error={errorField === 'form' ? error : undefined}
        errorFocusRequest={errorAttempt}
        errorTabIndex={-1}
        onSubmit={submitPassword}
        noValidate
      >
        <div>
          <label htmlFor="setup-password">
            新密碼 <RequiredMark />
          </label>
          <input
            id="setup-password"
            name="password"
            type="password"
            autoComplete="new-password"
            ref={passwordInput}
            required
            value={password}
            aria-invalid={errorField === 'password'}
            aria-describedby={
              errorField === 'password' ? 'setup-password-error' : undefined
            }
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
              setErrorField(null)
              setCompleted(false)
            }}
          />
          {errorField === 'password' && error ? (
            <FieldError
              focusRequest={errorAttempt}
              focusTarget={passwordInput}
              id="setup-password-error"
              tabIndex={-1}
            >
              {error}
            </FieldError>
          ) : null}
        </div>
        <div>
          <label htmlFor="setup-password-confirm">
            再次輸入新密碼 <RequiredMark />
          </label>
          <input
            id="setup-password-confirm"
            name="password-confirm"
            type="password"
            autoComplete="new-password"
            ref={confirmationInput}
            required
            value={confirmation}
            aria-invalid={errorField === 'confirmation'}
            aria-describedby={
              errorField === 'confirmation'
                ? 'setup-password-confirm-error'
                : undefined
            }
            onChange={(event) => {
              setConfirmation(event.target.value)
              setError('')
              setErrorField(null)
              setCompleted(false)
            }}
          />
          {errorField === 'confirmation' && error ? (
            <FieldError
              focusRequest={errorAttempt}
              focusTarget={confirmationInput}
              id="setup-password-confirm-error"
              tabIndex={-1}
            >
              {error}
            </FieldError>
          ) : null}
        </div>
        {completed && <Link to="/login">前往登入頁</Link>}
        <FormActionButton
          onClick={() => {
            setError('')
            setErrorField(null)
            setCompleted(false)
            setStep({ kind: 'code' })
          }}
          type="button"
        >
          上一步
        </FormActionButton>
        <FormSubmitButton className="btn-primary">設定密碼</FormSubmitButton>
      </Form>
    </AuthLayout>
  )
}
