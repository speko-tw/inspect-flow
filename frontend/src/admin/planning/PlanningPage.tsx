import { useEffect, useState, type FormEvent } from 'react'

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

function taskTitle(task: InspectionTask): string {
  return task.items.map((item) => item.title).join('、')
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined
  }
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

export default function PlanningPage({
  client = planningClient,
}: {
  client?: PlanningClient
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
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [planName, setPlanName] = useState('')
  const [editingPlanName, setEditingPlanName] = useState(false)
  const [updatedPlanName, setUpdatedPlanName] = useState('')
  const [zoneName, setZoneName] = useState('')
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
  } | null>(null)

  useEffect(() => {
    let active = true
    async function loadProjects() {
      setLoading(true)
      setError('')
      try {
        const nextProjects = await client.listProjects()
        if (active) {
          setProjects(nextProjects)
          const firstProjectId = nextProjects[0]?.id ?? ''
          setProjectId((current) =>
            nextProjects.some((project) => project.id === current)
              ? current
              : firstProjectId,
          )
          if (!firstProjectId) setLoading(false)
        }
      } catch (caught) {
        if (active) {
          if (statusOf(caught) === 403) setReadOnly(true)
          setError(planningErrorMessage(caught))
          setLoading(false)
        }
      }
    }
    void loadProjects()
    return () => {
      active = false
    }
  }, [client])

  useEffect(() => {
    if (!projectId) return
    let active = true
    async function loadProjectData() {
      setLoading(true)
      setError('')
      setItems([])
      setZones([])
      setMembers([])
      setPlans([])
      try {
        const [nextItems, nextZones, nextMembers, nextPlans] =
          await Promise.all([
            client.listProjectItems(projectId),
            client.listProjectZones(projectId),
            client.listProjectMembers(projectId),
            client.listPlans(projectId),
          ])
        if (active) {
          setItems(nextItems)
          setZones(nextZones)
          setMembers(nextMembers)
          setPlans(nextPlans)
        }
      } catch (caught) {
        if (active) {
          if (statusOf(caught) === 403) setReadOnly(true)
          setError(planningErrorMessage(caught))
          setItems([])
          setZones([])
          setMembers([])
          setPlans([])
          setSelectedPlanId('')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadProjectData()
    return () => {
      active = false
    }
  }, [client, projectId, reloadKey])

  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null
  const canEditPlan = Boolean(selectedPlan && !selectedPlan.archived)

  async function act(operation: () => Promise<unknown>): Promise<boolean> {
    setError('')
    setBusy(true)
    try {
      await operation()
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
      if (statusOf(caught) === 403) setReadOnly(true)
      setError(planningErrorMessage(caught))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function changeProject(nextProjectId: string) {
    if (nextProjectId === projectId) return
    setProjectId(nextProjectId)
    setSelectedPlanId('')
    setItems([])
    setZones([])
    setMembers([])
    setPlans([])
    setTaskItems([])
    setTaskZoneId('')
    setTaskLocation('')
    setAssigneeId('')
    setPlanName('')
    setEditingPlanName(false)
    setUpdatedPlanName('')
    setZoneName('')
    setRenamingZone(null)
    setEditingLocation(null)
    setEditingAssignee(null)
    setCancelTask(null)
    setCancelReason('')
    setConfirmation(null)
    setError('')
    setLoading(true)
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const created = await act(() =>
      client.createPlan(projectId, { name: planName }),
    )
    if (created) setPlanName('')
  }

  async function saveZone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const saved = await act(() =>
      renamingZone
        ? client.renameZone(projectId, renamingZone.id, zoneName)
        : client.createZone(projectId, zoneName),
    )
    if (saved) setZoneName('')
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedPlan) return
    const created = await act(() =>
      client.createTask(selectedPlan.id, {
        item_ids: taskItems,
        suggested_assignee_id: assigneeId || null,
        zone_id: zones.length ? taskZoneId || null : null,
        location_text: taskLocation.trim() || null,
      }),
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

  return (
    <section aria-labelledby="planning-heading">
      <h1 id="planning-heading">計畫與任務</h1>
      <p>計畫狀態由任務狀態自動推導；任務派出後才會提供給現場。</p>
      {readOnly && <p role="status">目前為唯讀模式。</p>}
      {error && <p role="alert">{error}</p>}
      {loading ? <p>載入中…</p> : null}

      {!loading && (
        <>
          <label>
            專案
            <select
              disabled={busy}
              onChange={(event) => void changeProject(event.target.value)}
              value={projectId}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          {projects.length === 0 ? (
            <p>目前沒有可管理的專案。</p>
          ) : (
            <>
              <section aria-labelledby="zones-heading">
                <h2 id="zones-heading">專案分區</h2>
                {zones.length === 0 ? <p>尚未設定分區。</p> : null}
                {zones.map((zone) => (
                  <p key={zone.id}>
                    {zone.name}{' '}
                    <button
                      disabled={busy || readOnly}
                      onClick={() => {
                        setRenamingZone(zone)
                        setZoneName(zone.name)
                      }}
                      type="button"
                    >
                      改名
                    </button>{' '}
                    <button
                      disabled={busy || readOnly}
                      onClick={() =>
                        setConfirmation({
                          title: `刪除分區「${zone.name}」？`,
                          action: () => client.deleteZone(projectId, zone.id),
                        })
                      }
                      type="button"
                    >
                      刪除
                    </button>
                  </p>
                ))}
                {!readOnly && (
                  <form onSubmit={(event) => void saveZone(event)}>
                    <h3>{renamingZone ? '修改分區名稱' : '新增分區'}</h3>
                    <label>
                      分區名稱
                      <input
                        maxLength={128}
                        onChange={(event) => setZoneName(event.target.value)}
                        required
                        value={zoneName}
                      />
                    </label>
                    <button disabled={busy} type="submit">
                      {renamingZone ? '儲存名稱' : '新增分區'}
                    </button>
                    {renamingZone && (
                      <button
                        onClick={() => {
                          setRenamingZone(null)
                          setZoneName('')
                        }}
                        type="button"
                      >
                        取消編輯
                      </button>
                    )}
                  </form>
                )}
              </section>

              <section aria-labelledby="plans-heading">
                <h2 id="plans-heading">查核計畫</h2>
                {plans.length === 0 ? <p>目前沒有計畫。</p> : null}
                <ul>
                  {plans.map((plan) => (
                    <li key={plan.id}>
                      <button
                        aria-current={selectedPlanId === plan.id}
                        onClick={() => setSelectedPlanId(plan.id)}
                        type="button"
                      >
                        {plan.name}（{PLAN_STATUS[plan.status]}）
                      </button>
                    </li>
                  ))}
                </ul>
                {!readOnly && (
                  <form onSubmit={(event) => void createPlan(event)}>
                    <h3>建立計畫</h3>
                    <label>
                      計畫名稱
                      <input
                        maxLength={128}
                        onChange={(event) => setPlanName(event.target.value)}
                        required
                        value={planName}
                      />
                    </label>
                    <button disabled={busy} type="submit">
                      建立計畫
                    </button>
                  </form>
                )}
              </section>

              {selectedPlan && (
                <section aria-labelledby="plan-detail-heading">
                  <h2 id="plan-detail-heading">{selectedPlan.name}</h2>
                  <p>計畫狀態：{PLAN_STATUS[selectedPlan.status]}</p>
                  {!readOnly && (
                    <>
                      <button
                        disabled={busy || selectedPlan.archived}
                        onClick={() => {
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
                          setConfirmation({
                            title: selectedPlan.archived
                              ? '取消封存計畫並依目前任務重算狀態？'
                              : '封存計畫？封存期間任務將唯讀。',
                            action: () =>
                              selectedPlan.archived
                                ? client.unarchivePlan(selectedPlan.id)
                                : client.archivePlan(selectedPlan.id),
                          })
                        }
                        type="button"
                      >
                        {selectedPlan.archived ? '取消封存' : '封存計畫'}
                      </button>
                    </>
                  )}
                  {editingPlanName && !selectedPlan.archived && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault()
                        void act(() =>
                          client.updatePlan(selectedPlan.id, {
                            name: updatedPlanName,
                          }),
                        )
                      }}
                    >
                      <label>
                        計畫名稱
                        <input
                          maxLength={128}
                          onChange={(event) =>
                            setUpdatedPlanName(event.target.value)
                          }
                          required
                          value={updatedPlanName}
                        />
                      </label>
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
                  {selectedPlan.tasks.length === 0 ? (
                    <p>尚未建立任務。</p>
                  ) : null}
                  <ul>
                    {selectedPlan.tasks.map((task) => (
                      <li key={task.id}>
                        <article>
                          <h4>
                            {taskTitle(task)} （{TASK_STATUS[task.status]}）
                          </h4>
                          {task.location.zone && (
                            <p>分區：{task.location.zone.name}</p>
                          )}
                          {task.location.location_text && (
                            <p>補充地點：{task.location.location_text}</p>
                          )}
                          <p>
                            建議指派：
                            {task.suggested_assignee?.name_zh ??
                              task.suggested_assignee?.username ??
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
                                      setConfirmation({
                                        title:
                                          '派出此任務？派出後現場即可查看。',
                                        action: () =>
                                          client.dispatchTask(task.id),
                                      })
                                    }
                                    type="button"
                                  >
                                    派出任務
                                  </button>{' '}
                                  <button
                                    disabled={busy}
                                    onClick={() =>
                                      setConfirmation({
                                        title: '永久刪除此草稿任務？',
                                        action: () =>
                                          client.deleteDraftTask(task.id),
                                      })
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
                                        zoneId: task.location.zone?.id ?? '',
                                        locationText:
                                          task.location.location_text ?? '',
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
                                        assigneeId:
                                          task.suggested_assignee?.id ?? '',
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
                                  onClick={() => setCancelTask(task)}
                                  type="button"
                                >
                                  取消任務
                                </button>
                              )}
                              {task.status === 'CANCELLED' && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    setConfirmation({
                                      title: '恢復此任務至取消前狀態？',
                                      action: () =>
                                        client.restoreTask(task.id),
                                    })
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
                              onSubmit={(event) => {
                                event.preventDefault()
                                void act(() =>
                                  client.updateLocation(task.id, {
                                    zone_id: zones.length
                                      ? editingLocation.zoneId || null
                                      : null,
                                    location_text:
                                      editingLocation.locationText.trim() ||
                                      null,
                                  }),
                                )
                              }}
                            >
                              {zones.length > 0 && (
                                <label>
                                  分區
                                  <select
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
                            </form>
                          )}
                          {editingAssignee?.task.id === task.id && (
                            <form
                              onSubmit={(event) => {
                                event.preventDefault()
                                void act(() =>
                                  client.setSuggestedAssignee(
                                    task.id,
                                    editingAssignee.assigneeId || null,
                                  ),
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
                    <form onSubmit={(event) => void createTask(event)}>
                      <h3>建立任務</h3>
                      <fieldset>
                        <legend>選擇一筆以上查核項目</legend>
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
                            {item.sequence}. {item.title} — {item.instruction}
                          </label>
                        ))}
                      </fieldset>
                      {zones.length > 0 && (
                        <label>
                          任務分區
                          <select
                            onChange={(event) =>
                              setTaskZoneId(event.target.value)
                            }
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
                      )}
                      <label>
                        補充地點
                        <input
                          maxLength={256}
                          onChange={(event) =>
                            setTaskLocation(event.target.value)
                          }
                          value={taskLocation}
                        />
                      </label>
                      <label>
                        建議指派人
                        <select
                          onChange={(event) =>
                            setAssigneeId(event.target.value)
                          }
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
        </>
      )}

      {cancelTask && (
        <section aria-labelledby="cancel-task-heading">
          <h2 id="cancel-task-heading">取消任務</h2>
          <p>取消後會保留任務資料；之後可以恢復到取消前狀態。</p>
          <label>
            取消原因
            <textarea
              onChange={(event) => setCancelReason(event.target.value)}
              required
              value={cancelReason}
            />
          </label>
          <button
            disabled={busy || !cancelReason.trim()}
            onClick={() =>
              setConfirmation({
                title: '確認取消此任務並保存原因？',
                action: () => client.cancelTask(cancelTask.id, cancelReason),
              })
            }
            type="button"
          >
            確認取消
          </button>{' '}
          <button
            onClick={() => {
              setCancelTask(null)
              setCancelReason('')
            }}
            type="button"
          >
            返回
          </button>
        </section>
      )}

      {confirmation && (
        <section aria-labelledby="confirm-action-heading" role="group">
          <h2 id="confirm-action-heading">請確認操作</h2>
          <p>{confirmation.title}</p>
          <button
            disabled={busy || readOnly}
            onClick={() => void act(confirmation.action)}
            type="button"
          >
            確認
          </button>{' '}
          <button
            disabled={busy}
            onClick={() => setConfirmation(null)}
            type="button"
          >
            返回
          </button>
        </section>
      )}
    </section>
  )
}
