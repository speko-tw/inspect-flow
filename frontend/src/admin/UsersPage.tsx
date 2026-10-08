import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { useCurrentUser } from '../auth/useCurrentUser'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { activeStatus } from '../ui/statusBadge'
import {
  linkUserCompany,
  listCompanies,
  listUsersPage,
  managementErrorMessage,
  setUserActive,
  setUserAdmin,
  updateUser,
  type Company,
  type User,
} from './api'
import UserForm from './UserForm'

const SELF_REVOKED_NOTICE = '已收回你的管理者權限。'
type PendingAction = {
  user: User
  kind: 'admin' | 'deactivate'
}

export default function UsersPage({
  onTemporaryPassword,
}: {
  onTemporaryPassword: (username: string, password: string) => void
}) {
  const { user: currentUser } = useCurrentUser()
  const navigate = useNavigate()
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editingCompany, setEditingCompany] = useState<string | null>(null)
  const [busyUser, setBusyUser] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  )
  const [actionError, setActionError] = useState('')
  const confirmationRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [listError, setListError] = useState('')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    if (!pendingAction) return
    confirmationRef.current?.scrollIntoView?.({
      block: 'center',
      inline: 'start',
    })
  }, [pendingAction])

  async function loadUserPage(
    search: string,
    cursor: string | null = null,
    append = false,
    id = requestId.current,
  ) {
    const page = await listUsersPage({ q: search, cursor, limit: 50 })
    if (id === requestId.current) {
      setUsers((current) =>
        append ? [...current, ...page.items] : page.items,
      )
      setNextCursor(page.next_cursor)
    }
  }

  async function reload() {
    const id = ++requestId.current
    setListError('')
    setUsers([])
    setNextCursor(null)
    setLoadingMore(false)
    setLoading(true)
    try {
      const [, nextCompanies] = await Promise.all([
        loadUserPage(appliedQuery, null, false, id),
        listCompanies(),
      ])
      if (id === requestId.current) setCompanies(nextCompanies)
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const id = ++requestId.current
    async function load() {
      try {
        const [, nextCompanies] = await Promise.all([
          loadUserPage('', null, false, id),
          listCompanies(),
        ])
        if (active && id === requestId.current) {
          setCompanies(nextCompanies)
        }
      } catch (caught) {
        if (active) {
          setListError(managementErrorMessage(caught))
        }
      } finally {
        if (active) {
          if (id === requestId.current) setLoading(false)
        }
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  async function searchUsers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const search = query.trim()
    setAppliedQuery(search)
    const id = ++requestId.current
    setUsers([])
    setNextCursor(null)
    setLoadingMore(false)
    setListError('')
    setLoading(true)
    try {
      const [, nextCompanies] = await Promise.all([
        loadUserPage(search, null, false, id),
        listCompanies(),
      ])
      if (id === requestId.current) setCompanies(nextCompanies)
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  async function loadMoreUsers() {
    if (!nextCursor || loading || loadingMore) return
    const id = requestId.current
    setLoadingMore(true)
    setListError('')
    try {
      await loadUserPage(appliedQuery, nextCursor, true, id)
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoadingMore(false)
    }
  }

  async function clearSearch() {
    setQuery('')
    setAppliedQuery('')
    const id = ++requestId.current
    setUsers([])
    setNextCursor(null)
    setLoadingMore(false)
    setListError('')
    setLoading(true)
    try {
      const [, nextCompanies] = await Promise.all([
        loadUserPage('', null, false, id),
        listCompanies(),
      ])
      if (id === requestId.current) setCompanies(nextCompanies)
    } catch (caught) {
      if (id === requestId.current)
        setListError(managementErrorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

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

  // 收回「自己」的管理者權限：先確認；成功後不能再重新載入列表
  // （會被 403 擋下），改為導離管理頁並帶提示，目標頁的守衛會重新
  // 取得目前使用者。
  async function confirmAction() {
    if (!pendingAction) return
    const { user, kind } = pendingAction
    setActionError('')
    if (kind === 'admin' && user.is_admin && user.id === currentUser.id) {
      setBusyUser(user.id)
      try {
        await setUserAdmin(user.id, false)
        setPendingAction(null)
        navigate('/field', {
          replace: true,
          state: { notice: SELF_REVOKED_NOTICE },
        })
      } catch (caught) {
        setActionError(managementErrorMessage(caught))
        setBusyUser(null)
      }
      return
    }
    setBusyUser(user.id)
    try {
      await (kind === 'admin'
        ? setUserAdmin(user.id, !user.is_admin)
        : setUserActive(user.id, false))
      setPendingAction(null)
      setEditingUser(null)
      setEditingCompany(null)
      await reload()
    } catch (caught) {
      setActionError(managementErrorMessage(caught))
    } finally {
      setBusyUser(null)
    }
  }

  function actionMessage({ user, kind }: PendingAction): string {
    if (kind === 'deactivate') {
      return `停用 ${user.username} 後，該使用者將無法登入。`
    }
    if (user.is_admin) {
      return user.id === currentUser.id
        ? `收回 ${user.username} 的管理者權限後，你將無法再進入管理頁。`
        : `收回 ${user.username} 的管理者權限後，該使用者將失去系統管理權限。`
    }
    return `指派 ${user.username} 為管理者後，該使用者將擁有系統全部權限。`
  }

  function requestAction(user: User, kind: PendingAction['kind']) {
    if (kind === 'admin' || (kind === 'deactivate' && user.is_active)) {
      setActionError('')
      setPendingAction({ user, kind })
      return
    }
    void act(user.id, () => setUserActive(user.id, true))
  }

  function toggleAdmin(user: User) {
    requestAction(user, 'admin')
  }

  function cancelPendingAction() {
    setPendingAction(null)
    setActionError('')
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
        <form onSubmit={searchUsers}>
          <label>
            搜尋使用者
            <input
              onChange={(event) => setQuery(event.target.value)}
              value={query}
            />
          </label>
          <button disabled={loading} type="submit">
            搜尋
          </button>
        </form>
        {listError && <p role="alert">{listError}</p>}
        {!loading && users.length === 0 ? (
          appliedQuery ? (
            <p>
              找不到符合「{appliedQuery}」的使用者。{' '}
              <button onClick={() => void clearSearch()} type="button">
                清除搜尋
              </button>
            </p>
          ) : (
            <p>目前沒有使用者。</p>
          )
        ) : null}
        {users.length > 0 && (
          <div
            aria-label="使用者列表，可水平捲動"
            className="users-table-scroll"
            role="region"
            tabIndex={0}
          >
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
                  <Fragment key={user.id}>
                    <tr>
                      <th scope="row">
                        {user.username}
                        {user.is_system ? <span>（系統帳號）</span> : null}
                      </th>
                      <td>{user.name_zh ?? '—'}</td>
                      <td>{companyLabel(user, companies)}</td>
                      <td>{user.is_admin ? '是' : '否'}</td>
                      <td>
                        <StatusBadge status={activeStatus(user.is_active)} />
                      </td>
                      <td>
                        <button
                          disabled={
                            user.is_system || user.auth_source !== 'local'
                          }
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
                          disabled={
                            user.is_system || user.auth_source !== 'local'
                          }
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
                          onClick={() => void toggleAdmin(user)}
                          type="button"
                        >
                          {user.is_admin ? '收回管理者' : '指派管理者'}
                        </button>
                        <button
                          disabled={user.is_system || busyUser === user.id}
                          onClick={() => requestAction(user, 'deactivate')}
                          type="button"
                        >
                          {user.is_active ? '停用' : '啟用'}
                        </button>
                      </td>
                    </tr>
                    {pendingAction?.user.id === user.id && (
                      <tr className="row-detail">
                        <td colSpan={6}>
                          <ConfirmBox
                            busy={busyUser === user.id}
                            confirmLabel="確認"
                            label="操作確認"
                            onCancel={cancelPendingAction}
                            onConfirm={() => void confirmAction()}
                            role="region"
                            rootRef={confirmationRef}
                            variant={
                              pendingAction.kind === 'deactivate' ||
                              user.is_admin
                                ? 'danger'
                                : 'neutral'
                            }
                          >
                            <p>{actionMessage(pendingAction)}</p>
                            {actionError && <p role="alert">{actionError}</p>}
                          </ConfirmBox>
                        </td>
                      </tr>
                    )}
                    {(editingUser === user.id ||
                      editingCompany === user.id) && (
                      <tr className="row-detail">
                        <td colSpan={6}>
                          {editingUser === user.id && (
                            <UserDetailsForm
                              onCancel={() => setEditingUser(null)}
                              onSave={(fields) =>
                                void act(user.id, () =>
                                  updateUser(user.id, fields),
                                )
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
                                  companyId === user.company_id
                                    ? updateUser(user.id, fields)
                                    : linkUserCompany(
                                        user.id,
                                        companyId,
                                        fields,
                                      ),
                                )
                              }
                              user={user}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <button
            disabled={loading || loadingMore}
            onClick={() => void loadMoreUsers()}
            type="button"
          >
            {loadingMore ? '載入中…' : '載入更多'}
          </button>
        )}
      </div>
      <UserForm companies={companies} onCreated={created} />
    </section>
  )
}

function companyLabel(user: User, companies: Company[]): string {
  const name = companies.find(
    (company) => company.id === user.company_id,
  )?.name
  if (!name) {
    return '未連結'
  }
  return user.department ? `${name}／${user.department}` : name
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
      <button onClick={onCancel} type="button">
        取消
      </button>
      <button className="btn-primary" type="submit">
        儲存資料
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
    if (value === user.company_id) {
      setDepartment(user.department ?? '')
      setLocation(user.location ?? '')
      setEmployeeNo(user.employee_no ?? '')
    } else {
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
      <button onClick={onCancel} type="button">
        取消
      </button>
      <button className="btn-primary" type="submit">
        儲存公司連結
      </button>
    </form>
  )
}
