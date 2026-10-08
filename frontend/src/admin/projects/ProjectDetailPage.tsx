import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useParams } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { isForbidden } from '../../http'
import { ManagementApiError, managementErrorMessage } from '../api'
import MemberRoleFields, { RequiredMark } from './MemberRoleFields'
import {
  addProjectMember,
  getProject,
  listAssignableRoles,
  listMemberCandidates,
  listProjectMembers,
  personLabel,
  removeProjectMember,
  setProjectMemberRoles,
  type MemberCandidate,
  type Project,
  type ProjectMember,
  type Role,
} from './api'
import './ProjectMembers.css'

const ROLES_REQUIRED_CODE = 'project.member_roles_required'
const ROLES_REQUIRED_TEXT = '請至少選一個角色。'
const COMPANY_MISMATCH_CODE = 'project.member_company_mismatch'
const COMPANY_MISMATCH_TEXT = '只能加入和你同公司的使用者，請重新選擇。'

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

function isCompanyMismatch(caught: unknown): boolean {
  return (
    caught instanceof ManagementApiError &&
    caught.code === COMPANY_MISMATCH_CODE
  )
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  // 換專案時整頁重來，不沿用上一個專案的候選與角色。
  return <ProjectMembersSection key={projectId} projectId={projectId} />
}

