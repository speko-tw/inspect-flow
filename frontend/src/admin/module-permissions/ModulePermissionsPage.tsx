import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import { Button, Card, Field, Input, SectionHeader } from '../../components'
import { ConfirmationPanel } from '../../components/layout/LayoutPatterns'
import { createUser, listAllPages, listCompanies } from '../api'
import type { Company, User } from '../api'
import {
  addProjectMember,
  listProjectMembers,
  setProjectMemberRoles,
  type Project,
} from '../projects/api'
import {
  getCreatorRole,
  listRoles,
  setCreatorRole,
  updateRole,
  type Role,
} from '../roles/api'
import {
  applyPermissionBundle,
  createPermissionBundle,
  deletePermissionBundle,
  getRevokeImpact,
  getUserModulePermissions,
  grantModulePermission,
  listModulePermissions,
  listPermissionBundles,
  revokeModulePermission,
  setModuleDelegation,
  updatePermissionBundle,
  type ModulePermission,
  type PermissionBundle,
  type RevokeImpact,
} from './api'

type Profile = 'system' | 'office' | 'field' | 'contractor'
type StaffIdentity = 'internal' | 'external'

const PROFILE_OPTIONS: Array<{ id: Profile; label: string; summary: string }> =
  [
    {
      id: 'system',
      label: '系統管理',
      summary: '管理所有系統功能',
    },
    {
      id: 'office',
      label: '內業規劃',
      summary: '規劃與管理已授權專案',
    },
    {
      id: 'field',
      label: '現場查核',
      summary: '執行指派的現場查核工作',
    },
    {
      id: 'contractor',
      label: '外包顧問',
      summary: '只取得核准的外部可用功能',
    },
  ]

const PROFILE_ACCESS: Record<
  Profile,
  { can: string[]; cannot: string[]; projectRole: string }
> = {
  system: {
    can: ['管理人員與權限', '查看全部專案進度', '管理專案成員'],
    cannot: ['外部協作人員不能設為系統管理者', '不能替自己建立額外權限'],
    projectRole: '專案工程師',
  },
  office: {
    can: ['規劃與查看已授權專案', '建立專案', '使用查核與範本功能'],
    cannot: ['查看未授權的專案', '管理範本庫'],
    projectRole: '專案工程師',
  },
  field: {
    can: ['查看已加入的專案', '使用查核任務'],
    cannot: ['建立專案', '管理專案成員', '管理範本庫'],
    projectRole: '現場工程師',
  },
  contractor: {
    can: ['查看已加入且有查閱角色的專案', '依專案角色查看查核資料'],
    cannot: ['建立專案', '查看其他專案', '管理成員、權限或範本庫'],
    projectRole: '專案查閱人員',
  },
}

const PROFILE_BUNDLES: Partial<Record<Profile, string>> = {
  office: '專案工程師常用',
  field: '現場工程師常用',
  contractor: '現場工程師常用',
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '操作失敗，請重試。'
}

