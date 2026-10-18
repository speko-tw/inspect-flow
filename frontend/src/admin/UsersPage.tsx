import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useNavigate } from 'react-router'

import { useCurrentUser } from '../auth/useCurrentUser'
import { FormErrorSummary, FormField, FormGroup } from '../components'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../ui/Form'
import { activeStatus } from '../ui/statusBadge'
import { useSubmitGuard } from '../ui/submitGuard'
import { UnsavedLeaveBox } from '../ui/navigation'
import * as navigationGuard from '../ui/navigation'
import { CursorListSearch } from './CursorListSearch'
import {
  ManagementApiError,
  linkUserCompany,
  listCompanies,
  listUsersPage,
  managementErrorMessage,
  getDeactivationCheck,
  getReactivationPreview,
  listExternalUsersWithoutProject,
  listUnmanagedProjects,
  request,
  reactivateUser,
  setUserActive,
  setUserAdmin,
  updateUser,
  type Company,
  type DeactivationCheck,
  type RestorePreview,
  type UnmanagedProject,
  type User,
} from './api'
import { useCursorList } from './useCursorList'
import UserForm from './UserForm'
import { ACCOUNT_LABEL } from '../layout/navigationLabels'

const SELF_REVOKED_NOTICE = '已收回你的管理者權限。'
const NEEDS_COMPANY_HINT = '連結公司後才能填寫'

/** 工號衝突由 API 判斷，錯誤需提供可執行的修正方向。 */
function companyLinkErrorMessage(error: unknown): string {
  const message = managementErrorMessage(error).replace(/[。.!?]+$/, '')
  if (
    error instanceof ManagementApiError &&
    error.code === 'user.employee_no_conflict'
  ) {
    return `${message}。請修改工號，讓它在該公司內唯一後再試一次。`
  }
  if (
    error instanceof ManagementApiError &&
    error.code === 'company.inactive'
  ) {
    return `${message}。請選擇啟用中的公司後再試一次。`
  }
  if (
    error instanceof ManagementApiError &&
    error.code === 'permission.denied'
  ) {
    return `${message}。請洽系統管理員確認公司連結權限。`
  }
  return `${message}。請檢查公司與帳號資料；若無法修正，請洽系統管理員。`
}

type PendingAction = {
  user: User
  kind: 'admin' | 'deactivate' | 'activate'
}