function ProjectMembersSection({ projectId }: { projectId: string }) {
  const { user: currentUser } = useCurrentUser()
  const isAdmin = currentUser.is_admin
  const [projectState, setProjectState] = useState<Loaded<Project>>(LOADING)
  const [membersState, setMembersState] =
    useState<Loaded<ProjectMember[]>>(LOADING)
  const [candidatesState, setCandidatesState] =
    useState<Loaded<MemberCandidate[]>>(LOADING)
  const [rolesState, setRolesState] = useState<Loaded<Role[]>>(LOADING)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    scope: Scope
    text: string
  } | null>(null)
  const [notice, setNotice] = useState('')

  // 加入表單（草稿留在這裡，進出修改畫面都不會掉）。
  const [newUserId, setNewUserId] = useState('')
  const [newRoleIds, setNewRoleIds] = useState<string[]>([])
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
  const editRolesRef = useRef<HTMLInputElement>(null)
  const editHeadingRef = useRef<HTMLHeadingElement>(null)

  const [removing, setRemoving] = useState<ProjectMember | null>(null)
  const cancelRemoveRef = useRef<HTMLButtonElement>(null)

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
    track(listAssignableRoles(projectId), setRolesState)
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

  useEffect(() => {
    if (removing) cancelRemoveRef.current?.focus()
  }, [removing])

  function clearMessages() {
    setMessage(null)
    setNotice('')
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearMessages()
    const missingUser = newUserId === ''
    const missingRoles = newRoleIds.length === 0
    setUserError(missingUser ? '請選擇要加入的使用者。' : '')
    setRolesError(missingRoles ? ROLES_REQUIRED_TEXT : '')
    if (missingUser) {
      userRef.current?.focus()
      return
    }
    if (missingRoles) {
      addRolesRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await addProjectMember(projectId, newUserId, newRoleIds)
      const added = candidates.find((user) => user.id === newUserId)
      setNotice(`已加入「${added ? personLabel(added) : '成員'}」。`)
      setNewUserId('')
      setNewRoleIds([])
      setReloadKey((key) => key + 1)
    } catch (caught) {
      if (isRolesRequired(caught)) {
        setRolesError(ROLES_REQUIRED_TEXT)
        addRolesRef.current?.focus()
      } else if (isCompanyMismatch(caught)) {
        // 伺服器端的同公司檢查：錯誤顯示在使用者欄，已選的角色保留。
        setUserError(COMPANY_MISMATCH_TEXT)
        userRef.current?.focus()
      } else {
        setMessage({ scope: 'add', text: managementErrorMessage(caught) })
      }
    } finally {
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
    setBusy(true)
    try {
      await setProjectMemberRoles(
        projectId,
        editing.member.user_id,
        editing.roleIds,
      )
      setNotice(`已更新「${personLabel(editing.member)}」的角色。`)
      setEditing(null)
      setReloadKey((key) => key + 1)
    } catch (caught) {
      if (isRolesRequired(caught)) {
        setEditing({ ...editing, error: ROLES_REQUIRED_TEXT })
        editRolesRef.current?.focus()
      } else {
        setMessage({ scope: 'edit', text: managementErrorMessage(caught) })
      }
    } finally {
      setBusy(false)
    }
  }

  function startEdit(member: ProjectMember) {
    clearMessages()
    setRemoving(null)
    setEditing({
      member,
      roleIds: [...member.role_ids],
      error: '',
      confirmDiscard: false,
    })
  }

  function cancelEdit() {
    if (!editing) return
    const dirty = !sameSet(editing.roleIds, editing.member.role_ids)
    if (dirty && !editing.confirmDiscard) {
      setEditing({ ...editing, confirmDiscard: true })
      return
    }
    setEditing(null)
  }

  async function confirmRemove() {
    if (!removing) return
    clearMessages()
    setBusy(true)
    try {
      await removeProjectMember(projectId, removing.user_id)
      setNotice(`已將「${personLabel(removing)}」移出專案。`)
      setRemoving(null)
      setReloadKey((key) => key + 1)
    } catch (caught) {
      setMessage({ scope: 'remove', text: managementErrorMessage(caught) })
    } finally {
      setBusy(false)
    }
  }

  function escapeTo(action: () => void) {
    return (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        action()
      }
    }
  }

  const members = dataOf(membersState)
  const candidates = dataOf(candidatesState)
  const roles = dataOf(rolesState)
  const roleName = (id: string) =>
    roles.find((role) => role.id === id)?.name ??
    (rolesState.status === 'ready' ? '（未知角色）' : '（角色名稱無法顯示）')
  const reload = () => setReloadKey((key) => key + 1)
  // 沒有可加入的人時，只顯示說明；角色勾選與加入按鈕都沒有意義。
  const noCandidates =
    candidatesState.status === 'ready' && candidates.length === 0

  const alertFor = (scope: Scope) =>
    message?.scope === scope ? <p role="alert">{message.text}</p> : null

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
  if (membersState.status === 'failed' && membersState.forbidden) {
    return (
      <section aria-labelledby="project-heading">
        <h2 id="project-heading">成員</h2>
        <p role="alert">
          你沒有權限管理這個專案的成員。需要「管理專案成員」的角色才能查看與修改。
        </p>
      </section>
    )
  }

  // 成員列表是判斷權限的依據（沒有管理權限時它回 403）；先等它回來，
  // 避免候選、角色的失敗訊息在權限訊息出現前閃一下。
  if (membersState.status === 'loading' && !editing) {
    return (
      <section aria-labelledby="project-heading">
        <h2 id="project-heading">成員</h2>
        <p>載入中…</p>
      </section>
    )
  }

  if (editing) {
    return (
      <section aria-labelledby="project-heading">
        <h2 id="project-heading">成員</h2>
        <form
          className="member-edit-view"
          noValidate
          onKeyDown={escapeTo(cancelEdit)}
          onSubmit={submitEdit}
        >
          <h3 ref={editHeadingRef} tabIndex={-1}>
            修改「{personLabel(editing.member)}」的角色
          </h3>
          <MemberRoleFields
            error={editing.error}
            firstRef={editRolesRef}
            onChange={(next) =>
              setEditing((current) =>
                current ? { ...current, roleIds: next, error: '' } : current,
              )
            }
            roles={roles}
            selected={editing.roleIds}
          />
          {alertFor('edit')}
          {editing.confirmDiscard ? (
            <div className="member-confirm" role="group" aria-label="捨棄確認">
              <p>角色還沒儲存，要捨棄這次的修改嗎？</p>
              <div className="member-actions">
                <button
                  className="btn-danger"
                  onClick={() => setEditing(null)}
                  type="button"
                >
                  捨棄修改
                </button>
                <button
                  onClick={() =>
                    setEditing((current) =>
                      current
                        ? { ...current, confirmDiscard: false }
                        : current,
                    )
                  }
                  type="button"
                >
                  繼續編輯
                </button>
              </div>
            </div>
          ) : (
            <div className="member-actions">
              <button disabled={busy} type="submit">
                儲存角色
              </button>
              <button disabled={busy} onClick={cancelEdit} type="button">
                取消
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
      <h2 id="project-heading">成員</h2>
      {projectInfo && (
        <p className="member-muted">
          專案代號 {projectInfo.project_code}；業主／委託單位{' '}
          {projectInfo.client_name}；工程地點 {projectInfo.site_location}
        </p>
      )}
      {notice && (
        <p className="notice-success" role="status">
          {notice}
        </p>
      )}

      <form className="member-add-form" noValidate onSubmit={submitAdd}>
        <h3>加入成員</h3>
        {candidatesState.status === 'failed' ? (
          <div className="member-load-error">
            <p role="alert">
              無法載入可加入的使用者：{candidatesState.message}
            </p>
            <button onClick={reload} type="button">
              重新載入
            </button>
          </div>
        ) : candidatesState.status === 'loading' ? (
          <p>載入可加入的使用者…</p>
        ) : candidates.length === 0 ? (
          <>
            <p>沒有可加入的使用者。</p>
            {isAdmin ? (
              <p className="member-hint">
                要加入新的人，請先到
                <Link to="/admin/users">使用者</Link>建立帳號。
              </p>
            ) : (
              <p className="member-hint">
                只能加入和你同公司、還沒加入這個專案的使用者；
                需要新增帳號請洽系統管理者。
              </p>
            )}
          </>
        ) : (
          <div>
            <label>
              <span>
                使用者
                <RequiredMark />
              </span>
              <select
                aria-describedby={userError ? 'member-user-error' : undefined}
                aria-invalid={userError ? true : undefined}
                onChange={(event) => {
                  setNewUserId(event.target.value)
                  setUserError('')
                }}
                ref={userRef}
                value={newUserId}
              >
                <option value="">請選擇使用者</option>
                {candidates.map((user) => (
                  <option key={user.id} value={user.id}>
                    {personLabel(user)}
                  </option>
                ))}
              </select>
            </label>
            {userError && (
              <p className="member-field-error" id="member-user-error">
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
                <p className="member-hint">
                  {isAdmin ? (
                    <>
                      請先到<Link to="/admin/roles">角色</Link>
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
                roles={roles}
                selected={newRoleIds}
              />
            )}
            <button
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
          </>
        )}
        {alertFor('add')}
      </form>

      <h3>成員列表</h3>
      {membersState.status === 'failed' ? (
        <div className="member-load-error">
          <p role="alert">無法載入成員列表：{membersState.message}</p>
          <button onClick={reload} type="button">
            重新載入
          </button>
        </div>
      ) : membersState.status === 'loading' ? (
        <p>載入中…</p>
      ) : members.length === 0 ? (
        <div className="member-empty">
          <p>目前沒有成員。</p>
          <p className="member-hint">
            先在上方選一位使用者並指定角色，把他加入專案。
          </p>
        </div>
      ) : (
        <ul className="member-list">
          {members.map((member) => (
            <li className="member-card" key={member.id}>
              <div className="member-card-main">
                <p className="member-card-name">
                  {member.name_zh ?? member.username}
                  {member.is_active ? null : <span>（已停用）</span>}
                </p>
                <p className="member-muted">
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
                    member.role_ids.map(roleName).join('、')
                  )}
                </p>
              </div>
              {removing?.id === member.id ? (
                <div
                  className="member-confirm"
                  onKeyDown={escapeTo(() => setRemoving(null))}
                  role="group"
                  aria-label="移出確認"
                >
                  <p>
                    要把「{personLabel(member)}」移出專案嗎？
                    移出後這個人在本專案的角色會一併移除；不影響他在其他專案的角色。
                  </p>
                  {alertFor('remove')}
                  <div className="member-actions">
                    <button
                      className="btn-danger"
                      disabled={busy}
                      onClick={() => void confirmRemove()}
                      type="button"
                    >
                      確認移出
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => setRemoving(null)}
                      ref={cancelRemoveRef}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div className="member-card-actions">
                  <button
                    aria-label={`修改「${personLabel(member)}」的角色`}
                    disabled={busy || !rolesReady}
                    onClick={() => startEdit(member)}
                    type="button"
                  >
                    修改角色
                  </button>
                  <button
                    aria-label={`將「${personLabel(member)}」移出專案`}
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
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