export default function ModulePermissionsPage() {
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [permissions, setPermissions] = useState<ModulePermission[]>([])
  const [bundles, setBundles] = useState<PermissionBundle[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [memberRoles, setMemberRoles] = useState<Role[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [userAccess, setUserAccess] = useState<string[]>([])
  const [delegatedModules, setDelegatedModules] = useState<string[]>([])
  const [accessLoadedFor, setAccessLoadedFor] = useState('')
  const [profile, setProfile] = useState<Profile>('office')
  const [identity, setIdentity] = useState<StaffIdentity>('internal')
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [revoke, setRevoke] = useState<{
    code: string
    impact: RevokeImpact
  } | null>(null)
  const [bundleToDelete, setBundleToDelete] =
    useState<PermissionBundle | null>(null)
  const [bundleName, setBundleName] = useState('')
  const [bundleCodes, setBundleCodes] = useState<string[]>([])
  const [editingBundle, setEditingBundle] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [createdId, setCreatedId] = useState('')
  const [partial, setPartial] = useState('')
  const [query, setQuery] = useState('')
  const [diagnosticProject, setDiagnosticProject] = useState('')
  const [diagnosticAction, setDiagnosticAction] = useState('task-list')
  const [creatorRoleId, setCreatorRoleId] = useState('')
  const revokeTrigger = useRef<HTMLInputElement>(null)
  const bundleDeleteTrigger = useRef<HTMLButtonElement>(null)

  const profileIsAllowed =
    identity === 'external'
      ? profile === 'contractor'
      : profile !== 'contractor'

  function goToStep(nextStep: number) {
    if (!profileIsAllowed) {
      setError('請先依人員身分選擇可用職務。')
      return
    }
    setError('')
    setStep(nextStep)
  }

  async function refresh() {
    const [
      userRows,
      companyRows,
      permissionRows,
      bundleRows,
      roleRows,
      projectRows,
    ] = await Promise.all([
      listAllPages<User>('/users'),
      listCompanies(),
      listModulePermissions(),
      listPermissionBundles(),
      listRoles(),
      listAllPages<Project>('/projects'),
    ])
    setUsers(userRows)
    setCompanies(companyRows)
    setPermissions(permissionRows)
    setBundles(bundleRows)
    setRoles(roleRows)
    setProjects(projectRows)
  }

  useEffect(() => {
    let active = true
    async function load() {
      try {
        await refresh()
      } catch (caught) {
        if (active) setError(message(caught))
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!selectedUser) return
    let active = true
    getUserModulePermissions(selectedUser)
      .then((access) => {
        if (active) {
          setUserAccess(access.permission_codes)
          setDelegatedModules(access.delegated_modules)
          setAccessLoadedFor(selectedUser)
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(message(caught))
          setAccessLoadedFor(selectedUser)
        }
      })
    return () => {
      active = false
    }
  }, [selectedUser])

  const visibleUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return users.filter((user) =>
      `${user.name_zh ?? ''} ${user.username}`
        .toLocaleLowerCase()
        .includes(term),
    )
  }, [query, users])

  async function togglePermission(code: string, enabled: boolean) {
    if (!selectedUser) return
    setBusy(true)
    setError('')
    try {
      if (enabled) await grantModulePermission(selectedUser, code)
      else {
        const impact = await getRevokeImpact(selectedUser, code)
        setRevoke({ code, impact })
        return
      }
      const access = await getUserModulePermissions(selectedUser)
      setUserAccess(access.permission_codes)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function confirmRevoke() {
    if (!selectedUser || !revoke) return
    setBusy(true)
    try {
      await revokeModulePermission(selectedUser, revoke.code)
      setUserAccess((current) =>
        current.filter((code) => code !== revoke.code),
      )
      setRevoke(null)
      setNotice('權限已收回。')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function saveBundle() {
    setBusy(true)
    setError('')
    try {
      const input = { name: bundleName.trim(), permission_codes: bundleCodes }
      if (editingBundle) await updatePermissionBundle(editingBundle, input)
      else await createPermissionBundle(input)
      setBundleName('')
      setBundleCodes([])
      setEditingBundle(null)
      setBundles(await listPermissionBundles())
      setNotice('權限組合已儲存；既有使用者授權不會被改動。')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function createStaff() {
    if (!profileIsAllowed) {
      setError('請確認人員身分與職務相符。')
      return
    }
    setBusy(true)
    setError('')
    setPartial('')
    let createdUserId = ''
    try {
      const created = await createUser({
        username: username.trim(),
        email: email.trim(),
        name_zh: name.trim(),
        company_id: companyId || null,
        is_external_collaborator: identity === 'external',
        is_admin: profile === 'system',
      })
      createdUserId = created.id
      setCreatedId(created.id)
      setUsers((current) => [created, ...current])
      setSelectedUser(created.id)
      if (profile !== 'system') {
        const bundleName = PROFILE_BUNDLES[profile]
        const bundle = bundles.find((item) => item.name === bundleName)
        if (!bundle) throw new Error(`找不到預設權限組合「${bundleName}」。`)
        await applyPermissionBundle(created.id, bundle.id)
      }
      const roleName = PROFILE_ACCESS[profile].projectRole
      const role = roles.find((item) => item.name === roleName)
      if (projectId && role) {
        await addProjectMember(projectId, created.id, [role.id])
      }
      if (projectId && !role) {
        throw new Error(`找不到「${roleName}」角色，專案成員尚未加入。`)
      }
      setPartial('帳號、權限組合及所選專案已完成。')
      setStep(0)
    } catch (caught) {
      setPartial(
        createdUserId ||
          createdId ||
          users.some((user) => user.username === username)
          ? [
              '帳號已建立；後續授權或專案加入未完成。',
              '可在下方選取帳號後重試。',
              message(caught),
            ].join('')
          : '',
      )
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function diagnose() {
    setMemberRoles([])
    if (!selectedUser) return
    const selected = users.find((user) => user.id === selectedUser)
    const hasPermission = (code: string) =>
      selected?.is_admin === true || userAccess.includes(code)
    if (diagnosticAction === 'create-project') {
      setNotice(
        hasPermission('project.create') &&
          selected?.is_external_collaborator !== true
          ? '可以建立專案。'
          : '缺少「project.create」模組權限。',
      )
      return
    }
    if (diagnosticAction === 'template') {
      setNotice(
        hasPermission('template.manage')
          ? '可以管理範本庫。'
          : '缺少「template.manage」模組權限。',
      )
      return
    }
    const moduleCode =
      diagnosticAction === 'members' ? 'project.use' : 'inspection.use'
    const requiredRole =
      diagnosticAction === 'members' ? 'project_member.manage' : null
    if (!hasPermission(moduleCode)) {
      setNotice(`缺少「${moduleCode}」模組使用權。`)
      return
    }
    if (!diagnosticProject) {
      setNotice('請選擇專案，才能確認專案角色權限。')
      return
    }
    if (selected?.is_admin) {
      setNotice('系統管理者依 Admin 身分可使用此操作。')
      return
    }
    const members = await listProjectMembers(diagnosticProject)
    const member = members.find((item) => item.user_id === selectedUser)
    const codes = roles
      .filter((role) => member?.role_ids.includes(role.id))
      .flatMap((role) => role.permission_codes)
    setMemberRoles(roles.filter((role) => member?.role_ids.includes(role.id)))
    const allowed = requiredRole
      ? codes.includes(requiredRole)
      : codes.includes('inspection_task.read') ||
        codes.includes('inspection_task.inspect')
    setNotice(
      allowed
        ? '這個人具備此操作所需的有效權限。'
        : `缺少專案角色權限「${
            requiredRole ?? 'inspection_task.read 或 inspection_task.inspect'
          }」。`,
    )
  }

  async function repairDiagnosticRole() {
    if (!selectedUser || !diagnosticProject) return
    const selected = users.find((user) => user.id === selectedUser)
    if (!selected || selected.is_admin) return
    const requiredCode =
      diagnosticAction === 'members'
        ? 'project_member.manage'
        : diagnosticAction === 'task-list'
          ? null
          : undefined
    if (requiredCode === undefined) return
    const candidateRoles = roles.filter((role) => {
      const allowed = requiredCode
        ? role.permission_codes.includes(requiredCode)
        : role.permission_codes.some((code) =>
            ['inspection_task.read', 'inspection_task.inspect'].includes(code),
          )
      const externalAllowed =
        !selected.is_external_collaborator || role.is_external_allowed
      return allowed && externalAllowed
    })
    const candidate = candidateRoles.sort((left, right) => {
      const order = ['現場工程師', '專案工程師', '專案查閱人員']
      return order.indexOf(left.name) - order.indexOf(right.name)
    })[0]
    if (!candidate) {
      setError('找不到符合此人身分的專案角色，沒有變更資料。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const members = await listProjectMembers(diagnosticProject)
      const member = members.find((item) => item.user_id === selectedUser)
      if (member) {
        if (member.role_ids.includes(candidate.id)) {
          setError('目前角色已包含所需權限，沒有變更資料。')
          return
        }
        await setProjectMemberRoles(diagnosticProject, selectedUser, [
          ...member.role_ids,
          candidate.id,
        ])
      } else {
        await addProjectMember(diagnosticProject, selectedUser, [candidate.id])
      }
      await diagnose()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const canRepairProjectRole =
    notice.includes('缺少專案角色權限') && Boolean(diagnosticProject)

  return (
    <div className="admin-page permission-management">
      <SectionHeader
        title="人員權限"
        description="先選職務，再確認人員實際可使用的功能。"
      />
      {error && <p role="alert">{error}</p>}
      {notice && !selectedUser && <p role="status">{notice}</p>}
      <Card>
        <h2>職務起手式</h2>
        <p>建立後可再調整；系統管理者不套用一般權限組合。</p>
        <div aria-label="建立人員步驟" className="setup-steps">
          {['身分', '職務', '專案', '確認'].map((label, index) => (
            <Button key={label} onClick={() => goToStep(index)}>
              {index + 1}. {label}
            </Button>
          ))}
        </div>
        {step === 0 && (
          <div className="form-grid">
            <label>
              身分
              <select
                value={identity}
                onChange={(event) => {
                  const next = event.target.value as StaffIdentity
                  setIdentity(next)
                  setProfile(next === 'external' ? 'contractor' : 'office')
                  setError('')
                }}
              >
                <option value="internal">內部人員</option>
                <option value="external">外部協作人員</option>
              </select>
              {identity === 'external' && (
                <small>外部協作人員只能選「外包顧問」。</small>
              )}
            </label>
            <Field id="staff-username" label="帳號">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </Field>
            <Field id="staff-name" label="姓名">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field id="staff-email" label="電子郵件">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <label>
              公司
              <select
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                <option value="">選擇公司</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {step === 1 && (
          <fieldset>
            <legend>選擇職務</legend>
            {PROFILE_OPTIONS.filter((option) =>
              identity === 'external'
                ? option.id === 'contractor'
                : option.id !== 'contractor',
            ).map((option) => (
              <label key={option.id}>
                <input
                  checked={profile === option.id}
                  name="profile"
                  type="radio"
                  onChange={() => setProfile(option.id)}
                />
                <strong>{option.label}</strong> — {option.summary}
              </label>
            ))}
          </fieldset>
        )}
        {step === 2 && (
          <label>
            加入專案（可略過）
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">稍後再加入</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {step === 3 && (
          <div>
            <h3>建立前確認</h3>
            <p>
              {name || '新同仁'}將以「
              {PROFILE_OPTIONS.find((item) => item.id === profile)?.label}
              」加入。
            </p>
            <section aria-label="可以做">
              <h4>可以做</h4>
              <ul>
                {PROFILE_ACCESS[profile].can.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {projectId && (
                  <li>
                    在「
                    {projects.find((item) => item.id === projectId)?.name}
                    」擁有「{PROFILE_ACCESS[profile].projectRole}」角色
                  </li>
                )}
              </ul>
            </section>
            <section aria-label="不能做">
              <h4>不能做</h4>
              <ul>
                {PROFILE_ACCESS[profile].cannot.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
            <small>
              進階參考：
              {PROFILE_BUNDLES[profile]
                ? `權限組合「${PROFILE_BUNDLES[profile]}」`
                : 'Admin 權限來自系統身分，不寫入一般組合'}
              {`；預設專案角色「${PROFILE_ACCESS[profile].projectRole}」。`}
              {identity === 'external' &&
                ' 外部人員只會取得外部可用權限與角色。'}
            </small>
            <p>後續步驟若失敗，帳號會保留並顯示可重試的部分狀態。</p>
            <Button
              disabled={busy || !username || !name || !email}
              onClick={() => void createStaff()}
            >
              建立人員
            </Button>
          </div>
        )}
        {partial && <p role="status">{partial}</p>}
      </Card>
      <Card>
        <h2>人員能力與快速檢查</h2>
        <label>
          選擇人員
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
          >
            <option value="">請選擇</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name_zh || user.username}
              </option>
            ))}
          </select>
        </label>
        {selectedUser && (
          <div aria-label="人員能力摘要" role="region">
            <p role="status">
              能力摘要：
              {users.find((user) => user.id === selectedUser)?.is_admin
                ? '系統管理者可使用全部系統功能。'
                : permissions
                    .filter((item) => userAccess.includes(item.code))
                    .map((item) => item.description)
                    .join('、') || '尚無模組使用權。'}
              {memberRoles.length > 0 &&
                `；目前專案角色：${memberRoles
                  .map((role) => role.name)
                  .join('、')}`}
            </p>
            {notice && <p role="status">{notice}</p>}
            {canRepairProjectRole && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void repairDiagnosticRole()}
                >
                  補上缺少的專案角色權限
                </Button>
                <Link to={`/admin/projects/${diagnosticProject}/members`}>
                  前往指派專案角色
                </Link>
              </>
            )}
            {notice.startsWith('缺少「') && notice.includes('模組') && (
              <Button
                onClick={() => {
                  const code =
                    diagnosticAction === 'create-project'
                      ? 'project.create'
                      : diagnosticAction === 'template'
                        ? 'template.manage'
                        : diagnosticAction === 'members'
                          ? 'project.use'
                          : 'inspection.use'
                  void togglePermission(code, true)
                }}
              >
                補上缺少的模組權限
              </Button>
            )}
          </div>
        )}
        <label>
          要檢查的操作
          <select
            value={diagnosticAction}
            onChange={(event) => setDiagnosticAction(event.target.value)}
          >
            <option value="task-list">查看任務清單</option>
            <option value="create-project">建立專案</option>
            <option value="template">管理範本庫</option>
            <option value="members">管理專案成員</option>
          </select>
        </label>
        {['task-list', 'members'].includes(diagnosticAction) && (
          <label>
            專案
            <select
              value={diagnosticProject}
              onChange={(event) => setDiagnosticProject(event.target.value)}
            >
              <option value="">選擇專案</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button disabled={!selectedUser} onClick={() => void diagnose()}>
          檢查有效權限
        </Button>
        {memberRoles.length > 0 && (
          <p>目前角色：{memberRoles.map((role) => role.name).join('、')}</p>
        )}
        <p>
          任務清單需 inspection.use 與專案任務讀取／執行角色； 成員管理需
          project.use 與 project_member.manage。
        </p>
        <label>
          搜尋人員
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <ul>
          {visibleUsers.map((user) => (
            <li key={user.id}>
              <button onClick={() => setSelectedUser(user.id)} type="button">
                {user.name_zh || user.username}
              </button>
              ：{user.is_admin ? '系統管理者' : '由模組權限及專案角色共同決定'}
            </li>
          ))}
        </ul>
      </Card>
      <details>
        <summary>進階設定：委派、權限組合與逐項授權</summary>
        <Card>
          <h2>逐項模組授權</h2>
          {selectedUser && (
            <fieldset disabled={busy || accessLoadedFor !== selectedUser}>
              <legend>
                {'模組授權（已選取 '}
                {userAccess.length}
                {' 項）'}
              </legend>
              {permissions.map((item) => (
                <label key={item.code}>
                  <input
                    checked={userAccess.includes(item.code)}
                    type="checkbox"
                    onChange={(event) => {
                      if (!event.target.checked) {
                        revokeTrigger.current = event.currentTarget
                      }
                      void togglePermission(item.code, event.target.checked)
                    }}
                  />{' '}
                  {item.description} <code>{item.code}</code>
                </label>
              ))}
            </fieldset>
          )}
        </Card>
        <Card>
          <h2>委派管理</h2>
          <p>收回委派不會移除對方已授予的人員權限。</p>
          {selectedUser &&
            ['project', 'inspection', 'template'].map((module) => (
              <label key={module}>
                <input
                  disabled={accessLoadedFor !== selectedUser}
                  checked={delegatedModules.includes(module)}
                  type="checkbox"
                  onChange={(event) => {
                    const enabled = event.target.checked
                    setModuleDelegation(selectedUser, module, enabled)
                      .then(() =>
                        setDelegatedModules((current) =>
                          enabled
                            ? [...new Set([...current, module])]
                            : current.filter((item) => item !== module),
                        ),
                      )
                      .catch((caught: unknown) => setError(message(caught)))
                  }}
                />
                可管理 {module} 模組授權
              </label>
            ))}
        </Card>
        <Card>
          <h2>權限組合</h2>
          <ul>
            {bundles.map((bundle) => (
              <li key={bundle.id}>
                {bundle.name}：{bundle.permission_codes.join('、')}
                <Button
                  onClick={() => {
                    setEditingBundle(bundle.id)
                    setBundleName(bundle.name)
                    setBundleCodes(bundle.permission_codes)
                  }}
                >
                  編輯
                </Button>
                <Button
                  onClick={() =>
                    selectedUser &&
                    applyPermissionBundle(selectedUser, bundle.id)
                      .then(async () => {
                        const access =
                          await getUserModulePermissions(selectedUser)
                        setUserAccess(access.permission_codes)
                        setNotice('權限組合已完整套用。')
                      })
                      .catch((caught: unknown) => setError(message(caught)))
                  }
                >
                  套用至所選人員
                </Button>
                <Button
                  onClick={(event) => {
                    bundleDeleteTrigger.current = event.currentTarget
                    setBundleToDelete(bundle)
                  }}
                >
                  刪除定義
                </Button>
              </li>
            ))}
          </ul>
          <Field id="bundle-name" label="組合名稱">
            <Input
              value={bundleName}
              onChange={(event) => setBundleName(event.target.value)}
            />
          </Field>
          <fieldset>
            <legend>包含權限</legend>
            {permissions.map((item) => (
              <label key={item.code}>
                <input
                  checked={bundleCodes.includes(item.code)}
                  type="checkbox"
                  onChange={(event) =>
                    setBundleCodes((current) =>
                      event.target.checked
                        ? [...current, item.code]
                        : current.filter((code) => code !== item.code),
                    )
                  }
                />
                {item.description}
              </label>
            ))}
          </fieldset>
          <Button
            disabled={busy || !bundleName.trim()}
            onClick={() => void saveBundle()}
          >
            {editingBundle ? '儲存組合' : '新增組合'}
          </Button>
        </Card>
        <Card>
          <h2>快速診斷</h2>
          <p>
            建立專案需 project.create；管理成員需 project.use 與
            project_member.manage；範本管理需 template.manage。
          </p>
          <p>收回模組權限前會先重新讀取影響範圍；取消不送出收回請求。</p>
        </Card>
        <Card>
          <h2>角色治理</h2>
          <p>可指派角色會出現在專案成員選單；外部可用角色僅供外部協作者。</p>
          {roles.map((role) => (
            <div key={role.id}>
              <strong>{role.name}</strong>
              <label>
                <input
                  checked={role.is_assignable ?? true}
                  type="checkbox"
                  onChange={(event) =>
                    updateRole(role.id, {
                      is_assignable: event.target.checked,
                    })
                      .then(() => listRoles().then(setRoles))
                      .catch((caught: unknown) => setError(message(caught)))
                  }
                />
                可指派
              </label>
              <label>
                <input
                  checked={role.is_external_allowed ?? false}
                  type="checkbox"
                  onChange={(event) =>
                    updateRole(role.id, {
                      is_external_allowed: event.target.checked,
                    })
                      .then(() => listRoles().then(setRoles))
                      .catch((caught: unknown) => setError(message(caught)))
                  }
                />
                外部協作者可用
              </label>
            </div>
          ))}
          <label>
            專案建立者角色
            <select
              value={creatorRoleId}
              onFocus={() =>
                getCreatorRole().then((item) => setCreatorRoleId(item.role_id))
              }
              onChange={(event) => {
                const value = event.target.value
                setCreatorRole(value)
                  .then((item) => setCreatorRoleId(item.role_id))
                  .catch((caught: unknown) => setError(message(caught)))
              }}
            >
              <option value="">選擇角色</option>
              {roles
                .filter(
                  (role) => role.is_assignable && !role.is_external_allowed,
                )
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </label>
        </Card>
      </details>
      {revoke && (
        <ConfirmationPanel
          tone="danger"
          title="確認收回模組權限"
          subject={
            permissions.find((item) => item.code === revoke.code)
              ?.description ?? revoke.code
          }
          impact={
            `影響 ${revoke.impact.membership_count} 位專案成員；` +
            `可能失去管理權的專案：${
              revoke.impact.projects_becoming_unmanaged
                .map((project) => project.name)
                .join('、') || '無'
            }`
          }
          cancelLabel="取消"
          confirmLabel="確認收回"
          onCancel={() => setRevoke(null)}
          onConfirm={() => void confirmRevoke()}
          returnFocus={() => revokeTrigger.current?.focus()}
        />
      )}
      {bundleToDelete && (
        <ConfirmationPanel
          tone="danger"
          title="刪除權限組合定義"
          subject={bundleToDelete.name}
          impact="既有使用者已取得的權限會保留；之後無法再套用這個組合。"
          cancelLabel="取消"
          confirmLabel="刪除定義"
          onCancel={() => setBundleToDelete(null)}
          onConfirm={() => {
            void deletePermissionBundle(bundleToDelete.id)
              .then(() => {
                setBundles((current) =>
                  current.filter((item) => item.id !== bundleToDelete.id),
                )
                setBundleToDelete(null)
              })
              .catch((caught: unknown) => setError(message(caught)))
          }}
          returnFocus={() => bundleDeleteTrigger.current?.focus()}
        />
      )}
    </div>
  )
}
