/**
 * Inspection planning client contract. Paths and actions follow
 * docs/specs/inspection-planning/spec.md; the mock remains replaceable by the
 * HTTP implementation after the planning API is available.
 */

export type PlanStatus =
  'DRAFT' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED'

export type TaskStatus =
  'DRAFT' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export interface PlanningProject {
  id: string
  name: string
}

export interface ProjectInspectionItem {
  id: string
  sequence: number
  title: string
  instruction: string
}

export interface SuggestedAssignee {
  id: string
  username: string
  name_zh: string | null
}

export interface ProjectZone {
  id: string
  project_id: string
  name: string
}

export interface TaskLocation {
  zone: { id: string; name: string } | null
  location_text: string | null
}

export interface InspectionTask {
  id: string
  plan_id: string
  status: TaskStatus
  items: ProjectInspectionItem[]
  suggested_assignee: SuggestedAssignee | null
  location: TaskLocation
  cancellation_reason: string | null
  cancelled_from: 'PENDING' | 'IN_PROGRESS' | null
  started_by: string | null
  completed_by: string | null
}

export interface InspectionPlan {
  id: string
  project_id: string
  name: string
  status: PlanStatus
  archived: boolean
  tasks: InspectionTask[]
}

export interface CreatePlanInput {
  name: string
}

export interface CreateTaskInput {
  item_ids: string[]
  suggested_assignee_id: string | null
  zone_id: string | null
  location_text: string | null
}

export interface UpdateLocationInput {
  zone_id: string | null
  location_text: string | null
}

