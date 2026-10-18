import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  Button,
  Card,
  Field,
  FormField,
  FormGroup,
  Input,
  SectionHeader,
} from '../../components'
import { ConfirmationPanel } from '../../components/layout/LayoutPatterns'
import { ManagementApiError } from '../api'
import TemporaryPassword from '../TemporaryPassword'
import { createUser, listAllPages, listCompanies } from '../api'
import type { Company, CreatedUser, User } from '../api'
import { describeRole } from '../projects/roleDescriptions'
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
type Provisioning = {
  userId: string
  bundleId: string | null
  roleId: string
  projectId: string
  bundleDone: boolean
  memberDone: boolean
}

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

const PROFILE_BUNDLE_CODES: Partial<Record<Profile, string[]>> = {
  office: ['project.use', 'project.create', 'inspection.use', 'template.use'],
  field: ['project.use', 'inspection.use'],
  contractor: ['project.use', 'inspection.use'],
}

const PROJECT_READ_ROLE_CODES = [
  'project.read',
  'project_inspection_item.read',
  'project_zone.read',
  'inspection_plan.read',
  'inspection_task.read',
]

const PROFILE_ROLE_CODES: Partial<Record<Profile, string[]>> = {
  field: [...PROJECT_READ_ROLE_CODES, 'inspection_task.inspect'],
  contractor: PROJECT_READ_ROLE_CODES,
}

function samePermissionCodes(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalizedLeft = [...new Set(left)].sort()
  const normalizedRight = [...new Set(right)].sort()
  return (
    normalizedLeft.length === left.length &&
    normalizedLeft.every((code, index) => code === normalizedRight[index])
  )
}

function profileDefaultBundle(
  bundles: PermissionBundle[],
  profile: Profile,
): PermissionBundle | null {
  const name = PROFILE_BUNDLES[profile]
  const expectedCodes = PROFILE_BUNDLE_CODES[profile]
  if (!name || !expectedCodes) return null
  const named = bundles.filter((bundle) => bundle.name === name)
  if (named.length === 1) {
    return samePermissionCodes(named[0].permission_codes, expectedCodes)
      ? named[0]
      : null
  }
  if (named.length > 1) return null
  const matching = bundles.filter((bundle) =>
    samePermissionCodes(bundle.permission_codes, expectedCodes),
  )
  return matching.length === 1 ? matching[0] : null
}

function profileDefaultRole(
  roles: Role[],
  profile: Profile,
  creatorRoleId: string,
): Role | null {
  if (profile === 'system' || profile === 'office') {
    return roles.find((role) => role.id === creatorRoleId) ?? null
  }
  const expectedCodes = PROFILE_ROLE_CODES[profile]
  if (!expectedCodes) return null
  const matching = roles.filter(
    (role) =>
      role.is_assignable === true &&
      role.is_external_allowed === (profile === 'contractor') &&
      samePermissionCodes(role.permission_codes, expectedCodes),
  )
  return matching.length === 1 ? matching[0] : null
}

