import { PlanningApiError } from './api'
import type {
  InspectionPlan,
  InspectionTask,
  TaskInspectionItem,
  PlanStatus,
  PlanningClient,
  PlanningProject,
  ProjectInspectionItem,
  ProjectZone,
  SuggestedAssignee,
  UpdateLocationInput,
} from './api'

interface TaskLocation {
  zone: { id: string; name: string } | null
  location_text: string | null
}

interface MockPlan extends InspectionPlan {
  tasks: InspectionTask[]
}

const PROJECTS: PlanningProject[] = [
  { id: 'project-demo-1', name: '示範工程 A' },
  { id: 'project-demo-2', name: '示範工程 B' },
]

const ITEMS: Record<string, ProjectInspectionItem[]> = {
  'project-demo-1': [
    {
      id: 'item-demo-1',
      project_id: 'project-demo-1',
      source_template_name: '示範範本',
      inspection_points: [],
      sequence: 1,
      title: '混凝土外觀',
      instruction: '確認表面無明顯裂縫或蜂窩。',
    },
    {
      id: 'item-demo-2',
      project_id: 'project-demo-1',
      source_template_name: '示範範本',
      inspection_points: [],
      sequence: 2,
      title: '鋼筋保護層',
      instruction: '依核定圖說檢查保護層厚度。',
    },
    {
      id: 'item-demo-3',
      project_id: 'project-demo-1',
      source_template_name: '示範範本',
      inspection_points: [],
      sequence: 3,
      title: '施工縫處理',
      instruction: '確認施工縫清潔與止水處理。',
    },
  ],
  'project-demo-2': [
    {
      id: 'item-demo-4',
      project_id: 'project-demo-2',
      source_template_name: '示範範本',
      inspection_points: [],
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

function derivedStatus(plan: MockPlan): PlanStatus {
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
  const plans: MockPlan[] = []
  const actingUserId = options?.actingUserId ?? 'project-a-member-2'
  const completionReady = options?.completionReady ?? false

  function project(projectId: string): PlanningProject {
    const found = PROJECTS.find((entry) => entry.id === projectId)
    if (!found) throw new PlanningApiError(404, 'project.not_found')
    return found
  }

  function planForTask(taskId: string): {
    plan: MockPlan
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

  function getPlan(planId: string): MockPlan {
    const found = plans.find((entry) => entry.id === planId)
    if (!found) throw new PlanningApiError(404, 'inspection_plan.not_found')
    return found
  }

  function editable(plan: MockPlan, task: InspectionTask): void {
    if (
      plan.status === 'ARCHIVED' ||
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
    async getProject(projectId) {
      return clone(project(projectId))
    },
    async listProjectItems(projectId) {
      project(projectId)
      return clone(ITEMS[projectId] ?? [])
    },
    async listProjectZones(projectId) {
      project(projectId)
      return clone(zones.filter((zone) => zone.project_id === projectId))
    },
    async listProjectAssignees(projectId) {
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
          if (task.zone?.id === zoneId) {
            task.zone.name = name
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
          entry.tasks.some((task) => task.zone?.id === zoneId),
        )
      ) {
        throw new PlanningApiError(409, 'project_zone.in_use')
      }
      zones.splice(index, 1)
    },
    async listPlans(projectId, cursor) {
      project(projectId)
      const matching = plans.filter((entry) => entry.project_id === projectId)
      const offset = cursor ? Number(cursor) : 0
      const items = matching.slice(offset, offset + 20).map((entry) => ({
        id: entry.id,
        project_id: entry.project_id,
        name: entry.name,
        status: entry.status,
        archived: entry.status === 'ARCHIVED',
        created_at: entry.created_at,
        updated_at: entry.updated_at,
      }))
      const next = offset + items.length
      return clone({
        items,
        next_cursor: next < matching.length ? String(next) : null,
      })
    },
    async getPlan(planId) {
      return clone(getPlan(planId))
    },
    async getTask(taskId) {
      return clone(planForTask(taskId).task)
    },
    async createPlan(projectId, input) {
      project(projectId)
      const name = input.name.trim()
      if (!name || characterCount(name) > 128) {
        throw new PlanningApiError(422, 'inspection_plan.name_invalid')
      }
      const plan: MockPlan = {
        id: crypto.randomUUID(),
        project_id: projectId,
        name,
        status: 'DRAFT',
        archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        tasks: [],
      }
      plans.push(plan)
      return clone(plan)
    },
    async updatePlan(planId, input) {
      const plan = getPlan(planId)
      if (plan.status === 'ARCHIVED') {
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
      if (plan.status === 'ARCHIVED')
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
      const items: TaskInspectionItem[] = input.item_ids.map((id) => {
        const item = itemById.get(id)
        if (!item)
          throw new PlanningApiError(
            422,
            'inspection_task.invalid_project_item',
          )
        const snapshot = {
          revision: 1,
          source_standard_revision: 1,
          title: item.title,
          instruction: item.instruction,
          source_template_name: item.source_template_name ?? '示範範本',
          is_current: true,
          inspection_points: item.inspection_points,
        }
        return {
          id: item.id,
          status: 'PENDING',
          needs_reinspection: false,
          snapshots: [snapshot],
          current_snapshot: snapshot,
        }
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
        project_id: plan.project_id,
        plan_id: planId,
        status: 'DRAFT',
        items,
        assignee_id: assignee?.id ?? null,
        assignee: assignee ?? null,
        zone_id: location.zone?.id ?? null,
        zone: location.zone,
        location_text: location.location_text,
        cancellation_reason: null,
        cancelled_from: null,
        started_by: null,
        completed_by: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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
      task.assignee_id = assignee?.id ?? null
      task.assignee = assignee ?? null
      return clone(task)
    },
    async startTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.status === 'ARCHIVED' || task.status !== 'PENDING') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.status = 'IN_PROGRESS'
      task.started_by = actingUserId
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async completeTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.status === 'ARCHIVED' || task.status !== 'IN_PROGRESS') {
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
      const location = validateLocation(plan.project_id, input)
      task.zone_id = location.zone?.id ?? null
      task.zone = location.zone
      task.location_text = location.location_text
      return clone(task)
    },
    async dispatchTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.status === 'ARCHIVED' || task.status !== 'DRAFT') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      task.status = 'PENDING'
      plan.status = derivedStatus(plan)
      return clone(task)
    },
    async deleteDraftTask(taskId) {
      const { plan, task } = planForTask(taskId)
      if (plan.status === 'ARCHIVED' || task.status !== 'DRAFT') {
        throw new PlanningApiError(409, 'inspection_task.invalid_transition')
      }
      plan.tasks.splice(plan.tasks.indexOf(task), 1)
      plan.status = derivedStatus(plan)
    },
    async cancelTask(taskId, rawReason) {
      const { plan, task } = planForTask(taskId)
      if (
        plan.status === 'ARCHIVED' ||
        !['PENDING', 'IN_PROGRESS'].includes(task.status)
      ) {
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
        plan.status === 'ARCHIVED' ||
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
      plan.status = 'ARCHIVED'
      return clone(plan)
    },
    async unarchivePlan(planId) {
      const plan = getPlan(planId)
      plan.status = derivedStatus(plan)
      return clone(plan)
    },
  }
}
