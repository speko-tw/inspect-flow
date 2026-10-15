import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { collectPages, HttpError, isForbidden, isNotFound } from '../../http'
import { RequiredMark } from '../../ui/Form'
import { StatusBadge } from '../../ui/Badge'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import type { FieldErrorBinding } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { getProject, type Project } from '../projects/api'
import { listProjectItems, type ProjectItemData } from '../projectItems/api'
import { planningClient, planningErrorMessage } from './api'
import { UnsavedLeaveBox } from './UnsavedLeaveBox'
import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'
import type {
  InspectionPlan,
  InspectionTask,
  SuggestedAssignee,
  PlanningClient,
  ProjectZone,
} from './api'

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
 * Plan 已封存時收起修改入口；頁面不預先判斷寫入權限，寫入被
 * 後端回 403 後才切成唯讀，實際寫入一律由後端覆核。
 */
export default function PlanningPage({
  client = defaultPlanningPageClient,
  initialProjectId = '',
}: {
  client?: PlanningPageClient
  initialProjectId?: string
}) {
  const [projects, setProjects] = useState<Pick<Project, 'id' | 'name'>[]>([])
  const [projectId, setProjectId] = useState('')
  const [items, setItems] = useState<ProjectItemData[]>([])
  const [zones, setZones] = useState<ProjectZone[]>([])
  const [members, setMembers] = useState<SuggestedAssignee[]>([])
  const [plans, setPlans] = useState<InspectionPlan[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [projectNotFound, setProjectNotFound] = useState(false)
  const [zonesDenied, setZonesDenied] = useState(false)
  const [membersDenied, setMembersDenied] = useState(false)
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
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [planName, setPlanName] = useState('')
  const [editingPlanName, setEditingPlanName] = useState(false)
  const [updatedPlanName, setUpdatedPlanName] = useState('')
  const [taskItems, setTaskItems] = useState<string[]>([])
  const [taskName, setTaskName] = useState('')
  // 只有使用者碰過名稱欄才採用手動值，避免項目變動覆寫自訂名稱。
  const [taskNameTouched, setTaskNameTouched] = useState(false)
  const [taskFormOpen, setTaskFormOpen] = useState(false)
  // 表單展開時要把焦點送到第一個欄位；表單還沒渲染時不能直接聚焦，
  // 所以先記下來。
  const taskFormFocus = useRef<'first' | null>(null)
  // 只靠 ref 不會觸發 effect，所以每次請求都遞增計數讓 effect 再跑一次。
  const [taskFormFocusTick, setTaskFormFocusTick] = useState(0)
  const [taskToFocus, setTaskToFocus] = useState('')
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
  const [editingTaskItems, setEditingTaskItems] = useState<{
    task: InspectionTask
    itemIds: string[]
  } | null>(null)
  const [editingAssignee, setEditingAssignee] = useState<{
    task: InspectionTask
    assigneeId: string
  } | null>(null)
  const [cancelTask, setCancelTask] = useState<InspectionTask | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [confirmation, setConfirmation] = useState<{
    title: string
    action: () => Promise<unknown>
    success: { area: NoticeArea; text: string }
    danger?: { label: string }
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
  // 只在表單值偏離原資料或有新輸入時攔截離頁，避免純瀏覽也被詢問。
  // 唯讀、無權限與找不到專案時，表單都已收起或整頁被取代，看不見的內容
  // 不該再攔住離頁（ADM-R28）。
  const hasUnsavedChanges = Boolean(
    !readOnly &&
    !accessDenied &&
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
    if (error && !serverFieldFocus) errorMessage.current?.focus()
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
    if (taskFormOpen && taskFormFocus.current) {
      const form = pageContent.current?.querySelector<HTMLElement>(
        '#task-creation-form',
      )
      const fieldset = form?.querySelector<HTMLElement>(
        '[data-field="task-items"]',
      )
      // 展開後落在第一個欄位；沒有可選項目時退回項目欄本身。
      const target =
        form?.querySelector<HTMLElement>('input, select, textarea') ?? fieldset
      target?.scrollIntoView?.({ block: 'center' })
      target?.focus()
      taskFormFocus.current = null
    }
  }, [taskFormOpen, taskFormFocusTick])

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
      // ADM-R38：取消或儲存指派後回到原按鈕，避免焦點落到文件頂端。
      if (assigneeTrigger.current?.isConnected) {
        assigneeTrigger.current.focus()
      } else {
        pageHeading.current?.focus()
      }
    }
    previousAssigneeEdit.current = Boolean(editingAssignee)
  }, [editingAssignee])

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
  }, [client, initialProjectId])

  useEffect(() => {
    if (!projectId) return
    let active = true
    async function loadProjectData() {
      setLoading(true)
      setError('')
      setErrorContext('page')
      setZonesDenied(false)
      setMembersDenied(false)
      const allPlans = () =>
        collectPages<InspectionPlan>((cursor) =>
          client.listPlans(projectId, cursor),
        )
      const results = await Promise.allSettled([
        client.listProjectItems(projectId),
        client.listProjectZones(projectId),
        client.listProjectAssignees(projectId),
        allPlans(),
      ])
      if (active) {
        const [itemsResult, zonesResult, membersResult, plansResult] = results
        if (itemsResult.status === 'fulfilled') {
          setItems(itemsResult.value)
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
          setMembers([])
          if (isForbidden(membersResult.reason)) {
            setMembersDenied(true)
          } else {
            setError(planningErrorMessage(membersResult.reason))
          }
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
    }
  }, [client, projectId, reloadKey])

  const [selectedPlanData, setSelectedPlanData] = useState<{
    id: string
    plan: InspectionPlan
  } | null>(null)
  useEffect(() => {
    if (!selectedPlanId) return
    let active = true
    void client.getPlan(selectedPlanId).then(
      (plan) => active && setSelectedPlanData({ id: selectedPlanId, plan }),
      (caught: unknown) => {
        if (active) {
          setErrorContext('page')
          if (isForbidden(caught)) {
            setAccessDenied(true)
          } else {
            setError(planningErrorMessage(caught))
          }
        }
      },
    )
    return () => {
      active = false
    }
  }, [client, selectedPlanId, reloadKey])
  const selectedPlanDetail =
    selectedPlanData?.id === selectedPlanId ? selectedPlanData.plan : null

  // 只在「換了一份計畫」時聚焦；同一份計畫重新載入不應再搶焦點。
  const loadedPlanId = selectedPlanDetail?.id
  useEffect(() => {
    if (!loadedPlanId) return
    // ADM-R28：明細載入後聚焦標題，避免手機使用者越過表單尋找內容。
    selectedPlanHeading.current?.scrollIntoView?.({ block: 'start' })
    selectedPlanHeading.current?.focus()
  }, [loadedPlanId])

  useEffect(() => {
    if (!selectedPlanDetail || !taskToFocus) return
    const heading = pageContent.current?.querySelector<HTMLElement>(
      `[data-task-heading="${taskToFocus}"]`,
    )
    if (!heading) return
    // ADM-R28：建立成功後把視線帶到新任務，確認資料已進入任務清單。
    heading.scrollIntoView?.({ block: 'center' })
    heading.focus()
    pendingTaskHeading.current = ''
    setTaskToFocus('')
  }, [selectedPlanDetail, taskToFocus])
  const canEditPlan = Boolean(
    selectedPlan && selectedPlan.status !== 'ARCHIVED',
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

  function openTaskItemsEditor(
    task: InspectionTask,
    trigger?: HTMLButtonElement,
  ): void {
    clearFieldError()
    setError('')
    setNotice(null)
    if (trigger) taskItemsTrigger.current = trigger
    setEditingTaskItems({
      task,
      itemIds: task.items.map((item) => item.id),
    })
  }

  function requestTaskFormFocus(target: 'first'): void {
    taskFormFocus.current = target
    setTaskFormFocusTick((tick) => tick + 1)
  }

  // 沒有任何阻擋原因時不渲染清單，避免空的 <ul> 被報讀成「清單，0 項」。
  function renderDispatchBlockers(task: InspectionTask) {
    if (task.status !== 'DRAFT') return null
    const blockers = dispatchBlockers(task)
    if (!blockers.unassigned && !blockers.noLocation && !blockers.noItems) {
      return null
    }
    return (
      <ul
        aria-label="派出前需要處理的項目"
        className="task-dispatch-blockers"
        // 去掉項目符號後 Safari 會不再把 <ul> 當清單報讀，所以明示 role。
        role="list"
        style={{ listStyle: 'none' }}
      >
        {blockers.unassigned && (
          <li>
            {canModify ? '尚未指派：' : '尚未指派建議指派人。'}
            {canModify && (
              <button
                onClick={(event) => {
                  clearFieldError()
                  setNotice(null)
                  assigneeTrigger.current = event.currentTarget
                  setEditingAssignee({ task, assigneeId: '' })
                }}
                type="button"
              >
                前往建議指派欄位
              </button>
            )}
          </li>
        )}
        {blockers.noLocation && (
          <li>
            {canModify ? '尚未填寫地點：' : '尚未填寫地點。'}
            {canModify && (
              <button
                onClick={(event) => {
                  clearFieldError()
                  setNotice(null)
                  locationTrigger.current = event.currentTarget
                  setEditingLocation({ task, zoneId: '', locationText: '' })
                }}
                type="button"
              >
                前往地點欄位
              </button>
            )}
          </li>
        )}
        {blockers.noItems && (
          <li>
            {canModify
              ? '尚未選擇查核項目：請直接修改這筆草稿的查核項目。'
              : '尚未選擇查核項目。'}
            {canModify && task.status === 'DRAFT' && (
              <button
                onClick={(event) =>
                  openTaskItemsEditor(task, event.currentTarget)
                }
                type="button"
              >
                前往修改查核項目
              </button>
            )}
          </li>
        )}
      </ul>
    )
  }

  function confirm(
    title: string,
    action: () => Promise<unknown>,
    success: { area: NoticeArea; text: string },
    danger?: { label: string },
  ): void {
    setError('')
    setNotice(null)
    setErrorContext('dialog')
    confirmationTrigger.current = document.activeElement as HTMLElement
    setConfirmation({ title, action, success, danger })
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
      return true
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
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
    const created = await act(
      () => client.createPlan(projectId, { name: planName }),
      { area: 'plans', text: `已建立計畫「${planName.trim()}」。` },
      'plan-create',
      PLAN_CREATE_BINDINGS,
    )
    if (created) setPlanName('')
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
      setTaskToFocus(pendingTaskHeading.current)
      resetTaskForm()
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

  // 收起新增任務表單並清空輸入；收起後不應留下任何隱藏的未儲存內容，
  // 也不應留下等待確認的捨棄提示。
  function resetTaskForm(): void {
    setTaskFormOpen(false)
    taskFormFocus.current = null
    setTaskItems([])
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
  function dispatchConfirmation(task: InspectionTask): string {
    const zoneName = task.zone?.name ?? '未設定分區'
    const assigneeName =
      task.assignee?.name_zh ?? task.assignee?.username ?? '未指派'
    return (
      `派出任務「${task.name}」？查核項目：${taskItemsSummary(task)}；` +
      `分區：${zoneName}；建議指派人：${assigneeName}。派出後現場即可查看。`
    )
  }

  const noticeFor = (area: NoticeArea) =>
    notice?.area === area ? (
      <p className="notice-success" role="status">
        {notice.text}
      </p>
    ) : null

  if (accessDenied) {
    return (
      <section>
        <h2>無權限</h2>
        <p role="alert">你沒有這個專案的查核計畫讀取權限。</p>
        <Link className="btn" to="/admin/projects">
          返回專案清單
        </Link>
      </section>
    )
  }

  if (projectNotFound) {
    return (
      <section>
        <h2>找不到專案</h2>
        <p role="alert">網址中的專案不存在或已刪除。</p>
        <Link className="btn" to="/admin/projects">
          返回專案清單
        </Link>
      </section>
    )
  }

  return (
    <section aria-labelledby="planning-heading" ref={pageContent}>
      <h2 id="planning-heading" ref={pageHeading} tabIndex={-1}>
        計畫與任務
      </h2>
      <p>計畫狀態由任務狀態自動推導；任務派出後才會提供給現場。</p>
      <UnsavedLeaveBox guard={leaveGuard} />
      {projects[0] && <p>專案：{projects[0].name}</p>}
      {readOnly && (
        <p className="notice-info" role="status">
          目前為唯讀模式。
        </p>
      )}
      {membersDenied && (
        <p className="notice-info" role="status">
          沒有讀取可指派人員清單的權限；可略過建議指派。
        </p>
      )}
      {error && errorContext === 'page' && (
        <p ref={errorMessage} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {loading ? <p>載入中…</p> : null}

      {projects.length > 0 && (
        <>
          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading">查核計畫</h2>
            {noticeFor('plans')}
            {plans.length === 0 ? <p>目前沒有計畫。</p> : null}
            <ul className="plan-list">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    aria-current={selectedPlanId === plan.id}
                    onClick={() => {
                      setNotice(null)
                      clearFieldError()
                      if (plan.id !== selectedPlanId) {
                        // 新增任務的輸入與編輯中的表單都屬於上一份計畫，
                        // 帶到新計畫會誤建任務，也會留下看不見的未儲存內容。
                        resetTaskForm()
                        setEditingLocation(null)
                        setEditingName(null)
                        setEditingTaskItems(null)
                        setEditingAssignee(null)
                      }
                      setSelectedPlanId(plan.id)
                    }}
                    type="button"
                  >
                    {plan.name}
                    <StatusBadge parenthesized status={plan.status} />
                  </button>
                </li>
              ))}
            </ul>
            {!readOnly && (
              <form
                onKeyDown={blockImeEnter}
                data-error-context="plan-create"
                noValidate
                onSubmit={(event) => void createPlan(event)}
              >
                <h3>建立計畫</h3>
                <label>
                  <span className="required-label">
                    計畫名稱 <RequiredMark />
                  </span>
                  <input
                    aria-describedby={describedBy(
                      'plan-name-hint',
                      hasFieldError('plan-name') && fieldErrorId('plan-name'),
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
                <button className="btn-primary" disabled={busy} type="submit">
                  建立計畫
                </button>
              </form>
            )}
          </section>

          {selectedPlan && selectedPlanDetail && (
            <section aria-labelledby="plan-detail-heading">
              <h2
                id="plan-detail-heading"
                ref={selectedPlanHeading}
                tabIndex={-1}
              >
                {selectedPlanDetail.name}
              </h2>
              <p>
                計畫狀態：
                <StatusBadge status={selectedPlanDetail.status} />
              </p>
              {noticeFor('plan-detail')}
              {!readOnly && (
                <>
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
                  </button>{' '}
                  <button
                    disabled={busy}
                    onClick={() =>
                      confirm(
                        selectedPlan.status === 'ARCHIVED'
                          ? '取消封存計畫並依目前任務重算狀態？'
                          : '封存計畫？封存期間任務將唯讀。',
                        () =>
                          selectedPlan.status === 'ARCHIVED'
                            ? client.unarchivePlan(selectedPlan.id)
                            : client.archivePlan(selectedPlan.id),
                        {
                          area: 'plan-detail',
                          text:
                            selectedPlan.status === 'ARCHIVED'
                              ? '已取消封存計畫。'
                              : '已封存計畫。',
                        },
                      )
                    }
                    type="button"
                  >
                    {selectedPlan.status === 'ARCHIVED'
                      ? '取消封存'
                      : '封存計畫'}
                  </button>
                </>
              )}
              {editingPlanName &&
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

              {/* 按鈕與標題之間只靠標題的上邊距隔開，按鈕維持同一列。 */}
              <h3 style={{ marginBlockStart: 'var(--space-3)' }}>任務</h3>
              {noticeFor('tasks')}
              {(selectedPlanDetail.tasks ?? []).length === 0 ? (
                <p>尚未建立任務。</p>
              ) : null}
              <ul>
                {(selectedPlanDetail.tasks ?? []).map((task) => (
                  <li key={task.id}>
                    <article>
                      <h4
                        data-task-heading={task.id}
                        id={`task-${task.id}-heading`}
                        tabIndex={-1}
                      >
                        {taskTitle(task)}{' '}
                        <StatusBadge parenthesized status={task.status} />
                      </h4>
                      {renderDispatchBlockers(task)}
                      {task.zone && <p>分區：{task.zone.name}</p>}
                      {task.location_text && (
                        <p>補充地點：{task.location_text}</p>
                      )}
                      <p>查核項目：{taskItemsSummary(task)}</p>
                      <p>
                        建議指派：
                        {task.assignee?.name_zh ??
                          task.assignee?.username ??
                          '未指派'}
                      </p>
                      {task.status === 'CANCELLED' && (
                        <p>取消原因：{task.cancellation_reason}</p>
                      )}
                      {canModify && (
                        <div>
                          {task.status === 'DRAFT' && (
                            <>
                              <button
                                disabled={busy}
                                onClick={(event) =>
                                  openTaskItemsEditor(
                                    task,
                                    event.currentTarget,
                                  )
                                }
                                ref={taskItemsTrigger}
                                type="button"
                              >
                                修改查核項目
                              </button>{' '}
                              <button
                                disabled={
                                  busy ||
                                  Object.values(dispatchBlockers(task)).some(
                                    Boolean,
                                  )
                                }
                                onClick={() =>
                                  confirm(
                                    dispatchConfirmation(task),
                                    () => client.dispatchTask(task.id),
                                    {
                                      area: 'tasks',
                                      text: '已派出任務，現場可以查看了。',
                                    },
                                  )
                                }
                                type="button"
                              >
                                派出任務
                              </button>{' '}
                              <button
                                disabled={busy}
                                onClick={() =>
                                  confirm(
                                    [
                                      `永久刪除草稿任務${draftTaskSummary(task)}？`,
                                      '刪除後無法復原。',
                                    ].join(''),
                                    () => client.deleteDraftTask(task.id),
                                    {
                                      area: 'tasks',
                                      text: '已刪除草稿任務。',
                                    },
                                    { label: '刪除' },
                                  )
                                }
                                type="button"
                              >
                                刪除草稿
                              </button>{' '}
                            </>
                          )}
                          {['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(
                            task.status,
                          ) && (
                            <>
                              <button
                                disabled={busy}
                                onClick={(event) => {
                                  clearFieldError()
                                  setNotice(null)
                                  nameTrigger.current = event.currentTarget
                                  setEditingName({ task, name: task.name })
                                }}
                                type="button"
                              >
                                修改名稱
                              </button>{' '}
                              <button
                                disabled={busy}
                                onClick={(event) => {
                                  clearFieldError()
                                  setNotice(null)
                                  const trigger = event.currentTarget
                                  locationTrigger.current = trigger
                                  setEditingLocation({
                                    task,
                                    zoneId: task.zone_id ?? '',
                                    locationText: task.location_text ?? '',
                                  })
                                }}
                                type="button"
                              >
                                修改地點
                              </button>{' '}
                              <button
                                disabled={busy}
                                onClick={(event) => {
                                  clearFieldError()
                                  setNotice(null)
                                  const trigger = event.currentTarget
                                  assigneeTrigger.current = trigger
                                  setEditingAssignee({
                                    task,
                                    assigneeId: task.assignee_id ?? '',
                                  })
                                }}
                                type="button"
                              >
                                修改建議指派
                              </button>{' '}
                            </>
                          )}
                          {['PENDING', 'IN_PROGRESS'].includes(
                            task.status,
                          ) && (
                            <button
                              disabled={busy}
                              onClick={(event) => {
                                setNotice(null)
                                cancelTrigger.current = event.currentTarget
                                setCancelTask(task)
                              }}
                              type="button"
                            >
                              取消任務
                            </button>
                          )}
                          {task.status === 'CANCELLED' && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                confirm(
                                  '恢復此任務至取消前狀態？',
                                  () => client.restoreTask(task.id),
                                  { area: 'tasks', text: '已恢復任務。' },
                                )
                              }
                              type="button"
                            >
                              恢復任務
                            </button>
                          )}
                        </div>
                      )}
                      {canModify && editingName?.task.id === task.id && (
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
                              { area: 'tasks', text: '已更新任務名稱。' },
                              'task-rename',
                              TASK_RENAME_BINDINGS,
                              TASK_RENAME_CODE_FIELDS,
                            )
                          }}
                        >
                          <h5>修改任務名稱</h5>
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
                            className="btn-primary"
                            disabled={busy}
                            type="submit"
                          >
                            儲存名稱
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => requestTaskFormCancel('name')}
                            type="button"
                          >
                            取消
                          </button>
                          {error && errorContext === 'task-rename' && (
                            <p ref={errorMessage} role="alert" tabIndex={-1}>
                              {error}
                            </p>
                          )}
                        </form>
                      )}
                      {canModify && editingTaskItems?.task.id === task.id && (
                        <form
                          onKeyDown={blockImeEnter}
                          data-error-context="items"
                          noValidate
                          onSubmit={(event) => void updateTaskItems(event)}
                        >
                          <h5>修改草稿任務的查核項目</h5>
                          <fieldset
                            aria-describedby={describedBy(
                              `task-${task.id}-items-hint`,
                              hasFieldError('edit-task-items') &&
                                fieldErrorId('edit-task-items'),
                            )}
                            aria-invalid={hasFieldError('edit-task-items')}
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
                            {items.map((item) => {
                              const existingTasks = tasksForItem(item.id)
                              const selected =
                                editingTaskItems.itemIds.includes(item.id)
                              return (
                                <div key={item.id}>
                                  <label>
                                    <input
                                      checked={selected}
                                      onChange={(event) => {
                                        setEditingTaskItems({
                                          ...editingTaskItems,
                                          itemIds: event.target.checked
                                            ? [
                                                ...editingTaskItems.itemIds,
                                                item.id,
                                              ]
                                            : editingTaskItems.itemIds.filter(
                                                (id) => id !== item.id,
                                              ),
                                        })
                                        clearFieldError('edit-task-items')
                                      }}
                                      type="checkbox"
                                      value={item.id}
                                    />
                                    {item.title} — {item.instruction}
                                  </label>
                                  <details>
                                    <summary style={{ minHeight: 44 }}>
                                      本計畫已有 {existingTasks.length} 筆任務
                                    </summary>
                                    {existingTasks.length > 0 ? (
                                      <ul>
                                        {existingTasks.map((existing) => (
                                          <li key={existing.id}>
                                            {taskTitle(existing) ||
                                              '未命名任務'}
                                            {existing.zone
                                              ? `（${existing.zone.name}）`
                                              : ''}
                                          </li>
                                        ))}
                                      </ul>
                                    ) : (
                                      <p>目前沒有使用此項目的任務。</p>
                                    )}
                                  </details>
                                </div>
                              )
                            })}
                          </fieldset>
                          {fieldErrorText('edit-task-items')}
                          {error && errorContext === 'items' && (
                            <p ref={errorMessage} role="alert" tabIndex={-1}>
                              {error}
                            </p>
                          )}
                          <button
                            className="btn-primary"
                            disabled={busy}
                            type="submit"
                          >
                            儲存查核項目
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => requestTaskFormCancel('items')}
                            type="button"
                          >
                            取消
                          </button>
                        </form>
                      )}
                      {canModify && editingLocation?.task.id === task.id && (
                        <form
                          onKeyDown={blockImeEnter}
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
                            void act(
                              () =>
                                client.updateLocation(task.id, {
                                  zone_id: zones.length
                                    ? editingLocation.zoneId || null
                                    : null,
                                  location_text:
                                    editingLocation.locationText.trim() ||
                                    null,
                                }),
                              { area: 'tasks', text: '已更新任務地點。' },
                              'location',
                              TASK_LOCATION_BINDINGS,
                              TASK_LOCATION_CODE_FIELDS,
                            )
                          }}
                        >
                          <h5>修改任務地點</h5>
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
                                  aria-invalid={hasFieldError('location-zone')}
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
                                    <option key={zone.id} value={zone.id}>
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
                              autoFocus={zones.length === 0 || zonesDenied}
                              aria-describedby={
                                hasFieldError('location-text')
                                  ? fieldErrorId('location-text')
                                  : undefined
                              }
                              aria-invalid={hasFieldError('location-text')}
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
                            className="btn-primary"
                            disabled={busy}
                            type="submit"
                          >
                            儲存地點
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => requestTaskFormCancel('location')}
                            type="button"
                          >
                            取消
                          </button>
                          {error && errorContext === 'location' && (
                            <p ref={errorMessage} role="alert" tabIndex={-1}>
                              {error}
                            </p>
                          )}
                        </form>
                      )}
                      {canModify && editingAssignee?.task.id === task.id && (
                        <form
                          onKeyDown={blockImeEnter}
                          data-error-context="assignee"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void act(
                              () =>
                                client.setSuggestedAssignee(
                                  task.id,
                                  editingAssignee.assigneeId || null,
                                ),
                              { area: 'tasks', text: '已更新建議指派。' },
                              'assignee',
                              TASK_ASSIGNEE_BINDINGS,
                              TASK_ASSIGNEE_CODE_FIELDS,
                            )
                          }}
                        >
                          <h5>修改任務指派</h5>
                          <label>
                            建議指派人
                            <select
                              autoFocus
                              aria-describedby={
                                hasFieldError('suggested-assignee')
                                  ? fieldErrorId('suggested-assignee')
                                  : undefined
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
                              data-field="suggested-assignee"
                              value={editingAssignee.assigneeId}
                            >
                              <option value="">不指定</option>
                              {members.map((member) => (
                                <option key={member.id} value={member.id}>
                                  {member.name_zh ?? member.username}
                                </option>
                              ))}
                            </select>
                          </label>
                          {fieldErrorText('suggested-assignee')}
                          {error && errorContext === 'assignee' && (
                            <p ref={errorMessage} role="alert" tabIndex={-1}>
                              {error}
                            </p>
                          )}
                          <button
                            className="btn-primary"
                            disabled={busy}
                            type="submit"
                          >
                            儲存指派
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => requestTaskFormCancel('assignee')}
                            type="button"
                          >
                            取消
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
                ))}
              </ul>

              {canModify && !taskFormOpen && (
                <button
                  disabled={busy}
                  onClick={() => {
                    clearFieldError()
                    setError('')
                    setNotice(null)
                    setTaskFormOpen(true)
                    requestTaskFormFocus('first')
                  }}
                  ref={addTaskTrigger}
                  type="button"
                >
                  ＋ 新增任務
                </button>
              )}
              {canModify && taskFormOpen && (
                <form
                  id="task-creation-form"
                  onKeyDown={blockImeEnter}
                  data-error-context="task"
                  noValidate
                  onSubmit={(event) => void createTask(event)}
                >
                  <h3>新增任務</h3>
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
                    {items.map((item) => {
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
                            {item.title} — {item.instruction}
                          </label>
                          {/* IP-R02 允許同項目建立多筆任務，所以只標示已有
                              幾筆、不擋選擇，讓使用者自己避開重複任務。 */}
                          <details>
                            <summary style={{ minHeight: 44 }}>
                              本計畫已有 {existingTasks.length} 筆任務
                            </summary>
                            {existingTasks.length > 0 ? (
                              <ul>
                                {existingTasks.map((task) => (
                                  <li key={task.id}>
                                    {taskTitle(task) || '未命名任務'}
                                    {task.zone ? `（${task.zone.name}）` : ''}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p>目前沒有使用此項目的任務。</p>
                            )}
                          </details>
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
                        hasFieldError('task-assignee')
                          ? fieldErrorId('task-assignee')
                          : undefined
                      }
                      aria-invalid={hasFieldError('task-assignee')}
                      onChange={(event) => {
                        setAssigneeId(event.target.value)
                        clearFieldError('task-assignee')
                      }}
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
                  {fieldErrorText('task-assignee')}
                  <button
                    className="btn-primary"
                    disabled={busy}
                    type="submit"
                  >
                    建立草稿任務
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => requestTaskFormCancel('new-task')}
                    type="button"
                  >
                    取消
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
      {cancelTask && (
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
          confirmLabel={confirmation.danger?.label ?? '確認'}
          headingRef={confirmationHeading}
          initialFocus="none"
          modal
          onCancel={closeDialogs}
          onConfirm={() => act(confirmation.action, confirmation.success)}
          role="dialog"
          title="請確認操作"
          variant={confirmation.danger ? 'danger' : 'neutral'}
        >
          <p>{confirmation.title}</p>
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
