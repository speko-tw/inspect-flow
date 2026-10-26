import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { useCurrentUser } from '../auth/useCurrentUser'
import { FormErrorSummary, FormField, FormGroup } from '../components'
import { StatusBadge } from '../ui/Badge'
import { ConfirmBox } from '../ui/ConfirmBox'
import { BatchActionBar } from '../ui/BatchActionBar'
import { Notice } from '../ui/Notice'
import { revealElement } from '../ui/reveal'
import { Form, FormError, FormSubmitButton } from '../ui/Form'
import permissionCodeContract from '../permissionCodeContract'
import { STATUS_BADGES, type BadgeStatus } from '../ui/statusBadge'
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
  resetUserTemporaryPassword,
  setUserActive,
  setUsersActiveStatus,
  setUserAdmin,
  updateUser,
  type Company,
  type DeactivationCheck,
  type RestorePreview,
  type UnmanagedProject,
  type User,
  type UserDetail,
} from './api'
import { getUserParticipatingProjects } from './module-permissions/api'
import { useCursorList } from './useCursorList'
import UserForm from './UserForm'
import { ACCOUNT_LABEL } from '../layout/navigationLabels'
import './UsersPage.css'

type RestorePreviewSelection = {
  permission_codes: string[]
  delegated_modules: string[]
  project_ids: string[]
  task_ids: string[]
}

function emptyRestorePreviewSelection(): RestorePreviewSelection {
  return {
    permission_codes: [],
    delegated_modules: [],
    project_ids: [],
    task_ids: [],
  }
}

const SELF_REVOKED_NOTICE = '已收回你的管理者權限。'
const NEEDS_COMPANY_HINT = '連結公司後才能填寫'
/** 停用對象獨立標示，避免姓名看起來像另一項後果。 */
function deactivationAccountText(user: User): string {
  const name = user.name_zh || user.username
  return `要停用的帳號：${name}（${user.username}）`
}

/** T2：單人及批次共用四項後果，避免詳情與清單文案分歧。 */
function DeactivationConsequences({ count }: { count?: number }) {
  const subject = count === undefined ? '他' : `這 ${count} 個帳號`
  return (
    <ul>
      <li>{subject}會立刻被登出，之後不能再登入。</li>
      <li>過去的查核紀錄與專案資料都會保留。</li>
      <li>
        {`${subject}的功能權限與專案成員關係會先留著，` +
          '重新啟用時由你逐項決定要不要恢復。'}
      </li>
      <li>{subject}手上已派出但沒做完的任務不會自動轉走，請通知內業改派。</li>
    </ul>
  )
}

