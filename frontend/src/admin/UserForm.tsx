import { useState, type FormEvent } from 'react'

import {
  createUser,
  managementErrorMessage,
  type Company,
  type CreatedUser,
} from './api'

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
      <label>
        帳號名稱
        <input
          autoComplete="username"
          maxLength={32}
          minLength={3}
          onChange={(event) => setUsername(event.target.value)}
          pattern="[A-Za-z][A-Za-z0-9._-]{2,31}"
          required
          value={username}
        />
      </label>
      <label>
        Email
        <input
          autoComplete="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        中文姓名
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
      <label>
        部門
        <input
          disabled={fieldsDisabled}
          onChange={(event) => setDepartment(event.target.value)}
          value={department}
        />
      </label>
      <label>
        地點
        <input
          disabled={fieldsDisabled}
          onChange={(event) => setLocation(event.target.value)}
          value={location}
        />
      </label>
      <label>
        工號
        <input
          disabled={fieldsDisabled}
          onChange={(event) => setEmployeeNo(event.target.value)}
          value={employeeNo}
        />
      </label>
      <label>
        <input
          checked={isAdmin}
          onChange={(event) => setIsAdmin(event.target.checked)}
          type="checkbox"
        />
        指派系統管理者權限
      </label>
      <button disabled={saving} type="submit">
        {saving ? '建立中…' : '新增使用者'}
      </button>
    </form>
  )
}
