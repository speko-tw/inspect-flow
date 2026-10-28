import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import {
  Link,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
} from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { isForbidden } from '../../http'
import { BackLink } from '../../layout/BackLink'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { UnsavedLeaveBox } from '../../ui/navigation'
import * as navigationGuard from '../../ui/navigation'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { revealElement } from '../../ui/reveal'
import { ManagementApiError, managementErrorMessage } from '../api'
import { isResourceId } from '../../resourceId'
import { RequiredMark } from '../../ui/Form'
import { ACCOUNT_LABEL } from '../../layout/navigationLabels'
import MemberRoleFields from './MemberRoleFields'
import {
  addProjectMember,
  getProject,
  listAssignableRoles,
  listMemberCandidates,
  listProjectMembers,
  personLabel,
  removeProjectMember,
  setProjectMemberRoles,
  setProjectMemberRolesBatch,
  type MemberCandidate,
  type Project,
  type ProjectMember,
  type Role,
} from './api'
import './ProjectMembers.css'

// ADM-R20：加入成員與取代角色集合至少要一個角色，後端以這個錯誤碼回
// 422；資料層仍允許沒有角色的舊成員（DOM-R36），所以只有 API 會擋。
const ROLES_REQUIRED_CODE = 'project.member_roles_required'
const ROLES_REQUIRED_TEXT = '請至少選一個角色。'

// 訊息只顯示在發生的地方，並在下一次操作前清掉，不殘留舊訊息。
type Scope = 'add' | 'edit' | 'remove'

function isRolesRequired(caught: unknown): boolean {
  return (
    caught instanceof ManagementApiError && caught.code === ROLES_REQUIRED_CODE
  )
}

// 每支 API 各自記錄結果：任何一支失敗只影響它自己的區塊（#481）。
type Loaded<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | {
      status: 'failed'
      message: string
      forbidden: boolean
      notFound: boolean
    }

const LOADING = { status: 'loading' } as const

function failure(caught: unknown): Loaded<never> {
  return {
    status: 'failed',
    message: managementErrorMessage(caught),
    forbidden: isForbidden(caught),
    notFound: caught instanceof ManagementApiError && caught.status === 404,
  }
}

function dataOf<T>(state: Loaded<T[]>): T[] {
  return state.status === 'ready' ? state.data : []
}

/**
 * 把後端的指派限制錯誤碼轉成白話訊息；不是這幾種就回 `null`，由呼叫
 * 端走通用錯誤。後端才是限制的依據（DOM-R70、DOM-R72），前端另外
 * 先濾掉選項只是少讓人踩到。
 */
function assignmentError(caught: unknown): string | null {
  if (!(caught instanceof ManagementApiError)) return null
  if (caught.code === 'project.role_not_assignable') {
    return '你不能指派這個角色，請選擇可指派的角色。'
  }
  if (caught.code === 'project.external_role_not_allowed') {
    return '外部協作人員只能指派外部可用的角色。'
  }
  if (caught.code === 'project.member_self_role_change') {
    return '不能修改自己的專案角色。'
  }
  if (caught.code === 'project.last_manager') {
    return '這是此專案最後一位管理者，請先安排其他管理者後再修改角色。'
  }
  return null
}

// 角色集合不看順序；用來判斷修改畫面有沒有未儲存的變更。
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

function revealMemberAlert(alert: HTMLParagraphElement | null) {
  if (!alert) return
  // #734 T7：長訊息從頂端可讀，短訊息就近顯示，再以 preventScroll 聚焦。
  const block =
    alert.getBoundingClientRect().height > window.innerHeight * 0.8
      ? 'start'
      : 'nearest'
  alert.scrollIntoView?.({ block })
  alert.focus({ preventScroll: true })
}

function memberAccountPath(member: ProjectMember): string {
  const path = `/accounts/${encodeURIComponent(member.user_id)}`
  return path
}

function memberEditPath(listPath: string, member: ProjectMember): string {
  const userId = encodeURIComponent(member.user_id)
  const path = `${listPath}/${userId}/edit`
  return path
}

function memberEditLabel(member: ProjectMember): string {
  const label = `修改「${personLabel(member)}」的角色`
  return label
}

function memberRemoveLabel(member: ProjectMember): string {
  const label = `將「${personLabel(member)}」移出專案`
  return label
}

