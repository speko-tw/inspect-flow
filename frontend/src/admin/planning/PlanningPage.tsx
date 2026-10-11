import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { collectPages, HttpError, isForbidden, isNotFound } from '../../http'
import { StatusBadge } from '../../ui/Badge'
import { ConfirmBox } from '../../ui/ConfirmBox'
import { fieldErrorMessage, mapFieldErrors } from '../../ui/fieldErrors'
import type { FieldErrorBinding } from '../../ui/fieldErrors'
import { blockImeEnter, useSubmitGuard } from '../../ui/submitGuard'
import { planningClient, planningErrorMessage } from './api'
import { UnsavedLeaveBox } from './UnsavedLeaveBox'
import { useUnsavedNavigationGuard } from './useUnsavedNavigationGuard'
import type {
  InspectionPlan,
  InspectionTask,
  SuggestedAssignee,
  PlanningClient,
  PlanningProject,
  ProjectInspectionItem,
  ProjectZone,
} from './api'

type NoticeArea = 'plans' | 'plan-detail' | 'tasks'

// 依 #451 表單驗收，必填錯誤等送出才顯示，避免輸入前就出現錯誤。
// 說明提示常駐，錯誤列在欄位旁並聚焦，讓使用者能找到修正位置。
type FieldKey =
  | 'plan-name'
  | 'plan-rename'
  | 'task-items'
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
  { path: '/item_ids', key: 'task-items' },
  { path: '/zone_id', key: 'task-zone' },
  { path: '/location_text', key: 'task-location' },
  { path: '/suggested_assignee_id', key: 'task-assignee' },
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
// 聚焦（ADM-R28）；各表單的欄位不同，所以每個表單各一張表。
const TASK_CODE_MESSAGES: Record<string, string> = {
  'inspection_task.invalid_zone': '所選分區不屬於這個專案，請重新選擇。',
  'inspection_task.invalid_assignee':
    '建議指派人不是這個專案的成員，請重新選擇。',
  'inspection_task.items_required': '請至少選擇一筆查核項目。',
  'inspection_task.invalid_project_item':
    '所選查核項目不屬於這個專案，請重新整理後再選。',
  'inspection_task.invalid_location': '補充地點內容不符合規則，請修改後再試。',
}
const TASK_CREATE_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_zone': 'task-zone',
  'inspection_task.invalid_assignee': 'task-assignee',
  'inspection_task.items_required': 'task-items',
  'inspection_task.invalid_project_item': 'task-items',
  'inspection_task.invalid_location': 'task-location',
}
const TASK_LOCATION_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_zone': 'location-zone',
  'inspection_task.invalid_location': 'location-text',
}
const TASK_ASSIGNEE_CODE_FIELDS: Record<string, FieldKey> = {
  'inspection_task.invalid_assignee': 'suggested-assignee',
}

// 派出前必須處理的缺項；派出鈕的停用與阻擋說明共用同一份判斷（IP-R05、
// IP-R10）。派出前檢查只在畫面引導：建議指派是非排他的，後端不擋。
function dispatchBlockers(task: InspectionTask) {
  return {
    unassigned: !task.assignee_id,
    noLocation: !task.zone_id && !task.location_text?.trim(),
    noItems: task.items.length === 0,
  }
}

function describedBy(...ids: (string | false)[]): string {
  return ids.filter(Boolean).join(' ')
}

function taskTitle(task: InspectionTask): string {
  return task.items
    .map((item) => item.current_snapshot?.title ?? '')
    .join('、')
}

// 刪除確認用：查核項目名加上分區與補充地點，讓人知道刪的是哪一筆。
function draftTaskSummary(task: InspectionTask): string {
  const places = [task.zone?.name, task.location_text].filter(Boolean)
  const title = `「${taskTitle(task) || '未命名任務'}」`
  return places.length ? `${title}，位置：${places.join('・')}` : title
}

