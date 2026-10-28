import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router'

import { useCurrentUser } from '../../auth/useCurrentUser'
import { isForbidden, isNotFound } from '../../http'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import permissionCodeContract from '../../permissionCodeContract'
import {
  Button,
  Card,
  FormErrorSummary,
  FormField,
  FormGroup,
  Input,
} from '../../components'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { Notice } from '../../ui/Notice'
import {
  UnsavedLeaveBox,
  useUnsavedNavigationGuard,
} from '../../ui/navigation'
import { ManagementApiError, request } from '../api'
import TemporaryPassword from '../TemporaryPassword'
import {
  createUser,
  listAllPages,
  listCompanies,
  managementErrorMessage,
} from '../api'
import type { Company, CreatedUser, User, UserDetail } from '../api'
import RolePermissionSummary from '../projects/RolePermissionSummary'
import './ModulePermissionsPage.css'
import {
  addProjectMember,
  listProjectMembers,
  setProjectMemberRoles,
  type Project,
} from '../projects/api'
import { getCreatorRole, listRoles, type Role } from '../roles/api'
import {
  applyPermissionBundle,
  getRevokeImpact,
  getUserEffectiveAccess,
  getUserModulePermissions,
  getUserParticipatingProjects,
  grantModulePermission,
  listModulePermissions,
  listPermissionBundles,
  revokeModulePermission,
  setModuleDelegation,
  type ModulePermission,
  type PermissionBundle,
  type RevokeImpact,
  type ParticipatingProject,
} from './api'

/** T6：缺口使用結構化資料，補救不從顯示文案反推授權代碼。 */
type DiagnosticResult = {
  requiredModuleCodes: string[]
  missingModuleCodes: string[]
  missingRole: boolean
  moduleMessage: string
  roleMessage: string
  nonmember: boolean
}

type IdentityField =
  | 'username'
  | 'name'
  | 'email'
  | 'employee_no'
  | 'name_en'
  | 'department'
  | 'location'
  | 'company_id'
type IdentityErrors = Partial<Record<IdentityField, string>>

// 第一步三個必填欄位的標籤與欄位 id；id 固定，錯誤摘要才能跳到欄位。
const IDENTITY_FIELDS: Record<IdentityField, { label: string; id: string }> = {
  username: { label: '帳號名稱', id: 'wizard-username' },
  name: { label: '姓名', id: 'wizard-name' },
  email: { label: '電子郵件', id: 'wizard-email' },
  employee_no: { label: '工號', id: 'wizard-employee-no' },
  name_en: { label: '英文姓名', id: 'wizard-name-en' },
  department: { label: '部門', id: 'wizard-department' },
  location: { label: '地點', id: 'wizard-location' },
  company_id: { label: '公司', id: 'wizard-company' },
}

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
    cannot: ['不能替自己建立額外權限'],
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

/** 以無重複且完整相同的代碼集合辨識起手式，避免陣列順序影響比對。 */
function samePermissionCodes(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const normalizedLeft = [...new Set(left)].sort()
  const normalizedRight = [...new Set(right)].sort()
  return (
    normalizedLeft.length === left.length &&
    normalizedLeft.every((code, index) => code === normalizedRight[index])
  )
}

/** 同名組合內容遭修改或候選不唯一時拒絕猜測，避免套錯職務權限。 */
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

/**
 * system／office 沿用新專案預設角色；
 * 現場與外部職務須精確符合角色能力及可指派條件，避免額外授權。
 */
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

const NONMEMBER_MESSAGE = '他還不是這個專案的成員，請先到專案成員頁加入。'

function message(error: unknown): string {
  return managementErrorMessage(error)
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
  onTemporaryPassword?: (
    username: string,
    password: string,
    source?: 'created' | 'reset',
    displayName?: string,
  ) => void
  onTemporaryPasswordVisible?: (visible: boolean) => void
  onRequestTemporaryPasswordLeave?: (action: () => void) => void
  externalNavigationGuard?: boolean
  onDirtyChange?: (dirty: boolean) => void
  onWizardBackToList?: () => void
  onWizardViewUser?: (id: string) => void
  onForbidden?: () => void
  onWizardCancel?: () => void
  onCreationComplete?: (created: CreatedUser) => void
}

/** ADM-R47、ADM-R56：保留就地授權，新增由詳情承接一次性結果。 */
export default function ModulePermissionsPage(
  props: ModulePermissionsPageProps = {},
) {
  // ADM-R56：切換帳號或重新開精靈時重建狀態，避免帶入上一份草稿。
  const remountKey =
    props.selectedUserId ?? `wizard:${props.openWizardRequest ?? 0}`
  return <ModulePermissionsPageContent key={remountKey} {...props} />
}

