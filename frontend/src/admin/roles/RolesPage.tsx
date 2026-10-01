import { useEffect, useState, type FormEvent } from 'react'

import { ManagementApiError } from '../api'
import {
  createRole,
  deleteRole,
  listPermissionCodes,
  listRoles,
  roleErrorMessage,
  updateRole,
  type PermissionCode,
  type Role,
} from './api'

const NO_PERMISSIONS_TEXT = '目前尚無可設定的權限，功能上線後會出現'

function sameCodes(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().join('\n') === [...right].sort().join('\n')
  )
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<PermissionCode[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const descriptions = new Map(
    permissions.map((item) => [item.code, item.description]),
  )
  const editing = roles.find((role) => role.id === editingId) ?? null
  // 角色上若有已不在登記表的代碼，仍列出來，讓管理者看得到、可取消。
  const unregistered = (editing?.permission_codes ?? []).filter(
    (code) => !descriptions.has(code),
  )

  async function reload() {
    try {
      setRoles(await listRoles())
    } catch (caught) {
      setError(roleErrorMessage(caught))
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [rows, codes] = await Promise.all([
          listRoles(),
          listPermissionCodes(),
        ])
        if (active) {
          setRoles(rows)
          setPermissions(codes)
        }
      } catch (caught) {
        if (active) {
          setError(roleErrorMessage(caught))
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

  function resetForm() {
    setEditingId(null)
    setName('')
    setSelected([])
  }

  function startEditing(role: Role) {
    setError('')
    setDeleting(null)
    setEditingId(role.id)
    setName(role.name)
    setSelected(role.permission_codes)
  }

  function toggleCode(code: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((item) => item !== code),
    )
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('請輸入角色名稱。')
      return
    }
    setSaving(true)
    setError('')
    try {
      if (editing) {
        // 後端拒絕沒有實際變更的更新，所以只送有變的欄位。
        const changes: { name?: string; permission_codes?: string[] } = {}
        if (trimmed !== editing.name) {
          changes.name = trimmed
        }
        if (!sameCodes(selected, editing.permission_codes)) {
          changes.permission_codes = selected
        }
        if (Object.keys(changes).length > 0) {
          await updateRole(editing.id, changes)
        }
      } else {
        await createRole({ name: trimmed, permission_codes: selected })
      }
      resetForm()
      await reload()
    } catch (caught) {
      setError(roleErrorMessage(caught))
      if (
        caught instanceof ManagementApiError &&
        caught.code === 'role.not_found'
      ) {
        // 正在修改的角色已被別人刪除，不能再當成修改。
        resetForm()
      }
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setSaving(true)
    setError('')
    try {
      await deleteRole(deleting.id)
      if (editingId === deleting.id) {
        resetForm()
      }
    } catch (caught) {
      setError(roleErrorMessage(caught))
    } finally {
      setDeleting(null)
      await reload()
      setSaving(false)
    }
  }

  function permissionText(role: Role): string {
    if (role.permission_codes.length === 0) {
      return '（無）'
    }
    return role.permission_codes
      .map((code) => descriptions.get(code) ?? code)
      .join('、')
  }

  return (
    <section aria-labelledby="roles-heading">
      <h1 id="roles-heading">角色管理</h1>
      {error && <p role="alert">{error}</p>}
      {deleting && (
        <section aria-labelledby="delete-role-heading">
          <h2 id="delete-role-heading">刪除「{deleting.name}」</h2>
          <p>刪除後，所有專案成員身上的這個角色指派都會一併移除，無法復原。</p>
          <button disabled={saving} onClick={() => void confirmDelete()}>
            確認刪除角色
          </button>
          <button
            disabled={saving}
            onClick={() => setDeleting(null)}
            type="button"
          >
            取消
          </button>
        </section>
      )}
      {loading ? <p>載入中…</p> : null}
      {!loading && roles.length === 0 ? <p>目前沒有角色。</p> : null}
      {roles.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">角色名稱</th>
              <th scope="col">權限</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <th scope="row">{role.name}</th>
                <td>{permissionText(role)}</td>
                <td>
                  <button
                    aria-label={`修改角色 ${role.name}`}
                    disabled={saving}
                    onClick={() => startEditing(role)}
                    type="button"
                  >
                    修改
                  </button>
                  <button
                    aria-label={`刪除角色 ${role.name}`}
                    disabled={saving}
                    onClick={() => {
                      setError('')
                      setDeleting(role)
                    }}
                    type="button"
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={save}>
        <h2>{editing ? `修改角色「${editing.name}」` : '新增角色'}</h2>
        <label>
          角色名稱
          <input
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <fieldset>
          <legend>權限</legend>
          {permissions.length === 0 && unregistered.length === 0 ? (
            <p>{loading ? '載入中…' : NO_PERMISSIONS_TEXT}</p>
          ) : (
            <>
              {permissions.map((item) => (
                <label key={item.code}>
                  <input
                    checked={selected.includes(item.code)}
                    onChange={(event) =>
                      toggleCode(item.code, event.target.checked)
                    }
                    type="checkbox"
                    value={item.code}
                  />
                  {item.description}
                </label>
              ))}
              {unregistered.map((code) => (
                <label key={code}>
                  <input
                    checked={selected.includes(code)}
                    onChange={(event) =>
                      toggleCode(code, event.target.checked)
                    }
                    type="checkbox"
                    value={code}
                  />
                  {code}（已不在可設定清單）
                </label>
              ))}
            </>
          )}
        </fieldset>
        <button disabled={saving || loading} type="submit">
          {editing ? '儲存角色' : '新增角色'}
        </button>
        {editing && (
          <button disabled={saving} onClick={resetForm} type="button">
            取消
          </button>
        )}
      </form>
    </section>
  )
}