/** 顯示專案計畫、草稿任務及其管理操作（#451；ADM-R17、IP-R10）。 */
export default function PlanningPage({
  client = planningClient,
  initialProjectId = '',
}: {
  client?: PlanningClient
  initialProjectId?: string
}) {
  const [projects, setProjects] = useState<PlanningProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [items, setItems] = useState<ProjectInspectionItem[]>([])
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
  // 依 #451 將成功提示放在所屬區塊，避免操作結果和其他表單混淆。
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
  const [taskZoneId, setTaskZoneId] = useState('')
  const [taskLocation, setTaskLocation] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [editingLocation, setEditingLocation] = useState<{
    task: InspectionTask
    zoneId: string
    locationText: string
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
  const confirmationTrigger = useRef<HTMLElement | null>(null)
  const confirmationHeading = useRef<HTMLHeadingElement | null>(null)
  const cancelTrigger = useRef<HTMLElement | null>(null)
  const cancelHeading = useRef<HTMLHeadingElement | null>(null)
  const pageHeading = useRef<HTMLHeadingElement | null>(null)
  const pageContent = useRef<HTMLElement | null>(null)
  const errorMessage = useRef<HTMLParagraphElement | null>(null)
  // Enter 用 requestSubmit() 送出時不會被停用的按鈕擋住，所以連按兩次 Enter
  // 會送出兩次；用防護擋掉進行中的第二次送出（#490、#507）。
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
      taskZoneId ||
      taskLocation ||
      assigneeId ||
      (editingLocation &&
        (editingLocation.zoneId !== (editingLocation.task.zone_id ?? '') ||
          editingLocation.locationText !==
            (editingLocation.task.location_text ?? ''))) ||
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
  const canEditPlan = Boolean(
    selectedPlan && selectedPlan.status !== 'ARCHIVED',
  )
  // 計畫封存或畫面唯讀時，任務上的所有修改入口（含阻擋說明的捷徑與
  // 修改表單）都不顯示；只留說明文字。
  const canModify = canEditPlan && !readOnly

  // 直接捲到「新增任務」的查核項目欄並聚焦（AC42）；不用 hash 導航，
  // 避免被未儲存變更的離頁確認誤判成離開頁面。
  function focusTaskItems(): void {
    const field = pageContent.current?.querySelector<HTMLElement>(
      '[data-field="task-items"]',
    )
    field?.scrollIntoView?.({ block: 'center' })
    field?.focus()
  }

  // 沒有任何阻擋原因時不渲染清單，避免空的 <ul> 被報讀成「清單，0 項」。
  function renderDispatchBlockers(task: InspectionTask) {
    if (task.status !== 'DRAFT') return null
    const blockers = dispatchBlockers(task)
    if (!blockers.unassigned && !blockers.noLocation && !blockers.noItems) {
      return null
    }
    return (
      <ul aria-label="派出前需要處理的項目" className="task-dispatch-blockers">
        {blockers.unassigned && (
          <li>
            {canModify ? '尚未指派：' : '尚未指派建議指派人。'}
            {canModify && (
              <button
                onClick={() => setEditingAssignee({ task, assigneeId: '' })}
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
                onClick={() =>
                  setEditingLocation({ task, zoneId: '', locationText: '' })
                }
                type="button"
              >
                前往地點欄位
              </button>
            )}
          </li>
        )}
        {blockers.noItems && (
          <li>
            {/* 現有 API 沒有替草稿補項目的操作；明示刪除重建，不暗示可修復。 */}
            {canModify
              ? '尚未選擇查核項目：請刪除這筆草稿後重新建立，並選擇項目。'
              : '尚未選擇查核項目。'}
            {canModify && (
              <button onClick={focusTaskItems} type="button">
                前往新增任務欄位
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
      setEditingAssignee(null)
      setEditingPlanName(false)
      setReloadKey((key) => key + 1)
      return true
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
        // 唯讀後改名表單與取消對話框都不再提供，一併收起；取消對話框裡的
        // 錯誤訊息改顯示在頁面上，避免使用者看不到被拒絕的原因。
        setEditingPlanName(false)
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
      <p className="tpl-field-error" id={fieldErrorId(field)}>
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

  // #451 的必填欄位在送出時攔截，避免把已知空白值送交 API。
  // 同時將錯誤設在對應欄位，讓使用者能直接修正。
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
    // 空項目會被後端拒絕；先在表單指出欄位並聚焦（IP-R14）。
    if (rejectBlank('task-items', taskItems.length === 0)) return
    if (
      rejectBlank('task-zone', zones.length > 0 && !zonesDenied && !taskZoneId)
    ) {
      return
    }
    const created = await act(
      () =>
        client.createTask(selectedPlan.id, {
          item_ids: taskItems,
          suggested_assignee_id: assigneeId || null,
          zone_id: zones.length ? taskZoneId || null : null,
          location_text: taskLocation.trim() || null,
        }),
      { area: 'tasks', text: '已建立草稿任務，派出後現場才看得到。' },
      'task',
      TASK_CREATE_BINDINGS,
      TASK_CREATE_CODE_FIELDS,
    )
    if (created) {
      setTaskItems([])
      setTaskZoneId('')
      setTaskLocation('')
      setAssigneeId('')
    }
  }

  function toggleItem(id: string, checked: boolean) {
    setTaskItems((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
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
                    計畫名稱 <span aria-hidden="true">*</span>
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
                    className="tpl-field-error"
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
              <h2 id="plan-detail-heading">{selectedPlanDetail.name}</h2>
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
                        計畫名稱 <span aria-hidden="true">*</span>
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
                        className="tpl-field-error"
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

              <h3>任務</h3>
              {noticeFor('tasks')}
              {(selectedPlanDetail.tasks ?? []).length === 0 ? (
                <p>尚未建立任務。</p>
              ) : null}
              <ul>
                {(selectedPlanDetail.tasks ?? []).map((task) => (
                  <li key={task.id}>
                    <article>
                      <h4 id={`task-${task.id}-heading`}>
                        {taskTitle(task)}{' '}
                        <StatusBadge parenthesized status={task.status} />
                      </h4>
                      {renderDispatchBlockers(task)}
                      {task.zone && <p>分區：{task.zone.name}</p>}
                      {task.location_text && (
                        <p>補充地點：{task.location_text}</p>
                      )}
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
                                disabled={
                                  busy ||
                                  Object.values(dispatchBlockers(task)).some(
                                    Boolean,
                                  )
                                }
                                onClick={() =>
                                  confirm(
                                    '派出此任務？派出後現場即可查看。',
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
                                onClick={() => {
                                  clearFieldError()
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
                                onClick={() =>
                                  setEditingAssignee({
                                    task,
                                    assigneeId: task.assignee_id ?? '',
                                  })
                                }
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
                                  分區 <span aria-hidden="true">*</span>
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
                        </form>
                      )}
                    </article>
                  </li>
                ))}
              </ul>

              {canModify && (
                <form
                  id="task-creation-form"
                  onKeyDown={blockImeEnter}
                  data-error-context="task"
                  noValidate
                  onSubmit={(event) => void createTask(event)}
                >
                  <h3>新增任務</h3>
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
                      選擇一筆以上查核項目 <span aria-hidden="true">*</span>
                    </legend>
                    <p className="field-hint" id="task-items-hint">
                      至少選擇一筆查核項目。
                    </p>
                    {items.map((item) => (
                      <label key={item.id}>
                        <input
                          checked={taskItems.includes(item.id)}
                          onChange={(event) => {
                            toggleItem(item.id, event.target.checked)
                            clearFieldError('task-items')
                          }}
                          type="checkbox"
                          value={item.id}
                        />
                        {item.title} — {item.instruction}
                      </label>
                    ))}
                  </fieldset>
                  {fieldErrorText('task-items')}
                  {zones.length > 0 && !zonesDenied && (
                    <div>
                      <label>
                        <span className="required-label">
                          任務分區 <span aria-hidden="true">*</span>
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
          title="取消任務"
          variant="danger"
        >
          <p>取消後會保留任務資料；之後可以恢復到取消前狀態。</p>
          {error && errorContext === 'dialog' && (
            <p ref={errorMessage} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <label>
            <span className="required-label">
              取消原因 <span aria-hidden="true">*</span>
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
