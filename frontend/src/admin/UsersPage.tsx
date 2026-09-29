import { useEffect, useState, type FormEvent } from 'react'

import {
  linkUserCompany,
  listCompanies,
  listUsers,
  managementErrorMessage,
  setUserActive,
  setUserAdmin,
  updateUser,
  type Company,
  type User,
} from './api'
import UserForm from './UserForm'

export default function UsersPage({
  onTemporaryPassword,
}: {
  onTemporaryPassword: (username: string, password: string) => void
}) {
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editingCompany, setEditingCompany] = useState<string | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)

  async function reload() {
    setError('')
    try {
      const [nextUsers, nextCompanies] = await Promise.all([
        listUsers(),
        listCompanies(),
      ])
      setUsers(nextUsers)
      setCompanies(nextCompanies)
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [nextUsers, nextCompanies] = await Promise.all([
          listUsers(),
          listCompanies(),
        ])
        if (active) {
          setUsers(nextUsers)
          setCompanies(nextCompanies)
        }
      } catch (caught) {
        if (active) {
          setError(managementErrorMessage(caught))
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function act(userId: string, operation: () => Promise<User>) {
    setError('')
    setBusyUser(userId)
    try {
      await operation()
      setEditingUser(null)
      setEditingCompany(null)
      await reload()
    } catch (caught) {
      setError(managementErrorMessage(caught))
    } finally {
      setBusyUser(null)
    }
  }

  function created(user: { username: string; temporary_password: string }) {
    onTemporaryPassword(user.username, user.temporary_password)
    void reload()
  }

  return (
    <section aria-labelledby="users-heading">
      <h1 id="users-heading">使用者管理</h1>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>載入中…</p> : null}
      <div>
        <h2>使用者列表</h2>
        {!loading && users.length === 0 ? <p>目前沒有使用者。</p> : null}
        {users.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">帳號</th>
                <th scope="col">姓名</th>
                <th scope="col">公司</th>
                <th scope="col">系統管理者</th>
                <th scope="col">狀態</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <th scope="row">
                    {user.username}
                    {user.is_system ? <span>（系統帳號）</span> : null}
                  </th>
                  <td>{user.name_zh ?? '—'}</td>
                  <td>
                    {companies.find(
                      (company) => company.id === user.company_id,
                    )?.name ?? '未連結'}
                  </td>
                  <td>{user.is_admin ? '是' : '否'}</td>
                  <td>{user.is_active ? '啟用' : '停用'}</td>
                  <td>
                    <button
                      disabled={user.is_system || user.auth_source !== 'local'}
                      onClick={() =>
                        setEditingUser(
                          editingUser === user.id ? null : user.id,
                        )
                      }
                      type="button"
                    >
                      修改資料
                    </button>
                    <button
                      disabled={user.is_system || user.auth_source !== 'local'}
                      onClick={() =>
                        setEditingCompany(
                          editingCompany === user.id ? null : user.id,
                        )
                      }
                      type="button"
                    >
                      公司連結
                    </button>
                    <button
                      disabled={user.is_system || busyUser === user.id}
                      onClick={() =>
                        void act(user.id, () =>
                          setUserAdmin(user.id, !user.is_admin),
                        )
                      }
                      type="button"
                    >
                      {user.is_admin ? '收回管理者' : '指派管理者'}
                    </button>
                    <button
                      disabled={user.is_system || busyUser === user.id}
                      onClick={() =>
                        void act(user.id, () =>
                          setUserActive(user.id, !user.is_active),
                        )
                      }
                      type="button"
                    >
                      {user.is_active ? '停用' : '啟用'}
                    </button>
                    {editingUser === user.id && (
                      <UserDetailsForm
                        onCancel={() => setEditingUser(null)}
                        onSave={(fields) =>
                          void act(user.id, () => updateUser(user.id, fields))
                        }
                        user={user}
                      />
                    )}
                    {editingCompany === user.id && (
                      <CompanyLinkForm
                        companies={companies}
                        onCancel={() => setEditingCompany(null)}
                        onSave={(companyId, fields) =>
                          void act(user.id, () =>
                            linkUserCompany(user.id, companyId, fields),
                          )
                        }
                        user={user}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <UserForm companies={companies} onCreated={created} />
    </section>
  )
}

function UserDetailsForm({
  user,
  onCancel,
  onSave,
}: {
  user: User
  onCancel: () => void
  onSave: (fields: {
    username: string
    email: string
    name_zh: string
    name_en: string | null
  }) => void
}) {
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  const [nameZh, setNameZh] = useState(user.name_zh ?? '')
  const [nameEn, setNameEn] = useState(user.name_en ?? '')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({
      username,
      email,
      name_zh: nameZh,
      name_en: nameEn || null,
    })
  }

  return (
    <form onSubmit={submit}>
      <h3>修改使用者資料</h3>
      <label>
        帳號名稱
        <input
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </label>
      <label>
        Email
        <input
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
      <button type="submit">儲存資料</button>
      <button onClick={onCancel} type="button">
        取消
      </button>
    </form>
  )
}

function CompanyLinkForm({
  user,
  companies,
  onCancel,
  onSave,
}: {
  user: User
  companies: Company[]
  onCancel: () => void
  onSave: (
    companyId: string | null,
    fields: Pick<User, 'department' | 'location' | 'employee_no'>,
  ) => void
}) {
  const [companyId, setCompanyId] = useState(user.company_id ?? '')
  const [department, setDepartment] = useState(user.department ?? '')
  const [location, setLocation] = useState(user.location ?? '')
  const [employeeNo, setEmployeeNo] = useState(user.employee_no ?? '')
  const disabled = companyId === ''

  function changeCompany(value: string) {
    setCompanyId(value)
    if (!value) {
      setDepartment('')
      setLocation('')
      setEmployeeNo('')
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave(companyId || null, {
          department: disabled ? null : department || null,
          location: disabled ? null : location || null,
          employee_no: disabled ? null : employeeNo || null,
        })
      }}
    >
      <h3>連結公司</h3>
      <label>
        公司
        <select
          onChange={(event) => changeCompany(event.target.value)}
          value={companyId}
        >
          <option value="">未連結公司</option>
          {companies
            .filter((company) => company.is_active || company.id === companyId)
            .map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
                {!company.is_active ? '（已停用）' : ''}
              </option>
            ))}
        </select>
      </label>
      <label>
        部門
        <input
          disabled={disabled}
          onChange={(event) => setDepartment(event.target.value)}
          value={department}
        />
      </label>
      <label>
        地點
        <input
          disabled={disabled}
          onChange={(event) => setLocation(event.target.value)}
          value={location}
        />
      </label>
      <label>
        工號
        <input
          disabled={disabled}
          onChange={(event) => setEmployeeNo(event.target.value)}
          value={employeeNo}
        />
      </label>
      <button type="submit">儲存公司連結</button>
      <button onClick={onCancel} type="button">
        取消
      </button>
    </form>
  )
}