export default function UsersPage({
  onTemporaryPassword,
  detailUserId,
  initialQuery,
  hideCreateForm = false,
  externalNavigationGuard = false,
  onQueryApplied,
  onDirtyChange,
  onSelectUser,
}: {
  onTemporaryPassword: (username: string, password: string) => void
  detailUserId?: string | null
  initialQuery?: string
  hideCreateForm?: boolean
  externalNavigationGuard?: boolean
  onQueryApplied?: (query: string) => void
  onDirtyChange?: (dirty: boolean) => void
  onSelectUser?: (id: string) => void
}) {
  const { user: currentUser } = useCurrentUser()
  const navigate = useNavigate()
  const userList = useCursorList(listUsersPage, managementErrorMessage)
  const {
    items: users,
    query,
    setQuery,
    appliedQuery,
    error: userListError,
    nextCursor,
    loading,
    loadingMore,
    search,
    clearSearch,
    reload,
    loadMore,
  } = userList
  const [companies, setCompanies] = useState<Company[]>([])
  const [detailUser, setDetailUser] = useState<User | null>(null)
  const [detailError, setDetailError] = useState('')
  const [externalNoProject, setExternalNoProject] = useState<User[]>([])
  const [unmanagedProjects, setUnmanagedProjects] = useState<
    UnmanagedProject[]
  >([])
  const [companyListError, setCompanyListError] = useState('')
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
  const [actionPreview, setActionPreview] = useState<
    DeactivationCheck | RestorePreview | null
  >(null)
  const [previewError, setPreviewError] = useState('')
  const [restoreSelection, setRestoreSelection] = useState({
    permission_codes: [] as string[],
    delegated_modules: [] as string[],
    project_ids: [] as string[],
    task_ids: [] as string[],
  })
  const [dirtyForms, setDirtyForms] = useState<Record<string, boolean>>({})
  const appliedQueryRef = useRef(appliedQuery)
  appliedQueryRef.current = appliedQuery
  const confirmationRef = useRef<HTMLDivElement>(null)
  const companyRequestId = useRef(0)
  const actionGuard = useSubmitGuard()
  const hasDirtyForms = Object.values(dirtyForms).some(Boolean)
  const reportDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyForms((current) =>
      current[key] === dirty ? current : { ...current, [key]: dirty },
    )
  }, [])

  useEffect(() => {
    onDirtyChange?.(hasDirtyForms)
  }, [hasDirtyForms, onDirtyChange])

  useEffect(() => {
    if (
      initialQuery !== undefined &&
      initialQuery.trim() !== appliedQueryRef.current
    ) {
      void search(initialQuery)
    }
  }, [initialQuery, search])

  useEffect(() => {
    if (!detailUserId) {
      setDetailUser(null)
      setDetailError('')
      return
    }
    const listed = users.find((user) => user.id === detailUserId)
    if (listed) {
      setDetailUser(listed)
      setDetailError('')
      return
    }
    let active = true
    setDetailUser(null)
    setDetailError('')
    void request<User>(`/users/${encodeURIComponent(detailUserId)}`)
      .then((user) => active && setDetailUser(user))
      .catch((caught: unknown) => {
        if (active) setDetailError(managementErrorMessage(caught))
      })
    return () => {
      active = false
    }
  }, [detailUserId, users])

  useEffect(() => {
    if (!pendingAction) return
    confirmationRef.current?.scrollIntoView?.({
      block: 'center',
      inline: 'start',
    })
  }, [pendingAction])

  useEffect(() => {
    if (!pendingAction || pendingAction.kind === 'admin') {
      setActionPreview(null)
      return
    }
    let active = true
    setPreviewError('')
    setActionPreview(null)
    if (pendingAction.kind === 'deactivate') {
      void getDeactivationCheck(pendingAction.user.id)
        .then((data) => active && setActionPreview(data))
        .catch((caught: unknown) => {
          if (active) setPreviewError(managementErrorMessage(caught))
        })
    } else {
      void getReactivationPreview(pendingAction.user.id)
        .then((data) => {
          if (!active) return
          setActionPreview(data)
          setRestoreSelection({
            permission_codes: [],
            delegated_modules: [],
            project_ids: [],
            task_ids: [],
          })
        })
        .catch((caught: unknown) => {
          if (active) setPreviewError(managementErrorMessage(caught))
        })
    }
    return () => {
      active = false
    }
  }, [pendingAction])

  const loadCompanies = useCallback(async () => {
    const id = ++companyRequestId.current
    setCompanyListError('')
    try {
      const nextCompanies = await listCompanies()
      if (id === companyRequestId.current) setCompanies(nextCompanies)
    } catch (caught) {
      if (id === companyRequestId.current)
        setCompanyListError(managementErrorMessage(caught))
    }
  }, [])

  const loadLifecycleLists = useCallback(async () => {
    try {
      const [externalUsers, projects] = await Promise.all([
        listExternalUsersWithoutProject(),
        listUnmanagedProjects(),
      ])
      setExternalNoProject(externalUsers)
      setUnmanagedProjects(projects)
    } catch {
      setExternalNoProject([])
      setUnmanagedProjects([])
    }
  }, [])

  useEffect(() => {
    void loadCompanies()
    void loadLifecycleLists()
    return () => {
      companyRequestId.current += 1
    }
  }, [loadCompanies, loadLifecycleLists])

  async function act(
    userId: string,
    form: 'details' | 'company',
    operation: () => Promise<User>,
  ) {
    if (!actionGuard.enter()) return
    setSaveError(null)
    setBusyUser(userId)
    try {
      const updated = await operation()
      setDetailUser((current) => (current?.id === userId ? updated : current))
      setEditingUser(null)
      setEditingCompany(null)
      setDirtyForms({})
      await reload()
    } catch (caught) {
      setSaveError((previous) => ({
        userId,
        form,
        message:
          form === 'company'
            ? companyLinkErrorMessage(caught)
            : managementErrorMessage(caught),
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
      if (kind === 'admin') {
        const updated = await setUserAdmin(user.id, !user.is_admin)
        setDetailUser((current) =>
          current?.id === user.id ? updated : current,
        )
      } else if (kind === 'deactivate') {
        const updated = await setUserActive(user.id, false)
        setDetailUser((current) =>
          current?.id === user.id ? updated : current,
        )
      } else {
        const updated = await reactivateUser(user.id, restoreSelection)
        setDetailUser((current) =>
          current?.id === user.id ? updated : current,
        )
      }
      setPendingAction(null)
      setEditingUser(null)
      setEditingCompany(null)
      await reload()
      await loadLifecycleLists()
    } catch (caught) {
      setActionError(managementErrorMessage(caught))
    } finally {
      setBusyUser(null)
    }
  }

  function actionMessage({ user, kind }: PendingAction): string {
    if (kind === 'deactivate') {
      return `停用 ${user.username} 後，該帳號將無法登入。`
    }
    if (kind === 'activate') {
      return `啟用 ${user.username} 後，該帳號可以再次登入。`
    }
    if (user.is_admin) {
      return user.id === currentUser.id
        ? `收回 ${user.username} 的管理者權限後，你將無法再進入管理頁。`
        : `收回 ${user.username} 的管理者權限後，該帳號將失去系統管理權限。`
    }
    return `指派 ${user.username} 為管理者後，該帳號將擁有系統全部權限。`
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
    setDirtyForms({})
    onTemporaryPassword(user.username, user.temporary_password)
    void reload()
    void loadCompanies()
  }

  const detail = detailUserId ? detailUser : null

  return (
    <section aria-labelledby="users-heading">
      {!externalNavigationGuard && (
        <UsersNavigationGuard hasUnsavedChanges={hasDirtyForms} />
      )}
      {detailUserId ? (
        <section aria-labelledby="person-basic-heading">
          {detailError && <p role="alert">{detailError}</p>}
          {!detail && !detailError && <p role="status">載入中…</p>}
          {detail && (
            <>
              <h2 id="person-basic-heading">基本資料</h2>
              <p>
                {detail.name_zh || detail.username}（{detail.username}）
                {detail.is_external_collaborator ? '・外部協作人員' : ''}
              </p>
              <p>電子郵件：{detail.email || '未填寫'}</p>
              <p>公司：{companyLabel(detail, companies)}</p>
              <p>狀態：{detail.is_active ? '啟用中' : '已停用'}</p>
              <div>
                <button
                  disabled={detail.is_system || detail.auth_source !== 'local'}
                  onClick={() => setEditingUser(detail.id)}
                  type="button"
                >
                  修改資料
                </button>
                <button
                  disabled={detail.is_system || detail.auth_source !== 'local'}
                  onClick={() => setEditingCompany(detail.id)}
                  type="button"
                >
                  公司連結
                </button>
                <button
                  disabled={detail.is_system || busyUser !== null}
                  onClick={() => toggleAdmin(detail)}
                  type="button"
                >
                  {detail.is_admin ? '收回管理者' : '指派管理者'}
                </button>
                <button
                  disabled={detail.is_system || busyUser !== null}
                  onClick={() =>
                    requestAction(
                      detail,
                      detail.is_active ? 'deactivate' : 'activate',
                    )
                  }
                  type="button"
                >
                  {detail.is_active ? '停用帳號' : '啟用帳號'}
                </button>
              </div>
              {pendingAction?.user.id === detail.id && (
                <ConfirmBox
                  busy={busyUser === detail.id}
                  confirmDisabled={
                    pendingAction.kind !== 'admin' &&
                    (!actionPreview ||
                      Boolean(previewError) ||
                      (pendingAction.kind === 'activate' &&
                        'account_expired' in actionPreview &&
                        actionPreview.account_expired))
                  }
                  key={`${detail.id}:${pendingAction.kind}`}
                  confirmLabel="確認"
                  label="操作確認"
                  onCancel={cancelPendingAction}
                  onConfirm={confirmAction}
                  role="region"
                  rootRef={confirmationRef}
                  variant={confirmVariant(pendingAction)}
                >
                  <p>{actionMessage(pendingAction)}</p>
                  {previewError && <p role="alert">{previewError}</p>}
                  {actionError && <p role="alert">{actionError}</p>}
                  {pendingAction.kind === 'activate' &&
                    actionPreview &&
                    'permission_codes' in actionPreview && (
                      <RestoreChoices
                        preview={actionPreview}
                        selection={restoreSelection}
                        onChange={setRestoreSelection}
                      />
                    )}
                </ConfirmBox>
              )}
              {editingUser === detail.id && (
                <UserDetailsForm
                  busy={busyUser !== null}
                  error={rowError(detail.id, 'details')}
                  errorFocusRequest={saveError?.request}
                  onCancel={() => setEditingUser(null)}
                  onDirtyChange={(dirty) =>
                    reportDirty(`details:${detail.id}`, dirty)
                  }
                  onSave={(fields) =>
                    act(detail.id, 'details', () =>
                      updateUser(detail.id, fields),
                    )
                  }
                  user={detail}
                />
              )}
              {editingCompany === detail.id && (
                <CompanyLinkForm
                  busy={busyUser !== null}
                  companies={companies}
                  error={rowError(detail.id, 'company')}
                  errorFocusRequest={saveError?.request}
                  onCancel={() => setEditingCompany(null)}
                  onDirtyChange={(dirty) =>
                    reportDirty(`company:${detail.id}`, dirty)
                  }
                  onSave={(companyId, fields) =>
                    act(detail.id, 'company', () =>
                      companyId === detail.company_id
                        ? updateUser(detail.id, fields)
                        : linkUserCompany(detail.id, companyId, fields),
                    )
                  }
                  user={detail}
                />
              )}
            </>
          )}
        </section>
      ) : null}
      {!detailUserId && <h2 id="users-heading">{ACCOUNT_LABEL}清單</h2>}
      {!detailUserId && (
        <>
          <section aria-labelledby="external-unassigned-heading">
            <h2 id="external-unassigned-heading">
              沒有參與專案的外部協作帳號
            </h2>
            {externalNoProject.length === 0 ? (
              <p>目前沒有符合條件的帳號。</p>
            ) : (
              <ul>
                {externalNoProject.map((user) => (
                  <li key={user.id}>
                    {user.name_zh || user.username}（{user.username}）
                    {user.account_expires_on
                      ? `，到期日 ${user.account_expires_on}`
                      : ''}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="unmanaged-projects-heading">
            <h2 id="unmanaged-projects-heading">沒有啟用管理成員的專案</h2>
            {unmanagedProjects.length === 0 ? (
              <p>目前沒有符合條件的專案。</p>
            ) : (
              <ul>
                {unmanagedProjects.map((project) => (
                  <li key={project.id}>
                    <Link to={`/admin/projects/${project.id}/members`}>
                      {project.project_code}／{project.name}（
                      {project.member_count} 位成員）
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {loading ? <p>載入中…</p> : null}
          <div>
            <h2>{ACCOUNT_LABEL}清單</h2>
            <CursorListSearch
              disabled={loading}
              label={`搜尋${ACCOUNT_LABEL}`}
              onQueryChange={setQuery}
              onSearch={(event) => {
                event.preventDefault()
                void search(query).then(() =>
                  onQueryApplied?.(query.trim()),
                )
              }}
              query={query}
            />
            <FormError>{userListError || companyListError}</FormError>
            {!loading && users.length === 0 ? (
              appliedQuery ? (
                <p>
                  找不到符合「{appliedQuery}」的帳號。{' '}
                  <button
                    onClick={() =>
                      void clearSearch().then(() => onQueryApplied?.(''))
                    }
                    type="button"
                  >
                    清除搜尋
                  </button>
                </p>
              ) : (
                <p>目前沒有{ACCOUNT_LABEL}。</p>
              )
            ) : null}
            {users.length > 0 && (
              <div
                aria-label={`${ACCOUNT_LABEL}清單，可水平捲動`}
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
                            {onSelectUser ? (
                              <button
                                onClick={() => onSelectUser(user.id)}
                                type="button"
                              >
                                {user.username}
                              </button>
                            ) : (
                              user.username
                            )}
                            {user.is_system ? <span>（系統帳號）</span> : null}
                            {user.is_external_collaborator ? (
                              <span>（外部協作）</span>
                            ) : null}
                          </th>
                          <td>{user.name_zh ?? '—'}</td>
                          <td>{companyLabel(user, companies)}</td>
                          <td>{user.is_admin ? '是' : '否'}</td>
                          <td>
                            <StatusBadge
                              status={activeStatus(user.is_active)}
                            />
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
                                confirmDisabled={
                                  pendingAction.kind !== 'admin' &&
                                  (!actionPreview ||
                                    Boolean(previewError) ||
                                    (pendingAction.kind === 'activate' &&
                                      'account_expired' in actionPreview &&
                                      actionPreview.account_expired))
                                }
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
                                {previewError && (
                                  <p role="alert">{previewError}</p>
                                )}
                                {pendingAction.kind === 'deactivate' &&
                                  actionPreview &&
                                  'last_manager_projects' in actionPreview &&
                                  actionPreview.last_manager_projects.length >
                                    0 && (
                                    <div>
                                      <p>
                                        停用後下列專案將沒有啟用中的管理成員；
                                        請先安排接手者。
                                      </p>
                                      <ul>
                                        {actionPreview.last_manager_projects.map(
                                          (project) => (
                                            <li key={project.id}>
                                              <Link
                                                to={[
                                                  '/admin/projects',
                                                  project.id,
                                                  'planning',
                                                ].join('/')}
                                              >
                                                {project.project_code}／
                                                {project.name}
                                              </Link>
                                            </li>
                                          ),
                                        )}
                                      </ul>
                                    </div>
                                  )}
                                {pendingAction.kind === 'activate' &&
                                  actionPreview &&
                                  'permission_codes' in actionPreview && (
                                    <RestoreChoices
                                      preview={actionPreview}
                                      selection={restoreSelection}
                                      onChange={setRestoreSelection}
                                    />
                                  )}
                                {actionError && (
                                  <p role="alert">{actionError}</p>
                                )}
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
                                    reportDirty(`details:${user.id}`, false)
                                  }}
                                  onDirtyChange={(dirty) =>
                                    reportDirty(`details:${user.id}`, dirty)
                                  }
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
                                    reportDirty(`company:${user.id}`, false)
                                  }}
                                  onDirtyChange={(dirty) =>
                                    reportDirty(`company:${user.id}`, dirty)
                                  }
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
                onClick={() => void loadMore()}
                type="button"
              >
                {loadingMore ? '載入中…' : '載入更多'}
              </button>
            )}
          </div>
          {!hideCreateForm && (
            <UserForm
              companies={companies}
              onCreated={created}
              onDirtyChange={(dirty) => reportDirty('create', dirty)}
            />
          )}
        </>
      )}
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

/** 讓 Admin 對預覽中的資料逐項選擇，避免整包復原過期授權。 */
function RestoreChoices({
  preview,
  selection,
  onChange,
}: {
  preview: RestorePreview
  selection: {
    permission_codes: string[]
    delegated_modules: string[]
    project_ids: string[]
    task_ids: string[]
  }
  onChange: (value: typeof selection) => void
}) {
  function toggle<K extends keyof typeof selection>(key: K, value: string) {
    const current = selection[key]
    onChange({
      ...selection,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    })
  }

  return (
    <div>
      {preview.account_expired && (
        <p role="alert">外部帳號已到期，請先修改到期日後再重新啟用。</p>
      )}
      <h4>選擇要恢復的模組權限</h4>
      {preview.permission_codes.map((code) => (
        <label key={code}>
          <input
            checked={selection.permission_codes.includes(code)}
            onChange={() => toggle('permission_codes', code)}
            type="checkbox"
          />
          {code}
        </label>
      ))}
      <h4>選擇要恢復的模組委派</h4>
      {preview.delegated_modules.map((module) => (
        <label key={module}>
          <input
            checked={selection.delegated_modules.includes(module)}
            onChange={() => toggle('delegated_modules', module)}
            type="checkbox"
          />
          {module}
        </label>
      ))}
      <h4>選擇要恢復的專案成員關係</h4>
      {preview.project_memberships.map((member) => (
        <label key={member.project_id}>
          <input
            checked={selection.project_ids.includes(member.project_id)}
            onChange={() => toggle('project_ids', member.project_id)}
            type="checkbox"
          />
          {member.project_code}／{member.project_name}
        </label>
      ))}
      <h4>選擇要保留的未完成任務建議指派</h4>
      {preview.tasks.map((task) => (
        <label key={task.task_id}>
          <input
            checked={selection.task_ids.includes(task.task_id)}
            onChange={() => toggle('task_ids', task.task_id)}
            type="checkbox"
          />
          {task.name}（{task.status}）
        </label>
      ))}
    </div>
  )
}

function UsersNavigationGuard({
  hasUnsavedChanges,
}: {
  hasUnsavedChanges: boolean
}) {
  const guard = navigationGuard.useUnsavedNavigationGuard(hasUnsavedChanges)
  return <UnsavedLeaveBox guard={guard} />
}

function UserDetailsForm({
  user,
  busy,
  error,
  errorFocusRequest,
  onCancel,
  onSave,
  onDirtyChange,
}: {
  user: User
  /** 任何一個動作進行中就停用儲存，與送出防護的範圍一致。 */
  busy: boolean
  error: string
  errorFocusRequest: number | undefined
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
  onSave: (fields: {
    username: string
    email: string
    name_zh: string
    name_en: string | null
    account_expires_on?: string | null
  }) => Promise<void>
}) {
  const [username, setUsername] = useState(user.username)
  const [email, setEmail] = useState(user.email ?? '')
  const [nameZh, setNameZh] = useState(user.name_zh ?? '')
  const [nameEn, setNameEn] = useState(user.name_en ?? '')
  const [expiresOn, setExpiresOn] = useState(user.account_expires_on ?? '')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorAttempt, setErrorAttempt] = useState(0)
  const dirty = Boolean(
    username !== user.username ||
    email !== (user.email ?? '') ||
    nameZh !== (user.name_zh ?? '') ||
    nameEn !== (user.name_en ?? '') ||
    expiresOn !== (user.account_expires_on ?? ''),
  )

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!errorAttempt) return
    const firstError = [
      'user-edit-username',
      'user-edit-email',
      'user-edit-name-zh',
    ].find(
      (id) =>
        document.getElementById(id)?.getAttribute('aria-invalid') === 'true',
    )
    document.getElementById(firstError ?? '')?.focus()
  }, [errorAttempt, fieldErrors])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    if (!usernameInput.checkValidity()) {
      nextErrors.username = username.trim()
        ? '帳號名稱格式不符。請修正帳號名稱後再試一次。'
        : '帳號名稱尚未填寫。請輸入有效的帳號名稱。'
    }
    if (!emailInput.checkValidity()) {
      nextErrors.email = email.trim()
        ? 'Email 格式不完整。請輸入有效的 Email 地址。'
        : 'Email 尚未填寫。請輸入可接收通知的 Email 地址。'
    }
    if (!nameInput.checkValidity()) {
      nextErrors.nameZh = '中文姓名尚未填寫。請輸入帳號的姓名。'
    }
    setFieldErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      setErrorAttempt((attempt) => attempt + 1)
      return
    }
    return onSave({
      username,
      email,
      name_zh: nameZh,
      name_en: nameEn || null,
      ...(user.is_external_collaborator
        ? { account_expires_on: expiresOn || null }
        : {}),
    })
  }

  return (
    <Form
      error={
        error
          ? `${error.replace(/[。.!?]+$/, '')}。請檢查修改內容後再試一次。`
          : ''
      }
      errorFocusRequest={errorFocusRequest}
      errorTabIndex={-1}
      onSubmit={submit}
      noValidate
      unexpectedErrorMessage="修改帳號失敗。請檢查資料後再試一次，或聯絡系統管理員。"
    >
      <h3>修改帳號資料</h3>
      <FormErrorSummary
        errors={Object.entries(fieldErrors).map(([field, message]) => ({
          fieldId:
            field === 'username'
              ? 'user-edit-username'
              : field === 'email'
                ? 'user-edit-email'
                : 'user-edit-name-zh',
          fieldLabel:
            field === 'username'
              ? '帳號名稱'
              : field === 'email'
                ? 'Email'
                : '中文姓名',
          message,
        }))}
        focusRequest={0}
      />
      <FormGroup title="帳號資料" description="修改登入帳號與姓名資料。">
        <FormField
          label="帳號名稱"
          id="user-edit-username"
          required
          error={fieldErrors.username}
        >
          {(control) => (
            <input
              {...control}
              name="username"
              onChange={(event) => {
                setUsername(event.target.value)
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.username
                  return next
                })
              }}
              required
              value={username}
            />
          )}
        </FormField>
        <FormField
          label="Email"
          id="user-edit-email"
          required
          error={fieldErrors.email}
        >
          {(control) => (
            <input
              {...control}
              name="email"
              onChange={(event) => {
                setEmail(event.target.value)
                setFieldErrors((current) => {
                  const next = { ...current }
                  delete next.email
                  return next
                })
              }}
              required
              type="email"
              value={email}
            />
          )}
        </FormField>
        <FormField
          label="中文姓名"
          id="user-edit-name-zh"
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
        {user.is_external_collaborator && (
          <FormField label="外部帳號到期日（留空代表不設定到期日）">
            {(control) => (
              <input
                {...control}
                onChange={(event) => setExpiresOn(event.target.value)}
                type="date"
                value={expiresOn}
              />
            )}
          </FormField>
        )}
      </FormGroup>
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
  onDirtyChange,
}: {
  user: User
  /** 任何一個動作進行中就停用儲存，與送出防護的範圍一致。 */
  busy: boolean
  companies: Company[]
  error: string
  errorFocusRequest: number | undefined
  onCancel: () => void
  onDirtyChange: (dirty: boolean) => void
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
  const dirty = Boolean(
    companyId !== (user.company_id ?? '') ||
    department !== (user.department ?? '') ||
    location !== (user.location ?? '') ||
    employeeNo !== (user.employee_no ?? ''),
  )

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

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
      <FormGroup title="公司資料">
        <FormField label="公司">
          {(control) => (
            <select
              {...control}
              onChange={(event) => changeCompany(event.target.value)}
              value={companyId}
            >
              <option value="">未連結公司</option>
              {companies
                .filter(
                  (company) => company.is_active || company.id === companyId,
                )
                .map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                    {!company.is_active ? '（已停用）' : ''}
                  </option>
                ))}
            </select>
          )}
        </FormField>
        <FormField
          label="部門"
          description={disabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={disabled}
              onChange={(event) => setDepartment(event.target.value)}
              value={department}
            />
          )}
        </FormField>
        <FormField
          label="地點"
          description={disabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={disabled}
              onChange={(event) => setLocation(event.target.value)}
              value={location}
            />
          )}
        </FormField>
        <FormField
          label="工號"
          description={disabled ? NEEDS_COMPANY_HINT : undefined}
        >
          {(control) => (
            <input
              {...control}
              disabled={disabled}
              onChange={(event) => setEmployeeNo(event.target.value)}
              value={employeeNo}
            />
          )}
        </FormField>
      </FormGroup>
      <button onClick={onCancel} type="button">
        取消
      </button>
      <FormSubmitButton className="btn-primary" disabled={busy}>
        儲存公司連結
      </FormSubmitButton>
    </Form>
  )
}
