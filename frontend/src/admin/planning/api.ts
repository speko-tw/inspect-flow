import { ManagementApiError } from '../api'

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

export interface InspectionTask {
  id: string
  plan_id: string
  status: TaskStatus
  items: ProjectInspectionItem[]
  assignee_id: string | null
  zone_id: string | null
  zone: { id: string; name: string } | null
  location_text: string | null
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
  /**
   * GET /api/v1/projects/{project_id}; TODO(#361): allow project inspectors.
   */
  getProject(projectId: string): Promise<PlanningProject>
  /** GET /api/v1/projects; used by the development-only project picker. */
  listProjects(): Promise<PlanningProject[]>
  /** GET /api/v1/projects/{project_id}/inspection-items. */
  listProjectItems(projectId: string): Promise<ProjectInspectionItem[]>
  /** GET /api/v1/projects/{project_id}/zones. */
  listProjectZones(projectId: string): Promise<ProjectZone[]>
  /** GET /api/v1/projects/{project_id}/members. */
  listProjectMembers(projectId: string): Promise<SuggestedAssignee[]>
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

const unavailableClient: PlanningClient = new Proxy({} as PlanningClient, {
  get: () => async () => {
    throw new ManagementApiError(501, 'inspection_planning.not_implemented')
  },
})

/** The mock module is loaded only by development builds. */
function createDevelopmentClient(): PlanningClient {
  let clientPromise: Promise<PlanningClient> | null = null
  return new Proxy({} as PlanningClient, {
    get:
      (_target, operation: keyof PlanningClient) =>
      async (...args: unknown[]) => {
        clientPromise ??= import('./api.mock').then(
          ({ createMockPlanningClient }) => createMockPlanningClient(),
        )
        const client = await clientPromise
        const method = client[operation]
        if (typeof method !== 'function') {
          throw new Error('Unknown planning operation')
        }
        return Reflect.apply(method, client, args)
      },
  })
}

export const planningClient: PlanningClient = import.meta.env.DEV
  ? createDevelopmentClient()
  : unavailableClient

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
  // TODO(#361): Replace status fallbacks when the API error contract lands.
  if (error.status === 422) return '輸入資料不符合規格，請檢查後再試。'
  if (error.status === 409) return '目前狀態不允許這項操作，請重新整理。'
  if (error.status === 404) return '找不到資料，請重新整理後再試。'
  if (error.status === 501) return '查核計畫 API 尚未提供。'
  return '目前無法完成操作，請稍後再試。'
}
