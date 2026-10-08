import { useEffect, useState, type FormEvent } from 'react'

import { ManagementApiError } from '../api'
import { ConfirmBox } from '../../ui/ConfirmBox'
import {
  createRole,
  deleteRole,
  getRole,
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
  // 待確認的刪除與修改；數字是按下按鈕當下向後端重新取得的。
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [pending, setPending] = useState<{
    role: Role
    changes: { name?: string; permission_codes?: string[] }
  } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const descriptions = new Map(
    permissions.map((item) => [item.code, item.description]),
  )
  // 等待確認修改時鎖住表單，確認的內容才不會和畫面上的欄位不一致。
  const locked = pending !== null
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
    setPending(null)
    setEditingId(null)
    setName('')
    setSelected([])
  }

  function startEditing(role: Role) {
    setError('')
    setDeleting(null)
    setPending(null)
    setEditingId(role.id)
    setName(role.name)
    setSelected(role.permission_codes)
  }

  function toggleCode(code: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((item) => item !== code),
    )
  }

  function describeImpact(role: Role): string {
    return `會影響 ${role.project_count} 個專案中的 ${role.user_count} 位使用者`
  }

  // 影響範圍以按下按鈕當下的後端數字為準，列表上的數字可能已過時。
  async function fetchFreshRole(id: string): Promise<Role | null> {
    try {
      return await getRole(id)
    } catch (caught) {
      setError(roleErrorMessage(caught))
      if (
        caught instanceof ManagementApiError &&
        caught.code === 'role.not_found'
      ) {
        resetForm()
        await reload()
      }
      return null
    }
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
      if (!editing) {
        await createRole({ name: trimmed, permission_codes: selected })
        resetForm()
        await reload()
        return
      }
      // 後端拒絕沒有實際變更的更新，所以只送有變的欄位。
      const changes: { name?: string; permission_codes?: string[] } = {}
      if (trimmed !== editing.name) {
        changes.name = trimmed
      }
      if (!sameCodes(selected, editing.permission_codes)) {
        changes.permission_codes = selected
      }
      if (Object.keys(changes).length === 0) {
        resetForm()
        return
      }
      const fresh = await fetchFreshRole(editing.id)
      if (fresh) {
        setPending({ role: fresh, changes })
      }
    } catch (caught) {
      setError(roleErrorMessage(caught))
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function confirmUpdate() {
    if (!pending) return
    setSaving(true)
    setError('')
    try {
      await updateRole(pending.role.id, pending.changes)
      setPending(null)
      resetForm()
      await reload()
    } catch (caught) {
      setError(roleErrorMessage(caught))
      setPending(null)
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

  async function startDelete(role: Role) {
    setError('')
    setPending(null)
    setSaving(true)
    try {
      const fresh = await fetchFreshRole(role.id)
      if (fresh) {
        setDeleting(fresh)
      }
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
        <ConfirmBox
          busy={saving}
          key={deleting.id}
          role="region"
          confirmLabel="確認刪除角色"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
          title={`刪除「${deleting.name}」`}
          variant="danger"
        >
          <p>
            刪除{describeImpact(deleting)}
            ：這些成員身上的這個角色指派都會一併移除，無法復原。
          </p>
        </ConfirmBox>
      )}
      {pending && (
        <ConfirmBox
          busy={saving}
          key={pending.role.id}
          role="region"
          confirmLabel="確認修改角色"
          onCancel={() => setPending(null)}
          onConfirm={() => void confirmUpdate()}
          title={`修改「${pending.role.name}」`}
        >
          <p>此變更{describeImpact(pending.role)}，儲存後立即生效。</p>
        </ConfirmBox>
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
                    onClick={() => void startDelete(role)}
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
            disabled={locked}
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
                    disabled={locked}
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
                    disabled={locked}
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
        {editing && (
          <button disabled={saving} onClick={resetForm} type="button">
            取消
          </button>
        )}
        <button
          className="btn-primary"
          disabled={saving || loading || locked}
          type="submit"
        >
          {editing ? '儲存角色' : '新增角色'}
        </button>
      </form>
    </section>
  )
}
