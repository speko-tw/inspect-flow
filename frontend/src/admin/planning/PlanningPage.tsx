import { inactiveAssigneeNotice } from '../../ui/SuggestedAssignee'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  Link,
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router'
import { BackLink } from '../../layout/BackLink'
import RouteNotFound from '../../RouteNotFound'

import { collectPages, HttpError, isForbidden, isNotFound } from '../../http'
import { RequiredMark } from '../../ui/Form'
import AccessDeniedPage from '../../components/layout/AccessDeniedPage'
import { StatusBadge } from '../../ui/Badge'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import type { FieldErrorBinding } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { getProject, type Project } from '../projects/api'
import { listProjectItems, type ProjectItemData } from '../projectItems/api'
import { planningClient, planningErrorMessage } from './api'
import { UnsavedLeaveBox } from '../../ui/navigation'
import { useUnsavedNavigationGuard } from '../../ui/navigation'
import type {
  InspectionPlan,
  InspectionTask,
  SuggestedAssignee,
  PlanningClient,
  ProjectZone,
} from './api'

import './PlanningPage.css'

const READ_ONLY_NOTICE =
  '你在這個專案只能查看計畫與任務，不能新增、修改或派出。' +
  '需要調整請找有管理權限的專案成員或管理者。'
const ASSIGNEE_LIST_UNAVAILABLE_NOTICE =
  '看不到成員名單，這次只能選「不指定」，' + '之後請有權限的人補上。'

/** 規劃頁操作與共用專案資料 API 的依賴介面。 */
export type PlanningPageClient = PlanningClient & {
  getProject(projectId: string): Promise<Pick<Project, 'id' | 'name'>>
  listProjectItems(projectId: string): Promise<ProjectItemData[]>
}

const defaultPlanningPageClient: PlanningPageClient = {
  ...planningClient,
  getProject,
  listProjectItems,
}

type NoticeArea = 'plans' | 'plan-detail' | 'tasks'

// 必填錯誤等送出才顯示，避免輸入前就出現錯誤；錯誤列在欄位旁
// 並聚焦（PR-19、ADM-R28），讓使用者能找到修正位置。
type FieldKey =
  | 'plan-name'
  | 'plan-rename'
  | 'task-items'
  | 'task-name'
  | 'task-rename'
  | 'edit-task-items'
  | 'task-zone'
  | 'task-location'
  | 'task-assignee'
  | 'location-zone'
  | 'location-text'
  | 'suggested-assignee'
  | 'cancel-reason'

const FIELD_ERROR: Partial<Record<FieldKey, string>> = {
  'plan-name': '請輸入計畫名稱。',
  'plan-rename': '請輸入計畫名稱。',
  'task-items': '請至少選擇一筆查核項目。',
  'task-name': '請輸入任務名稱。',
  'task-rename': '請輸入任務名稱。',
  'edit-task-items': '請至少選擇一筆查核項目。',
  'task-zone': '請選擇任務分區。',
  'location-zone': '請選擇任務分區。',
}

// 路徑依各 API 請求 body 綁定，避免不同表單的同名欄位互相搶焦點。
const PLAN_CREATE_BINDINGS: FieldErrorBinding[] = [
  { path: '/name', key: 'plan-name' },
]
const PLAN_RENAME_BINDINGS: FieldErrorBinding[] = [
  { path: '/name', key: 'plan-rename' },
]
const TASK_CREATE_BINDINGS: FieldErrorBinding[] = [
  { path: '/name', key: 'task-name' },
  { path: '/item_ids', key: 'task-items' },
  { path: '/zone_id', key: 'task-zone' },
  { path: '/location_text', key: 'task-location' },
  { path: '/suggested_assignee_id', key: 'task-assignee' },
]
const TASK_RENAME_BINDINGS: FieldErrorBinding[] = [
  { path: '/name', key: 'task-rename' },
]
const TASK_ITEMS_BINDINGS: FieldErrorBinding[] = [
  { path: '/item_ids', key: 'edit-task-items' },
]
const TASK_LOCATION_BINDINGS: FieldErrorBinding[] = [
  { path: '/zone_id', key: 'location-zone' },
  { path: '/location_text', key: 'location-text' },
]
const TASK_ASSIGNEE_BINDINGS: FieldErrorBinding[] = [
  { path: '/assignee_id', key: 'suggested-assignee' },
]
const TASK_CANCEL_BINDINGS: FieldErrorBinding[] = [
  { path: '/reason', key: 'cancel-reason' },
]

// 任務的業務 422（沒有 fields 清單、只有專用錯誤碼）也要落在對應欄位旁並
// 聚焦（ADM-R28）；IP-AC15 的零點位項目錯誤也屬於查核項目欄位。
// 各表單欄位不同，所以每個表單各一張表。
const TASK_CODE_MESSAGES: Record<string, string> = {
  'project_inspection_item.inactive':
    '所選的查核項目剛被停用，清單已更新並取消勾選，請確認後再送出。',
  'inspection_task.invalid_zone': '所選分區不屬於這個專案，請重新選擇。',
  'inspection_task.invalid_assignee':
    '建議指派人不是這個專案的成員，請重新選擇。',
  'inspection_task.items_required': '請至少選擇一筆查核項目。',
  'inspection_task.item_without_points': [
    '所選查核項目沒有查核項次，',
    '請先補上項次或改選其他項目。',
  ].join(''),
  'inspection_task.invalid_project_item':
    '所選查核項目不屬於這個專案，請重新整理後再選。',
  'inspection_task.invalid_location': '補充地點內容不符合規則，請修改後再試。',
  'inspection_task.invalid_name': '任務名稱需為 1 到 128 個字元。',
}
const TASK_CREATE_CODE_FIELDS: Record<string, FieldKey> = {
  'project_inspection_item.inactive': 'task-items',
  'inspection_task.invalid_name': 'task-name',
  'inspection_task.invalid_zone': 'task-zone',
  'inspection_task.invalid_assignee': 'task-assignee',
  'inspection_task.items_required': 'task-items',
  'inspection_task.item_without_points': 'task-items',
  'inspection_task.invalid_project_item': 'task-items',
  'inspection_task.invalid_location': 'task-location',
}
const TASK_RENAME_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_name': 'task-rename',
}
const TASK_ITEMS_CODE_FIELDS: Record<string, FieldKey> = {
  'project_inspection_item.inactive': 'edit-task-items',
  'inspection_task.items_required': 'edit-task-items',
  'inspection_task.item_without_points': 'edit-task-items',
  'inspection_task.invalid_project_item': 'edit-task-items',
}
const TASK_LOCATION_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_zone': 'location-zone',
  'inspection_task.invalid_location': 'location-text',
}
const TASK_ASSIGNEE_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_assignee': 'suggested-assignee',
}

// 依 ADM-R28、IP-R10，派出鈕與阻擋說明共用畫面判斷；建議指派
// 依 IP-R05 非排他，這裡的缺項提示不能冒充後端的派出限制。
function dispatchBlockers(task: InspectionTask) {
  return {
    unassigned: !task.assignee_id,
    noLocation: !task.zone_id && !task.location_text?.trim(),
    noItems: task.items.length === 0,
  }
}

function sameItemSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id))
}

function describedBy(...ids: (string | false)[]): string {
  return ids.filter(Boolean).join(' ')
}

function taskTitle(task: InspectionTask): string {
  return task.name
}

/** 只在欄位未被手動編輯前更新預設名稱，保留使用者自己的命名。 */
function suggestedTaskName(
  items: ProjectItemData[],
  itemIds: string[],
  zones: ProjectZone[],
  zoneId: string,
  locationText: string,
): string {
  const selected = itemIds
    .map((id) => items.find((item) => item.id === id)?.title)
    .filter((title): title is string => Boolean(title))
  if (!selected.length) return ''
  const itemPart =
    selected.length === 1
      ? selected[0]
      : `${selected[0]}等 ${selected.length} 項`
  const location =
    zones.find((zone) => zone.id === zoneId)?.name ?? locationText.trim()
  const result = location ? `${itemPart}－${location}` : itemPart
  // 預設值遵守領域名稱上限；使用者輸入不會再由此函式覆蓋。
  return Array.from(result).slice(0, 128).join('')
}

/** IP-R24：項目文字與停用標記共用容器，窄螢幕不拆成兩個 flex 欄。 */
function ItemChoiceLabel({ item }: { item: ProjectItemData }) {
  return (
    <span className="planning-item-label">
      {item.instruction
        ? [item.title, item.instruction].join(' — ')
        : item.title}
      {item.is_active === false && (
        <span className="planning-inactive-label">（已停用）</span>
      )}
    </span>
  )
}

function taskItemsSummary(task: InspectionTask): string {
  return (
    task.items
      .map((item) => item.current_snapshot?.title)
      .filter((title): title is string => Boolean(title))
      .join('、') || '無查核項目'
  )
}

function draftTaskSummary(task: InspectionTask): string {
  return `「${task.name}」（查核項目：${taskItemsSummary(task)}）`
}

/**
 * 依 ADM-R17、IP-R02、IP-R10 呈現專案計畫與任務管理。
 * #727：依 ADM-R17、IP-R01 與 viewer 權限隱藏入口；後端仍覆核寫入。
 */
type PlanningPageProps = {
  client?: PlanningPageClient
  viewerPermissions?: string[]
  initialProjectId?: string
}

type PlanningView =
  'list' | 'plan-new' | 'plan' | 'task-new' | 'task' | 'task-edit'
type EditSection = 'location' | 'assignee' | 'items'

/** IP-R27：每個清單、詳情與表單都有可重新整理的網址。 */
export default function PlanningPage(props: PlanningPageProps) {
  const location = useLocation()
  const projectPart = encodeURIComponent(props.initialProjectId ?? '')
  const base = `/projects/${projectPart}/planning`
  const relative = location.pathname.replace(/\/$/, '').slice(base.length)
  const suffix = relative.split('/').filter(Boolean)
  const valid =
    location.pathname.startsWith(base) &&
    (suffix.length === 0 ||
      suffix.length === 1 ||
      (suffix.length === 3 && suffix[0] !== 'new' && suffix[1] === 'tasks') ||
      (suffix.length === 4 &&
        suffix[0] !== 'new' &&
        suffix[1] === 'tasks' &&
        suffix[2] !== 'new' &&
        suffix[3] === 'edit'))
  const planId = suffix[0] === 'new' ? '' : (suffix[0] ?? '')
  const taskId = suffix[2] === 'new' ? '' : (suffix[2] ?? '')
  const view: PlanningView =
    suffix[0] === 'new'
      ? 'plan-new'
      : suffix[3] === 'edit'
        ? 'task-edit'
        : taskId
          ? 'task'
          : suffix[2] === 'new'
            ? 'task-new'
            : planId
              ? 'plan'
              : 'list'
  const section = new URLSearchParams(location.search).get('section')
  const editSection: EditSection =
    section === 'items' || section === 'assignee' ? section : 'location'
  // IP-R29：畸形網址不代表有效資源，直接回 404，避免發出無效 API 請求。
  if (!valid) return <RouteNotFound />
  return (
    <PlanningContent
      key={props.initialProjectId}
      {...props}
      base={base}
      view={view}
      planId={planId}
      taskId={taskId}
      editSection={editSection}
    />
  )
}

