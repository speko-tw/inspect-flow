import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useParams } from 'react-router'

import {
  ManagementApiError,
  listUsers,
  managementErrorMessage,
  type User,
} from '../api'
import { listRoles } from '../roles/api'
import MemberRoleFields, { RequiredMark } from './MemberRoleFields'
import {
  addProjectMember,
  getProject,
  listProjectMembers,
  personLabel,
  removeProjectMember,
  setProjectMemberRoles,
  type Project,
  type ProjectMember,
  type Role,
} from './api'
import './ProjectMembers.css'

const ROLES_REQUIRED_CODE = 'project.member_roles_required'
const ROLES_REQUIRED_TEXT = '請至少選一個角色。'

// 訊息只顯示在發生的地方，並在下一次操作前清掉，不殘留舊訊息。
type Scope = 'page' | 'add' | 'edit' | 'remove'

function isRolesRequired(caught: unknown): boolean {
  return (
    caught instanceof ManagementApiError && caught.code === ROLES_REQUIRED_CODE
  )
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id))
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
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
    async function load() {
      try {
        const [nextProject, nextMembers, nextUsers, nextRoles] =
          await Promise.all([
            getProject(projectId),
            listProjectMembers(projectId),
            listUsers(),
            listRoles(),
          ])
        if (active) {
          setProject(nextProject)
          setMembers(nextMembers)
          setUsers(nextUsers)
          setRoles(nextRoles)
        }
      } catch (caught) {
        if (active) {
          setMessage({ scope: 'page', text: managementErrorMessage(caught) })
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
  }, [projectId, reloadKey])

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
      const added = users.find((user) => user.id === newUserId)
      setNotice(`已加入「${added ? personLabel(added) : '成員'}」。`)
      setNewUserId('')
      setNewRoleIds([])
      setReloadKey((key) => key + 1)
    } catch (caught) {
      if (isRolesRequired(caught)) {
        setRolesError(ROLES_REQUIRED_TEXT)
        addRolesRef.current?.focus()
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

  const memberIds = new Set(members.map((member) => member.user_id))
  // 內建 admin 是系統帳號，不屬於任何公司，不該被指派到專案。
  const candidates = users.filter(
    (user) => user.is_active && !user.is_system && !memberIds.has(user.id),
  )
  const roleName = (id: string) =>
    roles.find((role) => role.id === id)?.name ?? '（未知角色）'

  const alertFor = (scope: Scope) =>
    message?.scope === scope ? <p role="alert">{message.text}</p> : null

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

  return (
    <section aria-labelledby="project-heading">
      <h2 id="project-heading">成員</h2>
      {message?.scope === 'page' && <p role="alert">{message.text}</p>}
      {loading ? <p>載入中…</p> : null}
      {project && (
        <>
          <p className="member-muted">
            專案代號 {project.project_code}；業主／委託單位{' '}
            {project.client_name}；工程地點 {project.site_location}
          </p>
          {notice && <p role="status">{notice}</p>}

          <form className="member-add-form" noValidate onSubmit={submitAdd}>
            <h3>加入成員</h3>
            {candidates.length === 0 ? (
              <>
                <p>沒有可加入的使用者。</p>
                <p className="member-hint">
                  要加入新的人，請先到
                  <Link to="/admin/users">使用者</Link>建立帳號。
                </p>
              </>
            ) : (
              <div>
                <label>
                  <span>
                    使用者
                    <RequiredMark />
                  </span>
                  <select
                    aria-describedby={
                      userError ? 'member-user-error' : undefined
                    }
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
            {roles.length === 0 && !loading ? (
              <>
                <p>目前沒有角色。</p>
                <p className="member-hint">
                  請先到<Link to="/admin/roles">角色</Link>
                  建立角色，才能把人加入專案。
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
            {alertFor('add')}
            <button
              disabled={busy || candidates.length === 0 || roles.length === 0}
              type="submit"
            >
              加入成員
            </button>
          </form>

          <h3>成員列表</h3>
          {members.length === 0 ? (
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
                        disabled={busy}
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
        </>
      )}
    </section>
  )
}
