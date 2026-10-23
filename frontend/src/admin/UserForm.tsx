import { useEffect, useRef, useState, type FormEvent } from 'react'

import {
  createUser,
  managementErrorMessage,
  type Company,
  type CreatedUser,
} from './api'
import { FormErrorSummary, FormField, FormGroup } from '../components'
import { Form, FormSubmitButton } from '../ui/Form'

const USERNAME_RULE = '3～32 字元，英文字母開頭，可用英數與 . _ -'
const NEEDS_COMPANY_HINT = '連結公司後才能填寫'
const ignoreDirtyChange = (): void => undefined

export default function UserForm({
  companies,
  onCompanyOptionsRequested,
  onCreated,
  onDirtyChange = ignoreDirtyChange,
}: {
  companies: Company[]
  onCompanyOptionsRequested?: () => void
  onCreated: (user: CreatedUser) => void
  /** 回報草稿狀態；不需離頁保護的設定流程可省略。 */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [nameZh, setNameZh] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [department, setDepartment] = useState('')
  const [location, setLocation] = useState('')
  const [employeeNo, setEmployeeNo] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [isExternalCollaborator, setIsExternalCollaborator] = useState<
    boolean | null
  >(null)
  const [accountTypeError, setAccountTypeError] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorAttempt, setErrorAttempt] = useState(0)

  const fieldsDisabled = companyId === ''
  const accountTypeRef = useRef<HTMLInputElement>(null)
  const dirty = Boolean(
    username ||
    email ||
    nameZh ||
    nameEn ||
    companyId ||
    department ||
    location ||
    employeeNo ||
    isAdmin ||
    isExternalCollaborator !== null,
  )

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!errorAttempt) return
    const firstError = [
      'user-account-name',
      'user-email',
      'user-name-zh',
      'user-account-type',
    ].find(
      (id) =>
        document.getElementById(id)?.getAttribute('aria-invalid') === 'true',
    )
    document.getElementById(firstError ?? '')?.focus()
  }, [errorAttempt, fieldErrors, accountTypeError])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const usernameInput = event.currentTarget.elements.namedItem(
      'username',
    ) as HTMLInputElement
    const emailInput = event.currentTarget.elements.namedItem(
      'email',
    ) as HTMLInputElement
    const nameInput = event.currentTarget.elements.namedItem(
      'name-zh',
    ) as HTMLInputElement
    const nextErrors: Record<string, string> = {}
    if (
      !usernameInput.checkValidity() ||
      username.length < 3 ||
      username.length > 32
    ) {
      nextErrors.username = username.trim()
        ? '帳號名稱格式不符。請依欄位說明修正後再試一次。'
        : '帳號名稱尚未填寫。請輸入 3～32 字元的帳號名稱。'
    }
    if (!emailInput.checkValidity()) {
      nextErrors.email = email.trim()
        ? 'Email 格式不完整。請輸入有效的 Email 地址。'
        : 'Email 尚未填寫。請輸入可接收通知的 Email 地址。'
    }
    if (!nameInput.checkValidity()) {
      nextErrors.nameZh = '中文姓名尚未填寫。請輸入帳號持有人的姓名。'
    }
    setFieldErrors(nextErrors)
    const nextAccountTypeError =
      isExternalCollaborator === null
        ? '帳號類型尚未選擇。請選擇內部帳號或外部協作人員。'
        : ''
    setAccountTypeError(nextAccountTypeError)
    if (Object.keys(nextErrors).length || nextAccountTypeError) {
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    setSaving(true)
    try {
      const user = await createUser({
        username,
        email,
        name_zh: nameZh,
        name_en: nameEn || null,
        company_id: companyId || null,
        department: companyId ? department || null : null,
        location: companyId ? location || null : null,
        employee_no: companyId ? employeeNo || null : null,
        is_external_collaborator: isExternalCollaborator ?? false,
        is_admin: isAdmin,
      })
      setUsername('')
      setEmail('')
      setNameZh('')
      setNameEn('')
      setCompanyId('')
      setDepartment('')
      setLocation('')
      setEmployeeNo('')
      setIsAdmin(false)
      setIsExternalCollaborator(null)
      onCreated(user)
    } catch (caught) {
      const message = managementErrorMessage(caught).replace(/[。.!?]+$/, '')
      setError(`${message}。請檢查資料後再試一次。`)
    } finally {
      setSaving(false)
    }
  }

  function changeCompany(value: string) {
    setCompanyId(value)
    if (!value) {
      setDepartment('')
      setLocation('')
      setEmployeeNo('')
    }
  }

  return (
    <Form
      error={error}
      onSubmit={submit}
      noValidate
      unexpectedErrorMessage="新增帳號失敗。請檢查資料後再試一次，或聯絡系統管理員。"
    >
      <h2>新增帳號</h2>
      <FormErrorSummary
        errors={[
          ...Object.entries(fieldErrors).map(([field, message]) => ({
            fieldId:
              field === 'username'
                ? 'user-account-name'
                : field === 'email'
                  ? 'user-email'
                  : 'user-name-zh',
            fieldLabel:
              field === 'username'
                ? '帳號名稱'
                : field === 'email'
                  ? 'Email'
                  : '中文姓名',
            message,
          })),
          ...(accountTypeError
            ? [
                {
                  fieldId: 'user-account-type',
                  fieldLabel: '帳號類型',
                  message: accountTypeError,
                },
              ]
            : []),
        ]}
        focusRequest={0}
      />
      <FormGroup title="帳號資料" description="設定登入與聯絡資訊。">
        <FormField
          label="帳號名稱"
          id="user-account-name"
          required
          description={USERNAME_RULE}
          error={fieldErrors.username}
        >
          {(control) => (
            <input
              {...control}
              autoComplete="username"
              maxLength={32}
              minLength={3}
              name="username"
              onChange={(event) => {
                setUsername(event.target.value)
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.username
                  return next
                })
                setError('')
              }}
              pattern="[A-Za-z][A-Za-z0-9._-]{2,31}"
              required
              value={username}
            />
          )}
        </FormField>
        <FormField
          label="Email"
          id="user-email"
          required
          error={fieldErrors.email}
        >
          {(control) => (
            <input
              {...control}
              autoComplete="email"
              name="email"
              onChange={(event) => {
                setEmail(event.target.value)
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.email
                  return next
                })
                setError('')
              }}
              required
              type="email"
              value={email}
            />
          )}
        </FormField>
        <FormField
          label="中文姓名"
          id="user-name-zh"
          required
          error={fieldErrors.nameZh}
        >
          {(control) => (
            <input
              {...control}
              name="name-zh"
              onChange={(event) => {
                setNameZh(event.target.value)
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.nameZh
                  return next
                })
                setError('')
              }}
              required
              value={nameZh}
            />
          )}
        </FormField>
        <FormField label="英文姓名">
          {(control) => (
            <input
              {...control}
              onChange={(event) => setNameEn(event.target.value)}
              value={nameEn}
            />
          )}
        </FormField>
      </FormGroup>
      <FormGroup title="公司與帳號類型">
        <FormField label="公司">
          {(control) => (
            <select
              {...control}
              onChange={(event) => changeCompany(event.target.value)}
              onFocus={onCompanyOptionsRequested}
              value={companyId}
            >
              <option value="">未連結公司</option>
              {companies
                .filter((company) => company.is_active)
                .map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
            </select>
          )}
        </FormField>
        <fieldset
          aria-invalid={accountTypeError ? 'true' : undefined}
          aria-describedby={
            accountTypeError ? 'user-account-type-error' : undefined
          }
          aria-required="true"
          role="radiogroup"
          className="form-pattern-group-fields"
        >
          <legend>
            帳號類型 <span className="required-mark" aria-hidden="true" />
            <span className="visually-hidden">（必填）</span>
          </legend>
          <label>
            <input
              checked={isExternalCollaborator === false}
              name="account-type"
              onChange={() => {
                setIsExternalCollaborator(false)
                setAccountTypeError('')
                setError('')
              }}
              ref={accountTypeRef}
              type="radio"
              id="user-account-type"
              aria-invalid={Boolean(accountTypeError)}
            />
            內部帳號
          </label>
          <label>
            <input
              checked={isExternalCollaborator === true}
              name="account-type"
              onChange={() => {
                setIsExternalCollaborator(true)
                setIsAdmin(false)
                setAccountTypeError('')
                setError('')
              }}
              type="radio"
              aria-invalid={Boolean(accountTypeError)}
            />
            外部協作人員
          </label>
          {accountTypeError && (
            <small id="user-account-type-error">{accountTypeError}</small>
          )}
        </fieldset>
        <FormField
          label="部門"
          description={fieldsDisabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={fieldsDisabled}
              onChange={(event) => setDepartment(event.target.value)}
              value={department}
            />
          )}
        </FormField>
        <FormField
          label="地點"
          description={fieldsDisabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={fieldsDisabled}
              onChange={(event) => setLocation(event.target.value)}
              value={location}
            />
          )}
        </FormField>
        <FormField
          label="工號"
          description={fieldsDisabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={fieldsDisabled}
              onChange={(event) => setEmployeeNo(event.target.value)}
              value={employeeNo}
            />
          )}
        </FormField>
      </FormGroup>
      <FormGroup title="系統權限">
        <label>
          <input
            checked={isAdmin}
            onChange={(event) => setIsAdmin(event.target.checked)}
            disabled={isExternalCollaborator === true}
            type="checkbox"
          />
          指派系統管理者權限
        </label>
      </FormGroup>
      <FormSubmitButton className="btn-primary" disabled={saving}>
        {saving ? '建立中…' : '新增帳號'}
      </FormSubmitButton>
    </Form>
  )
}
