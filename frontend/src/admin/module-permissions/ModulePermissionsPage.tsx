import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import permissionCodeContract from '../../permissionCodeContract'
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
import {
  UnsavedLeaveBox,
  useUnsavedNavigationGuard,
} from '../../ui/navigation'
import { ManagementApiError } from '../api'
import TemporaryPassword from '../TemporaryPassword'
import {
  createUser,
  listAllPages,
  listCompanies,
  managementErrorMessage,
} from '../api'
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
  getUserEffectiveAccess,
  getUserModulePermissions,
  getUserParticipatingProjects,
  grantModulePermission,
  listModulePermissions,
  listPermissionBundles,
  revokeModulePermission,
  setModuleDelegation,
  updatePermissionBundle,
  type ModulePermission,
  type PermissionBundle,
  type RevokeImpact,
  type ParticipatingProject,
} from './api'

type Profile = 'system' | 'manager' | 'office' | 'field' | 'external'
type Provisioning = {
  userId: string
  bundleId: string | null
  roleId: string
  projectId: string
  bundleDone: boolean
  memberDone: boolean
  mergeExistingRoles: boolean
}

const PROFILE_OPTIONS: Array<{ id: Profile; label: string; summary: string }> =
  [
    {
      id: 'system',
      label: '系統管理',
      summary: '管理所有系統功能',
    },
    {
      id: 'manager',
      label: '主管',
      summary: '查看全公司專案進度',
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
      id: 'external',
      label: '外部協作',
      summary: '只看被加入的專案',
    },
  ]

// DOM-R35、DOM-R72：委派選項沿用權限登記表的外部可用標記。
const EXTERNAL_ALLOWED_PERMISSION_CODES = new Set(
  permissionCodeContract.codes
    .filter((item) => item.external_allowed)
    .map((item) => item.code),
)

const PROFILE_ACCESS: Record<
  Profile,
  { can: string[]; cannot: string[]; projectRole: string }
