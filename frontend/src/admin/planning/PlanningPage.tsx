import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { collectPages, HttpError, isForbidden } from '../../http'
import { planningClient, planningErrorMessage } from './api'
import type {
  InspectionPlan,
  InspectionTask,
  SuggestedAssignee,
  PlanningClient,
  PlanningProject,
  ProjectInspectionItem,
  ProjectZone,
} from './api'

const PLAN_STATUS: Record<InspectionPlan['status'], string> = {
  DRAFT: '草稿',
  IN_PROGRESS: '進行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  ARCHIVED: '已封存',
}

const TASK_STATUS: Record<InspectionTask['status'], string> = {
  DRAFT: '草稿',
  PENDING: '待開始',
  IN_PROGRESS: '進行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

type NoticeArea = 'zones' | 'plans' | 'plan-detail' | 'tasks'

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
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [projectNotFound, setProjectNotFound] = useState(false)
  const [zonesDenied, setZonesDenied] = useState(false)
  const [membersDenied, setMembersDenied] = useState(false)
  const [error, setError] = useState('')
  const [errorContext, setErrorContext] = useState('page')
  // 操作成功後的提示，顯示在該操作所屬的區塊旁，下一次操作就清掉。
  const [notice, setNotice] = useState<{
    area: NoticeArea
    text: string
  } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [planName, setPlanName] = useState('')
  const [editingPlanName, setEditingPlanName] = useState(false)
  const [updatedPlanName, setUpdatedPlanName] = useState('')
  const [zoneName, setZoneName] = useState('')
  const [addingZone, setAddingZone] = useState(false)
  const [renamingZone, setRenamingZone] = useState<ProjectZone | null>(null)
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
  const addZoneTrigger = useRef<HTMLButtonElement | null>(null)
  const renameZoneTrigger = useRef<HTMLButtonElement | null>(null)
  const previousConfirmation = useRef(false)
  const previousCancelTask = useRef(false)
  const previousAddingZone = useRef(false)
  const previousRenamingZone = useRef(false)
  const dialogOpen = Boolean(confirmation || cancelTask)

  useEffect(() => {
    if (error) errorMessage.current?.focus()
  }, [error, errorContext])

  useEffect(() => {
    if (previousAddingZone.current && !addingZone) {
      addZoneTrigger.current?.focus()
    }
    if (previousRenamingZone.current && !renamingZone) {
      renameZoneTrigger.current?.focus()
    }
    previousAddingZone.current = addingZone
    previousRenamingZone.current = Boolean(renamingZone)
  }, [addingZone, renamingZone])

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
        } else if (caught instanceof HttpError && caught.status === 404) {
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

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null
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

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialogs()
    }
  }

  async function act(
    operation: () => Promise<unknown>,
    success: { area: NoticeArea; text: string },
    context?: string,
  ): Promise<boolean> {
    setError('')
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
      setRenamingZone(null)
      setEditingPlanName(false)
      setReloadKey((key) => key + 1)
      return true
    } catch (caught) {
      if (isForbidden(caught)) {
        setReadOnly(true)
      }
      setError(planningErrorMessage(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const created = await act(
      () => client.createPlan(projectId, { name: planName }),
      { area: 'plans', text: `已建立計畫「${planName.trim()}」。` },
      'plan-create',
    )
    if (created) setPlanName('')
  }

  async function saveZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await act(
      () => client.createZone(projectId, zoneName),
      { area: 'zones', text: `已新增分區「${zoneName.trim()}」。` },
      'zone',
    )
    if (saved) {
      setZoneName('')
      setAddingZone(false)
    }
  }

  async function renameZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!renamingZone) return
    const saved = await act(
      () => client.renameZone(projectId, renamingZone.id, zoneName),
      { area: 'zones', text: `已將分區改名為「${zoneName.trim()}」。` },
      'zone',
    )
    if (saved) {
      setZoneName('')
      setRenamingZone(null)
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPlan) return
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
      <p className="tpl-notice tpl-notice-ok" role="status">
        {notice.text}
      </p>
    ) : null

  if (accessDenied) {
    return (
      <section>
        <h2>無權限</h2>
        <p role="alert">你沒有這個專案的查核計畫讀取權限。</p>
        <p>
          <a href="/">返回工作台</a>
        </p>
      </section>
    )
  }

  if (projectNotFound) {
    return (
      <section>
        <h2>找不到專案</h2>
        <p role="alert">網址中的專案不存在或已刪除。</p>
        <p>
          <a href="/">返回工作台</a>
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="planning-heading" ref={pageContent}>
      <h2 id="planning-heading" ref={pageHeading} tabIndex={-1}>
        計畫與任務
      </h2>
      <p>計畫狀態由任務狀態自動推導；任務派出後才會提供給現場。</p>
      {projects[0] && <p>專案：{projects[0].name}</p>}
      {readOnly && <p role="status">目前為唯讀模式。</p>}
      {membersDenied && (
        <p role="status">沒有讀取可指派人員清單的權限；可略過建議指派。</p>
      )}
      {error && errorContext === 'page' && (
        <p ref={errorMessage} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {loading ? <p>載入中…</p> : null}

      {projects.length > 0 && (
        <>
          <section aria-labelledby="zones-heading">
            <h2 id="zones-heading">專案分區</h2>
            {noticeFor('zones')}
            {zonesDenied && (
              <p role="status">沒有讀取分區的權限；其他計畫功能仍可使用。</p>
            )}
            {zones.length === 0 ? <p>尚未設定分區。</p> : null}
            {zones.map((zone) => (
              <div key={zone.id}>
                {renamingZone?.id === zone.id ? (
                  <form
                    data-error-context="zone"
                    onSubmit={(event) => void renameZone(event)}
                  >
                    <label>
                      <span className="required-label">
                        分區名稱 <span aria-hidden="true">*</span>
                      </span>
                      <input
                        aria-describedby="zone-name-hint"
                        autoFocus
                        maxLength={128}
                        onChange={(event) => setZoneName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setRenamingZone(null)
                            setZoneName('')
                            setError('')
                          } else if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.form?.requestSubmit()
                          }
                        }}
                        required
                        value={zoneName}
                      />
                    </label>
                    <span id="zone-name-hint">請輸入分區名稱。</span>
                    {error && errorContext === 'zone' && (
                      <p ref={errorMessage} role="alert" tabIndex={-1}>
                        {error}
                      </p>
                    )}
                    <button disabled={busy} type="submit">
                      儲存名稱
                    </button>
                    <button
                      onClick={() => {
                        setRenamingZone(null)
                        setZoneName('')
                        setError('')
                      }}
                      type="button"
                    >
                      取消編輯
                    </button>
                  </form>
                ) : (
                  <>
                    {zone.name}{' '}
                    <button
                      disabled={busy || readOnly}
                      onClick={() => {
                        setError('')
                        renameZoneTrigger.current =
                          document.activeElement as HTMLButtonElement
                        setZoneName(zone.name)
                        setRenamingZone(zone)
                      }}
                      type="button"
                    >
                      重新命名
                    </button>{' '}
                  </>
                )}
                <button
                  disabled={busy || readOnly}
                  onClick={() =>
                    confirm(
                      `刪除分區「${zone.name}」？`,
                      () => client.deleteZone(projectId, zone.id),
                      { area: 'zones', text: `已刪除分區「${zone.name}」。` },
                    )
                  }
                  type="button"
                >
                  刪除
                </button>
              </div>
            ))}
            {!readOnly && !zonesDenied && !renamingZone && (
              <>
                <button
                  ref={addZoneTrigger}
                  onClick={() => {
                    setError('')
                    setAddingZone(true)
                    setZoneName('')
                  }}
                  type="button"
                >
                  ＋ 新增分區
                </button>
                {addingZone && (
                  <form
                    data-error-context="zone"
                    onSubmit={(event) => void saveZone(event)}
                  >
                    <label>
                      <span className="required-label">
                        分區名稱 <span aria-hidden="true">*</span>
                      </span>
                      <input
                        aria-describedby="zone-name-hint"
                        autoFocus
                        maxLength={128}
                        onChange={(event) => setZoneName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setAddingZone(false)
                            setZoneName('')
                            setError('')
                          } else if (event.key === 'Enter') {
                            event.preventDefault()
                            event.currentTarget.form?.requestSubmit()
                          }
                        }}
                        required
                        value={zoneName}
                      />
                    </label>
                    <span id="zone-name-hint">請輸入分區名稱。</span>
                    {error && errorContext === 'zone' && (
                      <p ref={errorMessage} role="alert" tabIndex={-1}>
                        {error}
                      </p>
                    )}
                    <button disabled={busy} type="submit">
                      新增分區
                    </button>
                    <button
                      onClick={() => {
                        setAddingZone(false)
                        setZoneName('')
                        setError('')
                      }}
                      type="button"
                    >
                      取消
                    </button>
                  </form>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="plans-heading">
            <h2 id="plans-heading">查核計畫</h2>
            {noticeFor('plans')}
            {plans.length === 0 ? <p>目前沒有計畫。</p> : null}
            <ul>
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    aria-current={selectedPlanId === plan.id}
                    onClick={() => {
                      setNotice(null)
                      setSelectedPlanId(plan.id)
                    }}
                    type="button"
                  >
                    {plan.name}（{PLAN_STATUS[plan.status]}）
                  </button>
                </li>
              ))}
            </ul>
            {!readOnly && (
              <form
                data-error-context="plan-create"
                onSubmit={(event) => void createPlan(event)}
              >
                <h3>建立計畫</h3>
                <label>
                  <span className="required-label">
                    計畫名稱 <span aria-hidden="true">*</span>
                  </span>
                  <input
                    aria-describedby={
                      errorContext === 'plan-create'
                        ? 'plan-name-hint plan-name-error'
                        : 'plan-name-hint'
                    }
                    aria-invalid={errorContext === 'plan-create' && !!error}
                    maxLength={128}
                    onChange={(event) => setPlanName(event.target.value)}
                    required
                    value={planName}
                  />
                </label>
                <span id="plan-name-hint">請輸入計畫名稱。</span>
                {error && errorContext === 'plan-create' && (
                  <p
                    id="plan-name-error"
                    ref={errorMessage}
                    role="alert"
                    tabIndex={-1}
                  >
                    {error}
                  </p>
                )}
                <button disabled={busy} type="submit">
                  建立計畫
                </button>
              </form>
            )}
          </section>

          {selectedPlan && selectedPlanDetail && (
            <section aria-labelledby="plan-detail-heading">
              <h2 id="plan-detail-heading">{selectedPlanDetail.name}</h2>
              <p>計畫狀態：{PLAN_STATUS[selectedPlanDetail.status]}</p>
              {noticeFor('plan-detail')}
              {!readOnly && (
                <>
                  <button
                    disabled={busy || selectedPlan.status === 'ARCHIVED'}
                    onClick={() => {
                      setError('')
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
              {editingPlanName && selectedPlan.status !== 'ARCHIVED' && (
                <form
                  data-error-context="plan-rename"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void act(
                      () =>
                        client.updatePlan(selectedPlan.id, {
                          name: updatedPlanName,
                        }),
                      { area: 'plan-detail', text: '已更新計畫名稱。' },
                      'plan-rename',
                    )
                  }}
                >
                  <label>
                    <span className="required-label">
                      計畫名稱 <span aria-hidden="true">*</span>
                    </span>
                    <input
                      aria-describedby={
                        errorContext === 'plan-rename'
                          ? 'updated-plan-name-hint updated-plan-name-error'
                          : 'updated-plan-name-hint'
                      }
                      aria-invalid={errorContext === 'plan-rename' && !!error}
                      maxLength={128}
                      onChange={(event) =>
                        setUpdatedPlanName(event.target.value)
                      }
                      required
                      value={updatedPlanName}
                    />
                  </label>
                  <span id="updated-plan-name-hint">請輸入計畫名稱。</span>
                  {error && errorContext === 'plan-rename' && (
                    <p
                      id="updated-plan-name-error"
                      ref={errorMessage}
                      role="alert"
                      tabIndex={-1}
                    >
                      {error}
                    </p>
                  )}
                  <button disabled={busy} type="submit">
                    儲存計畫名稱
                  </button>
                  <button
                    onClick={() => setEditingPlanName(false)}
                    type="button"
                  >
                    取消編輯
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
                      <h4>
                        {taskTitle(task)} （{TASK_STATUS[task.status]}）
                      </h4>
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
                      {canEditPlan && !readOnly && (
                        <div>
                          {task.status === 'DRAFT' && (
                            <>
                              <button
                                disabled={busy}
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
                                onClick={() =>
                                  setEditingLocation({
                                    task,
                                    zoneId: task.zone_id ?? '',
                                    locationText: task.location_text ?? '',
                                  })
                                }
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
                      {editingLocation?.task.id === task.id && (
                        <form
                          data-error-context="location"
                          onSubmit={(event) => {
                            event.preventDefault()
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
                            )
                          }}
                        >
                          {zones.length > 0 && !zonesDenied && (
                            <label>
                              <span className="required-label">
                                分區 <span aria-hidden="true">*</span>
                              </span>
                              <select
                                aria-describedby="location-zone-hint"
                                onChange={(event) =>
                                  setEditingLocation({
                                    ...editingLocation,
                                    zoneId: event.target.value,
                                  })
                                }
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
                              <span id="location-zone-hint">
                                請選擇任務分區。
                              </span>
                            </label>
                          )}
                          <label>
                            補充地點
                            <input
                              maxLength={256}
                              onChange={(event) =>
                                setEditingLocation({
                                  ...editingLocation,
                                  locationText: event.target.value,
                                })
                              }
                              value={editingLocation.locationText}
                            />
                          </label>
                          <button disabled={busy} type="submit">
                            儲存地點
                          </button>
                          {error && errorContext === 'location' && (
                            <p ref={errorMessage} role="alert" tabIndex={-1}>
                              {error}
                            </p>
                          )}
                        </form>
                      )}
                      {editingAssignee?.task.id === task.id && (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault()
                            void act(
                              () =>
                                client.setSuggestedAssignee(
                                  task.id,
                                  editingAssignee.assigneeId || null,
                                ),
                              { area: 'tasks', text: '已更新建議指派。' },
                            )
                          }}
                        >
                          <label>
                            建議指派人
                            <select
                              onChange={(event) =>
                                setEditingAssignee({
                                  ...editingAssignee,
                                  assigneeId: event.target.value,
                                })
                              }
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
                          <button disabled={busy} type="submit">
                            儲存指派
                          </button>
                        </form>
                      )}
                    </article>
                  </li>
                ))}
              </ul>

              {canEditPlan && !readOnly && (
                <form
                  data-error-context="task"
                  onSubmit={(event) => void createTask(event)}
                >
                  <h3>建立任務</h3>
                  <fieldset>
                    <legend>
                      選擇一筆以上查核項目 <span aria-hidden="true">*</span>
                    </legend>
                    <p>至少選擇一筆查核項目。</p>
                    {items.map((item) => (
                      <label key={item.id}>
                        <input
                          checked={taskItems.includes(item.id)}
                          onChange={(event) =>
                            toggleItem(item.id, event.target.checked)
                          }
                          type="checkbox"
                          value={item.id}
                        />
                        {item.title} — {item.instruction}
                      </label>
                    ))}
                  </fieldset>
                  {zones.length > 0 && !zonesDenied && (
                    <label>
                      <span className="required-label">
                        任務分區 <span aria-hidden="true">*</span>
                      </span>
                      <select
                        aria-describedby="task-zone-hint"
                        onChange={(event) => setTaskZoneId(event.target.value)}
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
                      <span id="task-zone-hint">請選擇任務分區。</span>
                    </label>
                  )}
                  {error && errorContext === 'task' && (
                    <p ref={errorMessage} role="alert" tabIndex={-1}>
                      {error}
                    </p>
                  )}
                  <label>
                    補充地點
                    <input
                      maxLength={256}
                      onChange={(event) => setTaskLocation(event.target.value)}
                      value={taskLocation}
                    />
                  </label>
                  <label>
                    建議指派人
                    <select
                      onChange={(event) => setAssigneeId(event.target.value)}
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
                  <button
                    disabled={busy || taskItems.length === 0}
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
        <section
          aria-labelledby="cancel-task-heading"
          aria-modal="true"
          className="planning-dialog"
          onKeyDown={handleDialogKeyDown}
          role="dialog"
        >
          <h2 id="cancel-task-heading" ref={cancelHeading} tabIndex={-1}>
            取消任務
          </h2>
          <p>取消後會保留任務資料；之後可以恢復到取消前狀態。</p>
          {error && errorContext === 'dialog' && (
            <p ref={errorMessage} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void act(
                () => client.cancelTask(cancelTask.id, cancelReason),
                { area: 'tasks', text: '已取消任務，之後可以恢復。' },
                'dialog',
              )
            }}
          >
            <label>
              <span className="required-label">
                取消原因 <span aria-hidden="true">*</span>
              </span>
              <textarea
                aria-describedby="cancel-reason-hint"
                onChange={(event) => setCancelReason(event.target.value)}
                required
                value={cancelReason}
              />
            </label>
            <span id="cancel-reason-hint">請填寫取消原因。</span>
            <button disabled={busy || !cancelReason.trim()} type="submit">
              確認取消
            </button>{' '}
            <button disabled={busy} onClick={closeDialogs} type="button">
              返回
            </button>
          </form>
        </section>
      )}

      {confirmation && (
        <section
          aria-labelledby="confirm-action-heading"
          aria-modal="true"
          className="planning-dialog"
          onKeyDown={handleDialogKeyDown}
          role="dialog"
        >
          <h2
            id="confirm-action-heading"
            ref={confirmationHeading}
            tabIndex={-1}
          >
            請確認操作
          </h2>
          <p>{confirmation.title}</p>
          {error && errorContext === 'dialog' && (
            <p ref={errorMessage} role="alert" tabIndex={-1}>
              {error}
            </p>
          )}
          <button
            className={confirmation.danger ? 'btn-danger' : undefined}
            disabled={busy || readOnly}
            onClick={() => void act(confirmation.action, confirmation.success)}
            type="button"
          >
            {confirmation.danger?.label ?? '確認'}
          </button>{' '}
          <button disabled={busy} onClick={closeDialogs} type="button">
            返回
          </button>
        </section>
      )}
    </section>
  )
}
