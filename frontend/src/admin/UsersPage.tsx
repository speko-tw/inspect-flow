import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { useCurrentUser } from '../auth/useCurrentUser'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../ui/Form'
import { activeStatus } from '../ui/statusBadge'
import { useSubmitGuard } from '../ui/submitGuard'
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
  kind: 'admin' | 'deactivate' | 'activate'
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
  // 修改資料與公司連結的存檔錯誤：顯示在那一列的表單裡並聚焦。放在頁頂
  // 的話，列表一長就在視窗外，螢幕閱讀器使用者也不會被帶過去（F-O02）。
  // 同一列的兩個表單可同時開啟，所以錯誤要記是哪個表單送出的，否則
  // 兩份表單會各顯示一份、焦點也可能落在沒送出的那一份。
  const [saveError, setSaveError] = useState<{
    userId: string
    form: 'details' | 'company'
    message: string
    request: number
  } | null>(null)
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
  const actionGuard = useSubmitGuard()

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

  async function act(
    userId: string,
    form: 'details' | 'company',
    operation: () => Promise<User>,
  ) {
    if (!actionGuard.enter()) return
    setSaveError(null)
    setBusyUser(userId)
    try {
      await operation()
      setEditingUser(null)
      setEditingCompany(null)
      await reload()
    } catch (caught) {
      setSaveError((previous) => ({
        userId,
        form,
        message: managementErrorMessage(caught),
        request: (previous?.request ?? 0) + 1,
      }))
    } finally {
      actionGuard.leave()
      setBusyUser(null)
    }
  }

  // 收回「自己」的管理者權限：先確認；成功後不能再重新載入列表
  // （會被 403 擋下），改為導離管理頁並帶提示，目標頁的守衛會重新
  // 取得目前使用者。
  function confirmAction() {
    return actionGuard.run(confirmActionOnce)
  }

  async function confirmActionOnce() {
    if (!pendingAction) return
    const { user, kind } = pendingAction
    setActionError('')
    if (kind === 'admin' && user.is_admin && user.id === currentUser.id) {
      setBusyUser(user.id)
      try {
        await setUserAdmin(user.id, false)
        setPendingAction(null)
        // 落點交給 HomeRedirect 依存取摘要決定（F-O04）：這個人收回後
        // 不一定有現場權限，直接寫死 /field 會落到無權限頁。
        navigate('/', {
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
        : setUserActive(user.id, kind === 'activate'))
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
    if (kind === 'activate') {
      return `啟用 ${user.username} 後，該使用者可以再次登入。`
    }
    if (user.is_admin) {
      return user.id === currentUser.id
        ? `收回 ${user.username} 的管理者權限後，你將無法再進入管理頁。`
        : `收回 ${user.username} 的管理者權限後，該使用者將失去系統管理權限。`
    }
    return `指派 ${user.username} 為管理者後，該使用者將擁有系統全部權限。`
  }

  function requestAction(user: User, kind: PendingAction['kind']) {
    setActionError('')
    setPendingAction({ user, kind })
  }

  // 確認框的顏色看動作的效果：立刻拿掉他人權限或登入（停用、收回管理者）
  // 用紅色；授予或恢復（啟用、指派管理者）用一般主色。管理者身分只影響
  // 「管理者」動作，不影響啟用與停用。
  function confirmVariant({ user, kind }: PendingAction) {
    if (kind === 'deactivate') return 'danger'
    if (kind === 'admin' && user.is_admin) return 'danger'
    return 'neutral'
  }

  function toggleAdmin(user: User) {
    requestAction(user, 'admin')
  }

  function cancelPendingAction() {
    setPendingAction(null)
    setActionError('')
  }

  function rowError(userId: string, form: 'details' | 'company'): string {
    return saveError?.userId === userId && saveError.form === form
      ? saveError.message
      : ''
  }

  function created(user: { username: string; temporary_password: string }) {
    onTemporaryPassword(user.username, user.temporary_password)
    void reload()
  }

  return (
    <section aria-labelledby="users-heading">
      <h1 id="users-heading">使用者管理</h1>
      {loading ? <p>載入中…</p> : null}
      <div>
        <h2>使用者列表</h2>
        <Form onSubmit={searchUsers}>
          <label>
            搜尋使用者
            <input
              onChange={(event) => setQuery(event.target.value)}
              value={query}
            />
          </label>
          <FormSubmitButton disabled={loading}>搜尋</FormSubmitButton>
        </Form>
        <FormError>{listError}</FormError>
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
                          onClick={() => {
                            setSaveError(null)
                            setEditingUser(
                              editingUser === user.id ? null : user.id,
                            )
                          }}
                          type="button"
                        >
                          修改資料
                        </button>
                        <button
                          disabled={
                            user.is_system || user.auth_source !== 'local'
                          }
                          onClick={() => {
                            setSaveError(null)
                            setEditingCompany(
                              editingCompany === user.id ? null : user.id,
                            )
                          }}
                          type="button"
                        >
                          公司連結
                        </button>
                        <button
                          disabled={user.is_system || busyUser !== null}
                          onClick={() => void toggleAdmin(user)}
                          type="button"
                        >
                          {user.is_admin ? '收回管理者' : '指派管理者'}
                        </button>
                        <button
                          disabled={user.is_system || busyUser !== null}
                          onClick={() =>
                            requestAction(
                              user,
                              user.is_active ? 'deactivate' : 'activate',
                            )
                          }
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
                            key={`${user.id}:${pendingAction.kind}`}
                            confirmLabel="確認"
                            label="操作確認"
                            onCancel={cancelPendingAction}
                            onConfirm={confirmAction}
                            role="region"
                            rootRef={confirmationRef}
                            variant={confirmVariant(pendingAction)}
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
                              busy={busyUser !== null}
                              error={rowError(user.id, 'details')}
                              errorFocusRequest={saveError?.request}
                              onCancel={() => {
                                setSaveError(null)
                                setEditingUser(null)
                              }}
                              onSave={(fields) =>
                                act(user.id, 'details', () =>
                                  updateUser(user.id, fields),
                                )
                              }
                              user={user}
                            />
                          )}
                          {editingCompany === user.id && (
                            <CompanyLinkForm
                              busy={busyUser !== null}
                              companies={companies}
                              error={rowError(user.id, 'company')}
                              errorFocusRequest={saveError?.request}
                              onCancel={() => {
                                setSaveError(null)
                                setEditingCompany(null)
                              }}
                              onSave={(companyId, fields) =>
                                act(user.id, 'company', () =>
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
  busy,
  error,
  errorFocusRequest,
  onCancel,
  onSave,
}: {
  user: User
  /** 任何一個動作進行中就停用儲存，與送出防護的範圍一致。 */
  busy: boolean
  error: string
  errorFocusRequest: number | undefined
  onCancel: () => void
  onSave: (fields: {
    username: string
    email: string
    name_zh: string
    name_en: string | null
  }) => Promise<void>
}) {
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  const [nameZh, setNameZh] = useState(user.name_zh ?? '')
  const [nameEn, setNameEn] = useState(user.name_en ?? '')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    return onSave({
      username,
      email,
      name_zh: nameZh,
      name_en: nameEn || null,
    })
  }

  return (
    <Form
      error={error}
      errorFocusRequest={errorFocusRequest}
      errorTabIndex={-1}
      onSubmit={submit}
    >
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
      <FormSubmitButton className="btn-primary" disabled={busy}>
        儲存資料
      </FormSubmitButton>
    </Form>
  )
}

function CompanyLinkForm({
  user,
  busy,
  companies,
  error,
  errorFocusRequest,
  onCancel,
  onSave,
}: {
  user: User
  /** 任何一個動作進行中就停用儲存，與送出防護的範圍一致。 */
  busy: boolean
  companies: Company[]
  error: string
  errorFocusRequest: number | undefined
  onCancel: () => void
  onSave: (
    companyId: string | null,
    fields: Pick<User, 'department' | 'location' | 'employee_no'>,
  ) => Promise<void>
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
    <Form
      error={error}
      errorFocusRequest={errorFocusRequest}
      errorTabIndex={-1}
      onSubmit={() =>
        onSave(companyId || null, {
          department: disabled ? null : department || null,
          location: disabled ? null : location || null,
          employee_no: disabled ? null : employeeNo || null,
        })
      }
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
      <FormSubmitButton className="btn-primary" disabled={busy}>
        儲存公司連結
      </FormSubmitButton>
    </Form>
  )
}