> = {
  system: {
    can: ['管理帳號與權限', '查看全部專案進度', '管理專案成員'],
    cannot: ['外部協作人員不能設為系統管理者', '不能替自己建立額外權限'],
    projectRole: '專案工程師',
  },
  manager: {
    can: ['查看全部專案進度'],
    cannot: ['不能建立專案', '不能管理專案成員'],
    projectRole: '無',
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
  external: {
    can: ['查看已加入且有查閱角色的專案', '依專案角色查看查核資料'],
    cannot: ['建立專案', '查看其他專案', '管理成員、權限或範本庫'],
    projectRole: '專案查閱人員',
  },
}

const PROFILE_BUNDLES: Partial<Record<Profile, string>> = {
  manager: '公司主管',
  office: '專案工程師常用',
  field: '現場工程師常用',
  external: '現場工程師常用',
}

const PROFILE_BUNDLE_CODES: Partial<Record<Profile, string[]>> = {
  manager: ['project.use', 'all_project_progress.read'],
  office: ['project.use', 'project.create', 'inspection.use', 'template.use'],
  field: ['project.use', 'inspection.use'],
  external: ['project.use', 'inspection.use'],
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
  external: PROJECT_READ_ROLE_CODES,
}

const JOB_REAPPLY_EXPLANATION = [
  '依職務補上功能；職務含專案角色且選了專案時',
  '會加入該角色，不移除既有功能或角色。',
].join('')

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
  if (profile === 'manager') return null
  if (profile === 'system' || profile === 'office') {
    return roles.find((role) => role.id === creatorRoleId) ?? null
  }
  const expectedCodes = PROFILE_ROLE_CODES[profile]
  if (!expectedCodes) return null
  const matching = roles.filter(
    (role) =>
      role.is_assignable === true &&
      role.is_external_allowed === (profile === 'external') &&
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

function ModulePermissionsNavigationGuard({
  hasUnsavedChanges,
}: {
  hasUnsavedChanges: boolean
}) {
  const guard = useUnsavedNavigationGuard(hasUnsavedChanges)
  return <UnsavedLeaveBox guard={guard} />
}

type ModulePermissionsPageProps = {
  embedded?: boolean
  openWizardRequest?: number
  selectedUserId?: string
  onTemporaryPassword?: (username: string, password: string) => void
  externalNavigationGuard?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onWizardBackToList?: () => void
  onWizardViewUser?: (id: string) => void
}

export default function ModulePermissionsPage(
  props: ModulePermissionsPageProps = {},
) {
  const remountKey =
    props.selectedUserId ?? `wizard:${props.openWizardRequest ?? 0}`
  return <ModulePermissionsPageContent key={remountKey} {...props} />
}

function ModulePermissionsPageContent({
  embedded = false,
  openWizardRequest = 0,
  selectedUserId,
  onTemporaryPassword,
  externalNavigationGuard = false,
  onDirtyChange,
  onWizardBackToList,
  onWizardViewUser,
}: ModulePermissionsPageProps) {
  const { user: currentUser } = useCurrentUser()
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [permissions, setPermissions] = useState<ModulePermission[]>([])
  const [bundles, setBundles] = useState<PermissionBundle[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [participationResult, setParticipationResult] = useState<{
    userId: string
    reloadRequest: number
    projects: ParticipatingProject[]
    error: string
  } | null>(null)
  const [participationReload, setParticipationReload] = useState(0)
  const [candidateRoles, setCandidateRoles] = useState<Role[]>([])
  const [selectedCandidateRole, setSelectedCandidateRole] = useState('')
  const [safeCandidateRole, setSafeCandidateRole] = useState('')
  const [selectedUserState, setSelectedUserState] = useState('')
  const selectedUser = selectedUserId ?? selectedUserState
  const selectedUserIsExternal = Boolean(
    users.find((user) => user.id === selectedUser)?.is_external_collaborator,
  )
  const visiblePermissions = selectedUserIsExternal
    ? permissions.filter((item) =>
        EXTERNAL_ALLOWED_PERMISSION_CODES.has(item.code),
      )
    : permissions
  const participationForSelectedUser =
    participationResult?.userId === selectedUser &&
    participationResult.reloadRequest === participationReload
      ? participationResult
      : null
  const [userAccess, setUserAccess] = useState<string[]>([])
  const [accessDraft, setAccessDraft] = useState<string[]>([])
  const [delegatedModules, setDelegatedModules] = useState<string[]>([])
  const [accessLoadedFor, setAccessLoadedFor] = useState('')
  const [profile, setProfile] = useState<Profile | null>(null)
  const [step, setStep] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(
    () => openWizardRequest > 0 && selectedUserId === undefined,
  )
  const [existingAccount, setExistingAccount] = useState(false)
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
  const [createdUsername, setCreatedUsername] = useState('')
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [createdName, setCreatedName] = useState('')
  const [provisioning, setProvisioning] = useState<Provisioning | null>(null)
  const [partial, setPartial] = useState('')
  const [query, setQuery] = useState('')
  const [diagnosticProject, setDiagnosticProject] = useState('')
  const [diagnosticAction, setDiagnosticAction] = useState('task-list')
  const [creatorRoleId, setCreatorRoleId] = useState('')
  const wizardHasDraft = Boolean(
    wizardOpen &&
    step !== 4 &&
    (username ||
      email ||
      name ||
      nameEn ||
      department ||
      location ||
      employeeNo ||
      companyId ||
      projectId ||
      profile ||
      busy ||
      partial),
  )
  useLayoutEffect(() => {
    onDirtyChange?.(wizardHasDraft)
  }, [onDirtyChange, wizardHasDraft])
  const revokeTrigger = useRef<HTMLInputElement>(null)
  const bundleDeleteTrigger = useRef<HTMLButtonElement>(null)
  const wizardHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (wizardOpen) wizardHeadingRef.current?.focus()
  }, [wizardOpen])

  function goToStep(nextStep: number) {
    if (nextStep >= 3 && profile === null) {
      setError('請先選擇職務，再繼續設定。')
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
    setProfile(null)
    setStep(0)
    setExistingAccount(false)
    setCreatedId('')
    setCreatedUsername('')
    setCreatedName('')
    setTemporaryPassword('')
    setProvisioning(null)
    setPartial('')
    setError('')
  }

  function startExistingJob() {
    const selected = users.find((user) => user.id === selectedUser)
    if (!selected || selected.is_admin) return
    resetWizard()
    setExistingAccount(true)
    setProfile(null)
    setStep(1)
    setWizardOpen(true)
  }

  const refresh = useCallback(async () => {
    const userPath = currentUser.is_admin ? '/users' : '/module-delegate/users'
    const [userRows, permissionRows, bundleRows] = await Promise.all([
      listAllPages<User>(userPath),
      listModulePermissions(),
      currentUser.is_admin ? listPermissionBundles() : Promise.resolve([]),
    ])
    const [companyRows, roleRows, projectRows, creatorRole] =
      currentUser.is_admin
        ? await Promise.all([
            listCompanies(),
            listRoles(),
            listAllPages<Project>('/projects'),
            getCreatorRole(),
          ])
        : [[], [], [], { role_id: '' }]
    setUsers(userRows)
    setCompanies(companyRows)
    setPermissions(permissionRows)
    setBundles(bundleRows)
    setRoles(roleRows)
    setProjects(projectRows)
    setCreatorRoleId(creatorRole.role_id)
  }, [currentUser.is_admin])

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
  }, [refresh])

  useEffect(() => {
    if (!selectedUser) return
    let active = true
    getUserModulePermissions(selectedUser)
      .then((access) => {
        if (active) {
          setUserAccess(access.permission_codes)
          setAccessDraft(access.permission_codes)
          setDelegatedModules(access.delegated_modules)
          setAccessLoadedFor(selectedUser)
        }
      })
      .catch((caught: unknown) => {
        // 載入失敗時不標成已載入：否則開通控制項會以空的權限
        // 草稿啟用，使用者可能在不知道現況下送出覆寫（#711）。
        if (active) setError(message(caught))
      })
    return () => {
      active = false
    }
  }, [selectedUser])

  useEffect(() => {
    if (!selectedUser || !currentUser.is_admin) return
    let active = true
    const reloadRequest = participationReload
    void getUserParticipatingProjects(selectedUser)
      .then((rows) => {
        if (active) {
          setParticipationResult({
            userId: selectedUser,
            reloadRequest,
            projects: rows,
            error: '',
          })
        }
      })
      .catch(() => {
        if (active) {
          setParticipationResult({
            userId: selectedUser,
            reloadRequest,
            projects: [],
            error: '目前無法載入參與專案。',
          })
        }
      })
    return () => {
      active = false
    }
  }, [currentUser.is_admin, participationReload, selectedUser])

  async function refreshEffectiveAccess() {
    if (!selectedUser) return
    const access = await getUserEffectiveAccess(
      selectedUser,
      diagnosticProject || undefined,
    )
    return access
  }

  const visibleUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return users.filter((user) =>
      `${user.name_zh ?? ''} ${user.username}`
        .toLocaleLowerCase()
        .includes(term),
    )
  }, [query, users])

  async function submitAccessDraft() {
    if (!selectedUser) return
    const granted = accessDraft.filter((code) => !userAccess.includes(code))
    const revoked = userAccess.filter((code) => !accessDraft.includes(code))
    if (revoked.length > 0) {
      setBusy(true)
      setError('')
      try {
        const impact = await getRevokeImpact(selectedUser, revoked[0])
        setRevoke({ code: revoked[0], impact })
      } catch (caught) {
        setError(message(caught))
      } finally {
        setBusy(false)
      }
      return
    }
    if (granted.length === 0) return
    setBusy(true)
    setError('')
    try {
      for (const code of granted) {
        await grantModulePermission(selectedUser, code)
      }
      const access = await getUserModulePermissions(selectedUser)
      setUserAccess(access.permission_codes)
      setAccessDraft(access.permission_codes)
      const targetName =
        users.find((user) => user.id === selectedUser)?.name_zh ||
        users.find((user) => user.id === selectedUser)?.username ||
        '此帳號'
      const grantedNames = permissions
        .filter((item) => granted.includes(item.code))
        .map((item) => item.description.replace('模組', '功能'))
      setNotice(`已為${targetName}開通${grantedNames.join('、')}。`)
    } catch (caught) {
      setError(message(caught))
      const access = await getUserModulePermissions(selectedUser)
      setUserAccess(access.permission_codes)
      setAccessDraft(access.permission_codes)
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
      setAccessDraft((current) =>
        current.filter((code) => code !== revoke.code),
      )
      setRevoke(null)
      setNotice('權限已收回。')
      await diagnose()
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
      setNotice('權限組合已儲存；既有帳號授權不會被改動。')
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function createStaff() {
    if (!profile) {
      setError('請先選擇職務，再繼續設定。')
      return
    }
    const bundleName = PROFILE_BUNDLES[profile]
    const matchingBundle = profileDefaultBundle(bundles, profile)
    const role = profileDefaultRole(roles, profile, creatorRoleId)
    if (bundleName && !matchingBundle) {
      setError(`無法建立帳號：找不到唯一的預設權限組合「${bundleName}」。`)
      return
    }
    if (!role && profile !== 'manager') {
      setError(
        `無法建立帳號：找不到唯一且符合權限需求的預設專案角色「${PROFILE_ACCESS[profile].projectRole}」。`,
      )
      return
    }
    const existing = existingAccount
      ? users.find((user) => user.id === selectedUser)
      : undefined
    if (existingAccount && (!existing || existing.is_admin)) {
      setError('找不到可套用職務的帳號，請重新選取。')
      return
    }
    if (existingAccount && profile === 'system') {
      setError('系統管理者不套用一般職務。')
      return
    }
    if (
      existing &&
      existing.is_external_collaborator !== (profile === 'external')
    ) {
      setError('帳號外部身分與所選職務不符，未變更授權。')
      return
    }
    setBusy(true)
    setError('')
    setPartial('')
    try {
      const created = existingAccount
        ? undefined
        : await createUser({
            username: username.trim(),
            email: email.trim(),
            name_zh: name.trim(),
            name_en: nameEn.trim() || null,
            company_id: companyId || null,
            department: department.trim() || null,
            location: location.trim() || null,
            employee_no: employeeNo.trim() || null,
            is_external_collaborator: profile === 'external',
            is_admin: profile === 'system',
          })
      const target = existing ?? created
      if (!target) throw new Error('找不到授權對象。')
      setCreatedId(target.id)
      setCreatedName(target.name_zh || target.username)
      setTemporaryPassword(created?.temporary_password ?? '')
      if (created) {
        setUsers((current) => [
          created,
          ...current.filter((row) => row.id !== created.id),
        ])
      }
      setSelectedUserState(target.id)
      const nextProvisioning: Provisioning = {
        userId: target.id,
        bundleId: matchingBundle?.id ?? null,
        roleId: role?.id ?? '',
        projectId,
        bundleDone: profile === 'system',
        memberDone: !projectId || profile === 'manager',
        mergeExistingRoles: existingAccount,
      }
      setProvisioning(nextProvisioning)
      if (created) setCreatedUsername(created.username)
      const completed = await finishProvisioning(nextProvisioning, created)
      if (created && completed) {
        onTemporaryPassword?.(created.username, created.temporary_password)
      }
    } catch (caught) {
      const errorMessage = managementErrorMessage(caught).replace(
        /[。.!?]+$/,
        '',
      )
      setError(`${errorMessage}。請檢查資料後再試一次。`)
    } finally {
      setBusy(false)
    }
  }

  async function finishProvisioning(
    pending: Provisioning,
    created?: CreatedUser,
  ): Promise<boolean> {
    let next = pending
    try {
      if (next.bundleId && !next.bundleDone) {
        await applyPermissionBundle(next.userId, next.bundleId)
        next = { ...next, bundleDone: true }
        setProvisioning(next)
      }
      if (next.projectId && !next.memberDone) {
        if (next.mergeExistingRoles) {
          const members = await listProjectMembers(next.projectId)
          const existingMember = members.find(
            (member) => member.user_id === next.userId,
          )
          if (existingMember) {
            const roleIds = existingMember.role_ids.includes(next.roleId)
              ? existingMember.role_ids
              : [...existingMember.role_ids, next.roleId]
            if (roleIds !== existingMember.role_ids) {
              await setProjectMemberRoles(next.projectId, next.userId, roleIds)
            }
          } else {
            await addProjectMember(next.projectId, next.userId, [next.roleId])
          }
        } else {
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
        }
        next = { ...next, memberDone: true }
        setProvisioning(next)
      }
      setPartial(
        next.mergeExistingRoles
          ? '職務、權限組合及所選專案已完成。'
          : '帳號、權限組合及所選專案已完成。',
      )
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
      return true
    } catch (caught) {
      setError(message(caught))
      setPartial(
        next.mergeExistingRoles
          ? '帳號資料保留；後續授權或專案加入未完成。'
          : '帳號已建立；後續授權或專案加入未完成。',
      )
      return false
    }
  }

  async function retryProvisioning() {
    if (!provisioning) return
    setBusy(true)
    setError('')
    const completed = await finishProvisioning(provisioning)
    if (completed && createdUsername && temporaryPassword) {
      onTemporaryPassword?.(createdUsername, temporaryPassword)
    }
    setBusy(false)
  }

  function startAnotherStaff() {
    resetWizard()
    setWizardOpen(true)
  }

  async function diagnose() {
    setCandidateRoles([])
    setSelectedCandidateRole('')
    setSafeCandidateRole('')
    if (!selectedUser) return
    const needsProject = ['task-list', 'members'].includes(diagnosticAction)
    if (needsProject && !diagnosticProject) {
      setNotice('請選擇專案，才能檢查有效權限。')
      return
    }
    setError('')
    try {
      const access = await refreshEffectiveAccess()
      if (!access) return
      const actionBySelection: Record<string, string> = {
        'task-list': 'task_list',
        'create-project': 'create_project',
        template: 'manage_template_library',
        members: 'manage_project_members',
      }
      const diagnostic = access.diagnostics.find(
        (item) => item.action === actionBySelection[diagnosticAction],
      )
      if (!diagnostic) {
        setNotice('目前無法檢查這項操作的有效權限。')
        return
      }
      if (diagnostic.allowed) {
        setCandidateRoles([])
        setNotice('這個人具備此操作所需的有效權限。')
        return
      }
      const roleMissing = diagnostic.missing_layers.includes('project_role')
      const candidates = roleMissing
        ? roles.filter(
            (role) =>
              diagnostic.required_project_codes.some((code) =>
                role.permission_codes.includes(code),
              ) &&
              (!users.find((user) => user.id === selectedUser)
                ?.is_external_collaborator ||
                role.is_external_allowed),
          )
        : []
      setCandidateRoles(candidates)
      const selected = users.find((user) => user.id === selectedUser)
      const minimumFieldRoleCodes = PROFILE_ROLE_CODES.field ?? []
      const minimalCandidates = candidates.filter(
        (role) =>
          role.name === '現場工程師' &&
          role.is_assignable === true &&
          role.is_external_allowed === false &&
          samePermissionCodes(role.permission_codes, minimumFieldRoleCodes),
      )
      if (
        diagnostic.action === 'task_list' &&
        !selected?.is_external_collaborator &&
        minimalCandidates.length === 1 &&
        minimalCandidates[0].permission_codes.includes(
          'inspection_task.inspect',
        )
      ) {
        setSafeCandidateRole(minimalCandidates[0].id)
        setSelectedCandidateRole(minimalCandidates[0].id)
      }
      const missingModule = diagnostic.missing_layers.includes('module')
      const actionMessages: Record<string, string> = {
        create_project: '缺少建立專案的權限。',
        manage_template_library: '缺少管理範本庫的權限。',
        manage_project_members: '缺少專案管理功能的權限。',
        task_list: '缺少查核功能的權限。',
      }
      setNotice(
        missingModule
          ? actionMessages[diagnostic.action]
          : diagnostic.action === 'manage_project_members'
            ? '這個專案裡沒有可以管理成員的角色。'
            : '這個專案裡沒有可以查看或執行任務的角色。',
      )
    } catch (caught) {
      setError(message(caught))
    }
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
      // 補上角色後，「參與專案與角色」清單要跟著更新，
      // 否則畫面會一直顯示補上前的角色（#708）。
      setParticipationReload((request) => request + 1)
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
      {!externalNavigationGuard && (
        <ModulePermissionsNavigationGuard hasUnsavedChanges={wizardHasDraft} />
      )}
      {!embedded && !wizardOpen && (
        <SectionHeader
          title="帳號權限"
          description="先選職務，再確認帳號實際可使用的功能。"
        />
      )}
      {error && <p role="alert">{error}</p>}
      {!embedded && !wizardOpen && (
        <Card>
          <h2>帳號清單</h2>
          <p>選取帳號查看目前能力，或新增帳號並依職務完成設定。</p>
          <Button onClick={() => setWizardOpen(true)}>新增帳號</Button>
          <Field id="people-search" label="搜尋帳號">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <ul aria-label="帳號清單">
            {visibleUsers.map((user) => (
              <li key={user.id}>
                <Button
                  variant="tertiary"
                  onClick={() => {
                    setSelectedUserState(user.id)
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
                    : '內部帳號'}
                {' · '}
                {user.is_admin
                  ? '系統管理'
                  : user.is_external_collaborator
                    ? '外部協作'
                    : '依權限與專案角色'}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {selectedUser && currentUser.is_admin && (
        <Card>
          <h2>{embedded ? '能做什麼' : '帳號能力與快速檢查'}</h2>
          {embedded &&
            currentUser.is_admin &&
            !users.find((user) => user.id === selectedUser)?.is_admin && (
              <div>
                <Button onClick={startExistingJob}>重新套用職務</Button>
                <p>{JOB_REAPPLY_EXPLANATION}</p>
              </div>
            )}
          <div aria-label="帳號能力摘要" role="region">
            <p role="status">
              能使用：
              {users.find((user) => user.id === selectedUser)?.is_admin
                ? '系統管理者可使用全部功能。'
                : permissions
                    .filter((item) => userAccess.includes(item.code))
                    .map((item) => item.description.replace('模組', '功能'))
                    .join('、') || '尚未開通功能。'}
            </p>
            <h3>參與專案與角色</h3>
            {participationForSelectedUser?.error && (
              <p role="alert">{participationForSelectedUser.error}</p>
            )}
            {participationForSelectedUser?.error && (
              <Button
                onClick={() =>
                  setParticipationReload((request) => request + 1)
                }
              >
                重新載入參與專案
              </Button>
            )}
            {!participationForSelectedUser && (
              <p role="status">載入參與專案…</p>
            )}
            {!participationForSelectedUser?.error &&
              participationForSelectedUser?.projects.length === 0 && (
                <p>目前沒有參與專案。</p>
              )}
            <ul>
              {participationForSelectedUser?.projects.map((project) => (
                <li key={project.id}>
                  <Link to={`/projects/${project.id}/members`}>
                    {project.project_code}／{project.name}
                  </Link>
                  ：
                  {project.roles.length > 0 ? (
                    project.roles.map((role) => role.name).join('、')
                  ) : (
                    <>
                      尚未指派角色（
                      <Link to={`/projects/${project.id}/members`}>補上</Link>
                      ）
                    </>
                  )}
                </li>
              ))}
            </ul>
            {notice && <p role="status">{notice}</p>}
            <h3>為什麼他不能做這件事？</h3>
            <label>
              要檢查的操作
              <select
                value={diagnosticAction}
                onChange={(event) => {
                  setDiagnosticAction(event.target.value)
                  if (!['task-list', 'members'].includes(event.target.value)) {
                    setDiagnosticProject('')
                  }
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
              disabled={
                accessLoadedFor !== selectedUser ||
                (['task-list', 'members'].includes(diagnosticAction) &&
                  !diagnosticProject)
              }
              onClick={() => void diagnose()}
            >
              檢查
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
                <Link to={`/projects/${diagnosticProject}/members`}>
                  前往專案成員設定
                </Link>
              </section>
            )}
            {notice.includes('缺少') && notice.includes('權限') && (
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
                  setAccessDraft((current) =>
                    current.includes(code) ? current : [...current, code],
                  )
                }}
              >
                選取要開通的權限
              </Button>
            )}
            {JSON.stringify([...accessDraft].sort()) !==
              JSON.stringify([...userAccess].sort()) && (
              <Button disabled={busy} onClick={() => void submitAccessDraft()}>
                開通
              </Button>
            )}
          </div>
        </Card>
      )}
      {embedded && !currentUser.is_admin && selectedUser && (
        <Card>
          <h2>權限</h2>
          <p>只能開通受委派範圍內的權限，不能替自己開通或轉交委派。</p>
          {notice && <p role="status">{notice}</p>}
          <fieldset disabled={busy || accessLoadedFor !== selectedUser}>
            {visiblePermissions.map((item) => (
              <label key={item.code}>
                <input
                  checked={accessDraft.includes(item.code)}
                  type="checkbox"
                  onChange={(event) => {
                    if (!event.target.checked) {
                      revokeTrigger.current = event.currentTarget
                    }
                    setAccessDraft((current) =>
                      event.target.checked
                        ? [...new Set([...current, item.code])]
                        : current.filter((code) => code !== item.code),
                    )
                  }}
                />{' '}
                {item.description.replace('模組', '功能')}
              </label>
            ))}
          </fieldset>
          {JSON.stringify([...accessDraft].sort()) !==
            JSON.stringify([...userAccess].sort()) && (
            <Button disabled={busy} onClick={() => void submitAccessDraft()}>
              開通
            </Button>
          )}
        </Card>
      )}
      {wizardOpen && currentUser.is_admin && (
        <Card>
          {step === 4 ? (
            <section aria-label="建立完成">
              <h2>{existingAccount ? '職務已套用' : '帳號已建立'}</h2>
              <p>
                {existingAccount
                  ? `${createdName} 的職務與授權設定已完成。`
                  : `${createdName} 的帳號與授權設定已完成。`}
              </p>
              {!existingAccount && (
                <>
                  <p>
                    請現在把以下臨時密碼交給本人；離開此畫面後就無法再查看。
                  </p>
                  <TemporaryPassword password={temporaryPassword} />
                </>
              )}
              <p>
                {existingAccount
                  ? '下一步可以查看此人的能力摘要。'
                  : '下一步可以新增另一個帳號，或查看這個帳號的能力摘要。'}
              </p>
              {!existingAccount && (
                <Button onClick={startAnotherStaff}>新增另一個帳號</Button>
              )}
              <Button
                onClick={() =>
                  onWizardBackToList
                    ? onWizardBackToList()
                    : setWizardOpen(false)
                }
              >
                回清單
              </Button>
              <Button
                onClick={() => {
                  setWizardOpen(false)
                  setTemporaryPassword('')
                  setSelectedUserState(createdId)
                  onWizardViewUser?.(createdId)
                }}
              >
                查看這個帳號的能力
              </Button>
            </section>
          ) : (
            <>
              <h2 ref={wizardHeadingRef} tabIndex={-1}>
                {existingAccount
                  ? '重新套用職務'
                  : embedded
                    ? '設定帳號'
                    : '新增帳號'}
              </h2>
              <p>建立後可以再調整。</p>
              <p role="status">
                步驟 {step + 1}／4：
                {['帳號資料', '職務', '專案', '確認'][step]}
              </p>
              {step === 0 && !existingAccount && (
                <FormGroup
                  title="帳號資料"
                  description="設定登入帳號與基本資料。"
                >
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
                  <FormField label="姓名" required>
                    {(control) => (
                      <Input
                        {...control}
                        value={name}
                        disabled={Boolean(createdId)}
                        onChange={(event) => setName(event.target.value)}
                      />
                    )}
                  </FormField>
                  <details>
                    <summary>更多資料（選填）</summary>
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
                    <FormField label="部門">
                      {(control) => (
                        <Input
                          {...control}
                          value={department}
                          disabled={Boolean(createdId)}
                          onChange={(event) =>
                            setDepartment(event.target.value)
                          }
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
                          onChange={(event) =>
                            setEmployeeNo(event.target.value)
                          }
                        />
                      )}
                    </FormField>
                  </details>
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
                </FormGroup>
              )}
              {step === 1 && (
                <fieldset>
                  <legend>選擇職務</legend>
                  {PROFILE_OPTIONS.map((option) => (
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
              {step === 3 && profile && (
                <div>
                  <h3>{existingAccount ? '套用前確認' : '建立前確認'}</h3>
                  <p>
                    {(existingAccount
                      ? users.find((user) => user.id === selectedUser)?.name_zh
                      : name) || '新同仁'}
                    將以「
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
                      {projectId && profile !== 'manager' && (
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
                    預設專案角色「
                    {profileRoleLabel(roles, profile, creatorRoleId)}」。
                  </small>
                  {!createdId ? (
                    <Button
                      disabled={
                        busy ||
                        (!existingAccount && (!username || !name || !email))
                      }
                      onClick={() => void createStaff()}
                    >
                      {existingAccount ? '套用職務' : '建立帳號'}
                    </Button>
                  ) : (
                    <>
                      {busy ? (
                        <p role="status">正在完成…</p>
                      ) : (
                        <>
                          <p role="status">
                            {partial}{' '}
                            請確認已建立的帳號資料，並完成尚未成功的步驟。
                          </p>
                          {temporaryPassword && (
                            <>
                              <p>臨時密碼只會顯示這一次；離開後無法再查看。</p>
                              <TemporaryPassword
                                password={temporaryPassword}
                              />
                            </>
                          )}
                          <Button onClick={() => void retryProvisioning()}>
                            重試未完成的步驟
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
              {step <= 3 && (
                <div>
                  {step > 0 && (
                    <Button
                      disabled={Boolean(createdId)}
                      onClick={() => goToStep(step - 1)}
                    >
                      上一步
                    </Button>
                  )}
                  {step < 3 && (
                    <Button
                      disabled={Boolean(createdId)}
                      onClick={() => goToStep(step + 1)}
                    >
                      下一步
                    </Button>
                  )}
                </div>
              )}
              {partial && step !== 3 && <p role="status">{partial}</p>}
            </>
          )}
        </Card>
      )}
      {(!embedded || currentUser.is_admin) && (
        <details>
          <summary>進階設定</summary>
          <Card>
            <h2>已設定的權限</h2>
            <p>這裡顯示帳號已開通的權限；專案內能力請查看上方的專案角色。</p>
            {selectedUser && (
              <>
                <fieldset disabled={busy || accessLoadedFor !== selectedUser}>
                  <legend>
                    {'權限（已選取 '}
                    {userAccess.length}
                    {' 項）'}
                  </legend>
                  {visiblePermissions.map((item) => (
                    <label key={item.code}>
                      <input
                        checked={accessDraft.includes(item.code)}
                        type="checkbox"
                        onChange={(event) => {
                          if (!event.target.checked) {
                            revokeTrigger.current = event.currentTarget
                          }
                          setAccessDraft((current) =>
                            event.target.checked
                              ? [...new Set([...current, item.code])]
                              : current.filter((code) => code !== item.code),
                          )
                        }}
                      />{' '}
                      {item.description.replace('模組', '功能')}
                    </label>
                  ))}
                </fieldset>
                {JSON.stringify([...accessDraft].sort()) !==
                  JSON.stringify([...userAccess].sort()) && (
                  <Button
                    disabled={busy}
                    onClick={() => void submitAccessDraft()}
                  >
                    開通
                  </Button>
                )}
              </>
            )}
          </Card>
          {currentUser.is_admin && (
            <Card>
              <h2>委派管理</h2>
              <p>收回委派不會移除對方已授予帳號的權限。</p>
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
                          .catch((caught: unknown) =>
                            setError(message(caught)),
                          )
                      }}
                    />
                    可管理
                    {{ project: '專案', inspection: '查核', template: '範本' }[
                      module
                    ] ?? module}
                    權限
                  </label>
                ))}
            </Card>
          )}
          {embedded && currentUser.is_admin && (
            <Card>
              <h2>套用權限組合</h2>
              <ul>
                {bundles.map((bundle) => (
                  <li key={bundle.id}>
                    <span>{bundle.name}</span>{' '}
                    <Button
                      disabled={!selectedUser || busy}
                      onClick={() =>
                        selectedUser &&
                        applyPermissionBundle(selectedUser, bundle.id)
                          .then(async () => {
                            const access =
                              await getUserModulePermissions(selectedUser)
                            setUserAccess(access.permission_codes)
                            setAccessDraft(access.permission_codes)
                            await diagnose()
                            setNotice('權限組合已套用。')
                          })
                          .catch((caught: unknown) =>
                            setError(message(caught)),
                          )
                      }
                    >
                      套用
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {!embedded && (
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
                              setAccessDraft(access.permission_codes)
                              await diagnose()
                              setNotice('權限組合已完整套用。')
                            })
                            .catch((caught: unknown) =>
                              setError(message(caught)),
                            )
                        }
                      >
                        套用至所選帳號
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
                {visiblePermissions.map((item) => (
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
          )}
          {!embedded && (
            <Card>
              <h2>快速診斷</h2>
              <p>建立專案、管理成員與管理範本庫，分別需要對應的權限。</p>
              <p>收回權限前會先重新讀取影響範圍；取消不會送出收回請求。</p>
            </Card>
          )}
          {!embedded && currentUser.is_admin && (
            <Card>
              <h2>角色治理</h2>
              <p>
                可指派角色會出現在專案成員選單；外部可用角色僅供外部協作者。
              </p>
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
                            .catch((caught: unknown) =>
                              setError(message(caught)),
                            )
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
                            .catch((caught: unknown) =>
                              setError(message(caught)),
                            )
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
                    getCreatorRole().then((item) =>
                      setCreatorRoleId(item.role_id),
                    )
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
                      (role) =>
                        role.is_assignable && !role.is_external_allowed,
                    )
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </label>
            </Card>
          )}
        </details>
      )}
      {revoke && (
        <ConfirmationPanel
          tone="danger"
          title="確認收回權限"
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
          impact="既有帳號已取得的權限會保留；之後無法再套用這個組合。"
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