function profileRoleLabel(
  roles: Role[],
  profile: Profile,
  creatorRoleId: string,
): string {
  return (
    profileDefaultRole(roles, profile, creatorRoleId)?.name ??
    PROFILE_ACCESS[profile].projectRole
  )
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
  const [candidateRoles, setCandidateRoles] = useState<Role[]>([])
  const [selectedCandidateRole, setSelectedCandidateRole] = useState('')
  const [safeCandidateRole, setSafeCandidateRole] = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [userAccess, setUserAccess] = useState<string[]>([])
  const [delegatedModules, setDelegatedModules] = useState<string[]>([])
  const [accessLoadedFor, setAccessLoadedFor] = useState('')
  const [profile, setProfile] = useState<Profile>('office')
  const [identity, setIdentity] = useState<StaffIdentity>('internal')
  const [step, setStep] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(false)
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
  const [nameEn, setNameEn] = useState('')
  const [department, setDepartment] = useState('')
  const [location, setLocation] = useState('')
  const [employeeNo, setEmployeeNo] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [createdId, setCreatedId] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [createdName, setCreatedName] = useState('')
  const [provisioning, setProvisioning] = useState<Provisioning | null>(null)
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

  function resetWizard() {
    setUsername('')
    setEmail('')
    setName('')
    setNameEn('')
    setDepartment('')
    setLocation('')
    setEmployeeNo('')
    setCompanyId('')
    setProjectId('')
    setIdentity('internal')
    setProfile('office')
    setStep(0)
    setCreatedId('')
    setCreatedName('')
    setTemporaryPassword('')
    setProvisioning(null)
    setPartial('')
    setError('')
  }

  async function refresh() {
    const [
      userRows,
      companyRows,
      permissionRows,
      bundleRows,
      roleRows,
      projectRows,
      creatorRole,
    ] = await Promise.all([
      listAllPages<User>('/users'),
      listCompanies(),
      listModulePermissions(),
      listPermissionBundles(),
      listRoles(),
      listAllPages<Project>('/projects'),
      getCreatorRole(),
    ])
    setUsers(userRows)
    setCompanies(companyRows)
    setPermissions(permissionRows)
    setBundles(bundleRows)
    setRoles(roleRows)
    setProjects(projectRows)
    setCreatorRoleId(creatorRole.role_id)
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
    const bundleName = PROFILE_BUNDLES[profile]
    const matchingBundle = profileDefaultBundle(bundles, profile)
    const role = profileDefaultRole(roles, profile, creatorRoleId)
    if (bundleName && !matchingBundle) {
      setError(`無法建立帳號：找不到唯一的預設權限組合「${bundleName}」。`)
      return
    }
    if (!role) {
      setError(
        `無法建立帳號：找不到唯一且符合權限需求的預設專案角色「${PROFILE_ACCESS[profile].projectRole}」。`,
      )
      return
    }
    setBusy(true)
    setError('')
    setPartial('')
    try {
      const created = await createUser({
        username: username.trim(),
        email: email.trim(),
        name_zh: name.trim(),
        name_en: nameEn.trim() || null,
        company_id: companyId || null,
        department: department.trim() || null,
        location: location.trim() || null,
        employee_no: employeeNo.trim() || null,
        is_external_collaborator: identity === 'external',
        is_admin: profile === 'system',
      })
      setCreatedId(created.id)
      setCreatedName(created.name_zh || created.username)
      setTemporaryPassword(created.temporary_password)
      setUsers((current) => [
        created,
        ...current.filter((row) => row.id !== created.id),
      ])
      setSelectedUser(created.id)
      const nextProvisioning: Provisioning = {
        userId: created.id,
        bundleId: matchingBundle?.id ?? null,
        roleId: role.id,
        projectId,
        bundleDone: profile === 'system',
        memberDone: !projectId,
      }
      setProvisioning(nextProvisioning)
      await finishProvisioning(nextProvisioning, created)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function finishProvisioning(
    pending: Provisioning,
    created?: CreatedUser,
  ) {
    let next = pending
    try {
      if (next.bundleId && !next.bundleDone) {
        await applyPermissionBundle(next.userId, next.bundleId)
        next = { ...next, bundleDone: true }
        setProvisioning(next)
      }
      if (next.projectId && !next.memberDone) {
        try {
          await addProjectMember(next.projectId, next.userId, [next.roleId])
        } catch (caught) {
          const isConflict =
            caught instanceof ManagementApiError &&
            caught.status === 409 &&
            caught.code === 'project.member_conflict'
          if (!isConflict) throw caught
          const members = await listProjectMembers(next.projectId)
          const existingMember = members.find(
            (member) => member.user_id === next.userId,
          )
          const expectedRoleExists =
            existingMember?.role_ids.length === 1 &&
            existingMember.role_ids.includes(next.roleId)
          if (!expectedRoleExists) throw caught
        }
        next = { ...next, memberDone: true }
        setProvisioning(next)
      }
      setPartial('帳號、權限組合及所選專案已完成。')
      setStep(4)
      setUsername('')
      setEmail('')
      setName('')
      setNameEn('')
      setDepartment('')
      setLocation('')
      setEmployeeNo('')
      setCompanyId('')
      setProjectId('')
      if (created) {
        setCreatedName(created.name_zh || created.username)
        setTemporaryPassword(created.temporary_password)
      }
    } catch (caught) {
      setError(message(caught))
      setPartial('帳號已建立；後續授權或專案加入未完成。')
    }
  }

  async function retryProvisioning() {
    if (!provisioning) return
    setBusy(true)
    setError('')
    await finishProvisioning(provisioning)
    setBusy(false)
  }

  function startAnotherStaff() {
    resetWizard()
    setWizardOpen(true)
  }

  async function diagnose() {
    setMemberRoles([])
    setCandidateRoles([])
    setSelectedCandidateRole('')
    setSafeCandidateRole('')
    if (!selectedUser) return
    const selected = users.find((user) => user.id === selectedUser)
    const hasPermission = (code: string) =>
      selected?.is_admin === true || userAccess.includes(code)
    if (diagnosticAction === 'create-project') {
      setNotice(
        hasPermission('project.create') &&
          selected?.is_external_collaborator !== true
          ? '可以建立專案。'
          : '缺少建立專案的模組使用權。',
      )
      return
    }
    if (diagnosticAction === 'template') {
      setNotice(
        hasPermission('template.manage')
          ? '可以管理範本庫。'
          : '缺少管理範本庫的模組使用權。',
      )
      return
    }
    const moduleCode =
      diagnosticAction === 'members' ? 'project.use' : 'inspection.use'
    const requiredRole =
      diagnosticAction === 'members' ? 'project_member.manage' : null
    if (!hasPermission(moduleCode)) {
      setNotice(
        diagnosticAction === 'members'
          ? '缺少專案管理功能的模組使用權。'
          : '缺少查核功能的模組使用權。',
      )
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
    if (allowed) {
      setNotice('這個人具備此操作所需的有效權限。')
      return
    }
    const candidates = roles.filter((role) => {
      const canPerform = requiredRole
        ? role.permission_codes.includes(requiredRole)
        : role.permission_codes.some((code) =>
            ['inspection_task.read', 'inspection_task.inspect'].includes(code),
          )
      return (
        canPerform &&
        (!selected?.is_external_collaborator || role.is_external_allowed)
      )
    })
    setCandidateRoles(candidates)
    const minimumFieldRoleCodes = PROFILE_ROLE_CODES.field ?? []
    const minimalCandidates = candidates.filter(
      (role) =>
        role.name === '現場工程師' &&
        role.is_assignable === true &&
        role.is_external_allowed === false &&
        samePermissionCodes(role.permission_codes, minimumFieldRoleCodes),
    )
    if (
      diagnosticAction === 'task-list' &&
      minimalCandidates.length === 1 &&
      minimalCandidates[0].name === '現場工程師' &&
      minimalCandidates[0].permission_codes.includes('inspection_task.inspect')
    ) {
      setSafeCandidateRole(minimalCandidates[0].id)
      setSelectedCandidateRole(minimalCandidates[0].id)
    }
    setNotice(
      requiredRole
        ? '這個專案裡沒有可以管理成員的角色。'
        : '這個專案裡沒有可以查看或執行任務的角色。',
    )
  }

  async function repairDiagnosticRole() {
    if (!selectedUser || !diagnosticProject) return
    const selected = users.find((user) => user.id === selectedUser)
    if (!selected || selected.is_admin) return
    const candidate = roles.find((role) => role.id === selectedCandidateRole)
    if (!candidate) {
      setError('請先選擇符合需求的專案角色，沒有變更資料。')
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
    candidateRoles.length > 0 && Boolean(diagnosticProject)

  return (
    <div className="admin-page permission-management">
      <SectionHeader
        title="人員權限"
        description="先選職務，再確認人員實際可使用的功能。"
      />
      {error && <p role="alert">{error}</p>}
      <Card>
        <h2>人員清單</h2>
        <p>選取人員查看目前能力，或新增人員並依職務完成設定。</p>
        <Button onClick={() => setWizardOpen(true)}>新增人員</Button>
        <Field id="people-search" label="搜尋人員">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <ul aria-label="人員清單">
          {visibleUsers.map((user) => (
            <li key={user.id}>
              <Button
                variant="tertiary"
                onClick={() => {
                  setSelectedUser(user.id)
                  setWizardOpen(false)
                  setTemporaryPassword('')
                  if (step === 4) resetWizard()
                }}
              >
                {user.name_zh || user.username}
              </Button>
              {' · '}
              {user.is_external_collaborator
                ? '外部協作人員'
                : user.is_admin
                  ? '系統管理者'
                  : '內部人員'}
              {' · '}
              {user.is_admin
                ? '系統管理'
                : user.is_external_collaborator
                  ? '外包顧問'
                  : '依模組權限與專案角色'}
            </li>
          ))}
        </ul>
      </Card>
      {selectedUser && (
        <Card>
          <h2>人員能力與快速檢查</h2>
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
            <label>
              要檢查的操作
              <select
                value={diagnosticAction}
                onChange={(event) => {
                  setDiagnosticAction(event.target.value)
                  setNotice('')
                  setCandidateRoles([])
                }}
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
                  onChange={(event) => {
                    setDiagnosticProject(event.target.value)
                    setNotice('')
                    setCandidateRoles([])
                  }}
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
            <Button
              disabled={accessLoadedFor !== selectedUser}
              onClick={() => void diagnose()}
            >
              檢查有效權限
            </Button>
            {canRepairProjectRole && (
              <section aria-label="可選專案角色">
                <h3>可補上的專案角色</h3>
                {safeCandidateRole ? (
                  <Button
                    disabled={busy}
                    onClick={() => void repairDiagnosticRole()}
                  >
                    補上「現場工程師」角色
                  </Button>
                ) : (
                  <>
                    <p>請先比較角色能做的事，再選擇符合需求的角色。</p>
                    {candidateRoles.map((role) => (
                      <label key={role.id}>
                        <input
                          checked={selectedCandidateRole === role.id}
                          name="diagnostic-role"
                          type="radio"
                          onChange={() => setSelectedCandidateRole(role.id)}
                        />
                        <strong>{role.name}</strong>
                        <span>{describeRole(role.permission_codes)}</span>
                      </label>
                    ))}
                    <Button
                      disabled={busy || !selectedCandidateRole}
                      onClick={() => void repairDiagnosticRole()}
                    >
                      指派所選角色
                    </Button>
                  </>
                )}
                <Link to={`/admin/projects/${diagnosticProject}/members`}>
                  前往專案成員設定
                </Link>
              </section>
            )}
            {notice.includes('缺少') && notice.includes('模組使用權') && (
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
        </Card>
      )}
      {wizardOpen && (
        <Card>
          {step === 4 ? (
            <section aria-label="建立完成">
              <h2>人員已建立</h2>
              <p>{createdName} 的帳號與授權設定已完成。</p>
              <p>請現在把以下臨時密碼交給本人；離開此畫面後就無法再查看。</p>
              <TemporaryPassword password={temporaryPassword} />
              <p>下一步可以新增另一位人員，或查看這位人員的能力摘要。</p>
              <Button onClick={startAnotherStaff}>新增另一位人員</Button>
              <Button
                onClick={() => {
                  setWizardOpen(false)
                  setTemporaryPassword('')
                  setSelectedUser(createdId)
                }}
              >
                查看這個人的能力
              </Button>
            </section>
          ) : (
            <>
              <h2>職務起手式</h2>
              <p>建立後可再調整；系統管理者不套用一般權限組合。</p>
              <nav aria-label="建立人員步驟">
                <ol className="layout-setup-steps module-permission-wizard-steps">
                  {['身分', '職務', '專案', '確認'].map((label, index) => {
                    const stateClass =
                      index < step
                        ? 'layout-step-complete'
                        : index === step
                          ? 'layout-step-current'
                          : ''
                    const stateLabel =
                      index < step
                        ? '已完成'
                        : index === step
                          ? '目前步驟'
                          : '尚未開始'
                    return (
                      <li className={`layout-step ${stateClass}`} key={label}>
                        <Button
                          aria-current={index === step ? 'step' : undefined}
                          className="layout-step-copy module-permission-wizard-step-copy"
                          onClick={() => goToStep(index)}
                        >
                          <span className="layout-step-marker">
                            {index + 1}
                          </span>
                          <span className="layout-step-label">{label}</span>
                          <span className="layout-step-status">
                            {stateLabel}
                          </span>
                        </Button>
                      </li>
                    )
                  })}
                </ol>
              </nav>
              {step === 0 && (
                <FormGroup title="帳號資料" description="設定登入與人員資料。">
                  <FormField label="身分">
                    {(control) => (
                      <select
                        {...control}
                        disabled={Boolean(createdId)}
                        value={identity}
                        onChange={(event) => {
                          const next = event.target.value as StaffIdentity
                          setIdentity(next)
                          setProfile(
                            next === 'external' ? 'contractor' : 'office',
                          )
                          setError('')
                        }}
                      >
                        <option value="internal">內部人員</option>
                        <option value="external">外部協作人員</option>
                      </select>
                    )}
                  </FormField>
                  <FormField label="帳號名稱" required>
                    {(control) => (
                      <Input
                        {...control}
                        value={username}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setUsername(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="中文姓名" required>
                    {(control) => (
                      <Input
                        {...control}
                        value={name}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="英文姓名">
                    {(control) => (
                      <Input
                        {...control}
                        value={nameEn}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setNameEn(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="電子郵件" required>
                    {(control) => (
                      <Input
                        {...control}
                        type="email"
                        value={email}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="公司">
                    {(control) => (
                      <select
                        {...control}
                        disabled={Boolean(createdId)}
                        value={companyId}
                        onChange={(event) => setCompanyId(event.target.value)}
                      >
                        <option value="">未連結公司</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                  <FormField label="部門">
                    {(control) => (
                      <Input
                        {...control}
                        value={department}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setDepartment(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="地點">
                    {(control) => (
                      <Input
                        {...control}
                        value={location}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setLocation(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="工號">
                    {(control) => (
                      <Input
                        {...control}
                        value={employeeNo}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setEmployeeNo(event.target.value)}
                      />
                    )}
                  </FormField>
                </FormGroup>
              )}
              {step === 1 && (
                <fieldset>
                  <legend>選擇職務</legend>
                  {PROFILE_OPTIONS.filter((option) =>
                    identity === 'external'
                      ? option.id === 'contractor'
                      : option.id !== 'contractor',
                  ).map((option) => (
                    <label
                      key={option.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(0, 1fr)',
                        gap: 'var(--space-2)',
                        padding: 'var(--space-3)',
                        border: '1px solid var(--color-border-control)',
                        borderRadius: 'var(--radius-control)',
                      }}
                    >
                      <input
                        checked={profile === option.id}
                        disabled={Boolean(createdId)}
                        name="profile"
                        type="radio"
                        onChange={() => setProfile(option.id)}
                      />
                      <span>
                        <strong>{option.label}</strong>
                        <br />
                        {option.summary}
                        <br />
                        <small>
                          可做：{PROFILE_ACCESS[option.id].can.join('、')}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {step === 2 && (
                <label>
                  加入專案（可略過）
                  <select
                    disabled={Boolean(createdId)}
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
                    {
                      PROFILE_OPTIONS.find((item) => item.id === profile)
                        ?.label
                    }
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
                          {
                            projects.find((item) => item.id === projectId)
                              ?.name
                          }
                          」 擁有「
                          {profileRoleLabel(roles, profile, creatorRoleId)}
                          」角色
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
                      : '系統管理者權限來自系統身分'}
                    {`；預設專案角色「${profileRoleLabel(roles, profile, creatorRoleId)}」。`}
                    {identity === 'external' &&
                      ' 外部人員只會取得外部可用權限與角色。'}
                  </small>
                  {!createdId ? (
                    <Button
                      disabled={busy || !username || !name || !email}
                      onClick={() => void createStaff()}
                    >
                      建立人員
                    </Button>
                  ) : (
                    <>
                      <p role="status">
                        {partial}{' '}
                        請確認已建立的帳號資料，並完成尚未成功的步驟。
                      </p>
                      {temporaryPassword && (
                        <>
                          <p>臨時密碼只會顯示這一次；離開後無法再查看。</p>
                          <TemporaryPassword password={temporaryPassword} />
                        </>
                      )}
                      <Button
                        disabled={busy}
                        onClick={() => void retryProvisioning()}
                      >
                        重試未完成的步驟
                      </Button>
                    </>
                  )}
                </div>
              )}
              {step < 3 && (
                <div>
                  <Button
                    disabled={step === 0 || Boolean(createdId)}
                    onClick={() => goToStep(step - 1)}
                  >
                    上一步
                  </Button>
                  <Button
                    disabled={Boolean(createdId)}
                    onClick={() => goToStep(step + 1)}
                  >
                    下一步
                  </Button>
                </div>
              )}
              {partial && step !== 3 && <p role="status">{partial}</p>}
            </>
          )}
        </Card>
      )}
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
              <li
                key={bundle.id}
                style={{
                  display: 'grid',
                  gap: 'var(--space-2)',
                  paddingBlock: 'var(--space-3)',
                  borderBlockEnd: '1px solid var(--color-border)',
                }}
              >
                <strong>{bundle.name}</strong>
                <span>{bundle.permission_codes.join('、')}</span>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 'var(--space-2)',
                  }}
                >
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
                </div>
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
          <ul aria-label="角色治理清單">
            {roles.map((role) => (
              <li
                key={role.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  paddingBlock: 'var(--space-2)',
                  borderBlockEnd: '1px solid var(--color-border)',
                }}
              >
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
                  外部可用
                </label>
              </li>
            ))}
          </ul>
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
