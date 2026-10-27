import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useMatch, useNavigate } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { isForbidden, isNotFound } from '../../http'
import { isResourceId } from '../../resourceId'
import RouteNotFound from '../../RouteNotFound'
import { BackLink } from '../../layout/BackLink'
import { ManagementApiError } from '../api'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { Notice } from '../../ui/Notice'
import { revealElement } from '../../ui/reveal'
import { Form, FormError, FormSubmitButton, RequiredMark } from '../../ui/Form'
import { useSubmitGuard } from '../../ui/submitGuard'
import { UnsavedLeaveBox } from '../../ui/navigation'
import * as navigationGuard from '../../ui/navigation'
import { PAGE_TITLES } from '../../layout/navigationLabels'
import RolePermissionSummary from '../projects/RolePermissionSummary'
import '../../styles/g7-shell.css'
import './RolesPage.css'
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
  type RoleInput,
} from './api'

const NO_PERMISSIONS_TEXT = '目前尚無可設定的權限，功能上線後會出現'

// 權限勾選區的分組只為了畫面好讀，依代碼前綴歸類；不屬於任何分組的
// 代碼（例如之後才登記的）會列在「其他」，不會被藏起來。
const PERMISSION_GROUPS = [
  { title: '查核計畫', prefixes: ['inspection_plan.'] },
  { title: '查核任務', prefixes: ['inspection_task.'] },
  {
    title: '專案',
    prefixes: ['project.', 'all_project_progress.'],
  },
  { title: '專案查核項目', prefixes: ['project_inspection_item.'] },
  { title: '成員', prefixes: ['project_member.'] },
  { title: '分區', prefixes: ['project_zone.'] },
]

// 權限集合不看順序；用來判斷哪些欄位真的有變動。
function sameCodes(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().join('\n') === [...right].sort().join('\n')
  )
}

type RoleMode = 'list' | 'detail' | 'new' | 'edit'

/** ADM-R55：角色清單、唯讀詳情與表單各有網址，無效路徑不打 API。 */
export default function RolesPage() {
  const { user } = useCurrentUser()
  const location = useLocation()
  const list = useMatch('/roles')
  const creating = useMatch('/roles/new')
  const detail = useMatch('/roles/:roleId')
  const edit = useMatch('/roles/:roleId/edit')
  const mode: RoleMode = creating
    ? 'new'
    : edit
      ? 'edit'
      : detail
        ? 'detail'
        : 'list'
  const roleId =
    mode === 'new' || mode === 'list'
      ? ''
      : ((edit ?? detail)?.params.roleId ?? '')
  if (
    (!list && !creating && !detail && !edit) ||
    (roleId &&
      (!isResourceId(roleId) ||
        ['new', 'creator-role', 'permission-codes'].includes(roleId)))
  ) {
    return <RouteNotFound />
  }
  if (!user.is_admin) return <AccessDeniedPage />
  // 換資源或表單就重建草稿；flash state 的 replace 不會重建同一頁。
  return (
    <RoleScreen
      key={`${mode}:${roleId}:${location.search}`}
      mode={mode}
      roleId={roleId}
    />
  )
}

