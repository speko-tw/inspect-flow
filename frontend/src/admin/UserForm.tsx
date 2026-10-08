import { useId, useState, type FormEvent, type ReactNode } from 'react'

import {
  createUser,
  managementErrorMessage,
  type Company,
  type CreatedUser,
} from './api'

const USERNAME_RULE = '3～32 字元，英文字母開頭，可用英數與 . _ -'
const NEEDS_COMPANY_HINT = '連結公司後才能填寫'

/** 必填欄位的標示；「*」對讀屏無意義，必填已由 `required` 表達。 */
function Required({ children }: { children: ReactNode }) {
  return (
    <span>
      {children} <span aria-hidden="true">*</span>
    </span>
  )
}

export default function UserForm({
  companies,
  onCreated,
}: {
  companies: Company[]
  onCreated: (user: CreatedUser) => void
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
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const fieldsDisabled = companyId === ''
  const usernameRuleId = useId()
  const companyHintIds = [useId(), useId(), useId()]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
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
      onCreated(user)
    } catch (caught) {
      setError(managementErrorMessage(caught))
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
    <form onSubmit={submit}>
      <h2>新增使用者</h2>
      {error && <p role="alert">{error}</p>}
      <div>
        <label>
          <Required>帳號名稱</Required>
          <input
            aria-describedby={usernameRuleId}
            autoComplete="username"
            maxLength={32}
            minLength={3}
            onChange={(event) => setUsername(event.target.value)}
            pattern="[A-Za-z][A-Za-z0-9._-]{2,31}"
            required
            value={username}
          />
        </label>
        <small id={usernameRuleId}>{USERNAME_RULE}</small>
      </div>
      <label>
        <Required>Email</Required>
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        <Required>中文姓名</Required>
        <input
          onChange={(event) => setNameZh(event.target.value)}
          required
          value={nameZh}
        />
      </label>
      <label>
        英文姓名
        <input
          onChange={(event) => setNameEn(event.target.value)}
          value={nameEn}
        />
      </label>
      <label>
        公司
        <select
          onChange={(event) => changeCompany(event.target.value)}
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
      </label>
      <div>
        <label>
          部門
          <input
            aria-describedby={fieldsDisabled ? companyHintIds[0] : undefined}
            disabled={fieldsDisabled}
            onChange={(event) => setDepartment(event.target.value)}
            value={department}
          />
        </label>
        {fieldsDisabled && (
          <small id={companyHintIds[0]}>{NEEDS_COMPANY_HINT}</small>
        )}
      </div>
      <div>
        <label>
          地點
          <input
            aria-describedby={fieldsDisabled ? companyHintIds[1] : undefined}
            disabled={fieldsDisabled}
            onChange={(event) => setLocation(event.target.value)}
            value={location}
          />
        </label>
        {fieldsDisabled && (
          <small id={companyHintIds[1]}>{NEEDS_COMPANY_HINT}</small>
        )}
      </div>
      <div>
        <label>
          工號
          <input
            aria-describedby={fieldsDisabled ? companyHintIds[2] : undefined}
            disabled={fieldsDisabled}
            onChange={(event) => setEmployeeNo(event.target.value)}
            value={employeeNo}
          />
        </label>
        {fieldsDisabled && (
          <small id={companyHintIds[2]}>{NEEDS_COMPANY_HINT}</small>
        )}
      </div>
      <label>
        <input
          checked={isAdmin}
          onChange={(event) => setIsAdmin(event.target.checked)}
          type="checkbox"
        />
        指派系統管理者權限
      </label>
      <button className="btn-primary" disabled={saving} type="submit">
        {saving ? '建立中…' : '新增使用者'}
      </button>
    </form>
  )
}
