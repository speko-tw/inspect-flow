import { ManagementApiError, request } from '../api'

/** HTTP client for the frozen inspection-planning API contract. */

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
  project_id: string
  sequence: number
  title: string
  instruction: string
  source_template_name: string | null
  inspection_points: unknown[]
}

export interface TaskInspectionItem {
  id: string
  status: string
  needs_reinspection: boolean
  snapshots: Array<Record<string, unknown>>
  current_snapshot: {
    revision: number
    source_standard_revision: number
    title: string
    instruction: string
    source_template_name: string
    is_current: boolean
    inspection_points: unknown[]
  } | null
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

export interface InspectionTask {
  id: string
  project_id: string
  plan_id: string
  status: TaskStatus
  items: TaskInspectionItem[]
  assignee_id: string | null
  assignee: SuggestedAssignee | null
  zone_id: string | null
  zone: { id: string; name: string } | null
  location_text: string | null
  cancellation_reason: string | null
  cancelled_from: 'PENDING' | 'IN_PROGRESS' | null
  started_by: string | null
  completed_by: string | null
  created_at: string
  updated_at: string
}

export interface InspectionPlan {
  id: string
  project_id: string
  name: string
  status: PlanStatus
  archived: boolean
  created_at: string
  updated_at: string
  tasks?: InspectionTask[]
}

export interface PlanPage {
  items: InspectionPlan[]
  next_cursor: string | null
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

export class PlanningApiError extends ManagementApiError {
  constructor(status: number, code: string) {
    super(status, code)
  }
}

/**
 * The operation names map one-to-one to the frozen planning endpoint table.
 * State values are read-only response data; there is no arbitrary status
 * update operation.
 */
export interface PlanningClient {
  /** GET /projects/{project_id}. */
  getProject(projectId: string): Promise<PlanningProject>
  /** GET /api/v1/projects/{project_id}/inspection-items. */
  listProjectItems(projectId: string): Promise<ProjectInspectionItem[]>
  /** GET /api/v1/projects/{project_id}/zones. */
  listProjectZones(projectId: string): Promise<ProjectZone[]>
  /** GET /projects/{project_id}/inspection-task-assignees. */
  listProjectAssignees(projectId: string): Promise<SuggestedAssignee[]>
  /** POST /api/v1/projects/{project_id}/zones. */
  createZone(projectId: string, name: string): Promise<ProjectZone>
  /** PATCH /api/v1/projects/{project_id}/zones/{zone_id}. */
  renameZone(
    projectId: string,
    zoneId: string,
    name: string,
  ): Promise<ProjectZone>
  /** DELETE /api/v1/projects/{project_id}/zones/{zone_id}. */
  deleteZone(projectId: string, zoneId: string): Promise<void>
  /** GET /api/v1/projects/{project_id}/inspection-plans?cursor={cursor}. */
  listPlans(projectId: string, cursor?: string | null): Promise<PlanPage>
  /** GET /api/v1/inspection-plans/{plan_id}. */
  getPlan(planId: string): Promise<InspectionPlan>
  /** GET /api/v1/inspection-tasks/{task_id}. */
  getTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/projects/{project_id}/inspection-plans. */
  createPlan(
    projectId: string,
    input: CreatePlanInput,
  ): Promise<InspectionPlan>
  /** PATCH /api/v1/inspection-plans/{plan_id}. */
  updatePlan(
    planId: string,
    input: Partial<CreatePlanInput>,
  ): Promise<InspectionPlan>
  /** POST /api/v1/inspection-plans/{plan_id}/tasks. */
  createTask(planId: string, input: CreateTaskInput): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:assign. */
  setSuggestedAssignee(
    taskId: string,
    assigneeId: string | null,
  ): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:start. */
  startTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:complete. */
  completeTask(taskId: string): Promise<InspectionTask>
  /** PATCH /api/v1/inspection-tasks/{task_id}. */
  updateLocation(
    taskId: string,
    input: UpdateLocationInput,
  ): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:dispatch. */
  dispatchTask(taskId: string): Promise<InspectionTask>
  /** DELETE /api/v1/inspection-tasks/{task_id}. */
  deleteDraftTask(taskId: string): Promise<void>
  /** POST /api/v1/inspection-tasks/{task_id}:cancel. */
  cancelTask(taskId: string, reason: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-tasks/{task_id}:restore. */
  restoreTask(taskId: string): Promise<InspectionTask>
  /** POST /api/v1/inspection-plans/{plan_id}:archive. */
  archivePlan(planId: string): Promise<InspectionPlan>
  /** POST /api/v1/inspection-plans/{plan_id}:unarchive. */
  unarchivePlan(planId: string): Promise<InspectionPlan>
}

async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  let cursor: string | null = null
  do {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    const page = await request<{ items: T[]; next_cursor: string | null }>(
      `${path}?${params.toString()}`,
    )
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

export const planningClient: PlanningClient = {
  async getProject(projectId) {
    const project = await request<{ id: string; name: string }>(
      `/projects/${projectId}`,
    )
    return { id: project.id, name: project.name }
  },
  listProjectItems(projectId) {
    return allPages(`/projects/${projectId}/inspection-items`)
  },
  listProjectZones(projectId) {
    return allPages(`/projects/${projectId}/zones`)
  },
  listProjectAssignees(projectId) {
    return allPages(`/projects/${projectId}/inspection-task-assignees`)
  },
  createZone(projectId, name) {
    return request(`/projects/${projectId}/zones`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
  },
  renameZone(projectId, zoneId, name) {
    return request(`/projects/${projectId}/zones/${zoneId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  },
  deleteZone(projectId, zoneId) {
    return request(`/projects/${projectId}/zones/${zoneId}`, {
      method: 'DELETE',
    })
  },
  async listPlans(projectId, cursor) {
    const params = new URLSearchParams({ limit: '100' })
    if (cursor) params.set('cursor', cursor)
    return request(`/projects/${projectId}/inspection-plans?${params}`)
  },
  getPlan(planId) {
    return request(`/inspection-plans/${planId}`)
  },
  getTask(taskId) {
    return request(`/inspection-tasks/${taskId}`)
  },
  createPlan(projectId, input) {
    return request(`/projects/${projectId}/inspection-plans`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  updatePlan(planId, input) {
    return request(`/inspection-plans/${planId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  createTask(planId, input) {
    return request(`/inspection-plans/${planId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  setSuggestedAssignee(taskId, assigneeId) {
    return request(`/inspection-tasks/${taskId}:assign`, {
      method: 'POST',
      body: JSON.stringify({ assignee_id: assigneeId }),
    })
  },
  startTask(taskId) {
    return request(`/inspection-tasks/${taskId}:start`, { method: 'POST' })
  },
  completeTask(taskId) {
    return request(`/inspection-tasks/${taskId}:complete`, { method: 'POST' })
  },
  updateLocation(taskId, input) {
    return request(`/inspection-tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    })
  },
  dispatchTask(taskId) {
    return request(`/inspection-tasks/${taskId}:dispatch`, { method: 'POST' })
  },
  deleteDraftTask(taskId) {
    return request(`/inspection-tasks/${taskId}`, { method: 'DELETE' })
  },
  cancelTask(taskId, reason) {
    return request(`/inspection-tasks/${taskId}:cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },
  restoreTask(taskId) {
    return request(`/inspection-tasks/${taskId}:restore`, { method: 'POST' })
  },
  archivePlan(planId) {
    return request(`/inspection-plans/${planId}:archive`, { method: 'POST' })
  },
  unarchivePlan(planId) {
    return request(`/inspection-plans/${planId}:unarchive`, { method: 'POST' })
  },
}

export function planningErrorMessage(error: unknown): string {
  if (!(error instanceof ManagementApiError)) {
    return '目前無法完成操作，請稍後再試。'
  }
  if (error.status === 403) return '你沒有權限執行這項操作，畫面已切換為唯讀。'
  if (error.code === 'project_zone.name_conflict') {
    return '同一專案已有相同名稱的分區。'
  }
  if (error.code === 'project_zone.in_use') {
    return '分區已有任務使用，無法刪除。'
  }
  if (error.code === 'inspection_plan.archived')
    return '計畫已封存，無法修改。'
  if (error.code === 'inspection_task.invalid_transition')
    return '目前任務狀態不允許這項操作。'
  if (error.code === 'inspection_task.reason_required')
    return '請填寫取消原因。'
  if (error.code === 'inspection_task.location_locked')
    return '目前任務狀態無法修改地點。'
  if (error.code === 'resource.not_found')
    return '找不到資料，請重新整理後再試。'
  if (error.status === 422) return '輸入資料不符合規格，請檢查後再試。'
  if (error.status === 409) return '目前狀態不允許這項操作，請重新整理。'
  if (error.status === 404) return '找不到資料，請重新整理後再試。'
  return '目前無法完成操作，請稍後再試。'
}