function ModulePermissionsPageContent({
  embedded = true,
  openWizardRequest = 0,
  selectedUserId,
  onTemporaryPassword,
  onTemporaryPasswordVisible,
  onRequestTemporaryPasswordLeave,
  externalNavigationGuard = false,
  onDirtyChange,
  onWizardBackToList,
  onWizardViewUser,
  onWizardCancel,
  onForbidden,
  onCreationComplete,
}: ModulePermissionsPageProps) {
  const { user: currentUser } = useCurrentUser()
  const [users, setUsers] = useState<User[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const wizardOptionsLoaded = useRef({
    companies: false,
    projects: false,
    roles: false,
  })
  const wizardOptionsRequests = useRef<{
    companies: Promise<void> | null
    projects: Promise<void> | null
    roles: Promise<void> | null
  }>({ companies: null, projects: null, roles: null })
  const wizardRoleData = useRef<{
    roles: Role[]
    bundles: PermissionBundle[]
    creatorRoleId: string
  }>({ roles: [], bundles: [], creatorRoleId: '' })
  const [permissions, setPermissions] = useState<ModulePermission[]>([])
  const [usersCatalogState, setUsersCatalogState] = useState<{
    status: 'loading' | 'ready' | 'error'
    error: string
  }>({ status: 'loading', error: '' })
  const [permissionsCatalogState, setPermissionsCatalogState] = useState<{
    status: 'loading' | 'ready' | 'error'
    error: string
  }>({ status: 'loading', error: '' })
  const [usersCatalogRetry, setUsersCatalogRetry] = useState(0)
  const [permissionsCatalogRetry, setPermissionsCatalogRetry] = useState(0)
  const [bundles, setBundles] = useState<PermissionBundle[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [projectOptionsStatus, setProjectOptionsStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [projectOptionsError, setProjectOptionsError] = useState('')
  const projectOptionsRequest = useRef<Promise<void> | null>(null)
  const [advancedStatus, setAdvancedStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [advancedError, setAdvancedError] = useState('')
  const advancedRequest = useRef<Promise<void> | null>(null)
  const advancedLoaded = useRef(false)
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
  const selectedAccount = users.find((user) => user.id === selectedUser)
  const selectedUserIsExternal = Boolean(
    selectedAccount?.is_external_collaborator,
  )
  const visiblePermissions =
    !selectedAccount || permissionsCatalogState.status !== 'ready'
      ? []
      : selectedUserIsExternal
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
  const [currentProjectRoleCodes, setCurrentProjectRoleCodes] = useState<
    string[]
  >([])
  const [delegatedModules, setDelegatedModules] = useState<string[]>([])
  const [accessLoadedFor, setAccessLoadedFor] = useState('')
  const [accessLoad, setAccessLoad] = useState<{
    userId: string
    status: 'loading' | 'ready' | 'error'
    error: string
  }>({ userId: '', status: 'loading', error: '' })
  const [accessRetry, setAccessRetry] = useState(0)
  const accessReady =
    accessLoad.userId === selectedUser &&
    accessLoad.status === 'ready' &&
    accessLoadedFor === selectedUser
  const capabilitySummaryReady =
    (Boolean(selectedAccount) || usersCatalogState.status === 'ready') &&
    permissionsCatalogState.status === 'ready' &&
    accessReady
  const capabilitySummaryLoading =
    (!selectedAccount && usersCatalogState.status === 'loading') ||
    permissionsCatalogState.status === 'loading' ||
    (accessLoad.userId === selectedUser && accessLoad.status === 'loading')
  const capabilitySummaryError =
    (!selectedAccount && usersCatalogState.status === 'error') ||
    permissionsCatalogState.status === 'error' ||
    (accessLoad.userId === selectedUser && accessLoad.status === 'error')

  const catalogLoadErrors = (
    <>
      {usersCatalogState.status === 'error' && (
        <>
          <p role="alert">{usersCatalogState.error}</p>
          <Button
            onClick={() => {
              setUsersCatalogState({ status: 'loading', error: '' })
              setUsersCatalogRetry((retry) => retry + 1)
            }}
          >
            重新載入帳號目錄
          </Button>
        </>
      )}
      {permissionsCatalogState.status === 'error' && (
        <>
          <p role="alert">{permissionsCatalogState.error}</p>
          <Button
            onClick={() => {
              setPermissionsCatalogState({ status: 'loading', error: '' })
              setPermissionsCatalogRetry((retry) => retry + 1)
            }}
          >
            重新載入權限目錄
          </Button>
        </>
      )}
    </>
  )

  function selectUser(userId: string) {
    // ADM-R47：同網址、同帳號的重新套用也要重新取得權限快照。
    if (userId === selectedUser) setAccessRetry((retry) => retry + 1)
    setSelectedUserState(userId)
    setAccessLoadedFor('')
    setAccessLoad({ userId, status: 'loading', error: '' })
  }

  const [profile, setProfile] = useState<Profile | null>(null)
  const [step, setStep] = useState(0)
  const [identityErrors, setIdentityErrors] = useState<IdentityErrors>({})
  const [identityFocusRequest, setIdentityFocusRequest] = useState(0)
  const [wizardOpen, setWizardOpen] = useState(
    () => openWizardRequest > 0 && selectedUserId === undefined,
  )
  const [existingAccount, setExistingAccount] = useState(false)
  const [error, setError] = useState('')
  const [optionsError, setOptionsError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [forbidden, setForbidden] = useState(false)
  useEffect(() => {
    if (forbidden) onForbidden?.()
  }, [forbidden, onForbidden])
  const [nonmemberProject, setNonmemberProject] = useState('')
  const [notice, setNotice] = useState('')
  const [diagnosticError, setDiagnosticError] = useState('')
  const [diagnosticResult, setDiagnosticResult] =
    useState<DiagnosticResult | null>(null)
  const [feedback, setFeedback] = useState<
    Record<
      string,
      {
        error?: string
        notice?: string
      }
    >
  >({})

  function feedbackKey(scope: string) {
    return scope === 'diagnostic'
      ? `${selectedUser}:${scope}:${diagnosticProject}:${diagnosticAction}`
      : `${selectedUser}:${scope}`
  }

  function setOperationError(scope: string, value: string) {
    setFeedback((current) => ({
      ...current,
      [feedbackKey(scope)]: { error: value, notice: '' },
    }))
  }

  function setOperationNotice(scope: string, value: string) {
    setFeedback((current) => ({
      ...current,
      [feedbackKey(scope)]: { error: '', notice: value },
    }))
  }

  function operationFeedback(scope: string) {
    const result = feedback[feedbackKey(scope)]
    return (
      <>
        {result?.error && <Notice variant="error">{result.error}</Notice>}
        {result?.notice && <Notice>{result.notice}</Notice>}
      </>
    )
  }

  const [feedbackUser, setFeedbackUser] = useState(selectedUser)
  if (feedbackUser !== selectedUser) {
    // 回饋屬於帳號；以 render key 調整狀態，避免 effect 再觸發重繪。
    setFeedbackUser(selectedUser)
    setFeedback({})
  }

  const [busy, setBusy] = useState(false)
  const [revoke, setRevoke] = useState<{
    code: string
    impact: RevokeImpact
    scope: 'access' | 'diagnostic'
  } | null>(null)
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
  const [diagnosticProject, setDiagnosticProject] = useState('')
  const [diagnosticAction, setDiagnosticAction] = useState('task-list')
  const diagnosticRequest = useRef(0)
  const diagnosticSelection = useRef({
    selectedUser,
    diagnosticProject,
    diagnosticAction,
  })
  useLayoutEffect(() => {
    // T5：換人或換問題後，較晚回來的舊診斷不能蓋掉新結果。
    diagnosticSelection.current = {
      selectedUser,
      diagnosticProject,
      diagnosticAction,
    }
    diagnosticRequest.current += 1
  }, [selectedUser, diagnosticProject, diagnosticAction])

  const [creatorRoleId, setCreatorRoleId] = useState('')
  const diagnosticKey = [
    selectedUser,
    diagnosticProject,
    diagnosticAction,
  ].join(':')
  const [previousDiagnosticKey, setPreviousDiagnosticKey] =
    useState(diagnosticKey)
  if (previousDiagnosticKey !== diagnosticKey) {
    setPreviousDiagnosticKey(diagnosticKey)
    setNotice('')
    setDiagnosticError('')
    setNonmemberProject('')
    setDiagnosticResult(null)
    setCandidateRoles([])
    setFeedback((current) => ({
      ...current,
      [feedbackKey('diagnostic')]: {},
    }))
  }

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
  useEffect(() => {
    onTemporaryPasswordVisible?.(Boolean(temporaryPassword))
    return () => onTemporaryPasswordVisible?.(false)
  }, [onTemporaryPasswordVisible, temporaryPassword])
  const revokeTrigger = useRef<HTMLButtonElement>(null)
  const accessHeadingRef = useRef<HTMLHeadingElement>(null)
  const diagnosticHeadingRef = useRef<HTMLHeadingElement>(null)
  const revokeFocusPending = useRef<'access' | 'diagnostic' | null>(null)

  useEffect(() => {
    const scope = revokeFocusPending.current
    if (!scope || revoke || busy) return
    revokeFocusPending.current = null
    const trigger = revokeTrigger.current
    const target =
      trigger?.isConnected && !trigger.disabled
        ? trigger
        : scope === 'diagnostic'
          ? diagnosticHeadingRef.current
          : accessHeadingRef.current
    target?.focus({ preventScroll: true })
  }, [revoke, busy])
  const wizardHeadingRef = useRef<HTMLHeadingElement>(null)

  const wizardStepsRef = useRef<HTMLElement>(null)
  // ADM-R56：步驟標題先聚焦，欄位摘要的被動 effect 才能接手錯誤焦點。
  useLayoutEffect(() => {
    if (!wizardOpen) return
    wizardStepsRef.current?.scrollIntoView?.({ block: 'start' })
    wizardHeadingRef.current?.focus({ preventScroll: true })
  }, [wizardOpen, step])

  function missingIdentityFields(): IdentityField[] {
    const values = { username, name, email }
    return (Object.keys(values) as Array<keyof typeof values>).filter(
      (field) => !values[field].trim(),
    )
  }

  function updateIdentity(
    field: IdentityField,
    value: string,
    set: (value: string) => void,
  ) {
    set(value)
    // 一改動就收掉該欄的錯誤，避免已補齊的欄位還掛著紅字。
    if (identityErrors[field]) {
      setIdentityErrors((current) => {
        const next = { ...current }
        delete next[field]
        return next
      })
    }
  }

  // 最後一步的按鈕不能按時，一定要在旁邊說原因，不能只是變灰。
  const missingForCreate = existingAccount
    ? []
    : missingIdentityFields().map((field) => IDENTITY_FIELDS[field].label)
  const createBlockReason = busy
    ? existingAccount
      ? '正在套用職務，請稍候。'
      : '正在建立帳號，請稍候。'
    : missingForCreate.length > 0
      ? `還缺${missingForCreate.join('、')}，請回到第一步補上。`
      : ''

  const loadProjectOptions = useCallback((): Promise<void> => {
    if (wizardOptionsLoaded.current.projects) return Promise.resolve()
    if (projectOptionsRequest.current) return projectOptionsRequest.current
    setProjectOptionsStatus('loading')
    setProjectOptionsError('')
    // ADM-R45：診斷與精靈共用一次載入，滑鼠首次開啟選單前即有明確狀態。
    const pending = listAllPages<Project>('/projects')
      .then((rows) => {
        setProjects(rows)
        wizardOptionsLoaded.current.projects = true
        setProjectOptionsStatus('ready')
      })
      .catch((caught: unknown) => {
        if (active.current && isForbidden(caught)) setForbidden(true)
        setProjectOptionsStatus('error')
        setProjectOptionsError(message(caught))
        throw caught
      })
      .finally(() => {
        if (projectOptionsRequest.current === pending)
          projectOptionsRequest.current = null
      })
    projectOptionsRequest.current = pending
    return pending
  }, [])

  const loadWizardOptions = useCallback(
    async (nextStep: number) => {
      if (!embedded || !currentUser.is_admin || !wizardOpen) return
      // 同一步可能由導覽與送出觸發；共用請求，但失敗後必須允許重試。
      const loadOnce = async (
        key: 'companies' | 'projects' | 'roles',
        load: () => Promise<void>,
      ) => {
        if (wizardOptionsLoaded.current[key]) return
        if (wizardOptionsRequests.current[key]) {
          await wizardOptionsRequests.current[key]
          return
        }
        const pending = load()
        wizardOptionsRequests.current[key] = pending
        try {
          await pending
        } catch (caught) {
          if (active.current && isForbidden(caught)) setForbidden(true)
          throw caught
        } finally {
          if (wizardOptionsRequests.current[key] === pending)
            wizardOptionsRequests.current[key] = null
        }
      }

      if (nextStep === 0 && !existingAccount) {
        await loadOnce('companies', async () => {
          setCompanies(await listCompanies())
          wizardOptionsLoaded.current.companies = true
        })
      }
      if (nextStep >= 2) {
        await loadProjectOptions()
      }
      if (nextStep >= 3) {
        await loadOnce('roles', async () => {
          const [roleRows, bundleRows, creatorRole] = await Promise.all([
            listRoles(),
            listPermissionBundles(),
            getCreatorRole(),
          ])
          setRoles(roleRows)
          setBundles(bundleRows)
          setCreatorRoleId(creatorRole.role_id)
          // 同次送出接著要選角色；ref 讓它不必等待 React 提交 state。
          wizardRoleData.current = {
            roles: roleRows,
            bundles: bundleRows,
            creatorRoleId: creatorRole.role_id,
          }
          wizardOptionsLoaded.current.roles = true
        })
      }
    },
    [
      currentUser.is_admin,
      embedded,
      existingAccount,
      loadProjectOptions,
      wizardOpen,
    ],
  )

  function goToStep(nextStep: number) {
    // 第一步先擋缺漏，不然要到最後一步才發現建立不了。
    if (step === 0 && nextStep > 0 && !existingAccount) {
      const errors: IdentityErrors = Object.fromEntries(
        missingIdentityFields().map((field) => [
          field,
          `請填寫${IDENTITY_FIELDS[field].label}。`,
        ]),
      )
      // DOM-R28：與後端帳號識別規則一致，離開第一步前就近指出欄位。
      if (
        username.trim() &&
        !/^[A-Za-z][A-Za-z0-9._-]{2,31}$/.test(username.trim())
      )
        errors.username =
          '帳號名稱須為 3–32 字，英文字母開頭，可用英文、數字、. _ -。'
      if (
        email.trim() &&
        (!email.trim().includes('@') || /\s/u.test(email.trim()))
      )
        errors.email = '電子郵件必須含 @，且不能有空白。'
      if (Object.keys(errors).length > 0) {
        setIdentityErrors(errors)
        setIdentityFocusRequest((value) => value + 1)
        return
      }
    }
    if (nextStep >= 2 && profile === null) {
      setProfileError('請先選一個職務，系統才知道要開通哪些功能。')
      return
    }
    setProfileError('')
    setError('')
    setStep(nextStep)
    void loadWizardOptions(nextStep).catch((caught: unknown) =>
      setOptionsError(message(caught)),
    )
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
    setIdentityErrors({})
    setOptionsError('')
    setProfileError('')
    setMoreOpen(false)
    setExistingAccount(false)
    setCreatedId('')
    setCreatedUsername('')
    setCreatedName('')
    setTemporaryPassword('')
    setProvisioning(null)
    setPartial('')
    setError('')
  }

  function leaveTemporaryPasswordPage(action: () => void) {
    if (onRequestTemporaryPasswordLeave) {
      onRequestTemporaryPasswordLeave(action)
    } else {
      action()
    }
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

  const userPath = currentUser.is_admin ? '/users' : '/module-delegate/users'

  useEffect(() => {
    if (embedded && currentUser.is_admin && wizardOpen) return
    let active = true
    // #712：詳情只載入目標帳號，同時保留目錄的載入、失敗與重試狀態。
    const usersRequest =
      embedded && currentUser.is_admin && selectedUserId
        ? request<UserDetail>(
            `/users/${encodeURIComponent(selectedUserId)}`,
          ).then((user) => [user])
        : listAllPages<User>(userPath)
    void usersRequest
      .then((rows) => {
        if (!active) return
        setUsers(rows)
        setUsersCatalogState({ status: 'ready', error: '' })
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (active && isForbidden(caught)) setForbidden(true)
        setUsersCatalogState({ status: 'error', error: message(caught) })
      })
    return () => {
      active = false
    }
  }, [
    currentUser.is_admin,
    embedded,
    selectedUserId,
    userPath,
    usersCatalogRetry,
    wizardOpen,
  ])

  useEffect(() => {
    let active = true
    void listModulePermissions()
      .then((rows) => {
        if (!active) return
        setPermissions(rows)
        setPermissionsCatalogState({ status: 'ready', error: '' })
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (active && isForbidden(caught)) setForbidden(true)
        setPermissionsCatalogState({ status: 'error', error: message(caught) })
      })
    return () => {
      active = false
    }
  }, [permissionsCatalogRetry])

  const refresh = useCallback((): Promise<void> => {
    if (advancedRequest.current) return advancedRequest.current
    setAdvancedStatus('loading')
    setAdvancedError('')
    const pending = (async () => {
      const bundleRows = currentUser.is_admin
        ? await listPermissionBundles()
        : []
      const [companyRows, roleRows, , creatorRole] = currentUser.is_admin
        ? await Promise.all([
            listCompanies(),
            listRoles(),
            embedded ? Promise.resolve() : loadProjectOptions(),
            getCreatorRole(),
          ])
        : [[], [], undefined, { role_id: '' }]
      setCompanies(companyRows)
      setBundles(bundleRows)
      setRoles(roleRows)
      setCreatorRoleId(creatorRole.role_id)
      advancedLoaded.current = true
      setAdvancedStatus('ready')
    })()
      .catch((caught: unknown) => {
        if (active.current && isForbidden(caught)) setForbidden(true)
        setAdvancedStatus('error')
        setAdvancedError(message(caught))
        throw caught
      })
      .finally(() => {
        if (advancedRequest.current === pending) advancedRequest.current = null
      })
    advancedRequest.current = pending
    return pending
  }, [currentUser.is_admin, embedded, loadProjectOptions])

  const diagnosticVisible =
    Boolean(selectedUser) &&
    currentUser.is_admin &&
    !(wizardOpen && step === 4)
  useEffect(() => {
    if (!diagnosticVisible) return
    void loadProjectOptions().catch(() => undefined)
  }, [diagnosticVisible, loadProjectOptions])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        if (embedded && currentUser.is_admin && wizardOpen) {
          await loadWizardOptions(step)
          return
        }
        if (embedded && currentUser.is_admin && selectedUserId) return
        await refresh().catch(() => undefined)
      } catch (caught) {
        if (active && isForbidden(caught)) setForbidden(true)
        if (active) setOptionsError(message(caught))
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [
    currentUser.is_admin,
    embedded,
    existingAccount,
    loadWizardOptions,
    refresh,
    selectedUserId,
    step,
    wizardOpen,
  ])

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
          setAccessLoad({ userId: selectedUser, status: 'ready', error: '' })
        }
      })
      .catch((caught: unknown) => {
        if (active && isForbidden(caught)) setForbidden(true)
        // 載入失敗時不標成已載入：否則開通控制項會以空的權限
        // 草稿啟用，使用者可能在不知道現況下送出覆寫（#711）。
        if (active) {
          setAccessLoad({
            userId: selectedUser,
            status: 'error',
            error: message(caught),
          })
        }
      })
    return () => {
      active = false
    }
  }, [selectedUser, accessRetry])

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

  async function submitAccessDraft(scope: 'access' | 'diagnostic' = 'access') {
    if (!selectedUser) return
    const granted = accessDraft.filter((code) => !userAccess.includes(code))
    const revoked = userAccess.filter((code) => !accessDraft.includes(code))
    // ADM-R10：收回前先查影響並確認，本次不混送尚未確認的新增授權。
    if (revoked.length > 0) {
      setBusy(true)
      setOperationError(scope, '')
      setOperationError('revoke', '')
      try {
        const impact = await getRevokeImpact(selectedUser, revoked[0])
        setRevoke({ code: revoked[0], impact, scope })
      } catch (caught) {
        setOperationError(scope, message(caught))
      } finally {
        setBusy(false)
      }
      return
    }
    if (granted.length === 0) return
    setBusy(true)
    setOperationError(scope, '')
    try {
      for (const code of granted) {
        await grantModulePermission(selectedUser, code)
      }
      const access = await getUserModulePermissions(selectedUser)
      if (diagnosticSelection.current.selectedUser !== selectedUser) return
      setUserAccess(access.permission_codes)
      setAccessDraft(access.permission_codes)
      const targetName =
        users.find((user) => user.id === selectedUser)?.name_zh ||
        users.find((user) => user.id === selectedUser)?.username ||
        '此帳號'
      const grantedNames = permissions
        .filter((item) => granted.includes(item.code))
        .map((item) => item.description.replace('模組', '功能'))
      if (scope === 'diagnostic' || diagnosticResult || notice)
        await diagnose()
      setOperationNotice(
        scope,
        `已為${targetName}開通${grantedNames.join('、')}。`,
      )
    } catch (caught) {
      setOperationError(scope, message(caught))
      // 逐項授予可能只成功一部分；以伺服器現況重建草稿，避免假設全敗。
      const access = await getUserModulePermissions(selectedUser)
      if (diagnosticSelection.current.selectedUser !== selectedUser) return
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
      revokeFocusPending.current = revoke.scope
      setRevoke(null)
      setOperationNotice(revoke.scope, '權限已收回。')
      await diagnose()
    } catch (caught) {
      setOperationError('revoke', message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function createStaff() {
    if (!profile) {
      setError('請先選擇職務，再繼續設定。')
      return
    }
    try {
      await loadWizardOptions(3)
    } catch (caught) {
      setOptionsError(message(caught))
      return
    }
    const bundleName = PROFILE_BUNDLES[profile]
    const matchingBundle = profileDefaultBundle(
      wizardRoleData.current.bundles.length
        ? wizardRoleData.current.bundles
        : bundles,
      profile,
    )
    const role = profileDefaultRole(
      wizardRoleData.current.roles.length
        ? wizardRoleData.current.roles
        : roles,
      profile,
      wizardRoleData.current.creatorRoleId || creatorRoleId,
    )
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
      setError('帳號外部身分與所選職務不符，未變更權限。')
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
      selectUser(target.id)
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
        onCreationComplete?.(created)
        onTemporaryPassword?.(
          created.username,
          created.temporary_password,
          'created',
          created.name_zh || created.username,
        )
      }
    } catch (caught) {
      const errorMessage = managementErrorMessage(caught)
      const fields: IdentityErrors = {}
      if (caught instanceof ManagementApiError) {
        const conflictField: Record<string, IdentityField> = {
          'user.username_conflict': 'username',
          'user.email_conflict': 'email',
          'user.employee_no_conflict': 'employee_no',
        }
        const field = conflictField[caught.code ?? '']
        if (field) fields[field] = errorMessage
        if (caught.code === 'request.validation_failed') {
          for (const item of caught.fields ?? []) {
            const apiField = item.path.replace(/^\/(?:body\/)?/, '')
            const field = apiField === 'name_zh' ? 'name' : apiField
            if (field in IDENTITY_FIELDS)
              fields[field as IdentityField] = errorMessage
          }
          // 舊後端若沒有欄位路徑，仍回到第一步提供可聚焦的修正入口。
          if (Object.keys(fields).length === 0) fields.username = errorMessage
        }
      }
      if (Object.keys(fields).length > 0) {
        setIdentityErrors(fields)
        if (
          fields.employee_no ||
          fields.name_en ||
          fields.department ||
          fields.location
        )
          setMoreOpen(true)
        setStep(0)
        setIdentityFocusRequest((value) => value + 1)
      } else setError(errorMessage)
    } finally {
      setBusy(false)
    }
  }

  // 建立帳號、套用組合及加入專案不是同一筆交易；逐步記住成功結果，
  // 重試只補未完成步驟，保留已建立帳號及其一次性臨時密碼。
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
        // 重新套用職務只補角色，保留這個帳號原本在專案內的其他能力。
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
            // 上次加入可能已成功但回應遺失；只有角色完全符合才視為完成，
            // 不能把任何成員衝突都當作這次設定已套用。
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
          ? '帳號資料保留；後續權限或專案加入未完成。'
          : '帳號已建立；後續權限或專案加入未完成。',
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
      const account = users.find((item) => item.id === createdId)
      if (account)
        onCreationComplete?.({
          ...account,
          temporary_password: temporaryPassword,
        })
      onTemporaryPassword?.(
        createdUsername,
        temporaryPassword,
        'created',
        createdName,
      )
    }
    setBusy(false)
  }

  function startAnotherStaff() {
    leaveTemporaryPasswordPage(() => {
      resetWizard()
      setWizardOpen(true)
    })
  }

  // 寫入成功不等於有效權限已生效；層別用來核對重查後的缺口。
  async function diagnose(repaired?: {
    layer: 'module' | 'project_role'
    label: string
  }) {
    const selection = diagnosticSelection.current
    if (
      selection.selectedUser !== selectedUser ||
      selection.diagnosticProject !== diagnosticProject ||
      selection.diagnosticAction !== diagnosticAction
    )
      return
    const requestId = ++diagnosticRequest.current
    const active = () => requestId === diagnosticRequest.current
    setOperationError('diagnostic', '')
    setNonmemberProject('')
    setNotice('')
    setDiagnosticResult(null)
    setCandidateRoles([])
    setSelectedCandidateRole('')
    setSafeCandidateRole('')
    if (!selectedUser) return
    const needsProject = ['task-list', 'members'].includes(diagnosticAction)
    if (needsProject && !diagnosticProject) {
      setNotice('請選擇專案，才能檢查有效權限。')
      return
    }
    setDiagnosticError('')
    const recheckFailed = () => {
      if (repaired)
        setOperationNotice(
          'diagnostic',
          `已補上${repaired.label}，但重新檢查失敗，請重試檢查。`,
        )
    }
    // 只依重查結果描述剩餘缺口，避免把成功寫入誤報為補救完成。
    const repairFeedback = (remaining: {
      module?: boolean
      project_role?: boolean
      project_member?: boolean
    }) => {
      if (!repaired) return
      const gaps = [
        remaining.module ? '功能權限' : '',
        remaining.project_role ? '專案角色' : '',
        remaining.project_member ? '專案成員身分' : '',
      ].filter(Boolean)
      const stillMissing =
        remaining[repaired.layer] ||
        (repaired.layer === 'project_role' && remaining.project_member)
      setOperationNotice(
        'diagnostic',
        stillMissing
          ? `補救已送出，但仍缺${gaps.join('與')}，請重試檢查。`
          : `已補上${repaired.label}${
              gaps.length ? `；還缺${gaps.join('與')}。` : '。'
            }`,
      )
    }
    try {
      const access = await refreshEffectiveAccess()
      if (!access || !active()) return
      setCurrentProjectRoleCodes(
        (access.project_roles ?? []).flatMap((role) => role.permission_codes),
      )
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
        recheckFailed()
        return
      }
      if (diagnostic.allowed) {
        setCandidateRoles([])
        setNotice('這個人具備此操作所需的有效權限。')
        repairFeedback({})
        return
      }
      const roleMissing = diagnostic.missing_layers.includes('project_role')
      const availableRoles = roleMissing ? await listRoles() : roles
      if (!active()) return
      if (roleMissing) setRoles(availableRoles)
      const candidates = roleMissing
        ? availableRoles.filter(
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
      const assigned = new Set(
        access.module_permissions.map((item) => item.code),
      )
      // 相容舊診斷：只從已登記的功能代碼補救，不猜專案角色代碼。
      const requiredModuleCodes = diagnostic.required_module_codes.length
        ? diagnostic.required_module_codes
        : diagnostic.missing_layers.includes('module')
          ? permissions
              .filter((item) => diagnostic.missing_codes.includes(item.code))
              .map((item) => item.code)
          : []
      const missingModuleCodes = requiredModuleCodes.filter(
        (code) => !assigned.has(code),
      )
      const actionMessages: Record<string, string> = {
        create_project: '缺少建立專案的權限。',
        manage_template_library: '缺少管理範本庫的權限。',
        manage_project_members: '缺少專案管理功能的權限。',
        task_list: '缺少查核功能的權限。',
      }
      setDiagnosticResult({
        requiredModuleCodes,
        missingModuleCodes,
        missingRole: roleMissing,
        moduleMessage:
          diagnostic.missing_layers.includes('module') ||
          missingModuleCodes.length > 0
            ? (actionMessages[diagnostic.action] ??
              '缺少功能權限，請檢查已設定的權限。')
            : '',
        roleMessage:
          diagnostic.action === 'manage_project_members'
            ? selected && projects.find((row) => row.id === diagnosticProject)
              ? `${selected.name_zh || selected.username}在「${
                  projects.find((row) => row.id === diagnosticProject)?.name
                }」的角色（${
                  access.project_roles?.map((role) => role.name).join('、') ||
                  '未指派角色'
                }）不能管理成員。`
              : '目前的專案角色不能管理成員。'
            : '這個專案裡沒有可以查看或執行任務的角色。',
        nonmember: false,
      })
      repairFeedback({
        module:
          diagnostic.missing_layers.includes('module') ||
          missingModuleCodes.length > 0,
        project_role: roleMissing,
      })
    } catch (caught) {
      if (!active()) return
      if (isNotFound(caught) && needsProject && diagnosticProject) {
        setNonmemberProject(diagnosticProject)

        try {
          // T6：非成員的專案查詢沒有診斷資料，另讀既有功能權限入口。
          const access = await getUserModulePermissions(selectedUser)
          if (!active()) return
          const code =
            diagnosticAction === 'members' ? 'project.use' : 'inspection.use'
          const missing = !access.permission_codes.includes(code)
          setDiagnosticResult({
            requiredModuleCodes: [code],
            missingModuleCodes: missing ? [code] : [],
            missingRole: false,
            moduleMessage: !missing
              ? ''
              : diagnosticAction === 'members'
                ? '他也還沒開通專案管理功能的權限。'
                : '他也還沒開通查核功能的權限。',
            roleMessage: '',
            nonmember: true,
          })
          repairFeedback({ module: missing, project_member: true })
        } catch (permissionError) {
          if (!active()) return
          recheckFailed()
          setDiagnosticError(message(permissionError))
        }
      } else {
        recheckFailed()
        setDiagnosticError(message(caught))
      }
    }
  }

  async function repairDiagnosticModules() {
    if (!selectedUser || !diagnosticResult || busy) return
    const selection = diagnosticSelection.current
    const stillCurrent = () => diagnosticSelection.current === selection
    setBusy(true)
    setOperationError('diagnostic', '')
    try {
      // 用 API 宣告的需求與最新實際權限差集，不套用編輯草稿中的其他權限。
      const latest = await getUserModulePermissions(selectedUser)
      const missing = diagnosticResult.requiredModuleCodes.filter(
        (code) => !latest.permission_codes.includes(code),
      )
      for (const code of missing) {
        await grantModulePermission(selectedUser, code)
      }
      const updated = await getUserModulePermissions(selectedUser)
      if (!stillCurrent()) return
      setUserAccess(updated.permission_codes)
      setAccessDraft((current) => [
        ...new Set([
          ...current,
          ...updated.permission_codes.filter(
            (code) => !latest.permission_codes.includes(code),
          ),
        ]),
      ])
      await diagnose({ layer: 'module', label: '功能權限' })
    } catch (caught) {
      if (stillCurrent()) setDiagnosticError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function repairDiagnosticRole() {
    if (!selectedUser || !diagnosticProject) return
    const selected = users.find((user) => user.id === selectedUser)
    if (!selected || selected.is_admin) return
    const candidate = roles.find((role) => role.id === selectedCandidateRole)
    if (!candidate) {
      setOperationError(
        'diagnostic',
        '請先選擇符合需求的專案角色，沒有變更資料。',
      )
      return
    }
    setBusy(true)
    setOperationError('diagnostic', '')
    try {
      const members = await listProjectMembers(diagnosticProject)
      const member = members.find((item) => item.user_id === selectedUser)
      if (member) {
        if (member.role_ids.includes(candidate.id)) {
          setOperationError(
            'diagnostic',
            '目前角色已包含所需權限，沒有變更資料。',
          )
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
      setParticipationReload((current) => current + 1)
      await diagnose({
        layer: 'project_role',
        label: `「${candidate.name}」角色`,
      })
    } catch (caught) {
      setOperationError('diagnostic', message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function applyBundle(bundle: PermissionBundle) {
    if (!selectedUser || busy) return
    const scope = `bundle:${bundle.id}`
    setOperationError(scope, '')
    setBusy(true)
    try {
      await applyPermissionBundle(selectedUser, bundle.id)
      const access = await getUserModulePermissions(selectedUser)
      if (diagnosticSelection.current.selectedUser !== selectedUser) return
      setUserAccess(access.permission_codes)
      setAccessDraft(access.permission_codes)
      if (diagnosticResult || notice) await diagnose()
      setOperationNotice(scope, '權限組合已完整套用。')
    } catch (caught) {
      setOperationError(scope, message(caught))
    } finally {
      setBusy(false)
    }
  }

  async function changeDelegation(module: string, enabled: boolean) {
    const scope = `delegation:${module}`
    setOperationError(scope, '')
    try {
      await setModuleDelegation(selectedUser, module, enabled)
      setDelegatedModules((current) =>
        enabled
          ? [...new Set([...current, module])]
          : current.filter((item) => item !== module),
      )
      setOperationNotice(
        scope,
        enabled ? '已委派權限管理。' : '已收回權限委派。',
      )
    } catch (caught) {
      setOperationError(scope, message(caught))
    }
  }

  const hasGrants = accessDraft.some((code) => !userAccess.includes(code))
  const hasRevokes = userAccess.some((code) => !accessDraft.includes(code))
  const accessChangeLabel = hasGrants
    ? hasRevokes
      ? '套用變更'
      : '開通所選權限'
    : '收回所選權限'

  const revokePanel = revoke && (
    <ConfirmBox
      title="確認收回權限"
      variant="danger"
      confirmLabel="確認收回"
      busy={busy}
      onCancel={() => {
        revokeFocusPending.current = revoke.scope
        setRevoke(null)
      }}
      onConfirm={confirmRevoke}
      role="region"
    >
      <p>
        要收回的權限：
        {permissions
          .find((item) => item.code === revoke.code)
          ?.description.replace('模組', '功能') ?? revoke.code}
      </p>
      <p>
        影響 {revoke.impact.membership_count}{' '}
        位專案成員；可能失去管理權的專案：
        {revoke.impact.projects_becoming_unmanaged
          .map((item) => item.name)
          .join('、') || '無'}
      </p>
      {operationFeedback('revoke')}
    </ConfirmBox>
  )

  const canRepairProjectRole =
    diagnosticResult?.missingRole &&
    candidateRoles.length > 0 &&
    Boolean(diagnosticProject)
  const diagnosticRoleChoices = canRepairProjectRole ? (
    <section aria-label="可選專案角色">
      <h3>可補上的專案角色</h3>
      {safeCandidateRole ? (
        <Button disabled={busy} onClick={() => void repairDiagnosticRole()}>
          補上「現場工程師」角色
        </Button>
      ) : (
        <>
          <p>請先比較角色能做的事，再選擇符合需求的角色。</p>
          {candidateRoles.map((role) => (
            <div className="role-candidate" key={role.id}>
              <label>
                <input
                  checked={selectedCandidateRole === role.id}
                  name="diagnostic-role"
                  type="radio"
                  onChange={() => setSelectedCandidateRole(role.id)}
                />
                <strong>{role.name}</strong>
              </label>
              <p>比目前多給的能力</p>
              <RolePermissionSummary
                codes={role.permission_codes.filter(
                  (code) => !currentProjectRoleCodes.includes(code),
                )}
                emptyText="不會增加新的能力"
                name={`${role.name}比目前多給的能力`}
              />
            </div>
          ))}
          <div className="diagnostic-role-actions">
            <Button
              disabled={busy || !selectedCandidateRole}
              onClick={() => void repairDiagnosticRole()}
            >
              指派所選角色
            </Button>
            <Link to={`/projects/${diagnosticProject}/members`}>
              前往專案成員設定
            </Link>
          </div>
        </>
      )}
      {safeCandidateRole && (
        <Link to={`/projects/${diagnosticProject}/members`}>
          前往專案成員設定
        </Link>
      )}
    </section>
  ) : (
    <Link to={`/projects/${diagnosticProject}/members`}>前往專案成員設定</Link>
  )
  if (forbidden) return onForbidden ? null : <AccessDeniedPage />

  return (
    <div className="admin-page permission-management">
      {!externalNavigationGuard && (
        <ModulePermissionsNavigationGuard hasUnsavedChanges={wizardHasDraft} />
      )}

      {!wizardOpen && error && <Notice variant="error">{error}</Notice>}

      {embedded && !currentUser.is_admin && selectedUser && (
        <Card aria-label="權限開通" role="region">
          <h2 ref={accessHeadingRef} tabIndex={-1}>
            權限
          </h2>
          <p>只能開通受委派範圍內的權限，不能替自己開通或轉交委派。</p>
          {catalogLoadErrors}
          {accessLoad.userId === selectedUser &&
            accessLoad.status === 'error' && (
              <>
                <p role="status">目前無法載入</p>
                <p role="alert">{accessLoad.error}</p>
                <Button
                  onClick={() => {
                    setAccessLoadedFor('')
                    setAccessLoad({
                      userId: selectedUser,
                      status: 'loading',
                      error: '',
                    })
                    setAccessRetry((retry) => retry + 1)
                  }}
                >
                  重新載入權限
                </Button>
              </>
            )}
          <fieldset disabled={busy || !capabilitySummaryReady}>
            <legend>可開通的功能</legend>
            {visiblePermissions.map((item) => (
              <label key={item.code}>
                <input
                  checked={accessDraft.includes(item.code)}
                  type="checkbox"
                  onChange={(event) => {
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
          {capabilitySummaryReady &&
            JSON.stringify([...accessDraft].sort()) !==
              JSON.stringify([...userAccess].sort()) && (
              <Button
                disabled={busy}
                onClick={(event) => {
                  revokeTrigger.current = event.currentTarget
                  void submitAccessDraft()
                }}
              >
                {accessChangeLabel}
              </Button>
            )}
          {operationFeedback('access')}
          {revoke?.scope === 'access' && revokePanel}
        </Card>
      )}
      {wizardOpen && currentUser.is_admin && (
        <Card>
          {step === 4 ? (
            <section aria-label="建立完成">
              <h2>
                {existingAccount ? '職務已套用' : `已建立帳號：${createdName}`}
              </h2>
              {/* 臨時密碼離開就看不到，所以放在標題正下方最先看到。 */}
              {!existingAccount && (
                <>
                  <p>帳號：{createdUsername}</p>
                  <p>
                    他第一次登入必須先改成自己的密碼。離開此頁後就看不到這組密碼。
                  </p>
                  <TemporaryPassword password={temporaryPassword} />
                </>
              )}
              <p>
                {existingAccount
                  ? `${createdName}的職務與權限設定已完成。`
                  : `${createdName}的帳號與權限設定已完成。`}
              </p>
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
                  leaveTemporaryPasswordPage(() =>
                    onWizardBackToList
                      ? onWizardBackToList()
                      : setWizardOpen(false),
                  )
                }
              >
                回清單
              </Button>
              <Button
                onClick={() => {
                  leaveTemporaryPasswordPage(() => {
                    setWizardOpen(false)
                    setTemporaryPassword('')
                    selectUser(createdId)
                    onWizardViewUser?.(createdId)
                  })
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
                  : ['帳號資料', '職務', '專案', '確認'][step]}
              </h2>
              <p>帳號資料與職務，建立後都能在帳號頁修改。</p>
              <nav
                ref={wizardStepsRef}
                aria-label="新增帳號步驟"
                className="wizard-steps"
              >
                {['帳號資料', '職務', '專案', '確認'].map((label, index) => (
                  <span key={label}>
                    {index > 0 && <span aria-hidden="true"> › </span>}
                    <span aria-current={step === index ? 'step' : undefined}>
                      {label}
                    </span>
                  </span>
                ))}
              </nav>
              {step === 0 && !existingAccount && (
                <>
                  <FormErrorSummary
                    errors={(Object.keys(IDENTITY_FIELDS) as IdentityField[])
                      .filter((field) => identityErrors[field])
                      .map((field) => ({
                        fieldId: IDENTITY_FIELDS[field].id,
                        fieldLabel: IDENTITY_FIELDS[field].label,
                        message: identityErrors[field] ?? '',
                      }))}
                    focusRequest={identityFocusRequest}
                  />
                  <FormGroup
                    title="帳號資料"
                    description="設定登入帳號與基本資料。"
                  >
                    <FormField
                      error={identityErrors.username}
                      id={IDENTITY_FIELDS.username.id}
                      label="帳號名稱"
                      required
                    >
                      {(control) => (
                        <Input
                          {...control}
                          aria-describedby={[
                            control['aria-describedby'],
                            'wizard-username-hint',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          value={username}
                          disabled={Boolean(createdId)}
                          onChange={(event) =>
                            updateIdentity(
                              'username',
                              event.target.value,
                              setUsername,
                            )
                          }
                        />
                      )}
                    </FormField>
                    <p className="field-hint" id="wizard-username-hint">
                      3–32 字，英文字母開頭，可用英文、數字、. _
                      -；不分大小寫。
                    </p>
                    <FormField
                      error={identityErrors.name}
                      id={IDENTITY_FIELDS.name.id}
                      label="姓名"
                      required
                    >
                      {(control) => (
                        <Input
                          {...control}
                          value={name}
                          disabled={Boolean(createdId)}
                          onChange={(event) =>
                            updateIdentity('name', event.target.value, setName)
                          }
                        />
                      )}
                    </FormField>
                    <FormField
                      error={identityErrors.email}
                      id={IDENTITY_FIELDS.email.id}
                      label="電子郵件"
                      required
                    >
                      {(control) => (
                        <Input
                          {...control}
                          type="email"
                          value={email}
                          disabled={Boolean(createdId)}
                          onChange={(event) =>
                            updateIdentity(
                              'email',
                              event.target.value,
                              setEmail,
                            )
                          }
                        />
                      )}
                    </FormField>
                    <details
                      open={moreOpen}
                      onToggle={(event) =>
                        setMoreOpen(event.currentTarget.open)
                      }
                    >
                      <summary>更多資料（選填）</summary>
                      <FormField
                        label="英文姓名"
                        id={IDENTITY_FIELDS.name_en.id}
                        error={identityErrors.name_en}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={nameEn}
                            disabled={Boolean(createdId)}
                            onChange={(event) =>
                              updateIdentity(
                                'name_en',
                                event.target.value,
                                setNameEn,
                              )
                            }
                          />
                        )}
                      </FormField>
                      <FormField
                        label="部門"
                        id={IDENTITY_FIELDS.department.id}
                        error={identityErrors.department}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={department}
                            disabled={Boolean(createdId)}
                            onChange={(event) =>
                              updateIdentity(
                                'department',
                                event.target.value,
                                setDepartment,
                              )
                            }
                          />
                        )}
                      </FormField>
                      <FormField
                        label="地點"
                        id={IDENTITY_FIELDS.location.id}
                        error={identityErrors.location}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={location}
                            disabled={Boolean(createdId)}
                            onChange={(event) =>
                              updateIdentity(
                                'location',
                                event.target.value,
                                setLocation,
                              )
                            }
                          />
                        )}
                      </FormField>
                      <FormField
                        label="工號"
                        id={IDENTITY_FIELDS.employee_no.id}
                        error={identityErrors.employee_no}
                      >
                        {(control) => (
                          <Input
                            {...control}
                            value={employeeNo}
                            disabled={Boolean(createdId)}
                            onChange={(event) =>
                              updateIdentity(
                                'employee_no',
                                event.target.value,
                                setEmployeeNo,
                              )
                            }
                          />
                        )}
                      </FormField>
                    </details>
                    <FormField
                      label="公司"
                      id={IDENTITY_FIELDS.company_id.id}
                      error={identityErrors.company_id}
                    >
                      {(control) => (
                        <select
                          {...control}
                          disabled={Boolean(createdId)}
                          value={companyId}
                          onChange={(event) =>
                            updateIdentity(
                              'company_id',
                              event.target.value,
                              setCompanyId,
                            )
                          }
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
                </>
              )}
              {step === 1 && (
                <fieldset
                  aria-describedby={
                    profileError ? 'wizard-profile-error' : undefined
                  }
                >
                  <legend>選擇職務</legend>
                  {profileError && (
                    <Notice variant="error" id="wizard-profile-error">
                      {profileError}
                    </Notice>
                  )}
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
                        onChange={() => {
                          setProfile(option.id)
                          setProfileError('')
                          if (option.id === 'manager') setProjectId('')
                        }}
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
                    aria-label="加入專案（可略過）"
                    disabled={
                      Boolean(createdId) ||
                      profile === 'manager' ||
                      projectOptionsStatus === 'loading'
                    }
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    <option value="">
                      {projectOptionsStatus === 'loading'
                        ? '載入專案中…'
                        : '稍後再加入'}
                    </option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    {profile === 'manager'
                      ? '主管只看全公司進度，不需要加入專案。'
                      : '現場查核與外部協作人員要先加入專案，才看得到任務。'}
                  </span>
                </label>
              )}
              {step === 3 && profile && (
                <div>
                  <h3>{existingAccount ? '套用前確認' : '建立前確認'}</h3>
                  <p>
                    {(existingAccount
                      ? users.find((user) => user.id === selectedUser)?.name_zh
                      : name) || '新同仁'}
                    將建立為「
                    {
                      PROFILE_OPTIONS.find((item) => item.id === profile)
                        ?.label
                    }
                    」帳號。
                  </p>
                  {!existingAccount && (
                    <div className="wizard-confirmation">
                      <p>帳號名稱：{username}</p>
                      <p>姓名：{name}</p>
                      <p>電子郵件：{email}</p>
                      <p>
                        公司：
                        {companies.find((item) => item.id === companyId)
                          ?.name || '未連結公司'}
                      </p>
                      <p>
                        職務：
                        {
                          PROFILE_OPTIONS.find((item) => item.id === profile)
                            ?.label
                        }
                      </p>
                      {profile !== 'manager' && (
                        <p>
                          加入專案：
                          {projects.find((item) => item.id === projectId)
                            ?.name || '稍後再加入'}
                        </p>
                      )}
                    </div>
                  )}
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
                  {!projectId &&
                    (profile === 'field' || profile === 'external') && (
                      <p role="note">加入專案前看不到任何任務。</p>
                    )}
                  {projectId && profile !== 'manager' && (
                    <p className="field-hint">
                      預設專案角色「
                      {profileRoleLabel(roles, profile, creatorRoleId)}」。
                    </p>
                  )}
                  {createdId && (
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
              {step === 3 && !existingAccount && !createdId && (
                <p>
                  按下後會產生一組臨時密碼，只顯示這一次。請先準備好複製或抄寫。
                </p>
              )}
              {step <= 3 && (
                <div className="wizard-actions">
                  {onWizardCancel && !createdId && (
                    <Button disabled={busy} onClick={onWizardCancel}>
                      取消
                    </Button>
                  )}
                  {step > 0 && (
                    <Button
                      disabled={busy || Boolean(createdId)}
                      onClick={() => goToStep(step - 1)}
                    >
                      上一步
                    </Button>
                  )}
                  {step === 3 && !createdId && (
                    <Button
                      disabled={Boolean(createBlockReason)}
                      aria-describedby={
                        createBlockReason
                          ? 'wizard-create-block-reason'
                          : undefined
                      }
                      onClick={() => void createStaff()}
                      variant="primary"
                    >
                      {existingAccount ? '套用職務' : '建立帳號'}
                    </Button>
                  )}
                  {step < 3 && (
                    <Button
                      disabled={busy || Boolean(createdId)}
                      onClick={() => goToStep(step + 1)}
                      variant="primary"
                    >
                      下一步
                    </Button>
                  )}
                </div>
              )}
              {step === 3 && createBlockReason && (
                <p id="wizard-create-block-reason" role="status">
                  {createBlockReason}
                </p>
              )}
              {error && <Notice variant="error">{error}</Notice>}
              {optionsError && (
                <div>
                  <Notice variant="error">{optionsError}</Notice>
                  <Button
                    onClick={() => {
                      setOptionsError('')
                      void loadWizardOptions(step).catch((caught: unknown) =>
                        setOptionsError(message(caught)),
                      )
                    }}
                  >
                    重新載入選項
                  </Button>
                </div>
              )}
              {partial && step !== 3 && (
                <Notice variant="info">{partial}</Notice>
              )}
            </>
          )}
        </Card>
      )}
      {selectedUserId &&
        currentUser.is_admin &&
        !(wizardOpen && step === 4) && (
          <details
            className="permission-advanced-settings"
            onToggle={(event) => {
              // #712：展開進階設定時才載入組合、角色與其他管理選項。
              // 原生 toggle 可能早於 React 提交 ready，成功快取以 ref 同步判斷。
              if (!event.currentTarget.open || advancedLoaded.current) return
              void refresh().catch(() => undefined)
            }}
          >
            <summary>進階設定</summary>
            {advancedStatus === 'loading' && <p role="status">載入中…</p>}
            {advancedStatus === 'error' && (
              <div>
                <p role="alert">進階設定載入失敗：{advancedError}</p>
                <Button onClick={() => void refresh().catch(() => undefined)}>
                  重新載入進階設定
                </Button>
              </div>
            )}
            <Card aria-label="已設定的權限" role="region">
              <h2 ref={accessHeadingRef} tabIndex={-1}>
                已設定的權限
              </h2>
              <p>
                這裡顯示帳號已開通的權限；專案內能力請查看「參與專案與角色」。
              </p>
              {selectedUser && (
                <>
                  <fieldset
                    disabled={busy || accessLoadedFor !== selectedUser}
                  >
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
                      onClick={(event) => {
                        revokeTrigger.current = event.currentTarget
                        void submitAccessDraft()
                      }}
                    >
                      {accessChangeLabel}
                    </Button>
                  )}
                </>
              )}
              {operationFeedback('access')}
              {revoke?.scope === 'access' && revokePanel}
            </Card>
            {embedded && currentUser.is_admin && (
              <Card>
                <h2>套用權限組合</h2>
                <ul>
                  {bundles.map((bundle) => (
                    <li className="permission-bundle-row" key={bundle.id}>
                      <span>{bundle.name}</span>{' '}
                      <Button
                        disabled={!selectedUser || busy}
                        onClick={() => void applyBundle(bundle)}
                      >
                        套用
                      </Button>
                      {operationFeedback(`bundle:${bundle.id}`)}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {currentUser.is_admin && (
              <Card>
                <h2>委派管理</h2>
                <p>收回委派不會移除對方已授予帳號的權限。</p>
                {selectedUser &&
                  ['project', 'inspection', 'template'].map((module) => (
                    <div key={module}>
                      <label>
                        <input
                          disabled={accessLoadedFor !== selectedUser}
                          checked={delegatedModules.includes(module)}
                          type="checkbox"
                          onChange={(event) => {
                            const enabled = event.target.checked
                            void changeDelegation(module, enabled)
                          }}
                        />
                        可管理
                        {{
                          project: '專案',
                          inspection: '查核',
                          template: '範本',
                        }[module] ?? module}
                        權限
                      </label>
                      {operationFeedback(`delegation:${module}`)}
                    </div>
                  ))}
              </Card>
            )}
          </details>
        )}
      {/* 完成頁只放臨時密碼與下一步；剛建好的帳號沒有可看的能力。 */}
      {selectedUser && currentUser.is_admin && !(wizardOpen && step === 4) && (
        <Card className="permission-capabilities">
          <h2>{embedded ? '能做什麼' : '帳號能力與快速檢查'}</h2>
          {embedded &&
            currentUser.is_admin &&
            selectedAccount &&
            !selectedAccount.is_admin && (
              <div className="wizard-actions">
                <Button className="btn-emphasis" onClick={startExistingJob}>
                  重新套用職務
                </Button>
                <p>{JOB_REAPPLY_EXPLANATION}</p>
              </div>
            )}
          <div aria-label="帳號能力摘要" role="region">
            <p role="status">
              可使用功能：
              {capabilitySummaryLoading
                ? '載入中…'
                : capabilitySummaryError
                  ? '目前無法載入'
                  : !capabilitySummaryReady
                    ? '載入中…'
                    : users.find((user) => user.id === selectedUser)?.is_admin
                      ? '系統管理者可使用全部功能。'
                      : permissions
                          .filter((item) => userAccess.includes(item.code))
                          .map((item) =>
                            item.description
                              .replace('模組', '功能')
                              .replace(/^使用/, ''),
                          )
                          .join('、') || '尚未開通功能。'}
            </p>
            {catalogLoadErrors}
            {accessLoad.userId === selectedUser &&
              accessLoad.status === 'error' && (
                <>
                  <p role="alert">{accessLoad.error}</p>
                  <Button
                    onClick={() => {
                      setAccessLoadedFor('')
                      setAccessLoad({
                        userId: selectedUser,
                        status: 'loading',
                        error: '',
                      })
                      setAccessRetry((retry) => retry + 1)
                    }}
                  >
                    重新載入權限
                  </Button>
                </>
              )}
            <h3>參與專案與角色</h3>
            {participationForSelectedUser?.error && (
              <p role="alert">{participationForSelectedUser.error}</p>
            )}
            {participationForSelectedUser?.error && (
              <Button
                onClick={() =>
                  setParticipationReload((current) => current + 1)
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
            <section aria-label="為什麼他不能做這件事？">
              <h3 ref={diagnosticHeadingRef} tabIndex={-1}>
                為什麼他不能做這件事？
              </h3>
              <label>
                要檢查的操作
                <select
                  value={diagnosticAction}
                  onChange={(event) => {
                    setDiagnosticError('')
                    setNonmemberProject('')
                    setDiagnosticAction(event.target.value)
                    if (
                      !['task-list', 'members'].includes(event.target.value)
                    ) {
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
                    disabled={projectOptionsStatus !== 'ready'}
                    onChange={(event) => {
                      setDiagnosticError('')
                      setNonmemberProject('')
                      setDiagnosticProject(event.target.value)
                      setNotice('')
                      setCandidateRoles([])
                    }}
                  >
                    <option
                      value=""
                      disabled={projectOptionsStatus !== 'ready'}
                    >
                      {projectOptionsStatus === 'error'
                        ? '無法載入專案'
                        : projectOptionsStatus !== 'ready'
                          ? '載入專案中…'
                          : '選擇專案'}
                    </option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {projectOptionsStatus === 'error' && (
                <div>
                  <p role="alert">專案選項載入失敗：{projectOptionsError}</p>
                  <Button
                    onClick={() =>
                      void loadProjectOptions().catch(() => undefined)
                    }
                  >
                    重新載入專案選項
                  </Button>
                </div>
              )}
              <Button
                className="permission-check-button"
                disabled={
                  accessLoadedFor !== selectedUser ||
                  (['task-list', 'members'].includes(diagnosticAction) &&
                    !diagnosticProject)
                }
                onClick={() => void diagnose()}
              >
                檢查
              </Button>
              {/* 結果訊息跟在觸發它的「檢查」按鈕後面，才讀得出因果。 */}
              {diagnosticError && (
                <Notice variant="error">{diagnosticError}</Notice>
              )}
              {notice && <Notice variant="info">{notice}</Notice>}
              {diagnosticResult && (
                <Notice variant="info">
                  <ul>
                    {diagnosticResult.nonmember && (
                      <li>
                        {NONMEMBER_MESSAGE}
                        <Link to={`/projects/${nonmemberProject}/members`}>
                          前往專案成員頁
                        </Link>
                      </li>
                    )}
                    {diagnosticResult.moduleMessage && (
                      <li>
                        {diagnosticResult.missingRole
                          ? diagnosticResult.moduleMessage.replace(/。$/, '') +
                            `；${diagnosticResult.roleMessage}`
                          : diagnosticResult.moduleMessage}
                        {diagnosticResult.missingModuleCodes.length > 0 && (
                          <Button
                            disabled={busy}
                            onClick={() => void repairDiagnosticModules()}
                          >
                            {diagnosticAction === 'task-list'
                              ? '開通查核功能'
                              : diagnosticAction === 'members'
                                ? '開通專案管理功能'
                                : diagnosticAction === 'template'
                                  ? '開通範本管理權限'
                                  : '開通建立專案權限'}
                          </Button>
                        )}
                      </li>
                    )}
                    {diagnosticResult.missingRole && (
                      <li>
                        {!diagnosticResult.moduleMessage &&
                          diagnosticResult.roleMessage}
                        {diagnosticRoleChoices}
                      </li>
                    )}
                  </ul>
                </Notice>
              )}
              {operationFeedback('diagnostic')}
              {revoke?.scope === 'diagnostic' && revokePanel}
            </section>
          </div>
        </Card>
      )}
    </div>
  )
}