function RoleScreen({ mode, roleId }: { mode: RoleMode; roleId: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const listPath = `/roles${location.search}`
  const rolePath = `/roles/${encodeURIComponent(roleId)}`
  const editPath = `${rolePath}/edit${location.search}`
  const detailPath = (id: string) =>
    `/roles/${encodeURIComponent(id)}${location.search}`
  const [roles, setRoles] = useState<Role[]>([])
  const [permissions, setPermissions] = useState<PermissionCode[]>([])
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [isAssignable, setIsAssignable] = useState(false)
  const [isExternalAllowed, setIsExternalAllowed] = useState(false)
  const [creatorRoleId, setCreatorRoleId] = useState('')
  const [creatorRoleSaved, setCreatorRoleSaved] = useState(false)
  const [creatorRoleOpen, setCreatorRoleOpen] = useState(false)
  const [deleting, setDeleting] = useState<Role | null>(null)
  const [pending, setPending] = useState<{
    role: Role
    changes: RoleInput
  } | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [creatorError, setCreatorError] = useState('')
  const [formError, setFormError] = useState<{
    message: string
    request: number
  } | null>(null)
  const [fieldError, setFieldError] = useState<{
    field: 'name' | 'permissions' | 'assignable' | 'external'
    message: string
  } | null>(null)
  const [notice, setNotice] = useState(() => {
    const text = (location.state as { managementNotice?: unknown } | null)
      ?.managementNotice
    return typeof text === 'string' ? text : ''
  })
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [forbidden, setForbidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [saving, setSaving] = useState(false)
  const initialized = useRef(false)
  const editorRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const permissionsRef = useRef<HTMLFieldSetElement>(null)
  const assignableRef = useRef<HTMLInputElement>(null)
  const externalRef = useRef<HTMLInputElement>(null)
  const guard = useSubmitGuard()
  const role = roles.find((item) => item.id === roleId) ?? null
  const editing = mode === 'edit' ? role : null
  const locked = pending !== null
  const descriptions = new Map(permissions.map((p) => [p.code, p.description]))
  const otherPermissions = permissions.filter(
    (item) =>
      !PERMISSION_GROUPS.some((group) =>
        group.prefixes.some((prefix) => item.code.startsWith(prefix)),
      ),
  )
  const unregistered = (editing?.permission_codes ?? []).filter(
    (code) => !descriptions.has(code),
  )
  const dirty =
    mode === 'edit' && editing
      ? name !== editing.name ||
        !sameCodes(selected, editing.permission_codes) ||
        isAssignable !== Boolean(editing.is_assignable) ||
        isExternalAllowed !== Boolean(editing.is_external_allowed)
      : mode === 'new' && (name !== '' || selected.length > 0)
  const leaveGuard = navigationGuard.useUnsavedNavigationGuard(
    Boolean(dirty && !forbidden && !notFound),
  )

  useEffect(() => {
    const state = location.state as Record<string, unknown> | null
    if (!state || !Object.hasOwn(state, 'managementNotice')) return
    const rest = { ...state }
    delete rest.managementNotice
    leaveGuard.allowNavigation(() =>
      navigate(location.pathname + location.search + location.hash, {
        replace: true,
        state: Object.keys(rest).length ? rest : null,
      }),
    )
  }, [
    location.state,
    location.pathname,
    location.search,
    location.hash,
    leaveGuard,
    navigate,
  ])

  useEffect(() => {
    let active = true
    const rows =
      mode === 'list'
        ? listRoles()
        : roleId
          ? getRole(roleId).then((item) => [item])
          : Promise.resolve<Role[]>([])
    void Promise.all([rows, listPermissionCodes(), getCreatorRole()])
      .then(
        ([items, codes, creator]) => {
          if (!active) return
          setRoles(items)
          setPermissions(codes)
          setCreatorRoleId(creator.role_id)
          if (mode === 'edit' && !initialized.current && items[0]) {
            initialized.current = true
            setName(items[0].name)
            setSelected(items[0].permission_codes)
            setIsAssignable(Boolean(items[0].is_assignable))
            setIsExternalAllowed(Boolean(items[0].is_external_allowed))
          }
        },
        (caught: unknown) => {
          if (!active) return
          setForbidden(isForbidden(caught))
          setNotFound(Boolean(roleId && isNotFound(caught)))
          setError(roleErrorMessage(caught))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [mode, roleId, reloadKey])

  useEffect(() => {
    if (loading || error || (mode !== 'new' && mode !== 'edit')) return
    revealElement(editorRef.current)
    nameRef.current?.focus({ preventScroll: true })
  }, [mode, loading, error])

  useEffect(() => {
    if (!fieldError) return
    const target =
      fieldError.field === 'name'
        ? nameRef.current
        : fieldError.field === 'permissions'
          ? permissionsRef.current
          : fieldError.field === 'assignable'
            ? assignableRef.current
            : externalRef.current
    revealElement(target)
    target?.focus({ preventScroll: true })
  }, [fieldError])

  function fail(caught: unknown) {
    if (isForbidden(caught)) {
      setForbidden(true)
      return
    }
    if (
      caught instanceof ManagementApiError &&
      caught.status === 404 &&
      roleId
    ) {
      setNotFound(true)
      return
    }
    const paths =
      caught instanceof ManagementApiError
        ? (caught.fields ?? []).map((field) => field.path)
        : []
    const code = caught instanceof ManagementApiError ? caught.code : ''
    const field =
      code === 'role.name_conflict' || paths.includes('/name')
        ? 'name'
        : code === 'role.permission_code_invalid' ||
            code === 'role.creator_role_requires_permissions' ||
            paths.some((path) => path.startsWith('/permission_codes'))
          ? 'permissions'
          : paths.includes('/is_assignable')
            ? 'assignable'
            : code === 'role.external_allowed_invalid' ||
                code === 'role.external_in_use' ||
                paths.includes('/is_external_allowed')
              ? 'external'
              : null
    const message = roleErrorMessage(caught)
    if (field) setFieldError({ field, message })
    else setFormError((old) => ({ message, request: (old?.request ?? 0) + 1 }))
  }

  function saved(id: string, text: string) {
    leaveGuard.allowNavigation(() =>
      navigate(detailPath(id), {
        replace: true,
        state: { managementNotice: text },
      }),
    )
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setFieldError(null)
    setNotice('')
    if (!name.trim()) {
      setFieldError({ field: 'name', message: '請輸入角色名稱。' })
      return
    }
    setSaving(true)
    try {
      if (!editing) {
        const created = await createRole({
          name: name.trim(),
          permission_codes: selected,
        })
        saved(created.id, `已建立角色「${created.name}」。`)
        return
      }
      const changes: RoleInput = {}
      if (name.trim() !== editing.name) changes.name = name.trim()
      if (!sameCodes(selected, editing.permission_codes)) {
        changes.permission_codes = selected
      }
      if (isAssignable !== Boolean(editing.is_assignable)) {
        changes.is_assignable = isAssignable
      }
      if (isExternalAllowed !== Boolean(editing.is_external_allowed)) {
        changes.is_external_allowed = isExternalAllowed
      }
      if (!Object.keys(changes).length) {
        leaveGuard.allowNavigation(() =>
          navigate(detailPath(roleId), {
            replace: true,
          }),
        )
        return
      }
      // PR-18：修改影響以送出當下的單筆查詢為準，不用舊列表人數。
      const fresh = await getRole(roleId)
      setPending({ role: fresh, changes })
    } catch (caught) {
      fail(caught)
    } finally {
      setSaving(false)
    }
  }

  async function confirmUpdate() {
    if (!pending || !guard.enter()) return
    setSaving(true)
    setFormError(null)
    setFieldError(null)
    try {
      const updated = await updateRole(roleId, pending.changes)
      saved(roleId, `已更新角色「${updated.name}」。`)
    } catch (caught) {
      setPending(null)
      fail(caught)
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  async function startDelete() {
    if (!role || role.id === creatorRoleId || !guard.enter()) return
    setSaving(true)
    setActionError('')
    setNotice('')
    try {
      setDeleting(await getRole(role.id))
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else if (isNotFound(caught)) setNotFound(true)
      else setActionError(roleErrorMessage(caught))
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting || !guard.enter()) return
    setSaving(true)
    setActionError('')
    try {
      await deleteRole(deleting.id)
      leaveGuard.allowNavigation(() =>
        navigate(listPath, {
          replace: true,
          state: { managementNotice: `已刪除角色「${deleting.name}」。` },
        }),
      )
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else setActionError(roleErrorMessage(caught))
    } finally {
      guard.leave()
      setDeleting(null)
      setSaving(false)
    }
  }

  async function saveCreatorRole() {
    setCreatorError('')
    setCreatorRoleSaved(false)
    if (!creatorRoleId) {
      setCreatorError('請選擇新專案預設角色。')
      return
    }
    if (!guard.enter()) return
    setSaving(true)
    try {
      await setCreatorRole(creatorRoleId)
      setCreatorRoleSaved(true)
    } catch (caught) {
      if (isForbidden(caught)) setForbidden(true)
      else setCreatorError(roleErrorMessage(caught))
    } finally {
      guard.leave()
      setSaving(false)
    }
  }

  function toggleCode(code: string, checked: boolean) {
    setFieldError(null)
    setSelected((current) =>
      checked ? [...current, code] : current.filter((item) => item !== code),
    )
  }
  function describeImpact(item: Role) {
    return `會影響 ${item.project_count} 個專案中的 ${item.user_count} 個帳號`
  }

  if (forbidden) return <AccessDeniedPage />
  if (notFound)
    return (
      <section>
        <BackLink replace to={listPath}>
          返回角色清單
        </BackLink>
        <h1>找不到這個角色</h1>
      </section>
    )
  return (
    <section aria-labelledby="roles-heading" className="roles-page">
      <UnsavedLeaveBox guard={leaveGuard} />
      {mode !== 'list' && (
        <BackLink replace to={mode === 'edit' ? detailPath(roleId) : listPath}>
          {mode === 'edit' ? '返回角色詳情' : '返回角色清單'}
        </BackLink>
      )}
      <h1 id="roles-heading">
        {mode === 'list'
          ? PAGE_TITLES.projectRoles
          : mode === 'new'
            ? '新增角色'
            : mode === 'edit'
              ? `修改角色｜${role?.name ?? '載入中…'}`
              : (role?.name ?? '載入中…')}
      </h1>
      {!loading && notice && <Notice>{notice}</Notice>}
      {loading && <p>載入中…</p>}
      {error && (
        <>
          <Notice variant="error" autoReveal={false}>
            {error}
          </Notice>
          <button
            onClick={() => {
              setLoading(true)
              setError('')
              setReloadKey((key) => key + 1)
            }}
            type="button"
          >
            重新載入
          </button>
        </>
      )}
      {mode === 'list' && (
        <>
          <Link
            replace
            className="btn btn-primary"
            to={`/roles/new${location.search}`}
          >
            新增角色
          </Link>
          {!loading && !error && !roles.length && <p>目前沒有角色。</p>}
          {roles.length > 0 && (
            <section aria-label="角色清單">
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
                  {roles.map((item) => (
                    <tr key={item.id}>
                      <th scope="row">
                        <Link replace to={detailPath(item.id)}>
                          {item.name}
                        </Link>
                      </th>
                      <td data-label="持有人數">
                        {item.user_count} 個帳號
                        {item.inactive_user_count > 0 &&
                          `（含 ${item.inactive_user_count} 個已停用）`}
                      </td>
                      <td data-label="權限">
                        <RolePermissionSummary
                          buttonClassName="btn btn-emphasis"
                          codes={item.permission_codes}
                          descriptions={descriptions}
                          emptyText="（無）"
                          name={item.name}
                        />
                      </td>
                      <td data-label="操作">
                        <Link
                          replace
                          className="btn btn-emphasis"
                          aria-label={`查看角色 ${item.name}`}
                          to={detailPath(item.id)}
                        >
                          查看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          <div className="roles-page-tools">
            <button
              aria-controls="creator-role-panel"
              aria-expanded={creatorRoleOpen}
              type="button"
              onClick={() => {
                setNotice('')
                setCreatorRoleOpen(!creatorRoleOpen)
              }}
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
                  value={creatorRoleId}
                  onChange={(event) => {
                    setCreatorRoleId(event.target.value)
                    setCreatorRoleSaved(false)
                  }}
                >
                  {roles.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={loading || saving || !creatorRoleId}
                type="button"
                onClick={() => void saveCreatorRole()}
              >
                儲存預設角色
              </button>
              {creatorError && <Notice variant="error">{creatorError}</Notice>}
              {creatorRoleSaved && <Notice>新專案預設角色已更新。</Notice>}
            </section>
          </div>
        </>
      )}
      {mode === 'detail' && !loading && role && (
        <>
          <dl>
            <dt>持有人數</dt>
            <dd>
              {role.user_count} 個帳號
              {role.inactive_user_count > 0 &&
                `（含 ${role.inactive_user_count} 個已停用）`}
            </dd>
            <dt>涉及專案</dt>
            <dd>{role.project_count} 個專案</dd>
            <dt>非管理者可指派</dt>
            <dd>{role.is_assignable ? '是' : '否'}</dd>
            <dt>外部協作帳號可用</dt>
            <dd>{role.is_external_allowed ? '是' : '否'}</dd>
          </dl>
          <RolePermissionSummary
            buttonClassName="btn btn-emphasis"
            codes={role.permission_codes}
            descriptions={descriptions}
            emptyText="（無）"
            name={role.name}
          />
          <section aria-label="角色操作">
            <div className="named-row-actions">
              <Link replace className="btn btn-primary" to={editPath}>
                修改角色
              </Link>
              {roleId !== creatorRoleId && (
                <button
                  className="btn-danger-outline"
                  disabled={saving}
                  type="button"
                  onClick={() => void startDelete()}
                >
                  刪除角色
                </button>
              )}
            </div>
            {roleId === creatorRoleId && (
              <p>這是建立者角色，請先改設另一個建立者角色。</p>
            )}
            {actionError && <Notice variant="error">{actionError}</Notice>}
            {deleting && (
              <ConfirmBox
                busy={saving}
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
          </section>
        </>
      )}
      {(mode === 'new' || mode === 'edit') &&
        !loading &&
        !error &&
        (mode === 'new' || editing) && (
          <Form
            ref={editorRef}
            guard={guard}
            onSubmit={save}
            noValidate
            aria-labelledby="roles-heading"
          >
            <label>
              角色名稱 <RequiredMark />
              <input
                ref={nameRef}
                disabled={locked}
                maxLength={64}
                required
                value={name}
                aria-invalid={fieldError?.field === 'name'}
                aria-describedby={
                  fieldError?.field === 'name' ? 'role-name-error' : undefined
                }
                onChange={(event) => {
                  setName(event.target.value)
                  setFieldError(null)
                }}
              />
            </label>
            {fieldError?.field === 'name' && (
              <p className="field-error" role="alert" id="role-name-error">
                {fieldError.message}
              </p>
            )}
            <fieldset
              className="roles-permissions"
              ref={permissionsRef}
              tabIndex={-1}
              aria-invalid={fieldError?.field === 'permissions'}
              aria-describedby={
                fieldError?.field === 'permissions'
                  ? 'role-permissions-error'
                  : undefined
              }
            >
              <legend>權限</legend>
              {permissions.length === 0 && unregistered.length === 0 ? (
                <p>{loading ? '載入中…' : NO_PERMISSIONS_TEXT}</p>
              ) : (
                <>
                  {PERMISSION_GROUPS.map((group) => {
                    const items = permissions.filter((item) =>
                      group.prefixes.some((prefix) =>
                        item.code.startsWith(prefix),
                      ),
                    )
                    if (items.length === 0) return null
                    return (
                      <fieldset
                        className="roles-permission-group"
                        key={group.title}
                      >
                        <legend>{group.title}</legend>
                        {items.map((item) => (
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
                      </fieldset>
                    )
                  })}
                  {otherPermissions.length > 0 && (
                    <fieldset className="roles-permission-group">
                      <legend>其他</legend>
                      {otherPermissions.map((item) => (
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
                    </fieldset>
                  )}
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
            {fieldError?.field === 'permissions' && (
              <p
                className="field-error"
                role="alert"
                id="role-permissions-error"
              >
                {fieldError.message}
              </p>
            )}
            {editing && (
              <fieldset
                disabled={locked}
                aria-describedby={
                  fieldError?.field === 'assignable' ||
                  fieldError?.field === 'external'
                    ? 'role-scope-error'
                    : undefined
                }
              >
                <legend>指派範圍</legend>
                <label>
                  <input
                    ref={assignableRef}
                    aria-invalid={fieldError?.field === 'assignable'}
                    aria-describedby={
                      fieldError?.field === 'assignable'
                        ? 'role-scope-error'
                        : undefined
                    }
                    checked={isAssignable}
                    onChange={(event) => setIsAssignable(event.target.checked)}
                    type="checkbox"
                  />
                  非管理者可指派
                </label>
                <label>
                  <input
                    ref={externalRef}
                    aria-invalid={fieldError?.field === 'external'}
                    aria-describedby={
                      fieldError?.field === 'external'
                        ? 'role-scope-error'
                        : undefined
                    }
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
            {(fieldError?.field === 'assignable' ||
              fieldError?.field === 'external') && (
              <p className="field-error" role="alert" id="role-scope-error">
                {fieldError.message}
              </p>
            )}
            <FormError focusRequest={formError?.request} tabIndex={-1}>
              {formError?.message}
            </FormError>
            <div className="named-row-actions">
              <Link
                replace
                className="btn"
                to={mode === 'edit' ? detailPath(roleId) : listPath}
              >
                取消
              </Link>
              <FormSubmitButton
                className="btn-primary"
                disabled={saving || loading || locked}
              >
                {editing ? '儲存角色' : '建立角色'}
              </FormSubmitButton>
            </div>
            {pending && (
              <ConfirmBox
                busy={saving}
                role="region"
                confirmLabel="確認修改角色"
                onCancel={() => setPending(null)}
                onConfirm={confirmUpdate}
                title={`修改「${pending.role.name}」`}
              >
                <p>此變更{describeImpact(pending.role)}，儲存後立即生效。</p>
              </ConfirmBox>
            )}
          </Form>
        )}
    </section>
  )
}
