import { useEffect, useState, type FormEvent } from 'react'

import { ManagementApiError } from '../api'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { Form, FormError, FormSubmitButton } from '../../ui/Form'
import { useSubmitGuard } from '../../ui/submitGuard'
import { UnsavedLeaveBox } from '../../ui/navigation'
import * as navigationGuard from '../../ui/navigation'
import { PAGE_TITLES } from '../../layout/navigationLabels'
import RolePermissionSummary from '../projects/RolePermissionSummary'
import '../../styles/g7-shell.css'
import {
  createRole,
  deleteRole,
  getCreatorRole,
  getRole,
  listPermissionCodes,
  listRoles,
  roleErrorMessage,
  setCreatorRole,
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
  const [isAssignable, setIsAssignable] = useState(false)
  const [isExternalAllowed, setIsExternalAllowed] = useState(false)
  const [creatorRoleId, setCreatorRoleId] = useState('')
  const [creatorRoleSaved, setCreatorRoleSaved] = useState(false)
  const [creatorRoleOpen, setCreatorRoleOpen] = useState(false)
  const [roleFormOpen, setRoleFormOpen] = useState(false)
  // 待確認的刪除與修改；數字是按下按鈕當下向後端重新取得的。
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [pending, setPending] = useState<{
    role: Role
    changes: {
      name?: string
      permission_codes?: string[]
      is_assignable?: boolean
      is_external_allowed?: boolean
    }
  } | null>(null)
  const [error, setError] = useState('')
  // 新增或修改角色的存檔錯誤：顯示在表單裡並聚焦。表單在頁面底部，放在
  // 頁頂的話使用者看不到，螢幕閱讀器也不會被帶過去（F-O02）。
  const [formError, setFormError] = useState<{
    message: string
    request: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const guard = useSubmitGuard()
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
  const hasUnsavedChanges = editing
    ? name !== editing.name ||
      !sameCodes(selected, editing.permission_codes) ||
      isAssignable !== Boolean(editing.is_assignable) ||
      isExternalAllowed !== Boolean(editing.is_external_allowed)
    : name !== '' || selected.length > 0
  const leaveGuard =
    navigationGuard.useUnsavedNavigationGuard(hasUnsavedChanges)

  async function reload() {
    try {
      setRoles(await listRoles())
    } catch (caught) {
      setError(roleErrorMessage(caught))
    }
  }

  async function saveCreatorRole() {
    if (!creatorRoleId) {
      setError('請選擇新專案預設角色。')
      return
    }
    setSaving(true)
    setError('')
    setCreatorRoleSaved(false)
    try {
      await setCreatorRole(creatorRoleId)
      setCreatorRoleSaved(true)
    } catch (caught) {
      setError(roleErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [rows, codes, creatorRole] = await Promise.all([
          listRoles(),
          listPermissionCodes(),
          getCreatorRole(),
        ])
        if (active) {
          setRoles(rows)
          setPermissions(codes)
          setCreatorRoleId(creatorRole.role_id)
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

  function failForm(message: string) {
    setFormError((previous) => ({
      message,
      request: (previous?.request ?? 0) + 1,
    }))
  }

  function resetForm() {
    setFormError(null)
    setPending(null)
    setEditingId(null)
    setName('')
    setSelected([])
    setIsAssignable(false)
    setIsExternalAllowed(false)
  }

  function startEditing(role: Role) {
    setError('')
    setFormError(null)
    setDeleting(null)
    setPending(null)
    setEditingId(role.id)
    setRoleFormOpen(true)
    setName(role.name)
    setSelected(role.permission_codes)
    setIsAssignable(Boolean(role.is_assignable))
    setIsExternalAllowed(Boolean(role.is_external_allowed))
  }

  function toggleCode(code: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, code] : current.filter((item) => item !== code),
    )
  }

  function describeImpact(role: Role): string {
    return `會影響 ${role.project_count} 個專案中的 ${role.user_count} 個帳號`
  }

  // 影響範圍以按下按鈕當下的後端數字為準，列表上的數字可能已過時。
  async function fetchFreshRole(
    id: string,
    report: (message: string) => void = setError,
  ): Promise<Role | null> {
    try {
      return await getRole(id)
    } catch (caught) {
      if (
        caught instanceof ManagementApiError &&
        caught.code === 'role.not_found'
      ) {
        resetForm()
        await reload()
      }
      // 放在 resetForm 之後：它會清掉表單錯誤，錯誤要留給使用者看。
      report(roleErrorMessage(caught))
      return null
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      failForm('請輸入角色名稱。')
      return
    }
    setSaving(true)
    setError('')
    setFormError(null)
    try {
      if (!editing) {
        await createRole({ name: trimmed, permission_codes: selected })
        resetForm()
        await reload()
        return
      }
      // 後端拒絕沒有實際變更的更新，所以只送有變的欄位。
      const changes: {
        name?: string
        permission_codes?: string[]
        is_assignable?: boolean
        is_external_allowed?: boolean
      } = {}
      if (trimmed !== editing.name) {
        changes.name = trimmed
      }
      if (!sameCodes(selected, editing.permission_codes)) {
        changes.permission_codes = selected
      }
      if (isAssignable !== Boolean(editing.is_assignable)) {
        changes.is_assignable = isAssignable
      }
      if (isExternalAllowed !== Boolean(editing.is_external_allowed)) {
        changes.is_external_allowed = isExternalAllowed
      }
      if (Object.keys(changes).length === 0) {
        resetForm()
        return
      }
      const fresh = await fetchFreshRole(editing.id, failForm)
      if (fresh) {
        setPending({ role: fresh, changes })
      }
    } catch (caught) {
      failForm(roleErrorMessage(caught))
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function confirmUpdate() {
    if (!pending) return
    if (!guard.enter()) return
    setSaving(true)
    setError('')
    setFormError(null)
    try {
      await updateRole(pending.role.id, pending.changes)
      setPending(null)
      resetForm()
      await reload()
    } catch (caught) {
      setPending(null)
      if (
        caught instanceof ManagementApiError &&
        caught.code === 'role.not_found'
      ) {
        // 正在修改的角色已被別人刪除，不能再當成修改。
        resetForm()
      }
      // 放在 resetForm 之後：它會清掉表單錯誤，錯誤要留給使用者看。
      failForm(roleErrorMessage(caught))
      await reload()
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  async function startDelete(role: Role) {
    if (!guard.enter()) return
    setError('')
    setPending(null)
    setSaving(true)
    try {
      const fresh = await fetchFreshRole(role.id)
      if (fresh) {
        setDeleting(fresh)
      }
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    if (!guard.enter()) return
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
      guard.leave()
      setDeleting(null)
      await reload()
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="roles-heading" className="roles-page">
      <UnsavedLeaveBox guard={leaveGuard} />
      <h1 id="roles-heading">{PAGE_TITLES.projectRoles}</h1>
      <FormError>{error}</FormError>
      {deleting && (
        <ConfirmBox
          busy={saving}
          key={deleting.id}
          role="region"
          confirmLabel="確認刪除角色"
          onCancel={() => setDeleting(null)}
          onConfirm={confirmDelete}
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
          onConfirm={confirmUpdate}
          title={`修改「${pending.role.name}」`}
        >
          <p>此變更{describeImpact(pending.role)}，儲存後立即生效。</p>
        </ConfirmBox>
      )}
      {loading ? <p>載入中…</p> : null}
      {!loading && roles.length === 0 ? <p>目前沒有角色。</p> : null}
      {roles.length > 0 && (
        <table className="roles-table">
          <thead>
            <tr>
              <th scope="col">角色名稱</th>
              <th scope="col">持有人數</th>
              <th scope="col">權限</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <th scope="row">{role.name}</th>
                <td data-label="持有人數">{role.user_count} 個帳號</td>
                <td data-label="權限">
                  <RolePermissionSummary
                    codes={role.permission_codes}
                    descriptions={descriptions}
                    emptyText="（無）"
                    name={role.name}
                  />
                </td>
                <td data-label="操作">
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
      <div className="roles-page-tools">
        <button
          aria-controls="creator-role-panel"
          aria-expanded={creatorRoleOpen}
          onClick={() => setCreatorRoleOpen((open) => !open)}
          type="button"
        >
          {creatorRoleOpen ? '收合新專案預設角色' : '設定新專案預設角色'}
        </button>
        <section
          aria-labelledby="creator-role-heading"
          hidden={!creatorRoleOpen}
          id="creator-role-panel"
        >
          <h2 id="creator-role-heading">新專案預設角色</h2>
          <p>新專案會把這個角色指派給負責建立專案的人。</p>
          <label>
            新專案預設角色
            <select
              disabled={loading || saving}
              onChange={(event) => {
                setCreatorRoleId(event.target.value)
                setCreatorRoleSaved(false)
              }}
              value={creatorRoleId}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={loading || saving || !creatorRoleId}
            onClick={() => void saveCreatorRole()}
            type="button"
          >
            儲存預設角色
          </button>
          {creatorRoleSaved && <p role="status">新專案預設角色已更新。</p>}
        </section>
        <button
          aria-controls="role-editor-panel"
          aria-expanded={roleFormOpen}
          onClick={() => setRoleFormOpen((open) => !open)}
          type="button"
        >
          {roleFormOpen ? '收合新增角色' : '新增角色'}
        </button>
      </div>
      {roleFormOpen && (
        <div className="roles-page-editor" id="role-editor-panel">
          <Form
            error={formError?.message}
            errorFocusRequest={formError?.request}
            errorTabIndex={-1}
            guard={guard}
            onSubmit={save}
          >
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
              <fieldset disabled={locked}>
                <legend>指派範圍</legend>
                <label>
                  <input
                    checked={isAssignable}
                    onChange={(event) => setIsAssignable(event.target.checked)}
                    type="checkbox"
                  />
                  非管理者可指派
                </label>
                <label>
                  <input
                    checked={isExternalAllowed}
                    onChange={(event) =>
                      setIsExternalAllowed(event.target.checked)
                    }
                    type="checkbox"
                  />
                  外部協作帳號可用
                </label>
              </fieldset>
            )}
            {editing && (
              <button disabled={saving} onClick={resetForm} type="button">
                取消
              </button>
            )}
            <FormSubmitButton
              className="btn-primary"
              disabled={saving || loading || locked}
            >
              {editing ? '儲存角色' : '新增角色'}
            </FormSubmitButton>
          </Form>
        </div>
      )}
    </section>
  )
}
