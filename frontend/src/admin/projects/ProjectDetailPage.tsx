import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { listUsers, managementErrorMessage, type User } from '../api'
import {
  addProjectMember,
  getProject,
  listAllRoles,
  listProjectMembers,
  personLabel,
  removeProjectMember,
  setProjectMemberRoles,
  type Project,
  type ProjectMember,
  type Role,
} from './api'

function toggle(ids: string[], id: string, checked: boolean): string[] {
  return checked ? [...ids, id] : ids.filter((item) => item !== id)
}

function RoleCheckboxes({
  roles,
  selected,
  onChange,
}: {
  roles: Role[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  if (roles.length === 0) {
    return <p>目前沒有角色，可先不指派角色。</p>
  }
  return (
    <fieldset>
      <legend>角色（可複選，也可以都不選）</legend>
      {roles.map((role) => (
        <label key={role.id}>
          <input
            checked={selected.includes(role.id)}
            onChange={(event) =>
              onChange(toggle(selected, role.id, event.target.checked))
            }
            type="checkbox"
            value={role.id}
          />
          {role.name}
        </label>
      ))}
    </fieldset>
  )
}

export default function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [newUserId, setNewUserId] = useState('')
  const [newRoleIds, setNewRoleIds] = useState<string[]>([])
  const [editing, setEditing] = useState<{
    member: ProjectMember
    roleIds: string[]
  } | null>(null)
  const [removing, setRemoving] = useState<ProjectMember | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [nextProject, nextMembers, nextUsers, nextRoles] =
          await Promise.all([
            getProject(projectId),
            listProjectMembers(projectId),
            listUsers(),
            listAllRoles(),
          ])
        if (active) {
          setProject(nextProject)
          setMembers(nextMembers)
          setUsers(nextUsers)
          setRoles(nextRoles)
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
  }, [projectId, reloadKey])

  async function act(operation: () => Promise<unknown>) {
    setError('')
    setBusy(true)
    try {
      await operation()
      setEditing(null)
      setRemoving(null)
      setReloadKey((key) => key + 1)
      return true
    } catch (caught) {
      setError(managementErrorMessage(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const added = await act(() =>
      addProjectMember(projectId, newUserId, newRoleIds),
    )
    if (added) {
      setNewUserId('')
      setNewRoleIds([])
    }
  }

  const memberIds = new Set(members.map((member) => member.user_id))
  // 內建 admin 是系統帳號，不屬於任何公司，不該被指派到專案。
  const candidates = users.filter(
    (user) => user.is_active && !user.is_system && !memberIds.has(user.id),
  )
  const roleName = (id: string) =>
    roles.find((role) => role.id === id)?.name ?? '（未知角色）'

  return (
    <section aria-labelledby="project-heading">
      <p>
        <Link to="/admin/projects">回專案列表</Link>
      </p>
      <h1 id="project-heading">
        {project ? `專案成員：${project.name}` : '專案成員'}
      </h1>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>載入中…</p> : null}
      {project && (
        <>
          <p>
            專案代號 {project.project_code}；業主／委託單位{' '}
            {project.client_name}；工程地點 {project.site_location}
          </p>
          <h2>成員列表</h2>
          {members.length === 0 ? <p>目前沒有成員。</p> : null}
          {members.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th scope="col">帳號</th>
                  <th scope="col">姓名</th>
                  <th scope="col">Email</th>
                  <th scope="col">公司</th>
                  <th scope="col">角色</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">
                      {member.username}
                      {member.is_active ? null : <span>（已停用）</span>}
                    </th>
                    <td>{member.name_zh ?? '—'}</td>
                    <td>{member.email ?? '—'}</td>
                    <td>{member.company_name ?? '—'}</td>
                    <td>
                      {member.role_ids.length === 0
                        ? '無角色'
                        : member.role_ids.map(roleName).join('、')}
                    </td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setRemoving(null)
                          setEditing({
                            member,
                            roleIds: [...member.role_ids],
                          })
                        }}
                        type="button"
                      >
                        調整角色
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(null)
                          setRemoving(member)
                        }}
                        type="button"
                      >
                        移出專案
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editing && (
            <section aria-labelledby="edit-roles-heading">
              <h2 id="edit-roles-heading">
                調整「{personLabel(editing.member)}」的角色
              </h2>
              <RoleCheckboxes
                onChange={(next) =>
                  setEditing((current) =>
                    current ? { ...current, roleIds: next } : current,
                  )
                }
                roles={roles}
                selected={editing.roleIds}
              />
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    setProjectMemberRoles(
                      projectId,
                      editing.member.user_id,
                      editing.roleIds,
                    ),
                  )
                }
                type="button"
              >
                儲存角色
              </button>
              <button
                disabled={busy}
                onClick={() => setEditing(null)}
                type="button"
              >
                取消
              </button>
            </section>
          )}

          {removing && (
            <section aria-labelledby="remove-member-heading">
              <h2 id="remove-member-heading">
                移出「{personLabel(removing)}」
              </h2>
              <p>
                移出後這個人在本專案的角色會一併移除；不影響他在其他專案的角色。
              </p>
              <button
                className="btn-danger"
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    removeProjectMember(projectId, removing.user_id),
                  )
                }
                type="button"
              >
                確認移出
              </button>
              <button
                disabled={busy}
                onClick={() => setRemoving(null)}
                type="button"
              >
                取消
              </button>
            </section>
          )}

          <form onSubmit={add}>
            <h2>加入成員</h2>
            {candidates.length === 0 ? (
              <p>沒有可加入的使用者。</p>
            ) : (
              <label>
                使用者
                <select
                  onChange={(event) => setNewUserId(event.target.value)}
                  required
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
            )}
            <RoleCheckboxes
              onChange={setNewRoleIds}
              roles={roles}
              selected={newRoleIds}
            />
            <button disabled={busy || candidates.length === 0} type="submit">
              加入成員
            </button>
          </form>
        </>
      )}
    </section>
  )
}