/** 依 ADM-R52 按路由呈現成員清單、加入表單或角色編輯表單。 */
export default function ProjectDetailPage() {
  const { projectId = '', userId = '' } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isAddPage = useMatch('/projects/:projectId/members/new') !== null
  const isEditPage =
    useMatch('/projects/:projectId/members/:userId/edit') !== null
  const mode = isAddPage ? 'add' : isEditPage ? 'edit' : 'list'
  const memberListPath = `/projects/${encodeURIComponent(projectId)}/members`
  const returnTo = memberReturnPath(
    projectId,
    (location.state as { returnTo?: unknown } | null)?.returnTo,
  )
  // 換專案時整頁重來，不沿用上一個專案的候選與角色。
  return (
    <ProjectMembersSection
      key={projectId}
      mode={mode}
      memberListPath={memberListPath}
      navigate={navigate}
      projectId={projectId}
      returnTo={returnTo}
      userId={userId}
    />
  )
}

function memberReturnPath(projectId: string, value: unknown): string {
  // ADM-R52：只允許站內成員清單或有效帳號詳情，避免越權／外站導向。
  const listPath = `/projects/${encodeURIComponent(projectId)}/members`
  if (value === listPath) return listPath
  const accountMatch =
    typeof value === 'string' && /^\/accounts\/([^/?#]+)$/.exec(value)
  if (accountMatch && isResourceId(accountMatch[1])) {
    return `/accounts/${encodeURIComponent(accountMatch[1])}`
  }
  return listPath
}

/**
 * 專案成員區段：加入成員、修改角色、移出與批次指派（ADM-R20～
 * ADM-R22、ADM-R13）。
 *
 * 沒有 `project_member.manage` 時成員 API 回 403，本區段只顯示無權限
 * 畫面（出路依 ADM-R25），不提供唯讀成員列表（ADM-R27）。
 */
function ProjectMembersSection({
  mode,
  memberListPath,
  navigate,
  projectId,
  returnTo,
  userId,
}: {
  mode: 'list' | 'add' | 'edit'
  memberListPath: string
  navigate: ReturnType<typeof useNavigate>
  projectId: string
  returnTo: string
  userId: string
}) {
  const { user: currentUser } = useCurrentUser()
  const isAdmin = currentUser.is_admin
  const [projectState, setProjectState] = useState<Loaded<Project>>(LOADING)
  const [membersState, setMembersState] =
    useState<Loaded<ProjectMember[]>>(LOADING)
  const [candidatesState, setCandidatesState] =
    useState<Loaded<MemberCandidate[]>>(LOADING)
  const [rolesState, setRolesState] = useState<Loaded<Role[]>>(LOADING)
  const [reloadKey, setReloadKey] = useState(0)
  const [rolesRefreshing, setRolesRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const guard = useSubmitGuard()
  const [message, setMessage] = useState<{
    scope: Scope
    text: string
  } | null>(null)
  const memberMessageRef = useRef<HTMLParagraphElement | null>(null)
  const [notice, setNotice] = useState('')
  const [rowNotice, setRowNotice] = useState<{
    userId: string
    text: string
  }>()
  const memberRows = useRef(new Map<string, HTMLLIElement>())
  const memberNotices = useRef(new Map<string, HTMLParagraphElement>())
  const [highlightedMemberId, setHighlightedMemberId] = useState<
    string | null
  >(null)
  const [batchRoleError, setBatchRoleError] = useState('')
  const batchRoleErrorRef = useRef<HTMLParagraphElement | null>(null)
  const [batchRoleNotice, setBatchRoleNotice] = useState('')
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [batchRoleId, setBatchRoleId] = useState('')

  // 加入表單草稿只在新增路由內保留；確認離開後由路由身分重設。
  const [newUserId, setNewUserId] = useState('')
  const [newRoleIds, setNewRoleIds] = useState<string[]>([])
  const [formRouteKey, setFormRouteKey] = useState(`${mode}:${userId}`)
  const [userError, setUserError] = useState('')
  const [rolesError, setRolesError] = useState('')
  const userRef = useRef<HTMLSelectElement>(null)
  const addRolesRef = useRef<HTMLInputElement>(null)

  // 修改角色（獨立畫面）。
  const [editing, setEditing] = useState<{
    member: ProjectMember
    roleIds: string[]
    error: string
    confirmDiscard: boolean
  } | null>(null)
  const currentFormRouteKey = `${mode}:${userId}`
  if (formRouteKey !== currentFormRouteKey) {
    // ADM-R52：確認離開表單後丟棄草稿；被 guard 攔下時保留草稿。
    setFormRouteKey(currentFormRouteKey)
    setNewUserId('')
    setNewRoleIds([])
    setUserError('')
    setRolesError('')
    setMessage(null)
    setEditing(null)
  }
  const editingDirty = Boolean(
    editing && !sameSet(editing.roleIds, editing.member.role_ids),
  )
  const addDirty = Boolean(newUserId || newRoleIds.length > 0)
  const leaveGuard = navigationGuard.useUnsavedNavigationGuard(
    (mode === 'edit' && editingDirty) || (mode === 'add' && addDirty),
  )
  const editRolesRef = useRef<HTMLInputElement>(null)
  const editHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (message) revealMemberAlert(memberMessageRef.current)
  }, [message])

  useEffect(() => {
    if (
      mode !== 'list' ||
      !rowNotice ||
      membersState.status !== 'ready' ||
      rolesState.status === 'loading' ||
      rolesRefreshing ||
      (isAdmin && projectState.status === 'loading')
    ) {
      return
    }
    const row = memberRows.current.get(rowNotice.userId)
    const messageElement = memberNotices.current.get(rowNotice.userId)
    if (!row || !messageElement) return
    revealElement(messageElement, 'nearest')
    setHighlightedMemberId(rowNotice.userId)
    const timer = window.setTimeout(() => {
      setHighlightedMemberId((current) =>
        current === rowNotice.userId ? null : current,
      )
    }, 1800)
    return () => window.clearTimeout(timer)
  }, [
    isAdmin,
    membersState,
    mode,
    projectState.status,
    rolesState.status,
    rolesRefreshing,
    rowNotice,
  ])

  useEffect(() => {
    if (batchRoleError) revealMemberAlert(batchRoleErrorRef.current)
  }, [batchRoleError])

  const [removing, setRemoving] = useState<ProjectMember | null>(null)

  useEffect(() => {
    let active = true
    function track<T>(load: Promise<T>, set: (next: Loaded<T>) => void) {
      load.then(
        (data) => {
          if (active) set({ status: 'ready', data })
        },
        (caught: unknown) => {
          if (active) set(failure(caught))
        },
      )
    }
    track(listProjectMembers(projectId), setMembersState)
    track(listMemberCandidates(projectId), setCandidatesState)
    track(listAssignableRoles(projectId), (next) => {
      setRolesState(next)
      setRolesRefreshing(false)
    })
    // 專案基本資料只給系統管理者看；專案身分由外層區段殼顯示，
    // 內業不必為此多打一支需要別的權限的 API。
    if (isAdmin) track(getProject(projectId), setProjectState)
    return () => {
      active = false
    }
  }, [projectId, reloadKey, isAdmin])

  const editingMemberId = editing?.member.id
  useEffect(() => {
    // 只在進入修改畫面時移動焦點，不隨勾選變動。
    if (editingMemberId) editHeadingRef.current?.focus()
  }, [editingMemberId])

  function clearMessages() {
    setMessage(null)
    setNotice('')
    setRowNotice(undefined)
    setBatchRoleError('')
    setBatchRoleNotice('')
  }

  /**
   * 批次指派或收回同一個角色（ADM-R13）。API 以「完整角色集合」取代，
   * 所以這裡先替每位成員算出新的完整集合再一次送出；任何一位會變成
   * 零角色就整批不送（ADM-R20）。
   */
  async function submitBatchRole(action: 'assign' | 'revoke') {
    if (selectedMemberIds.length === 0 || !batchRoleId || !guard.enter())
      return
    clearMessages()
    setBusy(true)
    const selected = members.filter((member) =>
      selectedMemberIds.includes(member.user_id),
    )
    const items = selected.map((member) => ({
      user_id: member.user_id,
      role_ids:
        action === 'assign'
          ? [...new Set([...member.role_ids, batchRoleId])]
          : member.role_ids.filter((id) => id !== batchRoleId),
    }))
    if (items.some((item) => item.role_ids.length === 0)) {
      setBatchRoleError('每位成員都必須至少保留一個角色。')
      guard.leave()
      setBusy(false)
      return
    }
    try {
      await setProjectMemberRolesBatch(projectId, items)
      const role = roles.find((item) => item.id === batchRoleId)
      setBatchRoleNotice(
        action === 'assign'
          ? `已為 ${items.length} 位成員指派角色「${role?.name ?? ''}」。`
          : `已為 ${items.length} 位成員收回角色「${role?.name ?? ''}」。`,
      )
      setSelectedMemberIds([])
      setBatchRoleId('')
      reload()
    } catch (caught) {
      setBatchRoleError(managementErrorMessage(caught))
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearMessages()
    const missingUser = newUserId === ''
    const missingRoles = newRoleIds.length === 0
    setUserError(missingUser ? '請選擇要加入的成員。' : '')
    setRolesError(missingRoles ? ROLES_REQUIRED_TEXT : '')
    if (missingUser) {
      userRef.current?.focus()
      return
    }
    if (missingRoles) {
      addRolesRef.current?.focus()
      return
    }
    if (!guard.enter()) return
    setBusy(true)
    try {
      await addProjectMember(projectId, newUserId, newRoleIds)
      const added = candidates.find((user) => user.id === newUserId)
      setRowNotice({
        userId: newUserId,
        text: `已加入「${added ? personLabel(added) : '成員'}」。`,
      })
      reload()
      leaveGuard.allowNavigation(() =>
        navigate(memberListPath, { replace: true }),
      )
    } catch (caught) {
      if (isRolesRequired(caught)) {
        setRolesError(ROLES_REQUIRED_TEXT)
        addRolesRef.current?.focus()
      } else if (
        caught instanceof ManagementApiError &&
        caught.code === 'project.member_self_role_change'
      ) {
        setUserError('不能把自己加入專案。')
        userRef.current?.focus()
      } else if (assignmentError(caught)) {
        setRolesError(assignmentError(caught) ?? '')
        addRolesRef.current?.focus()
      } else {
        setMessage({ scope: 'add', text: managementErrorMessage(caught) })
      }
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    clearMessages()
    if (editing.roleIds.length === 0) {
      setEditing({ ...editing, error: ROLES_REQUIRED_TEXT })
      editRolesRef.current?.focus()
      return
    }
    if (!guard.enter()) return
    setBusy(true)
    try {
      await setProjectMemberRoles(
        projectId,
        editing.member.user_id,
        editing.roleIds,
      )
      setRowNotice({
        userId: editing.member.user_id,
        text: `已更新「${personLabel(editing.member)}」的角色。`,
      })
      reload()
      leaveGuard.allowNavigation(() => navigate(returnTo, { replace: true }))
    } catch (caught) {
      if (isRolesRequired(caught)) {
        setEditing({ ...editing, error: ROLES_REQUIRED_TEXT })
        editRolesRef.current?.focus()
      } else if (assignmentError(caught)) {
        setEditing({ ...editing, error: assignmentError(caught) ?? '' })
        editRolesRef.current?.focus()
      } else {
        setMessage({ scope: 'edit', text: managementErrorMessage(caught) })
      }
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  function cancelEdit() {
    if (!editing) return
    if (editingDirty && !editing.confirmDiscard) {
      setEditing({ ...editing, confirmDiscard: true })
      return
    }
    setEditing(null)
    navigate(returnTo)
  }

  async function confirmRemove() {
    if (!removing) return
    if (!guard.enter()) return
    clearMessages()
    setBusy(true)
    try {
      await removeProjectMember(projectId, removing.user_id)
      setNotice(`已將「${personLabel(removing)}」移出專案。`)
      setRemoving(null)
      reload()
    } catch (caught) {
      setMessage({ scope: 'remove', text: managementErrorMessage(caught) })
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  function formKeyDown(action: () => void) {
    return (event: KeyboardEvent) => {
      if (blockImeEnter(event)) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        action()
      }
    }
  }

  const members = dataOf(membersState)
  const candidates = dataOf(candidatesState)
  const roles = dataOf(rolesState)
  const routeMember = members.find((item) => item.user_id === userId)
  if (
    mode === 'edit' &&
    membersState.status === 'ready' &&
    routeMember &&
    editing?.member.id !== routeMember.id
  ) {
    setEditing({
      member: routeMember,
      roleIds: [...routeMember.role_ids],
      error: '',
      confirmDiscard: false,
    })
  }
  const selectedCandidate = candidates.find(
    (candidate) => candidate.id === newUserId,
  )
  // 外部協作人員只能指派外部可用的角色（DOM-R72）；後端仍會檢查，
  // 這裡先濾掉選項，避免送出後才被 422 擋回。
  const addableRoles = selectedCandidate?.is_external_collaborator
    ? roles.filter((role) => role.is_external_allowed)
    : roles
  const editableRoles = editing?.member.is_external_collaborator
    ? roles.filter((role) => role.is_external_allowed)
    : roles
  function reload() {
    // 舊角色仍可顯示，但新增成員提示須等角色重查完成才揭露（#734）。
    setRolesRefreshing(true)
    // 更新時保留已載入的清單，避免卸載成員列而丟失焦點與捲動位置。
    // 失敗的區塊仍切回 loading，讓重新載入清掉舊錯誤。
    setMembersState((current) =>
      current.status === 'ready' ? current : LOADING,
    )
    setCandidatesState((current) =>
      current.status === 'ready' ? current : LOADING,
    )
    setRolesState((current) =>
      current.status === 'ready' ? current : LOADING,
    )
    setReloadKey((key) => key + 1)
  }
  // 沒有可加入的人時，只顯示說明；角色勾選與加入按鈕都沒有意義。
  const noCandidates =
    candidatesState.status === 'ready' && candidates.length === 0

  const alertFor = (scope: Scope) =>
    message?.scope === scope ? (
      <p ref={memberMessageRef} role="alert" tabIndex={-1}>
        {message.text}
      </p>
    ) : null

  // 專案不存在：整頁只顯示找不到，其餘區塊都沒有意義。
  const missing = [membersState, projectState].find(
    (state) => state.status === 'failed' && state.notFound,
  )
  if (missing?.status === 'failed') {
    return (
      <section aria-labelledby="project-heading">
        <h2 id="project-heading">成員</h2>
        <p role="alert">{missing.message}</p>
      </section>
    )
  }
  // 沒有 project_member.manage：成員 API 回 403，不顯示任何新增、修改、
  // 移出操作（導覽也已隱藏成員區段，這裡處理直接輸入網址的情況）。
  if (
    (membersState.status === 'failed' && membersState.forbidden) ||
    (mode === 'add' &&
      [candidatesState, rolesState].some(
        (state) => state.status === 'failed' && state.forbidden,
      )) ||
    (mode === 'edit' && rolesState.status === 'failed' && rolesState.forbidden)
  ) {
    return <AccessDeniedPage headingLevel={2} />
  }

  // 成員列表是判斷權限的依據（沒有管理權限時它回 403）；先等它回來，
  // 避免候選、角色的失敗訊息在權限訊息出現前閃一下。
  if (
    membersState.status === 'loading' ||
    (mode === 'add' &&
      (candidatesState.status === 'loading' ||
        rolesState.status === 'loading')) ||
    (mode === 'edit' && rolesState.status === 'loading')
  ) {
    return (
      <section aria-labelledby="project-heading">
        <h2 id="project-heading">成員</h2>
        <p>載入中…</p>
      </section>
    )
  }

  if (mode === 'edit' && membersState.status === 'failed') {
    return (
      <section aria-labelledby="project-heading">
        <BackLink to={memberListPath}>返回成員清單</BackLink>
        <h2 id="project-heading">修改成員角色</h2>
        <p role="alert">無法載入成員：{membersState.message}</p>
        <button className="btn" onClick={reload} type="button">
          重新載入
        </button>
      </section>
    )
  }

  if (mode === 'edit' && !editing) {
    return !routeMember ? (
      <section aria-labelledby="project-heading">
        <BackLink to={memberListPath}>返回成員清單</BackLink>
        <h2 id="project-heading">修改成員角色</h2>
        <p role="alert">找不到這位專案成員。</p>
      </section>
    ) : (
      <p role="status">載入中…</p>
    )
  }

  if (mode === 'edit' && editing) {
    return (
      <section aria-labelledby="project-heading">
        <BackLink to={memberListPath}>返回成員清單</BackLink>
        <h2 id="project-heading" ref={editHeadingRef} tabIndex={-1}>
          修改「{personLabel(editing.member)}」的角色
        </h2>
        <UnsavedLeaveBox guard={leaveGuard} />
        <form
          className="member-edit-view"
          noValidate
          onKeyDown={formKeyDown(cancelEdit)}
          onSubmit={submitEdit}
        >
          {rolesState.status === 'failed' ? (
            <div className="member-load-error">
              <p role="alert">無法載入角色：{rolesState.message}</p>
              <button className="btn" onClick={reload} type="button">
                重新載入
              </button>
            </div>
          ) : (
            <MemberRoleFields
              error={editing.error}
              firstRef={editRolesRef}
              onChange={(next) =>
                setEditing((current) =>
                  current ? { ...current, roleIds: next, error: '' } : current,
                )
              }
              roles={editableRoles}
              selected={editing.roleIds}
            />
          )}
          {alertFor('edit')}
          {editing.confirmDiscard ? (
            <ConfirmBox
              cancelLabel="繼續編輯"
              confirmLabel="捨棄修改"
              label="捨棄確認"
              onCancel={() =>
                setEditing((current) =>
                  current ? { ...current, confirmDiscard: false } : current,
                )
              }
              onConfirm={() =>
                leaveGuard.allowNavigation(() => {
                  setEditing(null)
                  navigate(returnTo)
                })
              }
              variant="danger"
            >
              <p>角色還沒儲存，要捨棄這次的修改嗎？</p>
            </ConfirmBox>
          ) : (
            <div className="member-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={cancelEdit}
                type="button"
              >
                取消
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || rolesState.status !== 'ready'}
                type="submit"
              >
                儲存角色
              </button>
            </div>
          )}
        </form>
      </section>
    )
  }

  const projectInfo =
    projectState.status === 'ready' ? projectState.data : null
  const candidatesReady = candidatesState.status === 'ready'
  const rolesReady = rolesState.status === 'ready'

  return (
    <section aria-labelledby="project-heading">
      {mode === 'add' ? (
        <BackLink to={memberListPath}>返回成員清單</BackLink>
      ) : null}
      <h2 id="project-heading">{mode === 'add' ? '加入成員' : '成員'}</h2>
      {mode === 'list' && projectInfo && (
        <p className="field-hint">
          專案代號 {projectInfo.project_code}；業主／委託單位{' '}
          {projectInfo.client_name}；工程地點 {projectInfo.site_location}
        </p>
      )}
      {notice && (
        <p className="notice-success" role="status">
          {notice}
        </p>
      )}

      <UnsavedLeaveBox guard={leaveGuard} />
      {mode === 'list' && rolesState.status === 'failed' ? (
        <div className="member-load-error">
          <p role="alert">無法載入角色：{rolesState.message}</p>
          <button className="btn" onClick={reload} type="button">
            重新載入
          </button>
        </div>
      ) : null}
      {mode === 'list' ? (
        <p>
          <Link
            className="btn btn-primary member-add-link"
            onClick={() => {
              clearMessages()
              setRemoving(null)
            }}
            to={`${memberListPath}/new`}
          >
            加入成員
          </Link>
        </p>
      ) : null}
      {mode === 'add' ? (
        <>
          <form
            className="member-add-form"
            noValidate
            onKeyDown={blockImeEnter}
            onSubmit={submitAdd}
          >
            {candidatesState.status === 'failed' ? (
              <div className="member-load-error">
                <p role="alert">
                  無法載入可加入的成員：{candidatesState.message}
                </p>
                <button onClick={reload} type="button">
                  重新載入
                </button>
              </div>
            ) : candidatesState.status === 'loading' ? (
              <p>載入可加入的成員…</p>
            ) : candidates.length === 0 ? (
              <>
                <p>沒有可加入的成員。</p>
                {isAdmin ? (
                  <p className="field-hint">
                    要加入新的人，請先到
                    <Link to="/accounts">{ACCOUNT_LABEL}</Link>建立帳號。
                  </p>
                ) : (
                  <p className="field-hint">
                    可加入尚未參與這個專案的成員；需要新增帳號請洽系統管理者。
                  </p>
                )}
              </>
            ) : (
              <div>
                <label>
                  <span>
                    成員
                    <RequiredMark />
                  </span>
                  <select
                    aria-describedby={
                      userError ? 'member-user-error' : undefined
                    }
                    aria-invalid={userError ? true : undefined}
                    onChange={(event) => {
                      setNewUserId(event.target.value)
                      setNewRoleIds([])
                      setUserError('')
                      setRolesError('')
                    }}
                    ref={userRef}
                    value={newUserId}
                  >
                    <option value="">請選擇成員</option>
                    {candidates.map((user) => (
                      <option key={user.id} value={user.id}>
                        {personLabel(user)} ·{' '}
                        {user.company_name ?? '未連結公司'}
                        {user.is_external_collaborator
                          ? ' · 外部協作人員'
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedCandidate &&
                  (!selectedCandidate.module_status.project_use ||
                    !selectedCandidate.module_status.inspection_use) && (
                    <p className="field-hint">
                      {[
                        selectedCandidate.module_status.project_use
                          ? null
                          : '尚未開通專案權限，請系統管理者或被委派者開通',
                        selectedCandidate.module_status.inspection_use
                          ? null
                          : '尚未開通查核權限，請系統管理者或被委派者開通',
                      ]
                        .filter(Boolean)
                        .join('；')}
                    </p>
                  )}
                {userError && (
                  <p className="field-error" id="member-user-error">
                    {userError}
                  </p>
                )}
              </div>
            )}
            {!noCandidates && (
              <>
                {rolesState.status === 'failed' ? (
                  <div className="member-load-error">
                    <p role="alert">無法載入角色：{rolesState.message}</p>
                    <button onClick={reload} type="button">
                      重新載入
                    </button>
                  </div>
                ) : rolesState.status === 'loading' ? (
                  <p>載入角色…</p>
                ) : roles.length === 0 ? (
                  <>
                    <p>目前沒有角色。</p>
                    <p className="field-hint">
                      {isAdmin ? (
                        <>
                          請先到<Link to="/roles">角色</Link>
                          建立角色，才能把人加入專案。
                        </>
                      ) : (
                        '還沒有可指派的角色，請洽系統管理者建立。'
                      )}
                    </p>
                  </>
                ) : (
                  <MemberRoleFields
                    error={rolesError}
                    firstRef={addRolesRef}
                    onChange={(next) => {
                      setNewRoleIds(next)
                      setRolesError('')
                    }}
                    roles={addableRoles}
                    selected={newRoleIds}
                  />
                )}
              </>
            )}
            <div className="member-actions">
              <Link className="btn" to={memberListPath}>
                取消
              </Link>
              {!noCandidates && (
                <button
                  className="btn btn-primary"
                  disabled={
                    busy ||
                    !candidatesReady ||
                    !rolesReady ||
                    candidates.length === 0 ||
                    roles.length === 0
                  }
                  type="submit"
                >
                  加入成員
                </button>
              )}
            </div>
            {alertFor('add')}
          </form>
        </>
      ) : null}

      {mode === 'list' && (
        <>
          <h3>成員列表</h3>
          {membersState.status === 'ready' &&
            members.length > 0 &&
            rolesReady && (
              <section
                aria-label="批次角色操作"
                className="member-batch-roles"
              >
                <p>已選取 {selectedMemberIds.length} 位成員。</p>
                <label>
                  批次角色
                  <select
                    disabled={busy}
                    onChange={(event) => setBatchRoleId(event.target.value)}
                    value={batchRoleId}
                  >
                    <option value="">選擇角色</option>
                    {roles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={
                    busy || !batchRoleId || selectedMemberIds.length === 0
                  }
                  onClick={() => void submitBatchRole('assign')}
                  type="button"
                >
                  {busy ? '正在更新角色…' : '批次指派角色'}
                </button>
                <button
                  disabled={
                    busy || !batchRoleId || selectedMemberIds.length === 0
                  }
                  onClick={() => void submitBatchRole('revoke')}
                  type="button"
                >
                  {busy ? '正在更新角色…' : '批次收回角色'}
                </button>
                {batchRoleError && (
                  <p ref={batchRoleErrorRef} role="alert" tabIndex={-1}>
                    {batchRoleError}
                  </p>
                )}
                {batchRoleNotice && <p role="status">{batchRoleNotice}</p>}
              </section>
            )}
          {membersState.status === 'failed' ? (
            <div className="member-load-error">
              <p role="alert">無法載入成員列表：{membersState.message}</p>
              <button onClick={reload} type="button">
                重新載入
              </button>
            </div>
          ) : members.length === 0 ? (
            <div className="member-empty">
              <p>目前沒有成員。</p>
              <p className="field-hint">
                使用上方「加入成員」建立第一筆成員資料。
              </p>
            </div>
          ) : (
            <ul className="member-list">
              {members.map((member) => (
                <li
                  className={
                    member.is_effectively_active
                      ? 'member-card'
                      : 'member-card member-card-inactive'
                  }
                  key={member.id}
                  ref={(element) => {
                    if (element)
                      memberRows.current.set(member.user_id, element)
                    else memberRows.current.delete(member.user_id)
                  }}
                  style={
                    highlightedMemberId === member.user_id
                      ? { backgroundColor: 'var(--success-bg)' }
                      : undefined
                  }
                >
                  <div className="member-card-main">
                    {rowNotice?.userId === member.user_id && (
                      <p
                        className="notice-success"
                        ref={(element) => {
                          if (element) {
                            memberNotices.current.set(member.user_id, element)
                          } else {
                            memberNotices.current.delete(member.user_id)
                          }
                        }}
                        role="status"
                      >
                        {rowNotice.text}
                      </p>
                    )}
                    <label className="member-batch-select">
                      <input
                        aria-label={`選取 ${personLabel(member)} 的角色`}
                        checked={selectedMemberIds.includes(member.user_id)}
                        disabled={
                          busy ||
                          !member.is_active ||
                          member.user_id === currentUser.id
                        }
                        aria-describedby={
                          !member.is_active
                            ? `inactive-member-${member.id}`
                            : undefined
                        }
                        onChange={(event) =>
                          setSelectedMemberIds((current) =>
                            event.target.checked
                              ? [...current, member.user_id]
                              : current.filter((id) => id !== member.user_id),
                          )
                        }
                        type="checkbox"
                        value={member.user_id}
                      />
                      選取
                    </label>
                    {!member.is_active && (
                      <p
                        className="field-hint"
                        id={`inactive-member-${member.id}`}
                      >
                        此帳號已停用，不能批次修改角色。
                      </p>
                    )}
                    <p className="member-card-name">
                      {isAdmin ? (
                        <Link to={memberAccountPath(member)}>
                          {member.name_zh ?? member.username}
                        </Link>
                      ) : (
                        (member.name_zh ?? member.username)
                      )}
                      {!member.is_active ? (
                        <span>（已停用）</span>
                      ) : !member.is_effectively_active ? (
                        <span>（已到期）</span>
                      ) : null}
                    </p>
                    <p className="field-hint">
                      {[
                        member.name_zh ? member.username : null,
                        member.company_name ?? '未連結公司',
                        member.email,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="member-card-roles">
                      {member.role_ids.length === 0 ? (
                        <span className="member-warning">
                          尚未指派角色，請修改角色
                        </span>
                      ) : (
                        // 名稱由後端附上，建立者角色等不可指派的角色也能顯示。
                        member.role_names.join('、')
                      )}
                    </p>
                  </div>
                  {removing?.id === member.id ? (
                    <ConfirmBox
                      busy={busy}
                      confirmLabel="確認移出"
                      label="移出確認"
                      onCancel={() => setRemoving(null)}
                      onConfirm={confirmRemove}
                      variant="danger"
                    >
                      <p>
                        要把「{personLabel(member)}」移出專案嗎？
                        移出後這個人在本專案的角色會一併移除；不影響他在其他專案的角色。
                      </p>
                      {alertFor('remove')}
                    </ConfirmBox>
                  ) : (
                    <div className="member-card-actions">
                      <Link
                        className={
                          busy ||
                          !rolesReady ||
                          member.user_id === currentUser.id
                            ? 'btn btn-sm'
                            : 'btn btn-sm btn-emphasis'
                        }
                        aria-label={memberEditLabel(member)}
                        aria-describedby={
                          member.user_id === currentUser.id
                            ? `self-role-warning-${member.id}`
                            : undefined
                        }
                        aria-disabled={
                          busy ||
                          !rolesReady ||
                          member.user_id === currentUser.id
                        }
                        tabIndex={
                          busy ||
                          !rolesReady ||
                          member.user_id === currentUser.id
                            ? -1
                            : undefined
                        }
                        onClick={(event) => {
                          if (
                            busy ||
                            !rolesReady ||
                            member.user_id === currentUser.id
                          ) {
                            event.preventDefault()
                          } else {
                            clearMessages()
                            setRemoving(null)
                          }
                        }}
                        to={memberEditPath(memberListPath, member)}
                        state={{ returnTo: memberListPath }}
                      >
                        修改角色
                      </Link>
                      <button
                        aria-label={memberRemoveLabel(member)}
                        className="btn-danger-outline"
                        disabled={busy}
                        onClick={() => {
                          clearMessages()
                          setRemoving(member)
                        }}
                        type="button"
                      >
                        移出專案
                      </button>
                    </div>
                  )}
                  {member.user_id === currentUser.id && (
                    <p
                      className="field-hint"
                      style={{ flexBasis: '100%', margin: 0 }}
                      id={`self-role-warning-${member.id}`}
                    >
                      不能修改自己的專案角色。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