export class PlanningApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Planning API error (${status}): ${code}`)
  }
}

/**
 * The operation names map one-to-one to the frozen planning endpoint table.
 * State values are read-only response data; there is no arbitrary status
 * update operation.
 */
export interface PlanningClient {
  listProjects(): Promise<PlanningProject[]>
  listProjectItems(projectId: string): Promise<ProjectInspectionItem[]>
  listProjectZones(projectId: string): Promise<ProjectZone[]>
  listProjectMembers(projectId: string): Promise<SuggestedAssignee[]>
  createZone(projectId: string, name: string): Promise<ProjectZone>
  renameZone(
    projectId: string,
    zoneId: string,
    name: string,
  ): Promise<ProjectZone>
  deleteZone(projectId: string, zoneId: string): Promise<void>
  listPlans(projectId: string): Promise<InspectionPlan[]>
  createPlan(
    projectId: string,
    input: CreatePlanInput,
  ): Promise<InspectionPlan>
  updatePlan(
    planId: string,
    input: Partial<CreatePlanInput>,
  ): Promise<InspectionPlan>
  createTask(planId: string, input: CreateTaskInput): Promise<InspectionTask>
  setSuggestedAssignee(
    taskId: string,
    assigneeId: string | null,
  ): Promise<InspectionTask>
  startTask(taskId: string): Promise<InspectionTask>
  completeTask(taskId: string): Promise<InspectionTask>
  updateLocation(
    taskId: string,
    input: UpdateLocationInput,
  ): Promise<InspectionTask>
  dispatchTask(taskId: string): Promise<InspectionTask>
  deleteDraftTask(taskId: string): Promise<void>
  cancelTask(taskId: string, reason: string): Promise<InspectionTask>
  restoreTask(taskId: string): Promise<InspectionTask>
  archivePlan(planId: string): Promise<InspectionPlan>
  unarchivePlan(planId: string): Promise<InspectionPlan>
}

const PROJECTS: PlanningProject[] = [
  { id: 'project-demo-1', name: '示範工程 A' },
  { id: 'project-demo-2', name: '示範工程 B' },
]

const ITEMS: Record<string, ProjectInspectionItem[]> = {
  'project-demo-1': [
    {
      id: 'item-demo-1',
      sequence: 1,
      title: '混凝土外觀',
      instruction: '確認表面無明顯裂縫或蜂窩。',
    },
    {
      id: 'item-demo-2',
      sequence: 2,
      title: '鋼筋保護層',
      instruction: '依核定圖說檢查保護層厚度。',
    },
    {
      id: 'item-demo-3',
      sequence: 3,
      title: '施工縫處理',
      instruction: '確認施工縫清潔與止水處理。',
    },
  ],
  'project-demo-2': [
    {
      id: 'item-demo-4',
      sequence: 1,
      title: '材料進場查驗',
      instruction: '核對材料標示及出廠文件。',
    },
  ],
}

const MEMBERS: Record<string, SuggestedAssignee[]> = {
  'project-demo-1': [
    { id: 'project-a-member-1', username: 'field-one', name_zh: '現場人員甲' },
    { id: 'project-a-member-2', username: 'field-two', name_zh: '現場人員乙' },
  ],
  'project-demo-2': [
    {
      id: 'project-b-member-1',
      username: 'field-three',
      name_zh: '專案 B 現場人員',
    },
  ],
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function derivedStatus(plan: InspectionPlan): PlanStatus {
  if (plan.archived) return 'ARCHIVED'
  const tasks = plan.tasks
  if (tasks.length === 0 || tasks.some((task) => task.status === 'DRAFT')) {
    return tasks.some((task) => task.status !== 'DRAFT')
      ? 'IN_PROGRESS'
      : 'DRAFT'
  }
  const activeTasks = tasks.filter((task) => task.status !== 'CANCELLED')
  if (activeTasks.length === 0) return 'CANCELLED'
  if (activeTasks.every((task) => task.status === 'COMPLETED')) {
    return 'COMPLETED'
  }
  return 'IN_PROGRESS'
}

function normalizedName(name: string): string {
  return name
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replaceAll('ß', 'ss')
    .replaceAll('ς', 'σ')
}

function characterCount(value: string): number {
  return Array.from(value).length
}

/** Create an isolated client with mutable in-memory data for UI tests. */
export function createMockPlanningClient(options?: {
  actingUserId?: string
  completionReady?: boolean
}): PlanningClient {
  const zones: ProjectZone[] = []
  const plans: InspectionPlan[] = []
  const actingUserId = options?.actingUserId ?? 'project-a-member-2'
  const completionReady = options?.completionReady ?? false

  function project(projectId: string): PlanningProject {
    const found = PROJECTS.find((entry) => entry.id === projectId)
    if (!found) throw new PlanningApiError(404, 'project.not_found')
    return found
  }

  function planForTask(taskId: string): {
    plan: InspectionPlan
    task: InspectionTask
  } {
    const plan = plans.find((entry) =>
      entry.tasks.some((task) => task.id === taskId),
    )
    const task = plan?.tasks.find((entry) => entry.id === taskId)
    if (!plan || !task)
      throw new PlanningApiError(404, 'inspection_task.not_found')
    return { plan, task }
  }

  function getPlan(planId: string): InspectionPlan {
    const found = plans.find((entry) => entry.id === planId)
    if (!found) throw new PlanningApiError(404, 'inspection_plan.not_found')
    return found
  }

  function editable(plan: InspectionPlan, task: InspectionTask): void {
    if (
      plan.archived ||
      !['DRAFT', 'PENDING', 'IN_PROGRESS'].includes(task.status)
    ) {
      throw new PlanningApiError(409, 'inspection_task.read_only')
    }
  }

  function findZone(
    projectId: string,
    zoneId: string | null,
  ): ProjectZone | null {
    if (zoneId === null) return null
    const zone = zones.find(
      (entry) => entry.id === zoneId && entry.project_id === projectId,
    )
    if (!zone) throw new PlanningApiError(422, 'project_zone.invalid')
    return zone
  }

  function validateLocation(
    projectId: string,
    input: UpdateLocationInput,
  ): TaskLocation {
    const projectZones = zones.filter((zone) => zone.project_id === projectId)
    const zone = findZone(projectId, input.zone_id)
    if (projectZones.length > 0 && zone === null) {
      throw new PlanningApiError(422, 'project_zone.required')
    }
    if (projectZones.length === 0 && input.zone_id !== null) {
      throw new PlanningApiError(422, 'project_zone.not_allowed')
    }
    const locationText = input.location_text?.trim() ?? ''
    if (characterCount(locationText) > 256) {
      throw new PlanningApiError(422, 'inspection_task.location_too_long')
    }
    return {
      zone: zone ? { id: zone.id, name: zone.name } : null,
      location_text: locationText || null,
    }
  }

  return {
    async listProjects() {
      return clone(PROJECTS)
    },
    async listProjectItems(projectId) {
      project(projectId)
      return clone(ITEMS[projectId] ?? [])
    },
    async listProjectZones(projectId) {
      project(projectId)
      return clone(zones.filter((zone) => zone.project_id === projectId))
    },
    async listProjectMembers(projectId) {
      project(projectId)
      return clone(MEMBERS[projectId] ?? [])
    },
    async createZone(projectId, rawName) {
      project(projectId)
      const name = rawName.trim()
      if (!name || characterCount(name) > 128) {
        throw new PlanningApiError(422, 'project_zone.name_invalid')
      }
      if (
        zones.some(
          (zone) =>
            zone.project_id === projectId &&
            normalizedName(zone.name) === normalizedName(name),
        )
      ) {
        throw new PlanningApiError(409, 'project_zone.name_conflict')
      }
      const zone = { id: crypto.randomUUID(), project_id: projectId, name }
      zones.push(zone)
      return clone(zone)
    },
    async renameZone(projectId, zoneId, rawName) {
      project(projectId)
      const zone = zones.find(
        (entry) => entry.id === zoneId && entry.project_id === projectId,
      )
      if (!zone) throw new PlanningApiError(404, 'project_zone.not_found')
      const name = rawName.trim()
      if (!name || characterCount(name) > 128) {
        throw new PlanningApiError(422, 'project_zone.name_invalid')
      }
      if (
        zones.some(
          (entry) =>
            entry.id !== zoneId &&
            entry.project_id === projectId &&
            normalizedName(entry.name) === normalizedName(name),
        )
      ) {
        throw new PlanningApiError(409, 'project_zone.name_conflict')
      }
      zone.name = name
      for (const currentPlan of plans) {
        for (const task of currentPlan.tasks) {
          if (task.location.zone?.id === zoneId) {
            task.location.zone.name = name
          }
        }
      }
      return clone(zone)
    },
    async deleteZone(projectId, zoneId) {
      project(projectId)
      const index = zones.findIndex(
        (entry) => entry.id === zoneId && entry.project_id === projectId,
      )
      if (index < 0) throw new PlanningApiError(404, 'project_zone.not_found')
      if (
        plans.some((entry) =>
          entry.tasks.some((task) => task.location.zone?.id === zoneId),
        )
      ) {
        throw new PlanningApiError(409, 'project_zone.in_use')
      }
      zones.splice(index, 1)
    },
    async listPlans(projectId) {
      project(projectId)
      return clone(plans.filter((entry) => entry.project_id === projectId))
    },
    async createPlan(projectId, input) {
      project(projectId)
      const name = input.name.trim()
      if (!name || characterCount(name) > 128) {
        throw new PlanningApiError(422, 'inspection_plan.name_invalid')
      }
      const plan: InspectionPlan = {
        id: crypto.randomUUID(),
        project_id: projectId,
        name,
        status: 'DRAFT',
        archived: false,
        tasks: [],
      }
      plans.push(plan)
      return clone(plan)
    },
    async updatePlan(planId, input) {
      const plan = getPlan(planId)
      if (plan.archived) {
        throw new PlanningApiError(409, 'inspection_plan.archived')
      }
      if (input.name !== undefined) {
        const name = input.name.trim()
        if (!name || characterCount(name) > 128) {
          throw new PlanningApiError(422, 'inspection_plan.name_invalid')
        }
        plan.name = name
      }
      return clone(plan)
    },
    async createTask(planId, input) {
      const plan = getPlan(planId)
      if (plan.archived)
        throw new PlanningApiError(409, 'inspection_plan.archived')
      if (input.item_ids.length === 0) {
        throw new PlanningApiError(422, 'inspection_task.items_required')
      }
      const projectZones = zones.filter(
        (zone) => zone.project_id === plan.project_id,
      )
      if (projectZones.length > 0 && input.zone_id === null) {
        throw new PlanningApiError(422, 'project_zone.required')
      }
      if (projectZones.length === 0 && input.zone_id !== null) {
        throw new PlanningApiError(422, 'project_zone.not_allowed')
      }
      const itemById = new Map(
        (ITEMS[plan.project_id] ?? []).map((item) => [item.id, item]),
      )
      const items = input.item_ids.map((id) => {
        const item = itemById.get(id)
        if (!item) throw new PlanningApiError(422, 'inspection_item.invalid')
        return clone(item)
      })
      const location = validateLocation(plan.project_id, input)
      const assignee = (MEMBERS[plan.project_id] ?? []).find(
        (person) => person.id === input.suggested_assignee_id,
      )
      if (input.suggested_assignee_id && !assignee) {
        throw new PlanningApiError(422, 'user.not_found')
      }
      const task: InspectionTask = {
        id: crypto.randomUUID(),
        plan_id: planId,
        status: 'DRAFT',
        items,
        suggested_assignee: assignee ? clone(assignee) : null,
        location,
        cancellation_reason: null,
        cancelled_from: null,
        started_by: null,
        completed_by: null,
      }
      plan.tasks.push(task)
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async setSuggestedAssignee(taskId, assigneeId) {
      const { plan, task } = planForTask(taskId)
      editable(plan, task)
      const assignee = (MEMBERS[plan.project_id] ?? []).find(
        (entry) => entry.id === assigneeId,
      )
      if (assigneeId && !assignee) {
        throw new PlanningApiError(422, 'user.not_found')
      }
      task.suggested_assignee = assignee ? clone(assignee) : null
      return clone(task)
    },
    async startTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.archived || task.status !== 'PENDING') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.status = 'IN_PROGRESS'
      task.started_by = actingUserId
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async completeTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.archived || task.status !== 'IN_PROGRESS') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      if (!completionReady) {
        throw new PlanningApiError(422, 'inspection_task.data_incomplete')
      }
      task.status = 'COMPLETED'
      task.completed_by = actingUserId
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async updateLocation(taskId, input) {
      const { plan, task } = planForTask(taskId)
      editable(plan, task)
      task.location = validateLocation(plan.project_id, input)
      return clone(task)
    },
    async dispatchTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.archived || task.status !== 'DRAFT') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.status = 'PENDING'
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async deleteDraftTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.archived || task.status !== 'DRAFT') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      plan.tasks.splice(plan.tasks.indexOf(task), 1)
      plan.status = derivedStatus(plan)
    },
    async cancelTask(taskId, rawReason) {
      const { plan, task } = planForTask(taskId)
      if (plan.archived || !['PENDING', 'IN_PROGRESS'].includes(task.status)) {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      const reason = rawReason.trim()
      if (!reason)
        throw new PlanningApiError(422, 'inspection_task.reason_required')
      if (task.status !== 'PENDING' && task.status !== 'IN_PROGRESS') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.cancelled_from = task.status
      task.status = 'CANCELLED'
      task.cancellation_reason = reason
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async restoreTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (
        plan.archived ||
        task.status !== 'CANCELLED' ||
        !task.cancelled_from
      ) {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.status = task.cancelled_from
      task.cancelled_from = null
      task.cancellation_reason = null
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async archivePlan(planId) {
      const plan = getPlan(planId)
      plan.archived = true
      plan.status = 'ARCHIVED'
      return clone(plan)
    },
    async unarchivePlan(planId) {
      const plan = getPlan(planId)
      plan.archived = false
      plan.status = derivedStatus(plan)
      return clone(plan)
    },
  }
}

/** A shared mock makes the unfinished API usable across page navigation. */
export const planningClient = createMockPlanningClient()

export function planningErrorMessage(error: unknown): string {
  if (!(error instanceof PlanningApiError)) {
    return '目前無法完成操作，請稍後再試。'
  }
  if (error.status === 403) return '你沒有權限執行這項操作，畫面已切換為唯讀。'
  if (error.code === 'project_zone.name_conflict') {
    return '同一專案已有相同名稱的分區。'
  }
  if (error.code === 'project_zone.in_use') {
    return '分區已有任務使用，無法刪除。'
  }
  if (error.code === 'project_zone.required') {
    return '此專案已設定分區，請選擇一個分區。'
  }
  if (error.code === 'project_zone.invalid') {
    return '所選分區不屬於目前專案。'
  }
  if (error.code === 'inspection_task.reason_required') {
    return '請填寫取消原因。'
  }
  if (error.status === 422) return '輸入資料不符合規格，請檢查後再試。'
  if (error.status === 409) return '目前狀態不允許這項操作，請重新整理。'
  if (error.status === 404) return '找不到資料，請重新整理後再試。'
  return '目前無法完成操作，請稍後再試。'
}