function PlanningContent({
  client = defaultPlanningPageClient,
  initialProjectId = '',
  viewerPermissions,
  base,
  view,
  planId,
  taskId,
  editSection,
}: PlanningPageProps & {
  base: string
  view: PlanningView
  planId: string
  taskId: string
  editSection: EditSection
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const navigationType = useNavigationType()
  const planPath = `${base}/${encodeURIComponent(planId)}`
  const taskUrl = (id: string) => `${planPath}/tasks/${encodeURIComponent(id)}`
  const taskPath = taskUrl(taskId)
  const [editReturnFocus, setEditReturnFocus] = useState(
    () => (location.state as { returnFocus?: string } | null)?.returnFocus,
  )

  function editTask(
    task: InspectionTask,
    section: EditSection,
    returnFocus?: string,
  ) {
    navigate(`${taskUrl(task.id)}/edit?section=${section}`, {
      state: {
        returnFocus:
          returnFocus ??
          {
            location: '修改地點',
            assignee: '修改建議指派',
            items: '修改查核項目',
          }[section],
      },
    })
  }
  const [projects, setProjects] = useState<Pick<Project, 'id' | 'name'>[]>([])
  const [projectId, setProjectId] = useState('')
  const [items, setItems] = useState<ProjectItemData[]>([])
  const [zones, setZones] = useState<ProjectZone[]>([])
  const [members, setMembers] = useState<SuggestedAssignee[]>([])
  const [plans, setPlans] = useState<InspectionPlan[]>([])
  const [selectedPlanData, setSelectedPlanData] = useState<{
    id: string
    requestKey: string
    path: string
    plan: InspectionPlan
  } | null>(null)
  const selectedPlanId = planId
  const selectedPlan =
    plans.find((plan) => plan.id === selectedPlanId) ??
    (selectedPlanData?.id === selectedPlanId &&
    selectedPlanData.plan.project_id === initialProjectId
      ? selectedPlanData.plan
      : null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [writeDenied, setReadOnly] = useState(false)
  // #727：計畫頁的寫入入口各自對應後端權限；現場查核不算規劃寫入。
  const writeCodes = [
    'inspection_plan.create',
    'inspection_plan.manage',
    'inspection_plan.archive',
    'inspection_plan.unarchive',
    'inspection_task.create',
    'inspection_task.manage',
    'inspection_task.assign',
    'inspection_task.dispatch',
    'inspection_task.delete_draft',
    'inspection_task.cancel',
  ]
  function canWrite(code: string): boolean {
    return (
      !writeDenied &&
      (viewerPermissions === undefined || viewerPermissions.includes(code))
    )
  }
  const canCreatePlan = canWrite('inspection_plan.create')
  const canManagePlan = canWrite('inspection_plan.manage')
  const canToggleArchive = canWrite(
    selectedPlan?.status === 'ARCHIVED'
      ? 'inspection_plan.unarchive'
      : 'inspection_plan.archive',
  )
  const canCreateTask = canWrite('inspection_task.create')
  const canManageTask = canWrite('inspection_task.manage')
  const canAssignTask = canWrite('inspection_task.assign')
  const canDispatchTask = canWrite('inspection_task.dispatch')
  const canDeleteTask = canWrite('inspection_task.delete_draft')
  const canCancelTask = canWrite('inspection_task.cancel')
  // 讀取條件只依有效權限，403 切唯讀不得重載並清掉頁面錯誤。
  const canLoadAssignees =
    viewerPermissions === undefined ||
    viewerPermissions.includes('inspection_task.create') ||
    viewerPermissions.includes('inspection_task.assign')
  const readOnly = !writeCodes.some(canWrite)
  const [accessDenied, setAccessDenied] = useState(false)
  const [projectNotFound, setProjectNotFound] = useState(false)
  const [zonesDenied, setZonesDenied] = useState(false)
  const [membersUnavailable, setMembersUnavailable] = useState(false)
  const [membersFailure, setMembersFailure] = useState<
    'forbidden' | 'temporary' | null
  >(null)
  const [retryingMembers, setRetryingMembers] = useState(false)
  const assigneeRequest = useRef(0)
  const retryFocusTarget = useRef<{
    projectId: string
    select: HTMLSelectElement
    fallback: HTMLElement
  } | null>(null)
  const wasRetryingMembers = useRef(false)
  const [error, setError] = useState('')
  const [errorContext, setErrorContext] = useState('page')
  const [fieldError, setFieldError] = useState<{ field: FieldKey } | null>(
    null,
  )
  const [serverFieldErrors, setServerFieldErrors] = useState<
    Partial<Record<FieldKey, string>>
  >({})
  const [serverFieldFocus, setServerFieldFocus] = useState<FieldKey | null>(
    null,
  )
  // 依 ADM-R28 將成功提示放在所屬區塊，避免與其他操作混淆。
  // 下一次操作先清除舊提示，避免使用者把舊結果套到新操作。
  const [notice, setNotice] = useState<{
    area: NoticeArea
    text: string
  } | null>(
    () =>
      (
        location.state as {
          planningNotice?: { area: NoticeArea; text: string }
        } | null
      )?.planningNotice ?? null,
  )
  const [returnFocus, setReturnFocus] = useState<string | undefined>(
    (location.state as { focusLabel?: string } | null)?.focusLabel,
  )
  const [reloadKey, setReloadKey] = useState(0)
  // 專案尚未載入時獨立重試，避免每次寫入後重載都重查專案。
  const [projectRetryKey, setProjectRetryKey] = useState(0)
  const [planName, setPlanName] = useState('')
  const [editingPlanName, setEditingPlanName] = useState(false)
  const [updatedPlanName, setUpdatedPlanName] = useState('')
  const [taskItems, setTaskItems] = useState<string[]>([])
  const [removedTaskItems, setRemovedTaskItems] = useState<string[]>([])
  // 重載完成時讀最新勾選，避免非同步請求保留較舊的選擇。
  const taskItemsRef = useRef(taskItems)
  useEffect(() => {
    taskItemsRef.current = taskItems
  }, [taskItems])
  const [taskName, setTaskName] = useState('')
  // 只有使用者碰過名稱欄才採用手動值，避免項目變動覆寫自訂名稱。
  const [taskNameTouched, setTaskNameTouched] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(view === 'task-new')
  const focusedTaskFormPath = useRef('')
  const [taskZoneId, setTaskZoneId] = useState('')
  const [taskLocation, setTaskLocation] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [editingLocation, setEditingLocation] = useState<{
    task: InspectionTask
    zoneId: string
    locationText: string
  } | null>(null)
  const [editingName, setEditingName] = useState<{
    task: InspectionTask
    name: string
  } | null>(null)
  const [editingTaskItemsDraft, setEditingTaskItems] = useState<{
    task: InspectionTask
    itemIds: string[]
  } | null>(null)

  const requestPath = location.pathname + location.search
  const planRequestKey =
    `${selectedPlanId}:${reloadKey}:` +
    `${location.pathname}:${location.search}`
  const [planFailure, setPlanFailure] = useState<{
    requestKey: string
    kind: 'forbidden' | 'not-found' | 'error'
    message: string
  } | null>(null)
  const currentPlanFailure =
    planFailure?.requestKey === planRequestKey ? planFailure : null
  const planPending = Boolean(
    selectedPlanId &&
    selectedPlanData?.requestKey !== planRequestKey &&
    !currentPlanFailure,
  )
  useEffect(() => {
    if (!selectedPlanId) return
    let active = true
    void client.getPlan(selectedPlanId).then(
      (plan) => {
        if (active)
          setSelectedPlanData({
            id: selectedPlanId,
            requestKey: planRequestKey,
            path: requestPath,
            plan,
          })
      },
      (caught: unknown) => {
        if (active)
          setPlanFailure({
            requestKey: planRequestKey,
            kind: isForbidden(caught)
              ? 'forbidden'
              : isNotFound(caught)
                ? 'not-found'
                : 'error',
            message: planningErrorMessage(caught),
          })
      },
    )
    return () => {
      active = false
    }
  }, [client, selectedPlanId, planRequestKey, requestPath])
  const selectedPlanDetail =
    selectedPlanData?.id === selectedPlanId ? selectedPlanData.plan : null
  // IP-R24：修改草稿時，只保留「伺服器目前仍有的」停用項目，裁掉剛新勾選、
  // 之後才被停用的項目（送出會回 inactive）。「原有」以重載後最新的計畫明細
  // 為準，和後端持鎖重讀的 old_ids 一致；明細尚未回來時先用開啟編輯器時的
  // 快照。項目清單載入失敗（items 為空）時不裁，避免誤清使用者的勾選。
  // 以衍生值呈現而不在 effect 內改 state，重載與明細到達的先後都會收斂。
  const editingTaskItems = useMemo(() => {
    const draft = editingTaskItemsDraft
    if (!draft || items.length === 0) return draft
    const activeIds = new Set(
      items.filter((item) => item.is_active !== false).map((item) => item.id),
    )
    const latest = selectedPlanDetail?.tasks?.find(
      (task) => task.id === draft.task.id,
    )
    const original = new Set(
      (latest ?? draft.task).items.map((item) => item.id),
    )
    const kept = draft.itemIds.filter(
      (id) => activeIds.has(id) || original.has(id),
    )
    return kept.length === draft.itemIds.length
      ? draft
      : { ...draft, itemIds: kept }
  }, [editingTaskItemsDraft, items, selectedPlanDetail])
  const [editingAssignee, setEditingAssignee] = useState<{
    task: InspectionTask
    assigneeId: string
  } | null>(null)
  const routeTask = selectedPlanDetail?.tasks?.find(
    (task) => task.id === taskId,
  )
  const [initializedEditor, setInitializedEditor] = useState(false)
  if (
    view === 'task-edit' &&
    routeTask &&
    !planPending &&
    !initializedEditor
  ) {
    setInitializedEditor(true)
    if (editSection === 'location')
      setEditingLocation({
        task: routeTask,
        zoneId: routeTask.zone_id ?? '',
        locationText: routeTask.location_text ?? '',
      })
    else if (editSection === 'assignee')
      setEditingAssignee({
        task: routeTask,
        assigneeId: routeTask.assignee_id ?? '',
      })
    else
      setEditingTaskItems({
        task: routeTask,
        itemIds: routeTask.items.map((item) => item.id),
      })
  }
  const [cancelTask, setCancelTask] = useState<InspectionTask | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [confirmation, setConfirmation] = useState<{
    title: string
    details: React.ReactNode
    confirmLabel: string
    action: () => Promise<unknown>
    success: { area: NoticeArea; text: string }
    danger?: boolean
  } | null>(null)
  const [discardingTaskForm, setDiscardingTaskForm] = useState<
    'location' | 'assignee' | 'items' | 'name' | 'new-task' | null
  >(null)
  const confirmationTrigger = useRef<HTMLElement | null>(null)
  const confirmationHeading = useRef<HTMLHeadingElement | null>(null)
  const cancelTrigger = useRef<HTMLElement | null>(null)
  const cancelHeading = useRef<HTMLHeadingElement | null>(null)
  const locationTrigger = useRef<HTMLButtonElement | null>(null)
  const nameTrigger = useRef<HTMLButtonElement | null>(null)
  const taskItemsTrigger = useRef<HTMLButtonElement | null>(null)
  const assigneeTrigger = useRef<HTMLButtonElement | null>(null)
  const assigneeFormHeading = useRef<HTMLHeadingElement | null>(null)
  const addTaskTrigger = useRef<HTMLButtonElement | null>(null)
  const restoreAddTaskFocus = useRef(false)
  const previousTaskFormOpen = useRef(false)
  const previousLocationEdit = useRef(false)
  const previousNameEdit = useRef(false)
  const previousTaskItemsEdit = useRef(false)
  const previousAssigneeEdit = useRef(false)
  const pageHeading = useRef<HTMLHeadingElement | null>(null)
  const selectedPlanHeading = useRef<HTMLHeadingElement | null>(null)
  const pageContent = useRef<HTMLElement | null>(null)
  const pendingTaskHeading = useRef('')
  const errorMessage = useRef<HTMLParagraphElement | null>(null)
  // Enter 用 requestSubmit() 送出時不會被停用的按鈕擋住，所以連按兩次 Enter
  // 會送出兩次；用同步防護擋掉進行中的第二次送出。
  const guard = useSubmitGuard()
  const previousConfirmation = useRef(false)
  const previousCancelTask = useRef(false)
  const dialogOpen = Boolean(confirmation || cancelTask)
  const pathKey = `${location.pathname}:${location.search}`
  const [routeKey, setRouteKey] = useState(location.key)
  const [previousLocation, setPreviousLocation] = useState({
    key: location.key,
    path: pathKey,
  })
  if (location.key !== previousLocation.key) {
    setPreviousLocation({ key: location.key, path: pathKey })
    const consumesState =
      navigationType === 'REPLACE' && previousLocation.path === pathKey
    if (!consumesState) {
      // IP-R29：確認離頁後才捨棄舊草稿，避免換資源時沿用舊輸入；
      // 清除 flash state 不應再重設畫面。
      setRouteKey(location.key)
      setEditReturnFocus(
        (location.state as { returnFocus?: string } | null)?.returnFocus,
      )
      setReturnFocus(
        (location.state as { focusLabel?: string } | null)?.focusLabel,
      )
      setPlanName('')
      setEditingPlanName(false)
      setUpdatedPlanName('')
      setTaskItems([])
      setRemovedTaskItems([])
      setTaskName('')
      setTaskNameTouched(false)
      setTaskZoneId('')
      setTaskLocation('')
      setAssigneeId('')
      setDiscardingTaskForm(null)
      setTaskFormOpen(view === 'task-new')
      setPlanFailure(null)
      setInitializedEditor(false)
      setEditingLocation(null)
      setEditingName(null)
      setEditingTaskItems(null)
      setEditingAssignee(null)
      setCancelTask(null)
      setCancelReason('')
      setConfirmation(null)
      setError('')
      setFieldError(null)
      setServerFieldErrors({})
      setServerFieldFocus(null)
      setNotice(
        (
          location.state as {
            planningNotice?: {
              area: NoticeArea
              text: string
            }
          } | null
        )?.planningNotice ?? null,
      )
    }
  }
  // 只在表單值偏離原資料或有新輸入時攔截離頁，避免純瀏覽也被詢問。
  // 唯讀、無權限與找不到專案時，表單都已收起或整頁被取代，看不見的內容
  // 不該再攔住離頁（ADM-R28）。
  const hasUnsavedChanges = Boolean(
    !readOnly &&
    !accessDenied &&
    currentPlanFailure?.kind !== 'forbidden' &&
    currentPlanFailure?.kind !== 'not-found' &&
    !projectNotFound &&
    (planName ||
      (editingPlanName && updatedPlanName.trim() !== selectedPlan?.name) ||
      taskItems.length > 0 ||
      (taskNameTouched &&
        taskName.trim() !==
          suggestedTaskName(
            items,
            taskItems,
            zones,
            taskZoneId,
            taskLocation,
          )) ||
      taskZoneId ||
      taskLocation ||
      assigneeId ||
      (editingLocation &&
        (editingLocation.zoneId !== (editingLocation.task.zone_id ?? '') ||
          editingLocation.locationText !==
            (editingLocation.task.location_text ?? ''))) ||
      (editingName && editingName.name.trim() !== editingName.task.name) ||
      (editingTaskItems &&
        !sameItemSet(
          editingTaskItems.itemIds,
          editingTaskItems.task.items.map((item) => item.id),
        )) ||
      (editingAssignee &&
        editingAssignee.assigneeId !==
          (editingAssignee.task.assignee_id ?? '')) ||
      (cancelTask && cancelReason)),
  )
  const leaveGuard = useUnsavedNavigationGuard(hasUnsavedChanges)
  useEffect(() => {
    if (!location.state) return
    leaveGuard.allowNavigation(() =>
      navigate(location.pathname + location.search + location.hash, {
        replace: true,
        state: null,
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
  const revealNotice = useCallback((node: HTMLParagraphElement | null) => {
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  useEffect(() => {
    if (!error || serverFieldFocus) return
    const message = errorMessage.current
    if (!message) return
    // #734 T7：先把就近錯誤帶入視野，再避免 focus 再次捲動頁面。
    const block =
      message.getBoundingClientRect().height > window.innerHeight * 0.8
        ? 'start'
        : 'nearest'
    message.scrollIntoView?.({ block })
    message.focus({ preventScroll: true })
  }, [error, errorContext, serverFieldFocus])

  useEffect(() => {
    const field = serverFieldFocus ?? fieldError?.field
    if (!field) return
    pageContent.current
      ?.querySelector<HTMLElement>(`[data-field="${field}"]`)
      ?.focus()
  }, [fieldError, serverFieldFocus])

  useEffect(() => {
    const content = pageContent.current
    if (!content) return
    Array.from(content.children).forEach((child) => {
      const element = child as HTMLElement
      if (element.getAttribute('role') !== 'dialog') {
        element.inert = dialogOpen
        if (dialogOpen) element.setAttribute('inert', '')
        else element.removeAttribute('inert')
      }
    })
  }, [dialogOpen])

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus()
    else if (previousConfirmation.current) {
      if (confirmationTrigger.current?.isConnected) {
        confirmationTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
      confirmationTrigger.current = null
    }
    previousConfirmation.current = Boolean(confirmation)
  }, [confirmation])

  useEffect(() => {
    if (cancelTask) cancelHeading.current?.focus()
    else if (previousCancelTask.current) {
      if (cancelTrigger.current?.isConnected) cancelTrigger.current.focus()
      else pageHeading.current?.focus()
      cancelTrigger.current = null
    }
    previousCancelTask.current = Boolean(cancelTask)
  }, [cancelTask])

  useEffect(() => {
    if (
      !taskFormOpen ||
      view !== 'task-new' ||
      focusedTaskFormPath.current === routeKey
    )
      return
    const form = pageContent.current?.querySelector<HTMLElement>(
      '#task-creation-form',
    )
    const target = form?.querySelector<HTMLElement>('input, select, textarea')
    if (!target) return
    target.scrollIntoView?.({ block: 'center' })
    target.focus()
    focusedTaskFormPath.current = routeKey
  }, [taskFormOpen, view, routeKey, selectedPlanDetail, selectedPlan])

  useEffect(() => {
    // 只有使用者取消或捨棄才把焦點還給「＋ 新增任務」；建立成功時焦點要
    // 去新任務，切換計畫時則沒有可還的對象。
    if (
      previousTaskFormOpen.current &&
      !taskFormOpen &&
      restoreAddTaskFocus.current
    ) {
      if (addTaskTrigger.current?.isConnected) {
        addTaskTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
    }
    if (!taskFormOpen) restoreAddTaskFocus.current = false
    previousTaskFormOpen.current = taskFormOpen
  }, [taskFormOpen])

  useEffect(() => {
    if (previousLocationEdit.current && !editingLocation) {
      // ADM-R38：收起原地表單後回到開啟它的按鈕，讓鍵盤使用者接續操作。
      if (locationTrigger.current?.isConnected) {
        locationTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
    }
    previousLocationEdit.current = Boolean(editingLocation)
  }, [editingLocation])

  useEffect(() => {
    if (previousNameEdit.current && !editingName) {
      if (nameTrigger.current?.isConnected) nameTrigger.current.focus()
      else pageHeading.current?.focus()
    }
    previousNameEdit.current = Boolean(editingName)
  }, [editingName])

  useEffect(() => {
    if (previousTaskItemsEdit.current && !editingTaskItems) {
      if (taskItemsTrigger.current?.isConnected) {
        taskItemsTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
    }
    if (!previousTaskItemsEdit.current && editingTaskItems) {
      pageContent.current
        ?.querySelector<HTMLElement>('[data-field="edit-task-items"]')
        ?.focus()
    }
    previousTaskItemsEdit.current = Boolean(editingTaskItems)
  }, [editingTaskItems])

  useEffect(() => {
    if (previousAssigneeEdit.current && !editingAssignee) {
      // ADM-R38：取消或儲存建議指派後回到原按鈕，避免焦點落到文件頂端。
      if (assigneeTrigger.current?.isConnected) {
        assigneeTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
    }
    previousAssigneeEdit.current = Boolean(editingAssignee)
  }, [editingAssignee])

  useEffect(() => {
    // 名單失敗會停用下拉，焦點改放表單標題以免落到文件頂端。
    if (editingAssignee && membersUnavailable) {
      assigneeFormHeading.current?.focus()
    }
  }, [editingAssignee, membersUnavailable])

  useEffect(() => {
    let active = true
    async function loadProjectRoute() {
      setLoading(true)
      setError('')
      setAccessDenied(false)
      setProjectNotFound(false)
      if (!initialProjectId) {
        setLoading(false)
        return
      }
      try {
        const project = await client.getProject(initialProjectId)
        if (active) {
          setProjects([project])
          setProjectId(initialProjectId)
        }
      } catch (caught) {
        if (!active) return
        if (isForbidden(caught)) {
          setAccessDenied(true)
        } else if (isNotFound(caught)) {
          setProjectNotFound(true)
        }
        setError(planningErrorMessage(caught))
        setLoading(false)
      }
    }
    void loadProjectRoute()
    return () => {
      active = false
    }
  }, [client, initialProjectId, projectRetryKey])

  useEffect(() => {
    if (!projectId) return
    let active = true
    const requestId = ++assigneeRequest.current
    async function loadProjectData() {
      setLoading(true)
      setRetryingMembers(false)
      retryFocusTarget.current = null
      setError('')
      setErrorContext('page')
      setZonesDenied(false)
      setMembersUnavailable(false)
      setMembersFailure(null)
      const allPlans = () =>
        collectPages<InspectionPlan>((cursor) =>
          client.listPlans(projectId, cursor),
        )
      const results = await Promise.allSettled([
        client.listProjectItems(projectId),
        client.listProjectZones(projectId),
        canLoadAssignees
          ? client.listProjectAssignees(projectId)
          : Promise.resolve([]),
        allPlans(),
      ])
      if (active) {
        const [itemsResult, zonesResult, membersResult, plansResult] = results
        if (itemsResult.status === 'fulfilled') {
          const loaded = itemsResult.value
          // IP-R24：新增任務表單重載項目後，裁掉剛被停用的勾選並提示
          // 移除的名稱，避免送出已知會被拒絕的項目。
          const selected = taskItemsRef.current
          const activeIds = new Set(
            loaded
              .filter((item) => item.is_active !== false)
              .map((item) => item.id),
          )
          setRemovedTaskItems(
            loaded
              .filter(
                (item) =>
                  item.is_active === false && selected.includes(item.id),
              )
              .map((item) => item.title),
          )
          setTaskItems(selected.filter((id) => activeIds.has(id)))
          setItems(loaded)
        } else {
          setItems([])
          setError(planningErrorMessage(itemsResult.reason))
        }
        if (zonesResult.status === 'fulfilled') {
          setZones(zonesResult.value)
        } else {
          setZones([])
          if (isForbidden(zonesResult.reason)) {
            setZonesDenied(true)
          } else {
            setError(planningErrorMessage(zonesResult.reason))
          }
        }
        if (membersResult.status === 'fulfilled') {
          setMembers(membersResult.value)
        } else {
          // 名單是選填查詢；失敗時保留其他頁面操作與既有表單值。
          setMembers([])
          setMembersUnavailable(true)
          setMembersFailure(
            isForbidden(membersResult.reason) ? 'forbidden' : 'temporary',
          )
        }
        if (plansResult.status === 'fulfilled') {
          setPlans(plansResult.value)
        } else {
          setPlans([])
          if (isForbidden(plansResult.reason)) {
            setAccessDenied(true)
          } else {
            setError(planningErrorMessage(plansResult.reason))
          }
        }
        setLoading(false)
      }
    }
    void loadProjectData()
    return () => {
      active = false
      if (assigneeRequest.current === requestId) {
        assigneeRequest.current += 1
      }
    }
  }, [client, projectId, reloadKey, canLoadAssignees])

  async function retryAssigneeList(
    select: HTMLSelectElement,
    fallback: HTMLElement,
  ): Promise<void> {
    if (!projectId || retryingMembers) return
    const requestId = ++assigneeRequest.current
    retryFocusTarget.current = { projectId, select, fallback }
    setRetryingMembers(true)
    try {
      const result = await client.listProjectAssignees(projectId)
      if (assigneeRequest.current !== requestId) return
      setMembers(result)
      setMembersFailure(null)
      setMembersUnavailable(false)
    } catch (caught) {
      if (assigneeRequest.current !== requestId) return
      setMembersFailure(isForbidden(caught) ? 'forbidden' : 'temporary')
      setMembersUnavailable(true)
    } finally {
      if (assigneeRequest.current === requestId) setRetryingMembers(false)
    }
  }

  useEffect(() => {
    if (wasRetryingMembers.current && !retryingMembers) {
      const target = retryFocusTarget.current
      if (target?.projectId === projectId) {
        const focusTarget = target.select.disabled
          ? target.fallback
          : target.select
        if (focusTarget.isConnected) focusTarget.focus()
      }
      retryFocusTarget.current = null
    }
    wasRetryingMembers.current = retryingMembers
  }, [projectId, retryingMembers])

  function retryAssigneeListFrom(button: HTMLButtonElement, field: string) {
    const form = button.closest('form')
    const select = form?.querySelector<HTMLSelectElement>(
      `[data-field="${field}"]`,
    )
    const fallback = form?.querySelector<HTMLElement>(
      '.assignee-list-unavailable',
    )
    if (select && fallback) void retryAssigneeList(select, fallback)
  }

  const membersFailureText =
    membersFailure === 'forbidden'
      ? ASSIGNEE_LIST_UNAVAILABLE_NOTICE
      : membersFailure === 'temporary'
        ? '成員名單暫時載入失敗'
        : ''

  // IP-R29：每次導頁完成才定位，資料重載不再搶走使用者或錯誤欄焦點。
  const loadedPlanId = selectedPlanDetail?.id
  const selectedId = selectedPlan?.id
  const focusedPage = useRef('')
  useEffect(() => {
    if (
      !loadedPlanId ||
      !selectedId ||
      loading ||
      planPending ||
      focusedPage.current === routeKey
    )
      return
    const focusLabel = returnFocus
    if (view === 'plan') {
      if (!notice)
        selectedPlanHeading.current?.scrollIntoView?.({ block: 'start' })
      if (focusLabel === '＋ 新增任務') addTaskTrigger.current?.focus()
      else selectedPlanHeading.current?.focus({ preventScroll: true })
    } else if (view === 'task') {
      const button = focusLabel
        ? Array.from(
            pageContent.current?.querySelectorAll('button') ?? [],
          ).find((node) => node.textContent?.trim().startsWith(focusLabel))
        : null
      const target =
        button ??
        pageContent.current?.querySelector<HTMLElement>(
          `[data-task-heading="${taskId}"]`,
        )
      if (!notice) target?.scrollIntoView?.({ block: 'start' })
      target?.focus({ preventScroll: true })
    } else return
    focusedPage.current = routeKey
  }, [
    loadedPlanId,
    selectedId,
    loading,
    view,
    routeKey,
    taskId,
    returnFocus,
    notice,
    planPending,
  ])

  const canEditPlan = Boolean(
    selectedPlan &&
    selectedPlan.status !== 'ARCHIVED' &&
    !selectedPlanDetail?.archived,
  )
  // 計畫封存或畫面唯讀時，任務上的所有修改入口（含阻擋說明的捷徑與
  // 修改表單）都不顯示；只留說明文字。
  const canModify = canEditPlan && !readOnly
  const suggestedName = suggestedTaskName(
    items,
    taskItems,
    zones,
    taskZoneId,
    taskLocation,
  )

  function openTaskItemsEditor(task: InspectionTask): void {
    editTask(task, 'items')
  }

  // 只有草稿的派出阻擋捷徑能取代下排指派入口，避免去重後無法指派。
  function showsAssigneeShortcut(task: InspectionTask): boolean {
    return (
      task.status === 'DRAFT' &&
      dispatchBlockers(task).unassigned &&
      canModify &&
      canDispatchTask &&
      canAssignTask
    )
  }

  // 派出鈕的描述只包含原因與欄位捷徑，不包含額外的權限提示。
  function renderDispatchBlockers(task: InspectionTask) {
    if (task.status !== 'DRAFT') return null
    const blockers = dispatchBlockers(task)
    if (!Object.values(blockers).some(Boolean)) return null
    if (canModify && canDispatchTask) {
      const reasons = [
        {
          blocked: blockers.unassigned,
          label: '指定建議指派人',
          allowed: showsAssigneeShortcut(task),
          section: 'assignee' as const,
        },
        {
          blocked: blockers.noLocation,
          label: '填寫地點',
          allowed: canManageTask,
          section: 'location' as const,
        },
        {
          blocked: blockers.noItems,
          label: '選擇查核項目',
          allowed: canManageTask,
          section: 'items' as const,
        },
      ].filter((reason) => reason.blocked)
      return (
        <>
          <p id={`dispatch-needs-${task.id}`}>
            派出前還需要：
            {reasons.map((reason, index) => (
              <span key={reason.label}>
                {index > 0 && '、'}
                {reason.allowed ? (
                  <button
                    onClick={(event) => {
                      clearFieldError()
                      setNotice(null)
                      if (reason.section === 'items') {
                        openTaskItemsEditor(task)
                      } else {
                        if (reason.section === 'assignee')
                          assigneeTrigger.current = event.currentTarget
                        else locationTrigger.current = event.currentTarget
                        editTask(task, reason.section, reason.label)
                      }
                    }}
                    type="button"
                  >
                    {reason.label}
                  </button>
                ) : (
                  reason.label
                )}
              </span>
            ))}
          </p>
          {blockers.unassigned && !canAssignTask && (
            <p>請洽有指派權限的專案管理者</p>
          )}
        </>
      )
    }
    return (
      <ul
        aria-label="派出前需要處理的項目"
        className="task-dispatch-blockers"
        // Safari 在隱藏項目符號時需要明示清單語意。
        role="list"
        style={{ listStyle: 'none' }}
      >
        {blockers.unassigned && <li>尚未指派建議指派人。</li>}
        {blockers.noLocation && (
          <li>
            {canModify && canManageTask ? '尚未填寫地點：' : '尚未填寫地點。'}
            {canModify && canManageTask && (
              <button
                onClick={(event) => {
                  clearFieldError()
                  setNotice(null)
                  locationTrigger.current = event.currentTarget
                  editTask(task, 'location', '填寫地點')
                }}
                type="button"
              >
                填寫地點
              </button>
            )}
          </li>
        )}
        {blockers.noItems && (
          <li>
            {canModify && canManageTask
              ? '尚未選擇查核項目：請直接修改這筆草稿的查核項目。'
              : '尚未選擇查核項目。'}
            {canModify && canManageTask && task.status === 'DRAFT' && (
              <button onClick={() => openTaskItemsEditor(task)} type="button">
                選擇查核項目
              </button>
            )}
          </li>
        )}
      </ul>
    )
  }

  function confirm(options: NonNullable<typeof confirmation>): void {
    setError('')
    setNotice(null)
    setErrorContext('dialog')
    confirmationTrigger.current = document.activeElement as HTMLElement
    setConfirmation(options)
  }

  function closeDialogs(): void {
    setConfirmation(null)
    setCancelTask(null)
    setCancelReason('')
  }

  async function act(
    operation: () => Promise<unknown>,
    success: { area: NoticeArea; text: string },
    context?: string,
    bindings: readonly FieldErrorBinding[] = [],
    codeFields: Readonly<Record<string, FieldKey>> = {},
  ): Promise<boolean> {
    if (!guard.enter()) return false
    setError('')
    setFieldError(null)
    setServerFieldErrors({})
    setServerFieldFocus(null)
    setNotice(null)
    setErrorContext(
      context ??
        (document.activeElement?.closest('[role="dialog"]')
          ? 'dialog'
          : (document.activeElement
              ?.closest('[data-error-context]')
              ?.getAttribute('data-error-context') ?? 'page')),
    )
    setBusy(true)
    try {
      await operation()
      setNotice(success)
      setConfirmation(null)
      setCancelTask(null)
      setCancelReason('')
      setEditingLocation(null)
      setEditingName(null)
      setEditingTaskItems(null)
      setEditingAssignee(null)
      setEditingPlanName(false)
      // 成功後各編輯表單都已收起，沒有東西可以再「確認捨棄」。
      setDiscardingTaskForm(null)
      setReloadKey((key) => key + 1)
      if (view === 'task' && success.text === '已刪除草稿任務。') {
        leaveGuard.allowNavigation(() =>
          navigate(planPath, {
            replace: true,
            state: { planningNotice: success },
          }),
        )
      }
      if (view === 'task-edit') {
        leaveGuard.allowNavigation(() =>
          navigate(taskPath, {
            replace: true,
            state: { planningNotice: success },
          }),
        )
      }
      return true
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
        setErrorContext('page')
        // 唯讀後改名表單與取消對話框都不再提供，一併收起；取消對話框裡的
        // 錯誤訊息改顯示在頁面上，避免使用者看不到被拒絕的原因。
        setEditingPlanName(false)
        setEditingName(null)
        if (cancelTask) {
          setCancelTask(null)
          setCancelReason('')
          setErrorContext('page')
        }
      }
      const codeField =
        caught instanceof HttpError && caught.code
          ? codeFields[caught.code]
          : undefined
      if (
        caught instanceof HttpError &&
        caught.code === 'project_inspection_item.inactive'
      ) {
        // IP-R24：項目在送出前被停用；沿用重載裁除機制自動更新清單，
        // 不要求使用者手動重新載入，也不清其他欄位的輸入與錯誤。
        setReloadKey((key) => key + 1)
      }
      if (codeField && caught instanceof HttpError && caught.code) {
        setServerFieldErrors({
          [codeField]:
            TASK_CODE_MESSAGES[caught.code] ?? planningErrorMessage(caught),
        })
        setServerFieldFocus(codeField)
        setError('')
      } else if (
        caught instanceof HttpError &&
        caught.status === 422 &&
        caught.fields?.length
      ) {
        // 未知 pointer 不猜欄位，留在一般錯誤區供使用者辨識伺服器訊息。
        const mapped = mapFieldErrors(caught.fields, bindings)
        const messages = Object.fromEntries(
          Object.entries(mapped.errors).map(([key, code]) => [
            key,
            fieldErrorMessage(code),
          ]),
        ) as Partial<Record<FieldKey, string>>
        setServerFieldErrors(messages)
        const firstField = Object.keys(messages)[0] as FieldKey | undefined
        setServerFieldFocus(firstField ?? null)
        setError(mapped.unmatched.length ? planningErrorMessage(caught) : '')
      } else {
        setServerFieldErrors({})
        setError(planningErrorMessage(caught))
      }
      return false
    } finally {
      guard.leave()
      setBusy(false)
    }
  }

  const hasFieldError = (field: FieldKey) =>
    fieldError?.field === field || Boolean(serverFieldErrors[field])
  const fieldErrorId = (field: FieldKey) => `${field}-field-error`
  const fieldErrorText = (field: FieldKey) =>
    hasFieldError(field) ? (
      <p className="field-error" id={fieldErrorId(field)}>
        {fieldError?.field === field
          ? (FIELD_ERROR[field] ?? '欄位內容不符合規則，請檢查後再試。')
          : serverFieldErrors[field]}
      </p>
    ) : null

  function clearFieldError(field?: FieldKey): void {
    setError('')
    setFieldError((current) =>
      !field || current?.field === field ? null : current,
    )
    setServerFieldErrors((current) => {
      if (!field) return {}
      const next = { ...current }
      delete next[field]
      return next
    })
    setServerFieldFocus((current) =>
      !field || current === field ? null : current,
    )
  }

  // 依 PR-19 送出時攔截必填空值，避免把已知錯誤送交 API；
  // 依 ADM-R28 把錯誤列在欄位旁並聚焦，讓使用者能直接修正。
  function rejectBlank(field: FieldKey, blank: boolean): boolean {
    if (!blank) return false
    setError('')
    setNotice(null)
    clearFieldError(field)
    setFieldError({ field })
    return true
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (rejectBlank('plan-name', !planName.trim())) return
    let createdPlan: InspectionPlan | undefined
    const created = await act(
      async () => {
        createdPlan = await client.createPlan(projectId, {
          name: planName,
        })
      },
      { area: 'plan-detail', text: '已建立計畫，接著新增任務。' },
      'plan-create',
      PLAN_CREATE_BINDINGS,
    )
    if (created && createdPlan) {
      setPlanName('')
      const destination = `${base}/${encodeURIComponent(createdPlan.id)}`
      leaveGuard.allowNavigation(() =>
        navigate(destination, {
          replace: true,
          state: {
            planningNotice: {
              area: 'plan-detail',
              text: '已建立計畫，接著新增任務。',
            },
          },
        }),
      )
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPlan) return
    // IP-R02 要求 Task 選專案既有項目；空選取先在欄旁提示並聚焦。
    if (rejectBlank('task-items', taskItems.length === 0)) return
    if (
      rejectBlank(
        'task-name',
        !(taskNameTouched ? taskName : suggestedName).trim(),
      )
    ) {
      return
    }
    if (
      rejectBlank('task-zone', zones.length > 0 && !zonesDenied && !taskZoneId)
    ) {
      return
    }
    const created = await act(
      async () => {
        const task = await client.createTask(selectedPlan.id, {
          name: taskNameTouched ? taskName : suggestedName,
          item_ids: taskItems,
          suggested_assignee_id: assigneeId || null,
          zone_id: zones.length ? taskZoneId || null : null,
          location_text: taskLocation.trim() || null,
        })
        pendingTaskHeading.current = task.id
      },
      { area: 'tasks', text: '已建立草稿任務，派出後現場才看得到。' },
      'task',
      TASK_CREATE_BINDINGS,
      TASK_CREATE_CODE_FIELDS,
    )
    if (created) {
      resetTaskForm()
      leaveGuard.allowNavigation(() =>
        navigate(taskUrl(pendingTaskHeading.current), {
          replace: true,
          state: {
            planningNotice: {
              area: 'tasks',
              text: '已建立草稿任務，派出後現場才看得到。',
            },
          },
        }),
      )
    }
  }

  async function updateTaskItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingTaskItems) return
    if (
      rejectBlank('edit-task-items', editingTaskItems.itemIds.length === 0)
    ) {
      return
    }
    await act(
      () =>
        client.updateTaskItems(editingTaskItems.task.id, {
          item_ids: editingTaskItems.itemIds,
        }),
      { area: 'tasks', text: '已更新草稿任務的查核項目。' },
      'items',
      TASK_ITEMS_BINDINGS,
      TASK_ITEMS_CODE_FIELDS,
    )
  }

  function resetTaskForm(): void {
    setTaskFormOpen(false)
    setTaskItems([])
    setRemovedTaskItems([])
    setTaskName('')
    setTaskNameTouched(false)
    setTaskZoneId('')
    setTaskLocation('')
    setAssigneeId('')
    setDiscardingTaskForm(null)
  }

  function toggleItem(id: string, checked: boolean) {
    setTaskItems((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    )
  }

  // ADM-R38：只有欄位偏離原值時才確認，避免取消未修改的表單多一步。
  function requestTaskFormCancel(
    kind: 'location' | 'assignee' | 'items' | 'name' | 'new-task',
  ): void {
    const changed =
      kind === 'new-task'
        ? Boolean(taskItems.length) ||
          taskNameTouched ||
          Boolean(taskZoneId || taskLocation || assigneeId)
        : kind === 'items'
          ? Boolean(
              editingTaskItems &&
              !sameItemSet(
                editingTaskItems.itemIds,
                editingTaskItems.task.items.map((item) => item.id),
              ),
            )
          : kind === 'location'
            ? Boolean(
                editingLocation &&
                (editingLocation.zoneId !==
                  (editingLocation.task.zone_id ?? '') ||
                  editingLocation.locationText !==
                    (editingLocation.task.location_text ?? '')),
              )
            : kind === 'name'
              ? Boolean(
                  editingName &&
                  editingName.name.trim() !== editingName.task.name,
                )
              : Boolean(
                  editingAssignee &&
                  editingAssignee.assigneeId !==
                    (editingAssignee.task.assignee_id ?? ''),
                )
    if (changed) {
      setDiscardingTaskForm(kind)
      return
    }
    closeTaskForm(kind)
  }

  // 依 kind 只收起對應的表單，不得牽動其他表單的狀態。
  function closeTaskForm(
    kind: 'location' | 'assignee' | 'items' | 'name' | 'new-task',
  ): void {
    if (kind === 'location') setEditingLocation(null)
    else if (kind === 'name') setEditingName(null)
    else if (kind === 'items') setEditingTaskItems(null)
    else if (kind === 'assignee') setEditingAssignee(null)
    else {
      restoreAddTaskFocus.current = true
      resetTaskForm()
    }
    setDiscardingTaskForm(null)
    if (kind === 'new-task') {
      leaveGuard.allowNavigation(() =>
        navigate(planPath, { state: { focusLabel: '＋ 新增任務' } }),
      )
    } else if (kind !== 'name') {
      leaveGuard.allowNavigation(() =>
        navigate(taskPath, {
          state: {
            focusLabel:
              editReturnFocus ??
              {
                location: '修改地點',
                assignee: '修改建議指派',
                items: '修改查核項目',
              }[editSection],
          },
        }),
      )
    }
  }

  // ADM-R38：確認捨棄後才清除編輯狀態，保留編輯則不碰原輸入。
  function discardTaskForm(): void {
    if (discardingTaskForm) closeTaskForm(discardingTaskForm)
  }

  // IP-R02：只計算本計畫內包含該專案項目的任務，其他計畫不混入數字。
  // 已取消的任務不再涵蓋該項目，所以不計入，免得數字讓人以為還有有效任務。
  function tasksForItem(itemId: string): InspectionTask[] {
    return (selectedPlanDetail?.tasks ?? []).filter(
      (task) =>
        task.status !== 'CANCELLED' &&
        task.items.some((taskItem) => taskItem.id === itemId),
    )
  }

  // ADM-R28：列出分區與指派資訊，並讓改名後仍能辨認任務項目。
  function dispatchConfirmation(task: InspectionTask) {
    return (
      <>
        <ul>
          <li>任務：{task.name}</li>
          <li>查核項目：{taskItemsSummary(task)}</li>
          <li>分區：{task.zone?.name ?? '未設定分區'}</li>
          <li>
            建議指派人：
            {task.assignee?.name_zh ?? task.assignee?.username ?? '未指派'}
          </li>
        </ul>
        <p>派出後現場即可查看</p>
      </>
    )
  }

  const noticeFor = (area: NoticeArea) =>
    notice?.area === area ? (
      <p
        className="notice notice-success"
        key={notice.text}
        ref={revealNotice}
        role="status"
      >
        {notice.text}
      </p>
    ) : null

  const readDenied = accessDenied || currentPlanFailure?.kind === 'forbidden'
  const formView =
    view === 'plan-new' || view === 'task-new' || view === 'task-edit'
  if (readDenied && !formView) {
    return <AccessDeniedPage headingLevel={2} />
  }

  if (projectNotFound) {
    return (
      <section>
        <h2>找不到專案</h2>
        <p role="alert">網址中的專案不存在或已刪除。</p>
        <Link className="btn" to="/projects">
          返回專案清單
        </Link>
      </section>
    )
  }

  const formDenied =
    (view === 'plan-new' && !canCreatePlan) ||
    (view === 'task-new' && !canCreateTask) ||
    (view === 'task-edit' &&
      !(editSection === 'assignee' ? canAssignTask : canManageTask))
  if ((formDenied && !writeDenied) || (formView && readDenied))
    return (
      <section>
        <h2>無權限</h2>
        <p className="notice-info" role="status">
          你沒有使用這個頁面的權限
        </p>
        <Link className="btn" to={base}>
          返回計畫清單
        </Link>
      </section>
    )
  if (
    currentPlanFailure?.kind === 'not-found' ||
    (!planPending &&
      selectedPlanDetail &&
      selectedPlanDetail.project_id !== initialProjectId)
  ) {
    return (
      <section>
        <h2>找不到計畫</h2>
        <Link className="btn" to={base}>
          返回計畫清單
        </Link>
      </section>
    )
  }
  if (
    selectedPlanDetail &&
    taskId &&
    !routeTask &&
    !planPending &&
    !currentPlanFailure
  ) {
    return (
      <section>
        <h2>找不到任務</h2>
        <Link className="btn" to={planPath}>
          返回計畫詳情
        </Link>
      </section>
    )
  }
  if (
    (view === 'task-edit' || view === 'task-new') &&
    selectedPlan &&
    (selectedPlan.status === 'ARCHIVED' ||
      (routeTask &&
        (!['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(routeTask.status) ||
          (editSection === 'items' && routeTask.status !== 'DRAFT'))))
  ) {
    return (
      <section>
        <h2>目前無法修改</h2>
        <p>計畫已封存或任務狀態不允許此操作。</p>
        <Link className="btn" to={taskId ? taskPath : planPath}>
          返回詳情
        </Link>
      </section>
    )
  }

  return (
    <section
      aria-labelledby={
        view === 'task' && routeTask
          ? `task-${routeTask.id}-heading`
          : 'planning-heading'
      }
      ref={pageContent}
    >
      {view !== 'list' && (
        <BackLink
          to={
            view === 'plan-new' || view === 'plan'
              ? base
              : view === 'task-edit'
                ? taskPath
                : planPath
          }
        >
          {view === 'plan-new' || view === 'plan'
            ? '返回計畫清單'
            : view === 'task-edit'
              ? '返回任務詳情'
              : '返回計畫詳情'}
        </BackLink>
      )}
      {view !== 'task' && (
        <h2
          id="planning-heading"
          ref={(node) => {
            pageHeading.current = node
            selectedPlanHeading.current = view === 'plan' ? node : null
            assigneeFormHeading.current =
              view === 'task-edit' && editSection === 'assignee' ? node : null
          }}
          tabIndex={-1}
        >
          {view === 'plan-new'
            ? '建立計畫'
            : view === 'task-new'
              ? '新增任務'
              : view === 'task-edit'
                ? `${
                    {
                      location: '修改地點',
                      assignee: routeTask?.assignee_id
                        ? '修改建議指派'
                        : '指定建議指派人',
                      items: '修改查核項目',
                    }[editSection]
                  }｜${routeTask?.name ?? '載入中…'}`
                : view === 'plan'
                  ? (selectedPlanDetail?.name ?? '載入中…')
                  : '計畫與任務'}
        </h2>
      )}
      {(view === 'list' || view === 'plan') && (
        <p>計畫的狀態會跟著任務自動更新；任務派出後，現場才看得到。</p>
      )}
      {(view === 'task-new' || view === 'task-edit') && selectedPlan && (
        <p>
          {selectedPlan.name}
          {routeTask ? `／${routeTask.name}` : ''}
        </p>
      )}
      <UnsavedLeaveBox guard={leaveGuard} />
      {projects[0] && (view === 'list' || view === 'plan') && (
        <p>專案：{projects[0].name}</p>
      )}
      {readOnly && !(view === 'plan' && selectedPlanDetail) && (
        <p className="notice-info" role="status">
          {READ_ONLY_NOTICE}
        </p>
      )}
      {((error && errorContext === 'page') ||
        currentPlanFailure?.kind === 'error') && (
        <div>
          <p ref={errorMessage} role="alert" tabIndex={-1}>
            {currentPlanFailure?.kind === 'error'
              ? currentPlanFailure.message
              : error}
          </p>
          <button
            type="button"
            disabled={planPending || (loading && !currentPlanFailure)}
            onClick={() => {
              if (!projectId) setProjectRetryKey((key) => key + 1)
              else setReloadKey((key) => key + 1)
            }}
          >
            重新載入
          </button>
        </div>
      )}
      {loading || planPending ? <p>載入中…</p> : null}

      {projects.length > 0 && (
        <>
          {(view === 'list' || view === 'plan-new') && (
            <section
              aria-labelledby={
                view === 'list' ? 'plans-heading' : 'planning-heading'
              }
            >
              {view === 'list' && <h2 id="plans-heading">查核計畫</h2>}
              {noticeFor('plans')}
              {view === 'list' && (
                <>
                  {canCreatePlan && (
                    <Link className="btn btn-primary" to={`${base}/new`}>
                      建立計畫
                    </Link>
                  )}
                  {plans.length === 0 ? <p>目前沒有計畫。</p> : null}
                  <ul className="plan-list">
                    {plans.map((plan) => (
                      <li key={plan.id}>
                        <Link
                          className="btn planning-plan-link"
                          to={`${base}/${encodeURIComponent(plan.id)}`}
                        >
                          {plan.name}
                          <StatusBadge parenthesized status={plan.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {view === 'plan-new' && !readOnly && canCreatePlan && (
                <form
                  onKeyDown={blockImeEnter}
                  data-error-context="plan-create"
                  noValidate
                  onSubmit={(event) => void createPlan(event)}
                >
                  <label>
                    <span className="required-label">
                      計畫名稱 <RequiredMark />
                    </span>
                    <input
                      aria-describedby={describedBy(
                        'plan-name-hint',
                        hasFieldError('plan-name') &&
                          fieldErrorId('plan-name'),
                      )}
                      aria-invalid={hasFieldError('plan-name')}
                      maxLength={128}
                      onChange={(event) => {
                        setPlanName(event.target.value)
                        clearFieldError('plan-name')
                      }}
                      data-field="plan-name"
                      required
                      value={planName}
                    />
                  </label>
                  <span className="field-hint" id="plan-name-hint">
                    必填，最多 128 字。
                  </span>
                  {fieldErrorText('plan-name')}
                  {error && errorContext === 'plan-create' && (
                    <p
                      className="field-error"
                      id="plan-name-error"
                      ref={errorMessage}
                      role="alert"
                      tabIndex={-1}
                    >
                      {error}
                    </p>
                  )}
                  <button
                    disabled={busy}
                    type="button"
                    onClick={() => navigate(base)}
                  >
                    取消
                  </button>
                  <button
                    className="btn-primary"
                    disabled={busy}
                    type="submit"
                  >
                    建立計畫
                  </button>
                </form>
              )}
            </section>
          )}

          {view !== 'list' &&
            view !== 'plan-new' &&
            selectedPlan &&
            selectedPlanDetail && (
              <section
                hidden={planPending}
                aria-labelledby={
                  view === 'task' && routeTask
                    ? `task-${routeTask.id}-heading`
                    : 'planning-heading'
                }
              >
                {view === 'plan' && (
                  <p>
                    計畫狀態：
                    <StatusBadge status={selectedPlanDetail.status} />
                  </p>
                )}
                {/* IP-R01：封存時只有取消封存可用；未封存時排除建立別的
                    計畫與取消封存，避免把不適用的權限當成此計畫可用操作。
                    合併封存與權限說明，避免兩個提示框上下重複。 */}
                {selectedPlanDetail.status === 'ARCHIVED' ? (
                  <p className="notice notice-info" role="status">
                    {view === 'plan' && !canToggleArchive
                      ? '這個計畫已封存。你沒有取消封存的權限，如需取消封存，請洽有權限的專案管理者。'
                      : '計畫已封存。取消封存後才能新增、修改或派出任務。'}
                  </p>
                ) : (
                  view === 'plan' &&
                  !writeCodes.some(
                    (code) =>
                      code !== 'inspection_plan.create' &&
                      code !== 'inspection_plan.unarchive' &&
                      canWrite(code),
                  ) && (
                    <p className="notice notice-info" role="status">
                      你目前沒有可以對這個計畫執行的操作。
                    </p>
                  )
                )}
                {noticeFor('plan-detail')}
                {view === 'plan' &&
                  !readOnly &&
                  (canManagePlan || canToggleArchive) && (
                    <>
                      {canManagePlan && (
                        <button
                          disabled={busy || selectedPlan.status === 'ARCHIVED'}
                          onClick={() => {
                            setError('')
                            setNotice(null)
                            clearFieldError()
                            setEditingPlanName(true)
                            setUpdatedPlanName(selectedPlan.name)
                          }}
                          type="button"
                        >
                          修改計畫名稱
                        </button>
                      )}{' '}
                      {canToggleArchive && (
                        <button
                          className={
                            selectedPlan.status !== 'ARCHIVED'
                              ? 'btn-danger-outline'
                              : undefined
                          }
                          disabled={busy}
                          onClick={() =>
                            confirm({
                              title:
                                selectedPlan.status === 'ARCHIVED'
                                  ? '取消封存這個計畫？'
                                  : '封存這個計畫？',
                              confirmLabel:
                                selectedPlan.status === 'ARCHIVED'
                                  ? '確認取消封存'
                                  : '確認封存',
                              details: (
                                <p>
                                  {selectedPlan.status === 'ARCHIVED'
                                    ? '取消封存後依目前任務重算計畫狀態。'
                                    : '封存期間任務將唯讀。'}
                                </p>
                              ),
                              action: () =>
                                selectedPlan.status === 'ARCHIVED'
                                  ? client.unarchivePlan(selectedPlan.id)
                                  : client.archivePlan(selectedPlan.id),
                              success: {
                                area: 'plan-detail',
                                text:
                                  selectedPlan.status === 'ARCHIVED'
                                    ? '已取消封存計畫。'
                                    : '已封存計畫。',
                              },
                              danger: selectedPlan.status !== 'ARCHIVED',
                            })
                          }
                          type="button"
                        >
                          {selectedPlan.status === 'ARCHIVED'
                            ? '取消封存'
                            : '封存計畫'}
                        </button>
                      )}
                    </>
                  )}
                {editingPlanName &&
                  canManagePlan &&
                  !readOnly &&
                  selectedPlan.status !== 'ARCHIVED' && (
                    <form
                      onKeyDown={blockImeEnter}
                      data-error-context="plan-rename"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault()
                        if (
                          rejectBlank('plan-rename', !updatedPlanName.trim())
                        ) {
                          return
                        }
                        void act(
                          () =>
                            client.updatePlan(selectedPlan.id, {
                              name: updatedPlanName,
                            }),
                          { area: 'plan-detail', text: '已更新計畫名稱。' },
                          'plan-rename',
                          PLAN_RENAME_BINDINGS,
                        )
                      }}
                    >
                      <label>
                        <span className="required-label">
                          計畫名稱 <RequiredMark />
                        </span>
                        <input
                          aria-describedby={describedBy(
                            'updated-plan-name-hint',
                            hasFieldError('plan-rename') &&
                              fieldErrorId('plan-rename'),
                          )}
                          aria-invalid={hasFieldError('plan-rename')}
                          maxLength={128}
                          onChange={(event) => {
                            setUpdatedPlanName(event.target.value)
                            clearFieldError('plan-rename')
                          }}
                          data-field="plan-rename"
                          required
                          value={updatedPlanName}
                        />
                      </label>
                      <span className="field-hint" id="updated-plan-name-hint">
                        必填，最多 128 字。
                      </span>
                      {fieldErrorText('plan-rename')}
                      {error && errorContext === 'plan-rename' && (
                        <p
                          className="field-error"
                          id="updated-plan-name-error"
                          ref={errorMessage}
                          role="alert"
                          tabIndex={-1}
                        >
                          {error}
                        </p>
                      )}
                      <button
                        aria-label="取消編輯"
                        disabled={busy}
                        onClick={() => {
                          setEditingPlanName(false)
                          clearFieldError('plan-rename')
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="btn-primary"
                        disabled={busy}
                        type="submit"
                      >
                        儲存計畫名稱
                      </button>
                    </form>
                  )}

                {/* 標題列負責區隔計畫操作與任務區段，按鈕維持同一列。 */}
                {view === 'plan' && (
                  <div className="planning-section-title">
                    <h3>任務</h3>
                    {view === 'plan' &&
                      canModify &&
                      canCreateTask &&
                      !taskFormOpen && (
                        <button
                          className={
                            editingPlanName ? undefined : 'btn-primary'
                          }
                          disabled={busy}
                          onClick={() => {
                            clearFieldError()
                            setError('')
                            setNotice(null)
                            navigate(`${planPath}/tasks/new`)
                          }}
                          ref={addTaskTrigger}
                          type="button"
                        >
                          ＋ 新增任務
                        </button>
                      )}
                  </div>
                )}
                {noticeFor('tasks')}
                {view === 'plan' &&
                !planPending &&
                (selectedPlanDetail.tasks ?? []).length === 0 ? (
                  <p>尚未建立任務。</p>
                ) : null}
                <ul className="planning-task-list" role="list">
                  {(view === 'task-new'
                    ? []
                    : (selectedPlanDetail.tasks ?? []).filter(
                        (task) => view === 'plan' || task.id === taskId,
                      )
                  ).map((task) => {
                    if (view === 'plan')
                      return (
                        <li key={task.id}>
                          <article>
                            <Link
                              className="planning-task-row"
                              to={taskUrl(task.id)}
                              aria-label={task.name}
                              aria-describedby={[
                                `task-${task.id}-state`,
                                `task-${task.id}-summary`,
                              ].join(' ')}
                            >
                              <h4>
                                <span className="planning-task-name">
                                  {task.name}
                                </span>{' '}
                                <span id={`task-${task.id}-state`}>
                                  <StatusBadge
                                    parenthesized
                                    status={task.status}
                                  />
                                </span>
                              </h4>
                              <p
                                className="planning-task-summary"
                                id={`task-${task.id}-summary`}
                              >
                                {taskItemsSummary(task)}｜
                                {task.zone?.name ??
                                  task.location_text ??
                                  '未填地點'}
                                ｜建議指派：
                                {task.assignee?.name_zh ??
                                  task.assignee?.username ??
                                  '未指派'}
                                {task.assignee?.is_active === false && (
                                  <span>
                                    {inactiveAssigneeNotice(
                                      task.status,
                                      selectedPlanDetail.archived,
                                    ).includes('請改派')
                                      ? '（已停用，請改派）'
                                      : '（已停用）'}
                                  </span>
                                )}
                              </p>
                            </Link>
                          </article>
                        </li>
                      )
                    return (
                      <li key={task.id}>
                        <article>
                          {view === 'task' && (
                            <p className="planning-parent-plan">
                              所屬計畫：
                              <Link to={planPath}>
                                {selectedPlanDetail.name}
                              </Link>
                            </p>
                          )}
                          {view === 'task' && (
                            <h2
                              ref={pageHeading}
                              data-task-heading={task.id}
                              id={`task-${task.id}-heading`}
                              tabIndex={-1}
                            >
                              {taskTitle(task)}{' '}
                              <StatusBadge
                                parenthesized
                                status={task.status}
                              />
                            </h2>
                          )}
                          {((view === 'task-edit' && readOnly) ||
                            (view === 'task' && !canModify)) &&
                            renderDispatchBlockers(task)}
                          {(view === 'task' || editSection === 'location') &&
                            task.zone && <p>分區：{task.zone.name}</p>}
                          {(view === 'task' || editSection === 'location') &&
                            task.location_text && (
                              <p>補充地點：{task.location_text}</p>
                            )}
                          {(view === 'task' || editSection === 'items') && (
                            <p>查核項目：{taskItemsSummary(task)}</p>
                          )}
                          {(view === 'task' || editSection === 'assignee') && (
                            <p>
                              建議指派：
                              {task.assignee?.name_zh ??
                                task.assignee?.username ??
                                '未指派'}
                              {task.assignee?.is_active === false &&
                                (inactiveAssigneeNotice(
                                  task.status,
                                  selectedPlanDetail.archived,
                                ).includes('請改派') ? (
                                  <strong className="field-error">
                                    （已停用，請改派）
                                  </strong>
                                ) : (
                                  <span className="muted-text">
                                    （已停用）
                                  </span>
                                ))}
                            </p>
                          )}
                          {task.status === 'CANCELLED' && (
                            <p>取消原因：{task.cancellation_reason}</p>
                          )}
                          {view === 'task' && task.status !== 'DRAFT' && (
                            <p className="notice notice-info">
                              任務已派出，不能更換查核項目
                            </p>
                          )}
                          {view === 'task' &&
                            canModify &&
                            renderDispatchBlockers(task)}
                          {view === 'task' && canModify && (
                            <div className="planning-task-actions">
                              <div className="named-row-actions">
                                {task.status === 'DRAFT' &&
                                  canDispatchTask && (
                                    <button
                                      aria-describedby={
                                        Object.values(
                                          dispatchBlockers(task),
                                        ).some(Boolean)
                                          ? `dispatch-needs-${task.id}`
                                          : undefined
                                      }
                                      className={
                                        editingName ? undefined : 'btn-primary'
                                      }
                                      disabled={
                                        busy ||
                                        Object.values(
                                          dispatchBlockers(task),
                                        ).some(Boolean)
                                      }
                                      onClick={() =>
                                        confirm({
                                          title: '派出這個任務？',
                                          confirmLabel: '確認派出',
                                          action: () =>
                                            client.dispatchTask(task.id),
                                          success: {
                                            area: 'tasks',
                                            text: '已派出任務，現場可以查看了。',
                                          },
                                          details: dispatchConfirmation(task),
                                        })
                                      }
                                      type="button"
                                    >
                                      派出任務
                                    </button>
                                  )}
                                {['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(
                                  task.status,
                                ) && (
                                  <>
                                    {canAssignTask &&
                                      !showsAssigneeShortcut(task) && (
                                        <button
                                          disabled={busy}
                                          onClick={(event) => {
                                            clearFieldError()
                                            setNotice(null)
                                            const trigger = event.currentTarget
                                            assigneeTrigger.current = trigger
                                            editTask(
                                              task,
                                              'assignee',
                                              trigger.textContent?.trim(),
                                            )
                                          }}
                                          type="button"
                                        >
                                          {task.assignee
                                            ? '修改建議指派'
                                            : '指定建議指派人'}
                                          {task.assignee?.is_active === false
                                            ? inactiveAssigneeNotice(
                                                task.status,
                                                selectedPlanDetail.archived,
                                              )
                                            : ''}
                                        </button>
                                      )}
                                    {canManageTask && (
                                      <button
                                        disabled={busy}
                                        onClick={(event) => {
                                          clearFieldError()
                                          setNotice(null)
                                          const trigger = event.currentTarget
                                          locationTrigger.current = trigger
                                          editTask(task, 'location')
                                        }}
                                        type="button"
                                      >
                                        修改地點
                                      </button>
                                    )}
                                    {canManageTask &&
                                      task.status === 'DRAFT' && (
                                        <button
                                          disabled={busy}
                                          onClick={() =>
                                            openTaskItemsEditor(task)
                                          }
                                          ref={taskItemsTrigger}
                                          type="button"
                                        >
                                          修改查核項目
                                        </button>
                                      )}
                                    {canManageTask && (
                                      <button
                                        disabled={busy}
                                        onClick={(event) => {
                                          clearFieldError()
                                          setNotice(null)
                                          nameTrigger.current =
                                            event.currentTarget
                                          setEditingName({
                                            task,
                                            name: task.name,
                                          })
                                        }}
                                        type="button"
                                      >
                                        修改名稱
                                      </button>
                                    )}
                                  </>
                                )}
                                {['PENDING', 'IN_PROGRESS'].includes(
                                  task.status,
                                ) &&
                                  canCancelTask && (
                                    <button
                                      className="btn-danger-outline"
                                      disabled={busy}
                                      onClick={(event) => {
                                        setNotice(null)
                                        cancelTrigger.current =
                                          event.currentTarget
                                        setCancelTask(task)
                                      }}
                                      type="button"
                                    >
                                      取消任務
                                    </button>
                                  )}
                                {task.status === 'CANCELLED' &&
                                  canCancelTask && (
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        confirm({
                                          title: '恢復這個任務？',
                                          confirmLabel: '確認恢復',
                                          details: (
                                            <p>任務將恢復至取消前狀態。</p>
                                          ),
                                          action: () =>
                                            client.restoreTask(task.id),
                                          success: {
                                            area: 'tasks',
                                            text: '已恢復任務。',
                                          },
                                        })
                                      }
                                      type="button"
                                    >
                                      恢復任務
                                    </button>
                                  )}
                              </div>
                              {task.status === 'DRAFT' && canDeleteTask && (
                                <div className="planning-task-delete">
                                  <button
                                    className="btn-danger-outline"
                                    disabled={busy}
                                    onClick={() =>
                                      confirm({
                                        title: '刪除這個草稿？',
                                        confirmLabel: '確認刪除',
                                        action: () =>
                                          client.deleteDraftTask(task.id),
                                        success: {
                                          area: 'tasks',
                                          text: '已刪除草稿任務。',
                                        },
                                        danger: true,
                                        details: (
                                          <p>
                                            {`任務${draftTaskSummary(task)}。` +
                                              '刪除後無法復原。'}
                                          </p>
                                        ),
                                      })
                                    }
                                    type="button"
                                  >
                                    刪除草稿
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          {canModify &&
                            canManageTask &&
                            editingName?.task.id === task.id && (
                              <form
                                onKeyDown={blockImeEnter}
                                data-error-context="task-rename"
                                noValidate
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  if (
                                    rejectBlank(
                                      'task-rename',
                                      !editingName.name.trim(),
                                    )
                                  ) {
                                    return
                                  }
                                  void act(
                                    () =>
                                      client.updateTaskName(task.id, {
                                        name: editingName.name,
                                      }),
                                    {
                                      area: 'tasks',
                                      text: '已更新任務名稱。',
                                    },
                                    'task-rename',
                                    TASK_RENAME_BINDINGS,
                                    TASK_RENAME_CODE_FIELDS,
                                  )
                                }}
                              >
                                <label>
                                  <span className="required-label">
                                    任務名稱 <RequiredMark />
                                  </span>
                                  <input
                                    autoFocus
                                    aria-describedby={
                                      hasFieldError('task-rename')
                                        ? fieldErrorId('task-rename')
                                        : undefined
                                    }
                                    aria-invalid={hasFieldError('task-rename')}
                                    data-field="task-rename"
                                    maxLength={128}
                                    onChange={(event) => {
                                      setEditingName({
                                        ...editingName,
                                        name: event.target.value,
                                      })
                                      clearFieldError('task-rename')
                                    }}
                                    required
                                    value={editingName.name}
                                  />
                                </label>
                                {fieldErrorText('task-rename')}
                                <button
                                  disabled={busy}
                                  onClick={() => requestTaskFormCancel('name')}
                                  type="button"
                                >
                                  取消
                                </button>
                                <button
                                  className="btn-primary"
                                  disabled={busy}
                                  type="submit"
                                >
                                  儲存名稱
                                </button>
                                {error && errorContext === 'task-rename' && (
                                  <p
                                    ref={errorMessage}
                                    role="alert"
                                    tabIndex={-1}
                                  >
                                    {error}
                                  </p>
                                )}
                              </form>
                            )}
                          {canModify &&
                            canManageTask &&
                            editingTaskItems?.task.id === task.id && (
                              <form
                                onKeyDown={blockImeEnter}
                                aria-labelledby="planning-heading"
                                data-error-context="items"
                                noValidate
                                onSubmit={(event) =>
                                  void updateTaskItems(event)
                                }
                              >
                                <fieldset
                                  aria-describedby={describedBy(
                                    `task-${task.id}-items-hint`,
                                    hasFieldError('edit-task-items') &&
                                      fieldErrorId('edit-task-items'),
                                  )}
                                  aria-invalid={hasFieldError(
                                    'edit-task-items',
                                  )}
                                  data-field="edit-task-items"
                                  tabIndex={-1}
                                >
                                  <legend>
                                    選擇一筆以上查核項目 <RequiredMark />
                                  </legend>
                                  <p
                                    className="field-hint"
                                    id={`task-${task.id}-items-hint`}
                                  >
                                    至少選擇一筆查核項目。
                                  </p>
                                  {/* IP-R24：草稿選單只額外呈現原本就選著的
                                  停用項目，不讓使用者把它換成其他停用項目。 */}
                                  {items
                                    .filter(
                                      (item) =>
                                        item.is_active !== false ||
                                        editingTaskItems.itemIds.includes(
                                          item.id,
                                        ),
                                    )
                                    .map((item) => {
                                      const existingTasks = tasksForItem(
                                        item.id,
                                      ).filter(
                                        (existing) => existing.id !== task.id,
                                      )
                                      const selected =
                                        editingTaskItems.itemIds.includes(
                                          item.id,
                                        )
                                      const inactiveNoteId = [
                                        'task',
                                        task.id,
                                        'item',
                                        item.id,
                                        'inactive-note',
                                      ].join('-')
                                      return (
                                        <div
                                          className="planning-task-item-choice"
                                          key={item.id}
                                        >
                                          <label>
                                            <input
                                              aria-describedby={
                                                item.is_active === false
                                                  ? inactiveNoteId
                                                  : undefined
                                              }
                                              checked={selected}
                                              onChange={(event) => {
                                                // 取消勾選的停用項目會從清單消失，
                                                // 先把焦點移到選單群組，避免掉到 body。
                                                if (
                                                  !event.target.checked &&
                                                  item.is_active === false
                                                ) {
                                                  event.currentTarget
                                                    .closest('fieldset')
                                                    ?.focus({
                                                      preventScroll: true,
                                                    })
                                                }
                                                const selectedIds =
                                                  editingTaskItems.itemIds
                                                setEditingTaskItems({
                                                  ...editingTaskItems,
                                                  itemIds: event.target.checked
                                                    ? [...selectedIds, item.id]
                                                    : selectedIds.filter(
                                                        (id) => id !== item.id,
                                                      ),
                                                })
                                                clearFieldError(
                                                  'edit-task-items',
                                                )
                                              }}
                                              type="checkbox"
                                              value={item.id}
                                            />
                                            <ItemChoiceLabel item={item} />
                                          </label>
                                          {item.is_active === false && (
                                            <p id={inactiveNoteId}>
                                              取消勾選後無法再加回。
                                            </p>
                                          )}
                                          {existingTasks.length > 0 && (
                                            <details>
                                              <summary
                                                style={{ minHeight: 44 }}
                                              >
                                                本計畫已有{' '}
                                                {existingTasks.length} 筆任務
                                              </summary>
                                              <ul>
                                                {existingTasks.map(
                                                  (existing) => (
                                                    <li key={existing.id}>
                                                      {taskTitle(existing) ||
                                                        '未命名任務'}
                                                      {existing.zone
                                                        ? [
                                                            '（',
                                                            existing.zone.name,
                                                            '）',
                                                          ].join('')
                                                        : ''}
                                                    </li>
                                                  ),
                                                )}
                                              </ul>
                                            </details>
                                          )}
                                        </div>
                                      )
                                    })}
                                </fieldset>
                                {fieldErrorText('edit-task-items')}
                                {error && errorContext === 'items' && (
                                  <p
                                    ref={errorMessage}
                                    role="alert"
                                    tabIndex={-1}
                                  >
                                    {error}
                                  </p>
                                )}
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    requestTaskFormCancel('items')
                                  }
                                  type="button"
                                >
                                  取消
                                </button>
                                <button
                                  className="btn-primary"
                                  disabled={busy}
                                  type="submit"
                                >
                                  儲存查核項目
                                </button>
                              </form>
                            )}
                          {canModify &&
                            canManageTask &&
                            editingLocation?.task.id === task.id && (
                              <form
                                onKeyDown={blockImeEnter}
                                aria-labelledby="planning-heading"
                                data-error-context="location"
                                noValidate
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  if (
                                    rejectBlank(
                                      'location-zone',
                                      zones.length > 0 &&
                                        !zonesDenied &&
                                        !editingLocation.zoneId,
                                    )
                                  ) {
                                    return
                                  }
                                  const text = editingLocation.locationText
                                  void act(
                                    () =>
                                      client.updateLocation(task.id, {
                                        zone_id: zones.length
                                          ? editingLocation.zoneId || null
                                          : null,
                                        location_text: text.trim() || null,
                                      }),
                                    {
                                      area: 'tasks',
                                      text: '已更新任務地點。',
                                    },
                                    'location',
                                    TASK_LOCATION_BINDINGS,
                                    TASK_LOCATION_CODE_FIELDS,
                                  )
                                }}
                              >
                                {zones.length > 0 && !zonesDenied && (
                                  <div>
                                    <label>
                                      <span className="required-label">
                                        分區 <RequiredMark />
                                      </span>
                                      <select
                                        autoFocus
                                        aria-describedby={describedBy(
                                          'location-zone-hint',
                                          hasFieldError('location-zone') &&
                                            fieldErrorId('location-zone'),
                                        )}
                                        aria-invalid={hasFieldError(
                                          'location-zone',
                                        )}
                                        onChange={(event) => {
                                          setEditingLocation({
                                            ...editingLocation,
                                            zoneId: event.target.value,
                                          })
                                          clearFieldError('location-zone')
                                        }}
                                        data-field="location-zone"
                                        required
                                        value={editingLocation.zoneId}
                                      >
                                        <option value="">請選擇分區</option>
                                        {zones.map((zone) => (
                                          <option
                                            key={zone.id}
                                            value={zone.id}
                                          >
                                            {zone.name}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <span
                                      className="field-hint"
                                      id="location-zone-hint"
                                    >
                                      必填，從專案分區中選一個。
                                    </span>
                                    {fieldErrorText('location-zone')}
                                  </div>
                                )}
                                <label>
                                  補充地點
                                  <input
                                    autoFocus={
                                      zones.length === 0 || zonesDenied
                                    }
                                    aria-describedby={
                                      hasFieldError('location-text')
                                        ? fieldErrorId('location-text')
                                        : undefined
                                    }
                                    aria-invalid={hasFieldError(
                                      'location-text',
                                    )}
                                    maxLength={256}
                                    onChange={(event) => {
                                      setEditingLocation({
                                        ...editingLocation,
                                        locationText: event.target.value,
                                      })
                                      clearFieldError('location-text')
                                    }}
                                    data-field="location-text"
                                    value={editingLocation.locationText}
                                  />
                                </label>
                                {fieldErrorText('location-text')}
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    requestTaskFormCancel('location')
                                  }
                                  type="button"
                                >
                                  取消
                                </button>
                                <button
                                  className="btn-primary"
                                  disabled={busy}
                                  type="submit"
                                >
                                  儲存地點
                                </button>
                                {error && errorContext === 'location' && (
                                  <p
                                    ref={errorMessage}
                                    role="alert"
                                    tabIndex={-1}
                                  >
                                    {error}
                                  </p>
                                )}
                              </form>
                            )}
                          {canModify &&
                            canAssignTask &&
                            editingAssignee?.task.id === task.id && (
                              <form
                                onKeyDown={blockImeEnter}
                                aria-labelledby="planning-heading"
                                data-error-context="assignee"
                                onSubmit={(event) => {
                                  event.preventDefault()
                                  void act(
                                    () =>
                                      client.setSuggestedAssignee(
                                        task.id,
                                        editingAssignee.assigneeId || null,
                                      ),
                                    {
                                      area: 'tasks',
                                      text: editingAssignee.task.assignee_id
                                        ? '已更新建議指派。'
                                        : '已指定建議指派人。',
                                    },
                                    'assignee',
                                    TASK_ASSIGNEE_BINDINGS,
                                    TASK_ASSIGNEE_CODE_FIELDS,
                                  )
                                }}
                              >
                                <label>
                                  建議指派人
                                  <select
                                    autoFocus
                                    aria-describedby={
                                      [
                                        hasFieldError('suggested-assignee')
                                          ? fieldErrorId('suggested-assignee')
                                          : '',
                                        membersUnavailable
                                          ? 'assignee-list-unavailable-' +
                                            task.id
                                          : '',
                                      ]
                                        .filter(Boolean)
                                        .join(' ') || undefined
                                    }
                                    aria-invalid={hasFieldError(
                                      'suggested-assignee',
                                    )}
                                    onChange={(event) => {
                                      setEditingAssignee({
                                        ...editingAssignee,
                                        assigneeId: event.target.value,
                                      })
                                      clearFieldError('suggested-assignee')
                                    }}
                                    disabled={membersUnavailable}
                                    data-field="suggested-assignee"
                                    value={editingAssignee.assigneeId}
                                  >
                                    <option value="">不指定</option>
                                    {membersUnavailable &&
                                      editingAssignee.assigneeId &&
                                      !members.some(
                                        (member) =>
                                          member.id ===
                                          editingAssignee.assigneeId,
                                      ) && (
                                        <option
                                          value={editingAssignee.assigneeId}
                                        >
                                          {editingAssignee.task.assignee
                                            ?.name_zh ??
                                            editingAssignee.task.assignee
                                              ?.username ??
                                            '既有指派'}
                                        </option>
                                      )}
                                    {members.map((member) => (
                                      <option
                                        key={member.id}
                                        value={member.id}
                                      >
                                        {member.name_zh ?? member.username}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                {membersUnavailable && (
                                  <p
                                    className="assignee-list-unavailable"
                                    id={'assignee-list-unavailable-' + task.id}
                                    tabIndex={-1}
                                  >
                                    {membersFailureText}
                                  </p>
                                )}
                                {membersFailure === 'temporary' && (
                                  <button
                                    disabled={retryingMembers}
                                    onClick={(event) =>
                                      retryAssigneeListFrom(
                                        event.currentTarget,
                                        'suggested-assignee',
                                      )
                                    }
                                    type="button"
                                  >
                                    {retryingMembers ? '重試中…' : '重試'}
                                  </button>
                                )}
                                {fieldErrorText('suggested-assignee')}
                                {error && errorContext === 'assignee' && (
                                  <p
                                    ref={errorMessage}
                                    role="alert"
                                    tabIndex={-1}
                                  >
                                    {error}
                                  </p>
                                )}
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    requestTaskFormCancel('assignee')
                                  }
                                  type="button"
                                >
                                  取消
                                </button>
                                <button
                                  className="btn-primary"
                                  disabled={busy}
                                  type="submit"
                                >
                                  {editingAssignee.task.assignee_id
                                    ? '修改建議指派'
                                    : '指定建議指派人'}
                                </button>
                              </form>
                            )}
                          {discardingTaskForm &&
                            discardingTaskForm !== 'new-task' &&
                            ((discardingTaskForm === 'location' &&
                              editingLocation?.task.id === task.id) ||
                              (discardingTaskForm === 'items' &&
                                editingTaskItems?.task.id === task.id) ||
                              (discardingTaskForm === 'assignee' &&
                                editingAssignee?.task.id === task.id) ||
                              (discardingTaskForm === 'name' &&
                                editingName?.task.id === task.id)) && (
                              <ConfirmBox
                                cancelLabel="保留編輯"
                                confirmLabel="捨棄變更"
                                onCancel={() => setDiscardingTaskForm(null)}
                                onConfirm={discardTaskForm}
                                title="有尚未儲存的變更"
                                variant="danger"
                              >
                                <p>修改內容尚未儲存；捨棄後無法復原。</p>
                              </ConfirmBox>
                            )}
                        </article>
                      </li>
                    )
                  })}
                </ul>

                {canModify &&
                  canCreateTask &&
                  taskFormOpen &&
                  selectedPlanData?.path === requestPath && (
                    <form
                      id="task-creation-form"
                      onKeyDown={blockImeEnter}
                      data-error-context="task"
                      noValidate
                      onSubmit={(event) => void createTask(event)}
                    >
                      <label>
                        <span className="required-label">
                          任務名稱 <RequiredMark />
                        </span>
                        <input
                          aria-describedby={
                            hasFieldError('task-name')
                              ? fieldErrorId('task-name')
                              : undefined
                          }
                          aria-invalid={hasFieldError('task-name')}
                          data-field="task-name"
                          maxLength={128}
                          onChange={(event) => {
                            setTaskName(event.target.value)
                            setTaskNameTouched(true)
                            clearFieldError('task-name')
                          }}
                          required
                          value={taskNameTouched ? taskName : suggestedName}
                        />
                      </label>
                      {fieldErrorText('task-name')}
                      <fieldset
                        aria-describedby={describedBy(
                          'task-items-hint',
                          hasFieldError('task-items') &&
                            fieldErrorId('task-items'),
                        )}
                        aria-invalid={hasFieldError('task-items')}
                        data-field="task-items"
                        tabIndex={-1}
                      >
                        <legend>
                          選擇一筆以上查核項目 <RequiredMark />
                        </legend>
                        <p className="field-hint" id="task-items-hint">
                          至少選擇一筆查核項目。
                        </p>
                        {removedTaskItems.length > 0 && (
                          <p role="status">
                            已移除剛停用的項目：{removedTaskItems.join('、')}
                          </p>
                        )}
                        {/* IP-R24：新增任務不得選入停用項目，清單只列啟用者。 */}
                        {!loading &&
                          items.length > 0 &&
                          !items.some((item) => item.is_active !== false) && (
                            <p className="field-hint">
                              目前沒有啟用的查核項目，請先到專案查核項目新增或恢復。
                            </p>
                          )}
                        {!loading && items.length === 0 && (
                          <p className="field-hint">
                            這個專案還沒有查核項目，請先到專案查核項目新增。
                          </p>
                        )}
                        {items
                          .filter((item) => item.is_active !== false)
                          .map((item) => {
                            const existingTasks = tasksForItem(item.id)
                            const selected = taskItems.includes(item.id)
                            return (
                              <div key={item.id}>
                                <label>
                                  <input
                                    checked={selected}
                                    onChange={(event) => {
                                      toggleItem(item.id, event.target.checked)
                                      clearFieldError('task-items')
                                    }}
                                    type="checkbox"
                                    value={item.id}
                                  />
                                  {item.instruction
                                    ? [item.title, item.instruction].join(
                                        ' — ',
                                      )
                                    : item.title}
                                </label>
                                {/* IP-R02 允許同項目建立多筆任務，所以只標示已有
                              幾筆、不擋選擇，讓使用者自己避開重複任務。 */}
                                {existingTasks.length > 0 && (
                                  <details>
                                    <summary style={{ minHeight: 44 }}>
                                      本計畫已有 {existingTasks.length} 筆任務
                                    </summary>
                                    <ul>
                                      {existingTasks.map((task) => (
                                        <li key={task.id}>
                                          {taskTitle(task) || '未命名任務'}
                                          {task.zone
                                            ? `（${task.zone.name}）`
                                            : ''}
                                        </li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                                {selected && existingTasks.length > 0 && (
                                  <p className="field-hint">
                                    此項目已在本計畫任務中使用；仍可建立另一筆任務。
                                  </p>
                                )}
                              </div>
                            )
                          })}
                      </fieldset>
                      {fieldErrorText('task-items')}
                      {zones.length > 0 && !zonesDenied && (
                        <div>
                          <label>
                            <span className="required-label">
                              任務分區 <RequiredMark />
                            </span>
                            <select
                              aria-describedby={describedBy(
                                'task-zone-hint',
                                hasFieldError('task-zone') &&
                                  fieldErrorId('task-zone'),
                              )}
                              aria-invalid={hasFieldError('task-zone')}
                              onChange={(event) => {
                                setTaskZoneId(event.target.value)
                                clearFieldError('task-zone')
                              }}
                              data-field="task-zone"
                              required
                              value={taskZoneId}
                            >
                              <option value="">請選擇分區</option>
                              {zones.map((zone) => (
                                <option key={zone.id} value={zone.id}>
                                  {zone.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <span className="field-hint" id="task-zone-hint">
                            必填，從專案分區中選一個。
                          </span>
                          {fieldErrorText('task-zone')}
                        </div>
                      )}
                      {error && errorContext === 'task' && (
                        <p ref={errorMessage} role="alert" tabIndex={-1}>
                          {error}
                        </p>
                      )}
                      <label>
                        補充地點
                        <input
                          aria-describedby={
                            hasFieldError('task-location')
                              ? fieldErrorId('task-location')
                              : undefined
                          }
                          aria-invalid={hasFieldError('task-location')}
                          maxLength={256}
                          onChange={(event) => {
                            setTaskLocation(event.target.value)
                            clearFieldError('task-location')
                          }}
                          data-field="task-location"
                          value={taskLocation}
                        />
                      </label>
                      {fieldErrorText('task-location')}
                      <label>
                        建議指派人
                        <select
                          aria-describedby={
                            [
                              hasFieldError('task-assignee')
                                ? fieldErrorId('task-assignee')
                                : '',
                              membersUnavailable
                                ? 'assignee-list-unavailable-create'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          aria-invalid={hasFieldError('task-assignee')}
                          onChange={(event) => {
                            setAssigneeId(event.target.value)
                            clearFieldError('task-assignee')
                          }}
                          disabled={membersUnavailable}
                          data-field="task-assignee"
                          value={assigneeId}
                        >
                          <option value="">不指定</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name_zh ?? member.username}
                            </option>
                          ))}
                        </select>
                      </label>
                      {membersUnavailable && (
                        <p
                          className="assignee-list-unavailable"
                          id="assignee-list-unavailable-create"
                          tabIndex={-1}
                        >
                          {membersFailureText}
                        </p>
                      )}
                      {membersFailure === 'temporary' && (
                        <button
                          disabled={retryingMembers}
                          onClick={(event) =>
                            retryAssigneeListFrom(
                              event.currentTarget,
                              'task-assignee',
                            )
                          }
                          type="button"
                        >
                          {retryingMembers ? '重試中…' : '重試'}
                        </button>
                      )}
                      {fieldErrorText('task-assignee')}
                      <button
                        disabled={busy}
                        onClick={() => requestTaskFormCancel('new-task')}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="btn-primary"
                        disabled={busy}
                        type="submit"
                      >
                        建立草稿任務
                      </button>
                      {discardingTaskForm === 'new-task' && (
                        <ConfirmBox
                          cancelLabel="保留編輯"
                          confirmLabel="捨棄變更"
                          onCancel={() => setDiscardingTaskForm(null)}
                          onConfirm={discardTaskForm}
                          title="有尚未儲存的變更"
                          variant="danger"
                        >
                          <p>新增任務內容尚未儲存；捨棄後無法復原。</p>
                        </ConfirmBox>
                      )}
                    </form>
                  )}
              </section>
            )}
        </>
      )}
      {cancelTask &&
        (viewerPermissions === undefined ||
          viewerPermissions.includes('inspection_task.cancel')) && (
          <ConfirmBox
            asForm
            busy={busy}
            confirmDisabled={!cancelReason.trim()}
            confirmLabel="取消任務"
            headingRef={cancelHeading}
            initialFocus="none"
            modal
            onCancel={closeDialogs}
            onConfirm={() =>
              act(
                () => client.cancelTask(cancelTask.id, cancelReason),
                { area: 'tasks', text: '已取消任務，之後可以恢復。' },
                'dialog',
                TASK_CANCEL_BINDINGS,
              )
            }
            role="dialog"
            title={`取消任務「${cancelTask.name}」`}
            variant="danger"
          >
            <p>
              將取消「{cancelTask.name}
              」；任務資料會保留，之後可以恢復到取消前狀態。
            </p>
            {error && errorContext === 'dialog' && (
              <p ref={errorMessage} role="alert" tabIndex={-1}>
                {error}
              </p>
            )}
            <label>
              <span className="required-label">
                取消原因 <RequiredMark />
              </span>
              <textarea
                aria-describedby={describedBy(
                  'cancel-reason-hint',
                  hasFieldError('cancel-reason') &&
                    fieldErrorId('cancel-reason'),
                )}
                aria-invalid={hasFieldError('cancel-reason')}
                onChange={(event) => {
                  setCancelReason(event.target.value)
                  clearFieldError('cancel-reason')
                }}
                data-field="cancel-reason"
                required
                value={cancelReason}
              />
            </label>
            {fieldErrorText('cancel-reason')}
            <span className="field-hint" id="cancel-reason-hint">
              必填，寫下取消這個任務的原因。
            </span>
          </ConfirmBox>
        )}

      {confirmation && (
        <ConfirmBox
          busy={busy}
          confirmDisabled={readOnly}
          confirmLabel={confirmation.confirmLabel}
          headingRef={confirmationHeading}
          initialFocus="none"
          modal
          onCancel={closeDialogs}
          onConfirm={() => act(confirmation.action, confirmation.success)}
          role="dialog"
          title={confirmation.title}
          variant={confirmation.danger ? 'danger' : 'neutral'}
        >
          {confirmation.details}
          {error && errorContext === 'dialog' && (
            <p ref={errorMessage} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
        </ConfirmBox>
      )}
    </section>
  )
}