/** T2：詳情、列表共用最後管理者警告，連到可安排接手者的專案。 */
function DeactivationWarning({
  projects,
}: {
  projects: DeactivationCheck['last_manager_projects']
}) {
  if (!projects.length) return null
  return (
    <div>
      <p>停用後下列專案將沒有啟用中的管理成員；請先安排接手者。</p>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <Link to={`/projects/${project.id}/planning`}>
              {project.project_code}／{project.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** ADM-R33：改派入口適用所有成員，不只最後一位管理成員。 */
function DeactivationReassignmentLinks({
  projects,
}: {
  projects: DeactivationCheck['last_manager_projects']
}) {
  if (!projects.length) return null
  return (
    <section aria-label="改派未完成任務">
      <p>請由內業前往計畫與任務改派未完成任務。</p>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>
            <Link to={`/projects/${project.id}/planning`}>
              計畫與任務：{project.project_code}／{project.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** 停用確認的頁面資料；保留 API 原有的最後管理者警告契約。 */
type DeactivationPreview = DeactivationCheck & {
  reassignment_projects: DeactivationCheck['last_manager_projects']
}

/** ADM-R33：整合既有查詢，讓一般成員也能直接前往參與專案改派。 */
async function loadDeactivationPreview(
  userId: string,
): Promise<DeactivationPreview> {
  const [check, projects] = await Promise.all([
    getDeactivationCheck(userId),
    getUserParticipatingProjects(userId),
  ])
  return { ...check, reassignment_projects: projects }
}

/** 每個帳號兩個查詢；限制六個帳號，避免批次預覽壓滿連線。 */
async function loadBatchDeactivationPreviews(users: User[]) {
  const previews: DeactivationPreview[] = new Array(users.length)
  let next = 0
  let failed = false
  let failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(6, users.length) }, async () => {
      while (!failed && next < users.length) {
        const index = next++
        try {
          previews[index] = await loadDeactivationPreview(users[index].id)
        } catch (caught) {
          failed = true
          failure = caught
        }
      }
    }),
  )
  // 等在途工作收尾後才回報；任何失敗都不交付部分確認資料。
  if (failed) throw failure
  return previews
}

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
  kind: 'admin' | 'deactivate' | 'activate' | 'reset'
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
  onTemporaryPassword: (
    username: string,
    password: string,
    source?: 'created' | 'reset',
    displayName?: string,
  ) => void
  detailUserId?: string | null
  initialQuery?: string
  hideCreateForm?: boolean
  externalNavigationGuard?: boolean
  onQueryApplied?: (query: string) => void
  onDirtyChange?: (dirty: boolean) => void
  onSelectUser?: (id: string) => void
}) {
  const { user: currentUser } = useCurrentUser()
  const location = useLocation()
  const navigate = useNavigate()
  const editExpiryRequested =
    new URLSearchParams(location.search).get('edit') === 'expiry'
  const consumedExpiryRequest = useRef('')
  const [expiryEditorUser, setExpiryEditorUser] = useState<string | null>(null)
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
  const companyListLoaded = useRef(false)
  const companyListRequest = useRef<Promise<void> | null>(null)
  const [detailUser, setDetailUser] = useState<User | null>(null)
  const [detailError, setDetailError] = useState('')
  // 詳情更新只同步快照；若把 detailUser 放入載入依賴，儲存與重查
  // 會再次載入並重掛表單，清掉使用者正在編輯的內容。
  const detailSnapshot = useRef<User | null>(null)
  useEffect(() => {
    detailSnapshot.current = detailUser
  }, [detailUser])
  const detailRequest = useRef<{
    id: string
    promise: Promise<UserDetail>
  } | null>(null)
  const [passwordResetError, setPasswordResetError] = useState<{
    userId: string
    message: string
  } | null>(null)
  const [externalNoProject, setExternalNoProject] = useState<User[]>([])
  const [unmanagedProjects, setUnmanagedProjects] = useState<
    UnmanagedProject[]
  >([])
  const [lifecycleLoaded, setLifecycleLoaded] = useState(false)
  const [lifecycleLoading, setLifecycleLoading] = useState(false)
  const [lifecycleError, setLifecycleError] = useState('')
  const [lifecycleInteractive, setLifecycleInteractive] = useState(false)
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
  const [actionNotice, setActionNotice] = useState<{
    userId: string
    message: string
  } | null>(null)
  const [actionPreview, setActionPreview] = useState<
    DeactivationPreview | RestorePreview | null
  >(null)
  const [previewError, setPreviewError] = useState('')
  const [selectedBatchUserIds, setSelectedBatchUserIds] = useState<string[]>(
    [],
  )
  const [batchDeactivationLoading, setBatchDeactivationLoading] =
    useState(false)
  const [batchDeactivationBusy, setBatchDeactivationBusy] = useState(false)
  const [batchDeactivationError, setBatchDeactivationError] = useState('')
  const [batchDeactivationNotice, setBatchDeactivationNotice] = useState('')
  const [batchDeactivationPreview, setBatchDeactivationPreview] = useState<{
    users: User[]
    projects: DeactivationCheck['last_manager_projects']
    reassignmentProjects: DeactivationCheck['last_manager_projects']
  } | null>(null)
  const [batchActivationLoading, setBatchActivationLoading] = useState(false)
  const [batchActivationBusy, setBatchActivationBusy] = useState(false)
  const [batchActivationError, setBatchActivationError] = useState('')
  const [batchActivationNotice, setBatchActivationNotice] = useState('')
  const [batchActivationPreview, setBatchActivationPreview] = useState<{
    users: User[]
    previews: RestorePreview[]
  } | null>(null)
  const [batchRestoreSelections, setBatchRestoreSelections] = useState<
    Record<string, RestorePreviewSelection>
  >({})
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
    // 路由替換仍指向同一帳號時沿用快照，避免重複 GET 與表單重掛。
    if (detailSnapshot.current?.id === detailUserId) return
    let active = true
    setDetailUser((current) => (current?.id === detailUserId ? current : null))
    setDetailError('')
    // 清單初次清空亦會更新 users；同一筆在途詳情可由新 effect 接手。
    if (detailRequest.current?.id !== detailUserId) {
      const promise = request<UserDetail>(
        `/users/${encodeURIComponent(detailUserId)}`,
      )
      detailRequest.current = { id: detailUserId, promise }
    }
    const pending = detailRequest.current
    void pending.promise
      .then((user) => active && setDetailUser(user))
      .catch((caught: unknown) => {
        if (active) setDetailError(managementErrorMessage(caught))
      })
      .finally(() => {
        if (detailRequest.current === pending) detailRequest.current = null
      })
    return () => {
      active = false
    }
  }, [detailUserId, users])

  useEffect(() => {
    // 到期日捷徑只消費網址；replace 不得重載詳情或重掛表單（#741）。
    if (
      !detailUser ||
      detailUser.id !== detailUserId ||
      !editExpiryRequested ||
      consumedExpiryRequest.current === location.key
    )
      return
    consumedExpiryRequest.current = location.key
    setExpiryEditorUser(detailUser.id)
    setEditingUser(detailUser.id)
    const params = new URLSearchParams(location.search)
    params.delete('edit')
    navigate(
      {
        pathname: location.pathname,
        search: params.toString(),
        hash: location.hash,
      },
      { replace: true, state: location.state, preventScrollReset: true },
    )
  }, [detailUser, detailUserId, editExpiryRequested, location, navigate])

  useEffect(() => {
    // T3：清單結果不屬於詳情或另一頁，不能隨共用頁面狀態留下。
    setBatchDeactivationError('')
    setBatchDeactivationNotice('')
    setBatchActivationError('')
    setBatchActivationNotice('')
    setBatchActivationPreview(null)
    setBatchDeactivationPreview(null)
    setSelectedBatchUserIds([])
  }, [detailUserId, location.key, appliedQuery])

  useEffect(() => {
    if (!pendingAction || ['admin', 'reset'].includes(pendingAction.kind)) {
      setActionPreview(null)
      return
    }
    let active = true
    setPreviewError('')
    setActionPreview(null)
    if (pendingAction.kind === 'deactivate') {
      void loadDeactivationPreview(pendingAction.user.id)
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
    if (companyListLoaded.current) return
    if (companyListRequest.current) return companyListRequest.current
    const id = ++companyRequestId.current
    setCompanyListError('')
    const companyOptionsRequest = listCompanies()
      .then((nextCompanies) => {
        if (id === companyRequestId.current) {
          setCompanies(nextCompanies)
          companyListLoaded.current = true
        }
      })
      .catch((caught: unknown) => {
        if (id === companyRequestId.current)
          setCompanyListError(managementErrorMessage(caught))
      })
      .finally(() => {
        if (id === companyRequestId.current) companyListRequest.current = null
      })
    companyListRequest.current = companyOptionsRequest
    return companyOptionsRequest
  }, [])

  const loadLifecycleLists = useCallback(async (interactive = false) => {
    setLifecycleInteractive(interactive)
    setLifecycleLoading(true)
    setLifecycleError('')
    try {
      const [externalUsers, projects] = await Promise.all([
        listExternalUsersWithoutProject(),
        listUnmanagedProjects(),
      ])
      setExternalNoProject(externalUsers)
      setUnmanagedProjects(projects)
      setLifecycleLoaded(true)
    } catch (caught) {
      setLifecycleError(managementErrorMessage(caught))
    } finally {
      setLifecycleLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!detailUserId) void loadLifecycleLists()
  }, [detailUserId, loadLifecycleLists])

  useEffect(() => {
    return () => {
      companyRequestId.current += 1
    }
  }, [loadCompanies])

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

  async function resetTemporaryPassword(user: User) {
    if (busyUser !== null || user.id === currentUser.id) return
    setPasswordResetError(null)
    setBusyUser(user.id)
    try {
      const result = await resetUserTemporaryPassword(user.id)
      onTemporaryPassword(
        user.username,
        result.temporary_password,
        'reset',
        user.name_zh || user.username,
      )
    } catch (caught) {
      setPasswordResetError({
        userId: user.id,
        message: managementErrorMessage(caught),
      })
    } finally {
      setBusyUser(null)
    }
  }

  async function prepareBatchDeactivation() {
    clearBatchMessages()
    const selected = users.filter(
      (user) =>
        selectedBatchUserIds.includes(user.id) && user.id !== currentUser.id,
    )
    if (selected.length === 0 || batchDeactivationLoading) return
    setBatchDeactivationError('')
    setBatchDeactivationNotice('')
    setBatchDeactivationLoading(true)
    try {
      const checks = await loadBatchDeactivationPreviews(selected)
      const projects = new Map<
        string,
        DeactivationCheck['last_manager_projects'][number]
      >()
      const reassignmentProjects = new Map<
        string,
        DeactivationCheck['last_manager_projects'][number]
      >()
      checks.forEach((check) => {
        check.reassignment_projects.forEach((project) =>
          reassignmentProjects.set(project.id, project),
        )
        check.last_manager_projects.forEach((project) =>
          projects.set(project.id, project),
        )
      })
      setBatchDeactivationPreview({
        users: selected,
        projects: [...projects.values()],
        reassignmentProjects: [...reassignmentProjects.values()],
      })
    } catch (caught) {
      setBatchDeactivationError(managementErrorMessage(caught))
    } finally {
      setBatchDeactivationLoading(false)
    }
  }

  async function confirmBatchDeactivation() {
    clearBatchMessages()
    if (!batchDeactivationPreview || batchDeactivationBusy) return
    setBatchDeactivationBusy(true)
    setBatchDeactivationError('')
    try {
      await setUsersActiveStatus({
        user_ids: batchDeactivationPreview.users.map((user) => user.id),
        is_active: false,
      })
      setBatchDeactivationNotice(
        `已停用 ${batchDeactivationPreview.users.length} 個帳號。`,
      )
      setSelectedBatchUserIds([])
      setBatchDeactivationPreview(null)
      await reload()
    } catch (caught) {
      setBatchDeactivationError(managementErrorMessage(caught))
    } finally {
      setBatchDeactivationBusy(false)
    }
  }

  async function prepareBatchActivation() {
    clearBatchMessages()
    const selected = users.filter((user) =>
      selectedBatchUserIds.includes(user.id),
    )
    if (
      selected.length === 0 ||
      selected.some((user) => user.is_active || user.is_system) ||
      batchActivationLoading
    )
      return
    setBatchActivationError('')
    setBatchActivationNotice('')
    setBatchActivationLoading(true)
    try {
      const previews = await Promise.all(
        selected.map((user) => getReactivationPreview(user.id)),
      )
      setBatchActivationPreview({ users: selected, previews })
      setBatchRestoreSelections(
        Object.fromEntries(
          previews.map((preview) => [
            preview.user_id,
            emptyRestorePreviewSelection(),
          ]),
        ),
      )
    } catch (caught) {
      setBatchActivationError(managementErrorMessage(caught))
    } finally {
      setBatchActivationLoading(false)
    }
  }

  async function confirmBatchActivation() {
    clearBatchMessages()
    if (!batchActivationPreview || batchActivationBusy) return
    const expiredIds = new Set(
      batchActivationPreview.previews
        .filter((preview) => preview.account_expired)
        .map((preview) => preview.user_id),
    )
    const selected = batchActivationPreview.users.filter(
      (user) => !expiredIds.has(user.id),
    )
    if (!selected.length) return
    const restore = selected.map((user) => ({
      user_id: user.id,
      restore:
        batchRestoreSelections[user.id] ?? emptyRestorePreviewSelection(),
    }))
    setBatchActivationBusy(true)
    setBatchActivationError('')
    try {
      await setUsersActiveStatus({
        user_ids: selected.map((user) => user.id),
        is_active: true,
        restore,
      })
      setBatchActivationNotice(`已啟用 ${selected.length} 個帳號。`)
      setSelectedBatchUserIds([])
      setBatchActivationPreview(null)
      await reload()
    } catch (caught) {
      setBatchActivationError(managementErrorMessage(caught))
    } finally {
      setBatchActivationBusy(false)
    }
  }

  // #727：新操作不能沿用另一種批次操作的成功或失敗訊息。
  function clearBatchMessages() {
    setBatchDeactivationError('')
    setBatchDeactivationNotice('')
    setBatchActivationError('')
    setBatchActivationNotice('')
  }

  function cancelBatchDeactivation() {
    setBatchDeactivationPreview(null)
    clearBatchMessages()
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
    if (kind === 'reset') {
      await resetTemporaryPassword(user)
      setPendingAction(null)
      return
    }
    setActionError('')
    if (kind === 'admin' && user.is_admin && user.id === currentUser.id) {
      setBusyUser(user.id)
      try {
        await setUserAdmin(user.id, false)
        setPendingAction(null)
        // 落點交給 HomeRedirect 依存取摘要決定（F-O04）：這個人收回後
        // 不一定有現場權限，導回首頁由權限落點決定。
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
        setActionNotice({
          userId: user.id,
          message: `${user.name_zh || user.username} 已停用。`,
        })
      } else {
        const updated = await reactivateUser(user.id, restoreSelection)
        setDetailUser((current) =>
          current?.id === user.id ? updated : current,
        )
        setActionNotice({
          userId: user.id,
          message: `${user.name_zh || user.username} 已重新啟用。`,
        })
      }
      setPendingAction(null)
      setEditingUser(null)
      setEditingCompany(null)
      await reload()
      if (lifecycleLoaded) await loadLifecycleLists()
    } catch (caught) {
      setActionError(managementErrorMessage(caught))
    } finally {
      setBusyUser(null)
    }
  }

  function actionMessage({ user, kind }: PendingAction): string {
    const name = user.name_zh || user.username
    if (kind === 'reset') {
      return [
        `重設${name}（${user.username}）的密碼後，`,
        '他目前的密碼與登入狀態會立刻失效；',
        '你會拿到一組只顯示一次的臨時密碼，他下次登入必須改密碼。',
      ].join('')
    }
    if (kind === 'activate') {
      return `重新啟用${name}（${user.username}）後，他可以再次登入。`
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
    setPreviewError('')
    setActionPreview(null)
    setPendingAction({ user, kind })
  }

  // 確認框的顏色看動作的效果：立刻拿掉他人權限或登入（停用、收回管理者）
  // 用紅色；授予或恢復（啟用、指派管理者）用一般主色。管理者身分只影響
  // 「管理者」動作，不影響啟用與停用。
  function confirmVariant({ user, kind }: PendingAction) {
    if (kind === 'deactivate' || kind === 'reset') return 'danger'
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

  function created(user: {
    username: string
    temporary_password: string
    name_zh?: string | null
  }) {
    setDirtyForms({})
    onTemporaryPassword(
      user.username,
      user.temporary_password,
      'created',
      user.name_zh || user.username,
    )
    void reload()
    void loadCompanies()
  }

  const expiredBatchUsers =
    batchActivationPreview?.users.filter((user) =>
      batchActivationPreview.previews.some(
        (preview) => preview.user_id === user.id && preview.account_expired,
      ),
    ) ?? []
  const eligibleBatchCount =
    (batchActivationPreview?.users.length ?? 0) - expiredBatchUsers.length

  const detail = detailUserId ? detailUser : null

  // 在「帳號」頁（有 onSelectUser）裡，頁面標題已是「帳號」，清單不再
  // 重複標題；連結到詳情的列也沒有操作欄，只有四欄（#713）。
  const embeddedList = Boolean(onSelectUser)
  const listColumnCount = embeddedList ? 5 : 7

  return (
    <section
      aria-label={
        !detailUserId && embeddedList ? `${ACCOUNT_LABEL}清單` : undefined
      }
      aria-labelledby={
        detailUserId
          ? 'person-basic-heading'
          : embeddedList
            ? undefined
            : 'users-heading'
      }
    >
      {!externalNavigationGuard && (
        <UsersNavigationGuard hasUnsavedChanges={hasDirtyForms} />
      )}
      {detailUserId ? (
        <section aria-labelledby="person-basic-heading">
          {detailError && <p role="alert">{detailError}</p>}
          {!detail && !detailError && <p role="status">載入中…</p>}
          {detail && (
            <>
              <h1 id="person-basic-heading">
                {detail.name_zh || detail.username}
              </h1>
              <p>帳號：{detail.username}</p>
              {detail.is_external_collaborator && <p>外部協作人員</p>}
              <p>電子郵件：{detail.email || '未填寫'}</p>
              <p>公司：{companyLabel(detail, companies)}</p>
              <p>狀態：{detail.is_active ? '啟用中' : '已停用'}</p>
              <div className="account-detail-actions">
                <button
                  disabled={detail.is_system || detail.auth_source !== 'local'}
                  onClick={() => {
                    setExpiryEditorUser(null)
                    setEditingUser(detail.id)
                  }}
                  type="button"
                >
                  修改資料
                </button>
                <button
                  disabled={detail.is_system || detail.auth_source !== 'local'}
                  onClick={() => {
                    setEditingCompany(detail.id)
                    void loadCompanies()
                  }}
                  type="button"
                >
                  修改公司連結
                </button>
                <button
                  disabled={detail.is_system || busyUser !== null}
                  onClick={() => toggleAdmin(detail)}
                  type="button"
                >
                  {detail.is_admin ? '收回管理者' : '指派管理者'}
                </button>
                <button
                  className={detail.is_active ? 'btn-danger' : undefined}
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
                <button
                  disabled={
                    detail.is_system ||
                    detail.id === currentUser.id ||
                    detail.auth_source !== 'local' ||
                    busyUser !== null
                  }
                  onClick={() => requestAction(detail, 'reset')}
                  type="button"
                >
                  {busyUser === detail.id
                    ? '正在重設臨時密碼…'
                    : '重設臨時密碼'}
                </button>
              </div>
              {detail.id === currentUser.id && (
                <p className="field-hint">請到設定變更自己的密碼。</p>
              )}
              {passwordResetError?.userId === detail.id && (
                <Notice variant="error">{passwordResetError.message}</Notice>
              )}
              {actionNotice?.userId === detail.id && (
                <Notice>{actionNotice.message}</Notice>
              )}
              {pendingAction?.user.id === detail.id && (
                <ConfirmBox
                  busy={busyUser === detail.id}
                  confirmDisabled={
                    !['admin', 'reset'].includes(pendingAction.kind) &&
                    (!actionPreview ||
                      Boolean(previewError) ||
                      (pendingAction.kind === 'activate' &&
                        'account_expired' in actionPreview &&
                        actionPreview.account_expired))
                  }
                  key={`${detail.id}:${pendingAction.kind}`}
                  confirmLabel={
                    pendingAction.kind === 'reset'
                      ? '確認重設'
                      : pendingAction.kind === 'deactivate'
                        ? '確認停用帳號'
                        : '確認'
                  }
                  label="操作確認"
                  onCancel={cancelPendingAction}
                  onConfirm={confirmAction}
                  role="region"
                  revealRequest={actionPreview ? 1 : 0}
                  rootRef={confirmationRef}
                  variant={confirmVariant(pendingAction)}
                >
                  {pendingAction.kind === 'deactivate' && (
                    <h2>停用 1 個帳號？</h2>
                  )}
                  <p>
                    {pendingAction.kind === 'deactivate'
                      ? deactivationAccountText(pendingAction.user)
                      : actionMessage(pendingAction)}
                  </p>
                  {pendingAction.kind === 'deactivate' && (
                    <DeactivationConsequences />
                  )}
                  {previewError && (
                    <Notice variant="error">{previewError}</Notice>
                  )}
                  {actionError && (
                    <Notice variant="error">{actionError}</Notice>
                  )}
                  {pendingAction.kind === 'deactivate' &&
                    actionPreview &&
                    'last_manager_projects' in actionPreview && (
                      <>
                        <DeactivationWarning
                          projects={actionPreview.last_manager_projects}
                        />
                        <DeactivationReassignmentLinks
                          projects={actionPreview.reassignment_projects}
                        />
                      </>
                    )}
                  {pendingAction.kind === 'activate' &&
                    actionPreview &&
                    'permission_codes' in actionPreview && (
                      <RestoreChoices
                        preview={actionPreview}
                        name={
                          pendingAction.user.name_zh ??
                          pendingAction.user.username
                        }
                        selection={restoreSelection}
                        onChange={setRestoreSelection}
                      />
                    )}
                </ConfirmBox>
              )}
              {editingUser === detail.id && (
                <UserDetailsForm
                  focusExpiry={expiryEditorUser === detail.id}
                  busy={busyUser !== null}
                  error={rowError(detail.id, 'details')}
                  errorFocusRequest={saveError?.request}
                  onCancel={() => {
                    setExpiryEditorUser(null)
                    setEditingUser(null)
                  }}
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
                <>
                  {companyListError && (
                    <div>
                      <p role="alert">公司清單載入失敗：{companyListError}</p>
                      <button
                        onClick={() => void loadCompanies()}
                        type="button"
                      >
                        重新載入公司清單
                      </button>
                    </div>
                  )}
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
                </>
              )}
            </>
          )}
        </section>
      ) : null}
      {!detailUserId && (
        <>
          {(externalNoProject.length > 0 || unmanagedProjects.length > 0) && (
            <details>
              <summary>
                提醒：
                {externalNoProject.length > 0 &&
                  `無專案外部協作帳號 ${externalNoProject.length} 個`}
                {externalNoProject.length > 0 && unmanagedProjects.length > 0
                  ? '；'
                  : ''}
                {unmanagedProjects.length > 0 &&
                  `沒有管理成員的專案 ${unmanagedProjects.length} 個`}
                {'；查看'}
              </summary>
              {externalNoProject.length > 0 && (
                <section aria-label="沒有參與專案的外部協作帳號">
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
                </section>
              )}
              {unmanagedProjects.length > 0 && (
                <section aria-label="沒有啟用管理成員的專案">
                  <ul>
                    {unmanagedProjects.map((project) => (
                      <li key={project.id}>
                        <Link to={`/projects/${project.id}/members`}>
                          {project.project_code}／{project.name}（
                          {project.member_count} 位成員）
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </details>
          )}
          {lifecycleError && (
            <div>
              <Notice variant="error" autoReveal={lifecycleInteractive}>
                {lifecycleError}
              </Notice>
              <button
                disabled={lifecycleLoading}
                onClick={() => void loadLifecycleLists(true)}
                type="button"
              >
                重試
              </button>
            </div>
          )}
          {loading ? <p>載入中…</p> : null}
          <div>
            {!embeddedList && <h1 id="users-heading">{ACCOUNT_LABEL}清單</h1>}
            <CursorListSearch
              disabled={loading}
              label={`搜尋${ACCOUNT_LABEL}`}
              onQueryChange={setQuery}
              onSearch={(event) => {
                event.preventDefault()
                clearBatchMessages()
                setSelectedBatchUserIds([])
                void search(query).then(() => onQueryApplied?.(query.trim()))
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
                      void clearSearch().then(() => {
                        clearBatchMessages()
                        setSelectedBatchUserIds([])
                        onQueryApplied?.('')
                      })
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
                <table
                  className={onSelectUser ? 'users-account-table' : undefined}
                >
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="visually-hidden">選取</span>
                      </th>
                      <th scope="col">姓名</th>
                      <th scope="col">帳號</th>
                      <th scope="col">公司</th>
                      <th scope="col">狀態</th>
                      {!embeddedList && (
                        <>
                          <th scope="col">系統管理者</th>
                          <th scope="col">操作</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <Fragment key={user.id}>
                        <tr>
                          <td data-label="選取">
                            <input
                              aria-label={`選取 ${user.username}`}
                              checked={selectedBatchUserIds.includes(user.id)}
                              disabled={
                                user.is_system ||
                                user.id === currentUser.id ||
                                batchDeactivationBusy ||
                                batchActivationBusy
                              }
                              onChange={(event) =>
                                setSelectedBatchUserIds((current) =>
                                  event.target.checked
                                    ? [...current, user.id]
                                    : current.filter((id) => id !== user.id),
                                )
                              }
                              type="checkbox"
                              value={user.id}
                              aria-describedby={
                                user.id === currentUser.id
                                  ? `self-batch-${user.id}`
                                  : undefined
                              }
                            />
                            {user.id === currentUser.id && (
                              <p
                                className="field-hint"
                                id={`self-batch-${user.id}`}
                              >
                                不能批次停用自己的帳號。
                              </p>
                            )}
                          </td>
                          <th scope="row">
                            {onSelectUser ? (
                              <Link
                                className="users-account-name-link"
                                to={
                                  '/accounts/' +
                                  encodeURIComponent(user.id) +
                                  location.search
                                }
                              >
                                {user.name_zh || user.username}
                              </Link>
                            ) : (
                              user.name_zh || user.username
                            )}
                          </th>
                          <td data-label="帳號">{user.username}</td>
                          <td data-label="公司">
                            {companyLabel(user, companies)}
                          </td>
                          <td data-label="狀態">
                            <StatusBadge
                              status={activeStatus(user.is_active)}
                            />
                          </td>
                          {!embeddedList && (
                            <td>
                              <button
                                disabled={
                                  user.is_system ||
                                  user.auth_source !== 'local'
                                }
                                onClick={() => {
                                  setSaveError(null)
                                  setExpiryEditorUser(null)
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
                                  user.is_system ||
                                  user.auth_source !== 'local'
                                }
                                onClick={() => {
                                  setSaveError(null)
                                  setEditingCompany(
                                    editingCompany === user.id
                                      ? null
                                      : user.id,
                                  )
                                  if (editingCompany !== user.id)
                                    void loadCompanies()
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
                          )}
                        </tr>
                        {!onSelectUser &&
                          pendingAction?.user.id === user.id && (
                            <tr className="row-detail">
                              <td colSpan={listColumnCount}>
                                <ConfirmBox
                                  busy={busyUser === user.id}
                                  confirmDisabled={
                                    !['admin', 'reset'].includes(
                                      pendingAction.kind,
                                    ) &&
                                    (!actionPreview ||
                                      Boolean(previewError) ||
                                      (pendingAction.kind === 'activate' &&
                                        'account_expired' in actionPreview &&
                                        actionPreview.account_expired))
                                  }
                                  key={`${user.id}:${pendingAction.kind}`}
                                  confirmLabel={
                                    pendingAction.kind === 'reset'
                                      ? '確認重設'
                                      : pendingAction.kind === 'deactivate'
                                        ? '確認停用帳號'
                                        : '確認'
                                  }
                                  label="操作確認"
                                  onCancel={cancelPendingAction}
                                  onConfirm={confirmAction}
                                  role="region"
                                  revealRequest={actionPreview ? 1 : 0}
                                  rootRef={confirmationRef}
                                  variant={confirmVariant(pendingAction)}
                                >
                                  {pendingAction.kind === 'deactivate' && (
                                    <h2>停用 1 個帳號？</h2>
                                  )}
                                  <p>
                                    {pendingAction.kind === 'deactivate'
                                      ? deactivationAccountText(
                                          pendingAction.user,
                                        )
                                      : actionMessage(pendingAction)}
                                  </p>
                                  {pendingAction.kind === 'deactivate' && (
                                    <DeactivationConsequences />
                                  )}
                                  {previewError && (
                                    <Notice variant="error">
                                      {previewError}
                                    </Notice>
                                  )}
                                  {pendingAction.kind === 'deactivate' &&
                                    actionPreview &&
                                    'last_manager_projects' in
                                      actionPreview && (
                                      <>
                                        <DeactivationWarning
                                          projects={
                                            actionPreview.last_manager_projects
                                          }
                                        />
                                        <DeactivationReassignmentLinks
                                          projects={
                                            actionPreview.reassignment_projects
                                          }
                                        />
                                      </>
                                    )}
                                  {pendingAction.kind === 'activate' &&
                                    actionPreview &&
                                    'permission_codes' in actionPreview && (
                                      <RestoreChoices
                                        preview={actionPreview}
                                        name={
                                          pendingAction.user.name_zh ??
                                          pendingAction.user.username
                                        }
                                        selection={restoreSelection}
                                        onChange={setRestoreSelection}
                                      />
                                    )}
                                  {actionError && (
                                    <Notice variant="error">
                                      {actionError}
                                    </Notice>
                                  )}
                                </ConfirmBox>
                              </td>
                            </tr>
                          )}
                        {!onSelectUser &&
                          (editingUser === user.id ||
                            editingCompany === user.id) && (
                            <tr className="row-detail">
                              <td colSpan={listColumnCount}>
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
                onClick={() => {
                  clearBatchMessages()
                  void loadMore()
                }}
                type="button"
              >
                {loadingMore ? '載入中…' : '載入更多'}
              </button>
            )}
            {users.length > 0 && !detailUserId && (
              <BatchActionBar
                label="批次帳號操作"
                actions={
                  <>
                    <p>已選取 {selectedBatchUserIds.length} 個帳號。</p>
                    <button
                      disabled={
                        selectedBatchUserIds.length === 0 ||
                        users
                          .filter((user) =>
                            selectedBatchUserIds.includes(user.id),
                          )
                          .some((user) => !user.is_active || user.is_system) ||
                        batchDeactivationLoading ||
                        batchDeactivationBusy ||
                        batchActivationBusy
                      }
                      onClick={() => void prepareBatchDeactivation()}
                      type="button"
                    >
                      {batchDeactivationLoading
                        ? '正在檢查帳號…'
                        : '批次停用帳號'}
                    </button>
                    {selectedBatchUserIds.length > 0 &&
                      users
                        .filter((user) =>
                          selectedBatchUserIds.includes(user.id),
                        )
                        .every(
                          (user) => !user.is_active && !user.is_system,
                        ) && (
                        <button
                          disabled={
                            batchActivationLoading || batchActivationBusy
                          }
                          onClick={() => void prepareBatchActivation()}
                          type="button"
                        >
                          {batchActivationLoading
                            ? '正在載入恢復項目…'
                            : '批次啟用帳號'}
                        </button>
                      )}
                  </>
                }
                feedback={
                  <>
                    {batchDeactivationError && (
                      <Notice variant="error">{batchDeactivationError}</Notice>
                    )}
                    {batchDeactivationNotice && (
                      <Notice>{batchDeactivationNotice}</Notice>
                    )}
                    {batchActivationError && (
                      <Notice variant="error">{batchActivationError}</Notice>
                    )}
                    {batchActivationNotice && (
                      <Notice>{batchActivationNotice}</Notice>
                    )}
                  </>
                }
                confirmation={
                  <>
                    {batchActivationPreview && (
                      <ConfirmBox
                        busy={batchActivationBusy}
                        confirmDisabled={eligibleBatchCount === 0}
                        confirmLabel={
                          batchActivationBusy
                            ? '正在啟用帳號…'
                            : expiredBatchUsers.length
                              ? `確認啟用其餘 ${eligibleBatchCount} 個帳號`
                              : '確認啟用帳號'
                        }
                        label="批次啟用確認"
                        onCancel={() => {
                          setBatchActivationPreview(null)
                          clearBatchMessages()
                        }}
                        onConfirm={confirmBatchActivation}
                        role="region"
                      >
                        {expiredBatchUsers.length > 0 && (
                          <div className="notice-warning" role="status">
                            <p>
                              {expiredBatchUsers.length} 個外部帳號已過到期日，
                              這次不會啟用：
                              {expiredBatchUsers
                                .map((user) => user.name_zh || user.username)
                                .join('、')}
                            </p>
                            <ul>
                              {expiredBatchUsers.map((user) => (
                                <li key={user.id}>
                                  <Link
                                    to={`/accounts/${user.id}?edit=expiry`}
                                  >
                                    改到期日：{user.name_zh || user.username}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {eligibleBatchCount > 0 && (
                          <p>
                            請逐一確認每個帳號要恢復的權限、成員身分與未完成任務。
                          </p>
                        )}
                        {batchActivationPreview.previews
                          .filter((preview) => !preview.account_expired)
                          .map((preview) => (
                            <RestoreChoices
                              key={preview.user_id}
                              name={
                                batchActivationPreview.users.find(
                                  (user) => user.id === preview.user_id,
                                )?.name_zh ?? preview.username
                              }
                              preview={preview}
                              selection={
                                batchRestoreSelections[preview.user_id] ??
                                emptyRestorePreviewSelection()
                              }
                              disabled={batchActivationBusy}
                              onChange={(selection) =>
                                setBatchRestoreSelections((current) => ({
                                  ...current,
                                  [preview.user_id]: selection,
                                }))
                              }
                            />
                          ))}
                      </ConfirmBox>
                    )}
                    {batchDeactivationPreview && (
                      <ConfirmBox
                        busy={batchDeactivationBusy}
                        confirmLabel={
                          batchDeactivationBusy
                            ? '正在停用帳號…'
                            : '確認停用帳號'
                        }
                        label="批次停用確認"
                        onCancel={cancelBatchDeactivation}
                        onConfirm={confirmBatchDeactivation}
                        role="region"
                        variant="danger"
                      >
                        <h2>
                          停用 {batchDeactivationPreview.users.length} 個帳號？
                        </h2>
                        <DeactivationConsequences
                          count={batchDeactivationPreview.users.length}
                        />
                        <DeactivationReassignmentLinks
                          projects={
                            batchDeactivationPreview.reassignmentProjects
                          }
                        />
                        <p>要停用的帳號：</p>
                        <ul aria-label="要停用的帳號">
                          {batchDeactivationPreview.users.map((user) => (
                            <li key={user.id}>
                              {user.name_zh || user.username}（{user.username}
                              ）
                            </li>
                          ))}
                        </ul>
                        {batchDeactivationPreview.projects.length > 0 && (
                          <div>
                            <p>
                              停用後下列專案將沒有啟用中的管理成員；請先安排接手者。
                            </p>
                            <ul>
                              {batchDeactivationPreview.projects.map(
                                (project) => (
                                  <li key={project.id}>
                                    <Link
                                      to={`/projects/${project.id}/planning`}
                                    >
                                      {project.project_code}／{project.name}
                                    </Link>
                                  </li>
                                ),
                              )}
                            </ul>
                          </div>
                        )}
                      </ConfirmBox>
                    )}
                  </>
                }
              />
            )}
          </div>
          {!hideCreateForm && (
            <UserForm
              companies={companies}
              onCompanyOptionsRequested={() => void loadCompanies()}
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
  const name =
    user.company_name ??
    companies.find((company) => company.id === user.company_id)?.name
  if (!user.company_id) {
    return '未連結'
  }
  if (!name) return '已連結公司'
  return user.department ? `${name}／${user.department}` : name
}

/** 讓 Admin 對預覽中的資料逐項選擇，避免整包復原過期授權。 */
function RestoreChoices({
  preview,
  name,
  selection,
  onChange,
  disabled = false,
}: {
  disabled?: boolean
  name: string
  preview: RestorePreview
  selection: {
    permission_codes: string[]
    delegated_modules: string[]
    project_ids: string[]
    task_ids: string[]
  }
  onChange: (value: typeof selection) => void
}) {
  const hasRestorableContent =
    preview.permission_codes.length > 0 ||
    preview.delegated_modules.length > 0 ||
    preview.project_memberships.length > 0 ||
    preview.tasks.length > 0

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
    <fieldset disabled={disabled || preview.account_expired}>
      <legend>
        {name || preview.username}（{preview.username}）
      </legend>
      {preview.account_expired && (
        <p role="alert">外部帳號已到期，請先修改到期日後再重新啟用。</p>
      )}
      {!hasRestorableContent ? (
        <p>這個帳號沒有需要恢復的權限或專案。</p>
      ) : (
        <>
          {preview.permission_codes.length > 0 && (
            <section>
              <h4>選擇要恢復的權限</h4>
              {preview.permission_codes.map((code) => (
                <label key={code}>
                  <input
                    checked={selection.permission_codes.includes(code)}
                    onChange={() => toggle('permission_codes', code)}
                    type="checkbox"
                  />
                  {permissionCodeContract.codes
                    .find((item) => item.code === code)
                    ?.description.replace('模組', '功能') ?? '其他功能'}
                </label>
              ))}
            </section>
          )}
          {preview.delegated_modules.length > 0 && (
            <section>
              <h4>選擇要恢復的委派範圍</h4>
              {preview.delegated_modules.map((module) => (
                <label key={module}>
                  <input
                    checked={selection.delegated_modules.includes(module)}
                    onChange={() => toggle('delegated_modules', module)}
                    type="checkbox"
                  />
                  {{ project: '專案', inspection: '查核', template: '範本' }[
                    module
                  ] ?? '其他'}
                  權限管理
                </label>
              ))}
            </section>
          )}
          {preview.project_memberships.length > 0 && (
            <section>
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
            </section>
          )}
          {preview.tasks.length > 0 && (
            <section>
              <h4>選擇要保留的未完成任務建議指派</h4>
              {preview.tasks.map((task) => (
                <label key={task.task_id}>
                  <input
                    checked={selection.task_ids.includes(task.task_id)}
                    onChange={() => toggle('task_ids', task.task_id)}
                    type="checkbox"
                  />
                  {task.name}（
                  {STATUS_BADGES[task.status as BadgeStatus]?.label ??
                    '未完成'}
                  ）
                </label>
              ))}
            </section>
          )}
        </>
      )}
    </fieldset>
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
  focusExpiry = false,
  user,
  busy,
  error,
  errorFocusRequest,
  onCancel,
  onSave,
  onDirtyChange,
}: {
  focusExpiry?: boolean
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
  const expiryRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusExpiry) return
    revealElement(expiryRef.current)
    expiryRef.current?.focus({ preventScroll: true })
  }, [focusExpiry])
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
                ref={expiryRef}
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
